import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'node:path';
import dotenv from 'dotenv';
import authRouter from './spotifyAuth';
import * as gm from './gameManager';

dotenv.config();
gm.initSongs();

// Countdown shown on the host before a song plays, used to buffer the track.
const PLAYBACK_COUNTDOWN_MS = 3000;

const allowedOrigins = new Set(
  (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
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
    if (game.phase === 'betting' && round && game.phaseEndsAt) {
      socket.emit('round_start', {
        roundIndex: game.roundIndex,
        total: game.totalRounds,
        hints: round.hints,
        bettingTime: game.bettingTime,
        endsAt: game.phaseEndsAt,
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

  // ── Host: rejoin after reconnect ──────────────────────────────────────────
  socket.on('rejoin_host', ({ pin }: { pin: string }, callback: (r: { players: { name: string }[] }) => void) => {
    const game = gm.getGame(pin);
    if (!game) return;
    game.hostSocketId = socket.id;
    socket.join(pin);
    socket.join(`host:${pin}`);
    gm.updateSocketPin(socket.id, pin);
    callback({ players: Array.from(game.players.values()).map(p => ({ name: p.name })) });
  });

  // ── Player: join game (lobby or mid-game) ─────────────────────────────────
  socket.on(
    'join_game',
    ({ pin, name }: { pin: string; name: string }, callback: (r: { error?: string; success?: boolean }) => void) => {
      const game = gm.getGame(pin);
      if (!game) return callback({ error: 'Game not found' });

      // Mid-game: if this name is already in the game, it's a full-disconnect
      // rejoin — migrate the socket ID and snap to the current phase.
      if (game.phase !== 'lobby') {
        const rejoined = gm.rejoinPlayer(game, socket.id, name);
        if (rejoined) {
          socket.join(pin);
          socket.join(`player:${pin}`);
          callback({ success: true });
          syncState(game);
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
    const player = gm.rejoinPlayer(game, socket.id, name);
    if (!player) return callback?.({ ok: false });
    socket.join(pin);
    socket.join(`player:${pin}`);
    callback?.({ ok: true });
    syncState(game);
  });

  // ── Host: start game → first round ────────────────────────────────────────
  socket.on('start_game', (payload?: { settings?: { bettingTime?: number; guessingTime?: number; totalRounds?: number } }) => {
    const game = gm.getGameBySocket(socket.id);
    if (game?.hostSocketId !== socket.id || game.phase !== 'lobby') return;
    const s = payload?.settings;
    if (s?.bettingTime) game.bettingTime = Math.max(5, Math.min(60, Math.round(s.bettingTime)));
    if (s?.guessingTime) game.guessingTime = Math.max(5, Math.min(60, Math.round(s.guessingTime)));
    if (s?.totalRounds) game.totalRounds = Math.max(1, Math.min(30, Math.round(s.totalRounds)));
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
    // Cancel fallback; start guessing timer from actual playback start
    if (game.phaseTimer) clearTimeout(game.phaseTimer);
    game.phaseTimer = setTimeout(() => startGuessingPhase(game), gm.playMsFor(game.currentRound!.lowestBid));
  });

  // ── Player: submit guess ───────────────────────────────────────────────────
  socket.on('submit_guess', ({ text }: { text: string }, callback?: (r: { correct: boolean }) => void) => {
    const game = gm.getGameBySocket(socket.id);
    if (!game) return callback?.({ correct: false });

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
        points: result.points,
      });
      io.to(game.pin).emit('score_update', {
        players: Array.from(game.players.values()).map(p => ({ name: p.name, score: p.score })),
      });
    } else if (result.allDone) {
      // Everyone in the tier has had their one guess — hand off / reveal.
      advanceTierOrReveal(game);
    }
  });

  // ── Player: skip guess ─────────────────────────────────────────────────────
  socket.on('skip_guess', () => {
    const game = gm.getGameBySocket(socket.id);
    if (!game) return;
    const result = gm.skipGuess(game, socket.id);
    if (!result) return;
    // Once everyone in the tier is done, hand off to the next tier / reveal.
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
    const result = gm.removeSocket(socket.id);
    if (!result) return;
    const { game, wasHost } = result;
    if (wasHost) {
      io.to(game.pin).emit('host_disconnected');
      gm.cleanupGame(game.pin);
    } else {
      io.to(`host:${game.pin}`).emit('player_left', {
        players: Array.from(game.players.values()).map(p => ({ name: p.name })),
      });
    }
  });

  // ── Round lifecycle (server-driven timing) ─────────────────────────────────
  function beginRound(game: ReturnType<typeof gm.getGame> & object) {
    if (!game) return;
    const round = gm.startRound(game);
    const bettingEndsAt = Date.now() + game.bettingTime * 1000;
    game.phaseEndsAt = bettingEndsAt;

    io.to(`player:${game.pin}`).emit('round_start', {
      roundIndex: game.roundIndex,
      total: game.totalRounds,
      hints: round.hints,
      bettingTime: game.bettingTime,
      endsAt: bettingEndsAt,
    });
    io.to(`host:${game.pin}`).emit('host_round_start', {
      roundIndex: game.roundIndex,
      total: game.totalRounds,
      hints: round.hints,
      bettingTime: game.bettingTime,
      endsAt: bettingEndsAt,
      song: {
        title: round.song.title,
        artist: round.song.artist,
        trackId: round.song.spotifyTrackId,
      },
    });

    // Extra 500ms lets last-second auto-submits from clients arrive before we close.
    game.phaseTimer = setTimeout(() => closeBettingAndPlay(game), game.bettingTime * 1000 + 500);
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
        points: 0,
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
      points: 0,
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
