import express from 'express';
import { createServer } from 'node:http';
import { randomInt } from 'node:crypto';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'node:path';
import dotenv from 'dotenv';
import authRouter from './spotifyAuth';
import * as gm from './gameManager';
import { getAlbumArtUrl } from './albumArt';

dotenv.config();
gm.initSongs();

// Countdown shown on the host before a song plays, used to buffer the track.
const PLAYBACK_COUNTDOWN_MS = 3000;

// Grace periods before treating a disconnect as permanent.
const HOST_GRACE_MS = 60_000;
const PLAYER_GRACE_MS = 30_000;

// pin → pending host-disconnect timer
const hostDisconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
// socketId → pending player-disconnect timer
const playerDisconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();

// IP → timestamps of recent create_game calls (for rate limiting)
const createGameAttempts = new Map<string, number[]>();
const CREATE_GAME_LIMIT = 5;
const CREATE_GAME_WINDOW_MS = 60 * 60 * 1000; // 1 hour

const allowedOrigins = new Set(
  (process.env.CORS_ORIGINS || process.env.FRONTEND_URL || '')
    .split(',')
    .map((origin) => {
      try { return new URL(origin.trim()).origin; } catch { return origin.trim(); }
    })
    .filter(Boolean),
);

const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.has(origin)) return callback(null, true);
    return callback(new Error('CORS origin not allowed'));
  },
  methods: ['GET', 'POST'],
};

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: corsOptions,
});

app.use(cors(corsOptions));
app.use(express.json());
app.use('/api/auth', authRouter);
app.get('/api/health', (_req, res) => res.json({ ok: true }));

if (process.env.NODE_ENV === 'production') {
  const clientDist = path.join(__dirname, '../../client/dist');
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

io.on('connection', (socket) => {
  console.log(`[socket] connected: ${socket.id}`);
  socket.on('disconnect', (reason) => console.log(`[socket] disconnected: ${socket.id} (${reason})`));

  // ── Host: create game ──────────────────────────────────────────────────────
  socket.on('create_game', (callback: (r: { pin?: string; error?: string }) => void) => {
    if (gm.activeGameCount() >= gm.MAX_ACTIVE_GAMES) {
      return callback({ error: 'Server is at capacity, try again later' });
    }

    const ip = socket.handshake.address;
    const now = Date.now();
    const attempts = (createGameAttempts.get(ip) ?? []).filter(t => now - t < CREATE_GAME_WINDOW_MS);
    if (attempts.length >= CREATE_GAME_LIMIT) {
      return callback({ error: 'Too many games created, try again later' });
    }
    createGameAttempts.set(ip, [...attempts, now]);

    const game = gm.createGame(socket.id);
    socket.join(game.pin);
    socket.join(`host:${game.pin}`);
    console.log(`[create_game] socket=${socket.id} pin=${game.pin} rooms=${[...socket.rooms].join(',')}`);
    callback({ pin: game.pin });
  });

  // Emit the right phase snapshot to this socket so a reconnecting or
  // mid-game-joining player jumps straight to where the game is.
  function syncState(game: NonNullable<ReturnType<typeof gm.getGame>>) {
    const round = game.currentRound;
    if (game.mode === 'race') {
      if (game.phase === 'guessing' && round?.playStartAt && game.phaseEndsAt) {
        if (!round.passed.has(socket.id)) {
          socket.emit('your_turn', { timeLimit: game.raceTime, endsAt: game.phaseEndsAt });
        }
      } else if (game.phase === 'finished') {
        socket.emit('game_over', { leaderboard: gm.getLeaderboard(game) });
      }
      return;
    }

    if (game.phase === 'betting' && round && game.phaseEndsAt) {
      socket.emit('round_start', {
        roundIndex: game.roundIndex,
        total: game.totalRounds,
        hints: round.hints,
        bettingTime: game.bettingTime,
        endsAt: game.phaseEndsAt,
        mode: 'classic',
      });
    } else if ((game.phase === 'playing' || game.phase === 'guessing') && round) {
      const guesserNames = round.guesserSocketIds
        .map(id => game.players.get(id)?.name ?? '')
        .filter(Boolean);
      socket.emit('betting_closed', { lowestBid: round.lowestBid, guesserNames, playerBids: [] });
      if (game.phase === 'guessing' && game.phaseEndsAt) {
        socket.emit('guessing_start', { guesserNames, timeLimit: game.guessingTime, endsAt: game.phaseEndsAt });
        if (round.guesserSocketIds.includes(socket.id) && !round.passed.has(socket.id)) {
          socket.emit('your_turn', { timeLimit: game.guessingTime, endsAt: game.phaseEndsAt });
        }
      }
    } else if (game.phase === 'finished') {
      socket.emit('game_over', { leaderboard: gm.getLeaderboard(game) });
    }
  }

  // ── Host: start a new game without a page reload ─────────────────────────
  socket.on('new_game', (callback: (r: { pin?: string; error?: string }) => void) => {
    const oldGame = gm.getGameBySocket(socket.id);
    if (oldGame?.hostSocketId !== socket.id) return callback({ error: 'Not a host' });
    const oldPin = oldGame.pin;

    // Cancel any pending player disconnect timers for this game.
    for (const sid of oldGame.players.keys()) {
      const t = playerDisconnectTimers.get(sid);
      if (t) { clearTimeout(t); playerDisconnectTimers.delete(sid); }
    }

    // Tear down old game state, then create the new one so we have its PIN.
    gm.cleanupGame(oldPin);
    const newGame = gm.createGame(socket.id);

    // Notify players still subscribed to the old room (Socket.IO rooms persist
    // independently of game state, so the emit reaches them before they leave).
    io.to(`player:${oldPin}`).emit('game_restarted', { newPin: newGame.pin });

    socket.leave(oldPin);
    socket.leave(`host:${oldPin}`);
    socket.join(newGame.pin);
    socket.join(`host:${newGame.pin}`);

    callback({ pin: newGame.pin });
  });

  // ── Host: rejoin after reconnect ──────────────────────────────────────────
  socket.on('rejoin_host', ({ pin }: { pin: string }, callback: (r: { players: { name: string }[] } | { error: string }) => void) => {
    const game = gm.getGame(pin);
    if (!game) return callback({ error: 'Game not found' });

    // Cancel the host grace-period timer so the game survives.
    const hostTimer = hostDisconnectTimers.get(pin);
    if (hostTimer) { clearTimeout(hostTimer); hostDisconnectTimers.delete(pin); }

    // Remove the stale host socket from the lookup table.
    if (game.hostSocketId !== socket.id) gm.removeSocket(game.hostSocketId);

    game.hostSocketId = socket.id;
    socket.join(pin);
    socket.join(`host:${pin}`);
    gm.updateSocketPin(socket.id, pin);
    io.to(game.pin).emit('host_reconnected');
    callback({ players: Array.from(game.players.values()).map(p => ({ name: p.name })) });
  });

  // ── Player: join game (lobby or mid-game) ─────────────────────────────────
  socket.on(
    'join_game',
    ({ pin, name }: { pin: string; name: string }, callback: (r: { error?: string; success?: boolean }) => void) => {
      const game = gm.getGame(pin);
      if (!game) return callback({ error: 'Game not found' });

      // Mid-game: if this name is already in the game, it's a full-disconnect
      // rejoin — cancel any pending removal timer, migrate the socket ID, and
      // snap to the current phase.
      if (game.phase !== 'lobby') {
        const oldEntry = Array.from(game.players.entries())
          .find(([, p]) => p.name.toLowerCase() === name.trim().toLowerCase());
        if (oldEntry) {
          const [oldId] = oldEntry;
          const t = playerDisconnectTimers.get(oldId);
          if (t) { clearTimeout(t); playerDisconnectTimers.delete(oldId); }
        }
        const rejoined = gm.rejoinPlayer(game, socket.id, name);
        if (rejoined) {
          socket.join(pin);
          socket.join(`player:${pin}`);
          callback({ success: true });
          syncState(game);
          io.to(`host:${pin}`).emit('player_reconnected', { name: rejoined.name });
          return;
        }
      }

      const player = gm.addPlayer(game, socket.id, name);
      if (!player) return callback({ error: 'Name already taken' });

      socket.join(pin);
      socket.join(`player:${pin}`);
      callback({ success: true });

      const players = Array.from(game.players.values()).map(p => ({ name: p.name }));
      io.to(`host:${pin}`).emit('player_joined', { players });

      // New player joining an in-progress game — sync them to the current phase.
      if (game.phase !== 'lobby') syncState(game);
    }
  );

  // ── Player: rejoin after reconnect ─────────────────────────────────────────
  socket.on('rejoin_player', ({ pin, name }: { pin: string; name: string }, callback?: (r: { ok: boolean }) => void) => {
    const game = gm.getGame(pin);
    if (!game) return callback?.({ ok: false });

    // Cancel any pending removal timer for this player.
    const oldEntry = Array.from(game.players.entries())
      .find(([, p]) => p.name.toLowerCase() === name.trim().toLowerCase());
    if (oldEntry) {
      const [oldId] = oldEntry;
      const t = playerDisconnectTimers.get(oldId);
      if (t) { clearTimeout(t); playerDisconnectTimers.delete(oldId); }
    }

    const player = gm.rejoinPlayer(game, socket.id, name);
    if (!player) return callback?.({ ok: false });
    socket.join(pin);
    socket.join(`player:${pin}`);
    callback?.({ ok: true });
    syncState(game);
    io.to(`host:${pin}`).emit('player_reconnected', { name: player.name });
  });

  // ── Host: start game → first round ────────────────────────────────────────
  socket.on('start_game', (payload?: { settings?: { bettingTime?: number; guessingTime?: number; totalRounds?: number; mode?: string; raceTime?: number; raceWinnerOnly?: boolean } }) => {
    const game = gm.getGameBySocket(socket.id);
    if (game?.hostSocketId !== socket.id || game.phase !== 'lobby') return;
    const s = payload?.settings;
    if (s?.bettingTime) game.bettingTime = Math.max(5, Math.min(60, Math.round(s.bettingTime)));
    if (s?.guessingTime) game.guessingTime = Math.max(5, Math.min(60, Math.round(s.guessingTime)));
    if (s?.totalRounds) game.totalRounds = Math.max(1, Math.min(30, Math.round(s.totalRounds)));
    game.mode = s?.mode === 'race' ? 'race' : 'classic';
    if (s?.raceTime) game.raceTime = Math.max(10, Math.min(60, Math.round(s.raceTime)));
    game.raceWinnerOnly = s?.raceWinnerOnly === true;
    game.roundIndex = 0;
    beginRound(game);
  });

  // ── Player: submit bid ─────────────────────────────────────────────────────
  socket.on('submit_bid', ({ seconds }: { seconds: number }, callback?: (r: { ok: boolean }) => void) => {
    const game = gm.getGameBySocket(socket.id);
    if (!game) return callback?.({ ok: false });
    const ok = gm.recordBid(game, socket.id, seconds);
    callback?.({ ok });
    if (!ok) return;

    const round = game.currentRound!;
    io.to(`host:${game.pin}`).emit('bid_received', {
      bidCount: round.bids.size,
      totalPlayers: game.players.size,
    });

    // Early close when every player has placed a bid
    if (round.bids.size >= game.players.size) {
      if (game.phaseTimer) clearTimeout(game.phaseTimer);
      closeBettingAndPlay(game);
    }
  });

  // ── Host: song playback confirmed ──────────────────────────────────────────
  socket.on('song_started', () => {
    const game = gm.getGameBySocket(socket.id);
    if (game?.hostSocketId !== socket.id || game.phase !== 'playing') return;
    if (game.phaseTimer) clearTimeout(game.phaseTimer);

    if (game.mode === 'race') {
      gm.markRaceStarted(game);
      const endsAt = game.currentRound!.playStartAt! + game.raceTime * 1000;
      game.phaseEndsAt = endsAt;
      io.to(`player:${game.pin}`).emit('your_turn', { timeLimit: game.raceTime, endsAt });
      game.phaseTimer = setTimeout(() => endRaceRound(game), game.raceTime * 1000);
    } else {
      game.phaseTimer = setTimeout(() => startGuessingPhase(game), gm.playMsFor(game.currentRound!.lowestBid));
    }
  });

  // ── Player: submit guess ───────────────────────────────────────────────────
  socket.on('submit_guess', ({ text }: { text: string }, callback?: (r: { correct: boolean; points?: number; timeMs?: number }) => void) => {
    const game = gm.getGameBySocket(socket.id);
    if (!game) return callback?.({ correct: false });

    if (game.mode === 'race') {
      const r = gm.recordRaceGuess(game, socket.id, text);
      if (!r) return callback?.({ correct: false });
      callback?.({ correct: r.correct, points: r.points, timeMs: r.elapsedMs });
      io.to(`host:${game.pin}`).emit('answer_received', {
        answered: game.currentRound!.passed.size,
        total: game.players.size,
      });
      if (r.allDone) endRaceRound(game);
      return;
    }

    const result = gm.recordGuess(game, socket.id, text);
    if (!result) return callback?.({ correct: false });

    callback?.({ correct: result.correct });

    const round = game.currentRound!;
    if (result.correct) {
      if (game.phaseTimer) clearTimeout(game.phaseTimer);
      game.phase = 'reveal';
      io.to(game.pin).emit('round_result', {
        correct: true,
        guesserName: result.guesserName,
        songTitle: round.song.title,
        artist: round.song.artist,
        year: round.song.year,
        coverUrl: round.coverUrl,
        points: result.points,
        playerGuesses: gm.getRoundGuesses(game),
      });
      io.to(game.pin).emit('score_update', {
        players: Array.from(game.players.values()).map(p => ({ name: p.name, score: p.score, streak: p.streak })),
      });
    } else if (result.allDone) {
      advanceTierOrReveal(game);
    }
  });

  // ── Player: skip guess ─────────────────────────────────────────────────────
  socket.on('skip_guess', () => {
    const game = gm.getGameBySocket(socket.id);
    if (!game) return;

    if (game.mode === 'race') {
      const r = gm.skipRaceGuess(game, socket.id);
      if (!r) return;
      io.to(`host:${game.pin}`).emit('answer_received', {
        answered: game.currentRound!.passed.size,
        total: game.players.size,
      });
      if (r.allDone) endRaceRound(game);
      return;
    }

    const result = gm.skipGuess(game, socket.id);
    if (!result) return;
    if (result.allDone) advanceTierOrReveal(game);
  });

  // ── Host: advance to next round ────────────────────────────────────────────
  socket.on('next_round', () => {
    const game = gm.getGameBySocket(socket.id);
    if (!game) return;
    if (game.hostSocketId !== socket.id) return;

    game.roundIndex += 1;
    if (game.roundIndex >= game.totalRounds) {
      game.phase = 'finished';
      io.to(game.pin).emit('game_over', { leaderboard: gm.getLeaderboard(game) });
      return;
    }
    beginRound(game);
  });

  // ── Disconnect ─────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    const game = gm.getGameBySocket(socket.id);
    if (!game) return;

    if (game.hostSocketId === socket.id) {
      // Give the host a grace window to reconnect before destroying the game.
      io.to(game.pin).emit('host_reconnecting');
      const timer = setTimeout(() => {
        hostDisconnectTimers.delete(game.pin);
        gm.removeSocket(socket.id);
        io.to(game.pin).emit('host_disconnected');
        gm.cleanupGame(game.pin);
      }, HOST_GRACE_MS);
      hostDisconnectTimers.set(game.pin, timer);
    } else {
      // Give the player a grace window to reconnect before removing them.
      const player = game.players.get(socket.id);
      if (!player) return;
      const sid = socket.id;
      io.to(`host:${game.pin}`).emit('player_reconnecting', { name: player.name });
      const timer = setTimeout(() => {
        playerDisconnectTimers.delete(sid);
        const removed = gm.removeSocket(sid);
        if (!removed) return; // already handled by rejoin
        io.to(`host:${removed.game.pin}`).emit('player_left', {
          players: Array.from(removed.game.players.values()).map(p => ({ name: p.name })),
        });
      }, PLAYER_GRACE_MS);
      playerDisconnectTimers.set(sid, timer);
    }
  });

  // ── Round lifecycle (server-driven timing) ─────────────────────────────────
  async function beginRound(game: ReturnType<typeof gm.getGame> & object) {
    if (!game) return;
    const round = gm.startRound(game);

    const coverUrl = await getAlbumArtUrl(round.song.spotifyTrackId);
    if (coverUrl) {
      round.coverUrl = coverUrl;
      if (game.mode === 'classic' && randomInt(4) === 0) {
        round.hints.push({ label: 'Album art', value: '', imageUrl: coverUrl });
      }
    }

    if (game.mode === 'race') {
      round.hints = [];
      game.phase = 'playing';
      game.phaseEndsAt = null;

      io.to(`player:${game.pin}`).emit('round_start', {
        roundIndex: game.roundIndex,
        total: game.totalRounds,
        hints: [],
        mode: 'race',
        raceTime: game.raceTime,
      });
      io.to(`host:${game.pin}`).emit('host_round_start', {
        roundIndex: game.roundIndex,
        total: game.totalRounds,
        hints: [],
        mode: 'race',
        raceTime: game.raceTime,
        song: {
          title: round.song.title,
          artist: round.song.artist,
          trackId: round.song.spotifyTrackId,
        },
      });

      io.to(`host:${game.pin}`).emit('play_song', {
        trackId: round.song.spotifyTrackId,
        durationMs: game.raceTime * 1000,
        countdownMs: PLAYBACK_COUNTDOWN_MS,
      });

      // Fallback: if host never confirms song_started, end the round after the window.
      game.phaseTimer = setTimeout(() => {
        if (game.phase === 'playing') {
          gm.markRaceStarted(game);
          endRaceRound(game);
        }
      }, game.raceTime * 1000 + PLAYBACK_COUNTDOWN_MS + 5000);
      return;
    }

    const bettingEndsAt = Date.now() + game.bettingTime * 1000;
    game.phaseEndsAt = bettingEndsAt;

    io.to(`player:${game.pin}`).emit('round_start', {
      roundIndex: game.roundIndex,
      total: game.totalRounds,
      hints: round.hints,
      bettingTime: game.bettingTime,
      endsAt: bettingEndsAt,
      mode: 'classic',
    });
    io.to(`host:${game.pin}`).emit('host_round_start', {
      roundIndex: game.roundIndex,
      total: game.totalRounds,
      hints: round.hints,
      bettingTime: game.bettingTime,
      endsAt: bettingEndsAt,
      mode: 'classic',
      song: {
        title: round.song.title,
        artist: round.song.artist,
        trackId: round.song.spotifyTrackId,
      },
    });

    // Extra 500ms lets last-second auto-submits from clients arrive before we close.
    game.phaseTimer = setTimeout(() => closeBettingAndPlay(game), game.bettingTime * 1000 + 500);
  }

  function endRaceRound(game: ReturnType<typeof gm.getGame> & object) {
    if (game.phase === 'reveal') return; // guard against timer + allDone race
    if (game.phaseTimer) clearTimeout(game.phaseTimer);
    const round = game.currentRound!;
    game.phase = 'reveal';
    const correctNames = Array.from(round.correctGuessers)
      .map(id => game.players.get(id)?.name ?? '')
      .filter(Boolean);
    io.to(game.pin).emit('round_result', {
      correct: round.correctGuessers.size > 0,
      guesserName: null,
      mode: 'race',
      correctGuessers: correctNames,
      songTitle: round.song.title,
      artist: round.song.artist,
      year: round.song.year,
      coverUrl: round.coverUrl,
      points: 0,
      playerGuesses: gm.getRoundGuesses(game),
    });
    io.to(game.pin).emit('score_update', {
      players: Array.from(game.players.values()).map(p => ({ name: p.name, score: p.score, streak: p.streak })),
    });
  }

  function closeBettingAndPlay(game: ReturnType<typeof gm.getGame> & object) {
    if (!game || game.phase !== 'betting') return;
    const round = game.currentRound!;
    const result = gm.closeBetting(game);
    if (!result) {
      // nobody bid — skip round
      io.to(game.pin).emit('round_result', {
        correct: false,
        guesserName: null,
        songTitle: round.song.title,
        artist: round.song.artist,
        year: round.song.year,
        coverUrl: round.coverUrl,
        points: 0,
        playerGuesses: [],
      });
      return;
    }
    playTier(game, result);
  }

  // Play the song for the current tier and queue its guessing phase. Reused both
  // for the opening (lowest) tier and each next-lowest tier that gets a turn.
  function playTier(
    game: ReturnType<typeof gm.getGame> & object,
    turn: gm.TierTurn,
  ) {
    if (game.phaseTimer) clearTimeout(game.phaseTimer);
    const round = game.currentRound!;
    const { lowestBid, guesserNames } = turn;
    const playerBids = Array.from(round.bids.entries())
      .map(([id, bid]) => ({ name: game.players.get(id)?.name ?? '', bid }))
      .filter(b => b.name);
    io.to(game.pin).emit('betting_closed', { lowestBid, guesserNames, playerBids });
    const durationMs = gm.playMsFor(lowestBid);
    io.to(`host:${game.pin}`).emit('play_song', {
      trackId: round.song.spotifyTrackId,
      durationMs,
      countdownMs: PLAYBACK_COUNTDOWN_MS,
    });

    // Fallback: start guessing if host never confirms song_started. The host
    // first runs a countdown (and buffers the track) before playback begins,
    // so allow for that plus the play duration plus slack.
    game.phaseTimer = setTimeout(() => {
      if (game.phase === 'playing') startGuessingPhase(game);
    }, durationMs + PLAYBACK_COUNTDOWN_MS + 5000);
  }

  // A tier ran out of guesses (all wrong, or time expired). Hand off to the
  // next-lowest bidders if there are any; otherwise reveal that nobody got it.
  function advanceTierOrReveal(game: ReturnType<typeof gm.getGame> & object) {
    const round = game.currentRound!;
    const next = gm.advanceTier(game);
    if (next) {
      playTier(game, next);
      return;
    }
    if (game.phaseTimer) clearTimeout(game.phaseTimer);
    game.phase = 'reveal';
    io.to(game.pin).emit('round_result', {
      correct: false,
      guesserName: null,
      songTitle: round.song.title,
      artist: round.song.artist,
      year: round.song.year,
      coverUrl: round.coverUrl,
      points: 0,
      playerGuesses: gm.getRoundGuesses(game),
    });
    io.to(game.pin).emit('score_update', {
      players: Array.from(game.players.values()).map(p => ({ name: p.name, score: p.score, streak: p.streak })),
    });
  }

  function startGuessingPhase(game: ReturnType<typeof gm.getGame> & object) {
    if (!game || game.phase !== 'playing') return;
    const round = game.currentRound!;
    const guesserSocketIds = round.guesserSocketIds;
    const guesserNames = guesserSocketIds
      .map(id => game.players.get(id)?.name ?? '')
      .filter(Boolean);

    if (game.phaseTimer) clearTimeout(game.phaseTimer);
    game.phase = 'guessing';
    const guessingEndsAt = Date.now() + game.guessingTime * 1000;
    game.phaseEndsAt = guessingEndsAt;
    io.to(game.pin).emit('guessing_start', { guesserNames, timeLimit: game.guessingTime, endsAt: guessingEndsAt });
    for (const sid of guesserSocketIds) {
      // Skip players who already got their turn early — don't reset their timer
      if (!round.earlyGuessers.has(sid)) {
        io.to(sid).emit('your_turn', { timeLimit: game.guessingTime, endsAt: guessingEndsAt });
      }
    }

    game.phaseTimer = setTimeout(() => {
      if (game.phase !== 'guessing' || round.answered) return;
      advanceTierOrReveal(game);
    }, game.guessingTime * 1000);
  }
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => console.log(`Server on port ${PORT}`));
