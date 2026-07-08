import express from 'express';
import { createServer } from 'node:http';
import { randomInt } from 'node:crypto';
import { Server } from 'socket.io';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import dotenv from 'dotenv';
import authRouter from './spotifyAuth';
import * as gm from './gameManager';
import { getAlbumArtUrl } from './albumArt';
import { Award, Game, PartyEvent, PlaylistTrackInput } from './types';

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

// Sweep out IPs whose attempts have all aged past the window, so the map
// doesn't grow for the lifetime of the process.
setInterval(() => {
  const now = Date.now();
  for (const [ip, times] of createGameAttempts) {
    const recent = times.filter(t => now - t < CREATE_GAME_WINDOW_MS);
    if (recent.length > 0) createGameAttempts.set(ip, recent);
    else createGameAttempts.delete(ip);
  }
}, CREATE_GAME_WINDOW_MS).unref();

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
    if (process.env.NODE_ENV !== 'production') return callback(null, true);
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
app.use(rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
}));
app.use('/api/auth', authRouter);
app.get('/api/health', (_req, res) => res.json({ ok: true }));

if (process.env.NODE_ENV === 'production') {
  const clientDist = path.join(__dirname, '../../client/dist');
  app.use(express.static(clientDist, {
    // index.html references content-hashed bundle filenames, so it must be
    // revalidated on every load; everything else (JS/CSS bundles, theme.mp3,
    // images) is safe to cache for a day instead of round-tripping to Railway
    // to revalidate on every single page load.
    setHeaders: (res, filePath) => {
      res.setHeader('Cache-Control', filePath.endsWith('.html') ? 'no-cache' : 'public, max-age=86400');
    },
  }));
  app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

interface StartGameSettings {
  bettingTime?: number; guessingTime?: number; totalRounds?: number; mode?: string;
  raceTime?: number; raceWinnerOnly?: boolean; artistOnly?: boolean; yearOnly?: boolean;
  difficulty?: string; songSource?: string;
  enabledEvents?: string[]; chaosLevel?: number;
  customPlaylist?: { id?: string; tracks?: PlaylistTrackInput[] };
}

function applyStartGameSettings(game: Game, s: StartGameSettings | undefined) {
  if (s?.bettingTime) game.bettingTime = Math.max(5, Math.min(999, Math.round(s.bettingTime)));
  if (s?.guessingTime) game.guessingTime = Math.max(5, Math.min(999, Math.round(s.guessingTime)));
  if (s?.totalRounds) game.totalRounds = Math.max(1, Math.min(999, Math.round(s.totalRounds)));
  if (s?.mode === 'race') game.mode = 'race';
  else if (s?.mode === 'party') game.mode = 'party';
  else game.mode = 'classic';
  if (s?.raceTime) game.raceTime = Math.max(10, Math.min(999, Math.round(s.raceTime)));

  // Party picks its own guess target per round, so these game-wide toggles
  // are Classic/Race only — leaving them set under Party would otherwise
  // leak a stale 'year' accent/target into party rounds client-side.
  const isParty = game.mode === 'party';
  game.yearOnly = !isParty && s?.yearOnly === true;
  // The client only ever shows this toggle in Race mode, and its one
  // useState persists across mode switches in the lobby — gate it here too,
  // or a stale `true` left over from a previous Race game would silently
  // force winner-take-all scoring onto Party's race-format rounds.
  game.raceWinnerOnly = game.mode === 'race' && s?.raceWinnerOnly === true;
  // Year isn't a title/artist target, so it can't coexist with artist-only.
  game.artistOnly = !isParty && !game.yearOnly && s?.artistOnly === true;
  game.difficulty = s?.difficulty === 'easy' || s?.difficulty === 'medium' ? s.difficulty : 'hard';

  game.chaosLevel = typeof s?.chaosLevel === 'number' && Number.isFinite(s.chaosLevel)
    ? Math.max(0, Math.min(100, s.chaosLevel))
    : 50;
  // A missing/non-array setting (never sent, or malformed) falls back to
  // "everything enabled". An explicit array — even filtered down to empty,
  // meaning the host unchecked every event — is respected as-is; the party
  // event picker already treats an empty pool as "always play plain".
  game.enabledEvents = Array.isArray(s?.enabledEvents)
    ? new Set(s.enabledEvents.filter((e): e is PartyEvent => (gm.ALL_PARTY_EVENTS as string[]).includes(e)))
    : new Set(gm.ALL_PARTY_EVENTS);
}

function applySongSource(game: Game, s: StartGameSettings | undefined): { ok: true } | { ok: false; error: string } {
  if (s?.songSource !== 'playlist') {
    game.songSource = 'library';
    game.songPool = undefined;
    game.playlistId = undefined;
    return { ok: true };
  }
  const tracks = s.customPlaylist?.tracks;
  if (!Array.isArray(tracks)) return { ok: false, error: 'No playlist selected' };
  return gm.setCustomSongPool(game, s.customPlaylist?.id, tracks);
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

  // Always send the player their current score so the client doesn't show 0
  // after a reconnect. This is a distinct event from `score_update` — that one
  // means "you just scored," and the client renders it as a round delta. This
  // is just a state sync, so it must not be mistaken for points just earned.
  function emitSelfScore(game: GameObj) {
    const selfPlayer = game.players.get(socket.id);
    if (selfPlayer) {
      socket.emit('score_sync', {
        score: selfPlayer.score,
        streak: selfPlayer.streak,
      });
    }
  }

  function emitRevealSnapshot(game: GameObj, round: RoundObj) {
    const isRace = gm.isRaceFlowRound(game, round);
    const correctGuessers = isRace
      ? Array.from(round.correctGuessers).map(id => game.players.get(id)?.name ?? '').filter(Boolean)
      : undefined;
    socket.emit('round_result', {
      correct: isRace ? round.correctGuessers.size > 0 : round.answered,
      guesserName: round.correctGuesserName ?? null,
      mode: isRace ? 'race' : undefined,
      correctGuessers,
      ...songFields(game, round),
      points: 0,
      playerGuesses: gm.getRoundGuesses(game),
      yearResults: round.yearResults,
      stealPending: stealPendingName(game, round),
    });
  }

  function emitRaceTurnSnapshot(game: GameObj, round: RoundObj | null) {
    if (!round) return;
    // Resend the round's own round_start first so a reconnecting client resets
    // its party/artistOnly/yearOnly state instead of keeping whatever the
    // previous round (which may have been a different format) left behind.
    socket.emit('round_start', {
      roundIndex: game.roundIndex,
      total: game.totalRounds,
      hints: round.hints,
      mode: 'race',
      raceTime: game.raceTime,
      artistOnly: game.artistOnly,
      yearOnly: game.yearOnly,
      party: gm.partyView(game, round),
      tempo: round.song.tempo,
    });
    if (game.phase === 'guessing' && round.playStartAt && game.phaseEndsAt && !round.passed.has(socket.id)) {
      socket.emit('your_turn', { timeLimit: game.raceTime, endsAt: game.phaseEndsAt });
    }
  }

  function emitClassicPhaseSnapshot(game: GameObj, round: RoundObj | null) {
    if (game.phase === 'betting' && round && game.phaseEndsAt) {
      socket.emit('round_start', {
        roundIndex: game.roundIndex,
        total: game.totalRounds,
        hints: round.hints,
        bettingTime: game.bettingTime,
        endsAt: game.phaseEndsAt,
        mode: 'classic',
        artistOnly: game.artistOnly,
        yearOnly: game.yearOnly,
        party: gm.partyView(game, round),
        bidOptions: gm.BID_OPTIONS,
        bidScores: gm.bidScoreTable(),
        tempo: round.song.tempo,
      });
      return;
    }

    if ((game.phase !== 'playing' && game.phase !== 'guessing') || !round) return;

    // Same as the betting branch above: resend round_start so a reconnecting
    // client resets party/artistOnly/yearOnly instead of keeping state from
    // whatever round (possibly a different format) it last saw before dropping.
    socket.emit('round_start', {
      roundIndex: game.roundIndex,
      total: game.totalRounds,
      hints: round.hints,
      mode: 'classic',
      artistOnly: game.artistOnly,
      yearOnly: game.yearOnly,
      party: gm.partyView(game, round),
      bidOptions: gm.BID_OPTIONS,
      bidScores: gm.bidScoreTable(),
      tempo: round.song.tempo,
    });

    const guesserNames = round.guesserSocketIds
      .map(id => game.players.get(id)?.name ?? '')
      .filter(Boolean);
    socket.emit('betting_closed', { lowestBid: round.lowestBid, guesserNames, playerBids: [] });
    if (game.phase !== 'guessing' || !game.phaseEndsAt) return;

    socket.emit('guessing_start', { guesserNames, timeLimit: game.guessingTime, endsAt: game.phaseEndsAt });
    if (round.guesserSocketIds.includes(socket.id) && !round.passed.has(socket.id)) {
      socket.emit('your_turn', { timeLimit: game.guessingTime, endsAt: game.phaseEndsAt });
    }
  }

  // Emit the right phase snapshot to this socket so a reconnecting or
  // mid-game-joining player jumps straight to where the game is.
  function syncState(game: GameObj) {
    emitSelfScore(game);
    const round = game.currentRound;

    if (game.phase === 'finished') {
      socket.emit('game_over', { leaderboard: gm.getLeaderboard(game), awards: gm.computeAwards(game) });
      return;
    }

    if (game.phase === 'leaderboard') {
      socket.emit('leaderboard', { leaderboard: gm.getLeaderboard(game) });
      return;
    }

    if (game.phase === 'reveal' && round) {
      emitRevealSnapshot(game, round);
      return;
    }

    if (raceFlow(game)) {
      emitRaceTurnSnapshot(game, round);
      return;
    }

    emitClassicPhaseSnapshot(game, round);
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

    // Tear down old game state, then create the new one. Reusing the old PIN
    // keeps QR codes, deep links and players' saved sessions valid.
    gm.cleanupGame(oldPin);
    const newGame = gm.createGame(socket.id, oldPin);

    // Notify players still subscribed to the old room (Socket.IO rooms persist
    // independently of game state, so the emit reaches them before they leave).
    io.to(`player:${oldPin}`).emit('game_restarted', { newPin: newGame.pin });

    // Then evict them from the rooms: the new game reuses the PIN, so anyone
    // lingering would otherwise receive events for a game they haven't joined.
    // Pressing "Play Again" re-joins the rooms via the normal join_game path.
    io.in(`player:${oldPin}`).socketsLeave([oldPin, `player:${oldPin}`]);

    socket.leave(oldPin);
    socket.leave(`host:${oldPin}`);
    socket.join(newGame.pin);
    socket.join(`host:${newGame.pin}`);

    callback({ pin: newGame.pin });
  });

  // ── Host: rejoin after reconnect or page reload ───────────────────────────
  // `fresh` marks a full page reload: the host client lost all round UI state,
  // so any round in flight can't be resumed. A plain socket reconnect (host
  // tab still alive) keeps the round running as before.
  socket.on('rejoin_host', ({ pin, fresh }: { pin: string; fresh?: boolean }, callback: (r: {
    players: { name: string; score: number; streak: number }[];
    phase: string; roundIndex: number; totalRounds: number;
    leaderboard: { rank: number; name: string; score: number }[];
    awards: Award[];
  } | { error: string }) => void) => {
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

    // After a reload mid-round, the safest resume point is the between-rounds
    // leaderboard: abandon the round in flight and park everyone there.
    if (fresh && game.phase !== 'lobby' && game.phase !== 'finished') {
      if (game.phaseTimer) clearTimeout(game.phaseTimer);
      game.phaseEndsAt = null;
      game.phase = 'leaderboard';
      io.to(`player:${pin}`).emit('leaderboard', { leaderboard: gm.getLeaderboard(game) });
    }

    callback({
      players: Array.from(game.players.values()).map(p => ({ name: p.name, score: p.score, streak: p.streak })),
      phase: game.phase,
      roundIndex: game.roundIndex,
      totalRounds: game.totalRounds,
      leaderboard: gm.getLeaderboard(game),
      awards: gm.computeAwards(game),
    });
  });

  // ── Player: check if a game PIN is still active ───────────────────────────
  socket.on('check_game', ({ pin }: { pin: string }, callback: (r: { exists: boolean }) => void) => {
    callback({ exists: !!gm.getGame(pin) });
  });

  // ── Player: join game (lobby or mid-game) ─────────────────────────────────
  socket.on(
    'join_game',
    ({ pin, name }: { pin: string; name: string }, callback: (r: { error?: string; success?: boolean }) => void) => {
      const game = gm.getGame(pin);
      if (!game) return callback({ error: 'Game not found' });

      // If this name is already in the game (lobby or mid-game), it's a
      // reconnect — cancel any pending removal timer, migrate the socket ID,
      // and snap to the current phase.
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
        if (game.phase === 'lobby') {
          const players = Array.from(game.players.values()).map(p => ({ name: p.name, score: p.score, streak: p.streak }));
          io.to(`host:${pin}`).emit('player_joined', { players });
        } else {
          syncState(game);
          io.to(`host:${pin}`).emit('player_reconnected', { name: rejoined.name, score: rejoined.score, streak: rejoined.streak });
        }
        return;
      }

      const player = gm.addPlayer(game, socket.id, name);
      if (!player) return callback({ error: 'Name already taken' });

      socket.join(pin);
      socket.join(`player:${pin}`);
      callback({ success: true });

      const players = Array.from(game.players.values()).map(p => ({ name: p.name, score: p.score, streak: p.streak }));
      io.to(`host:${pin}`).emit('player_joined', { players });

      // New player joining an in-progress game — sync them to the current phase.
      if (game.phase !== 'lobby') syncState(game);
    }
  );

  // ── Player: rename in lobby ────────────────────────────────────────────────
  socket.on('rename_player', ({ newName }: { newName: string }, callback: (r: { error?: string; success?: boolean }) => void) => {
    const game = gm.getGameBySocket(socket.id);
    if (game?.phase !== 'lobby') return callback({ error: 'Cannot rename now' });
    const player = gm.renamePlayer(game, socket.id, newName);
    if (!player) return callback({ error: 'Name already taken' });
    callback({ success: true });
    const players = Array.from(game.players.values()).map(p => ({ name: p.name, score: p.score, streak: p.streak }));
    io.to(`host:${game.pin}`).emit('player_joined', { players });
  });

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
    io.to(`host:${pin}`).emit('player_reconnected', { name: player.name, score: player.score, streak: player.streak });
  });

  // ── Host: kick player from lobby or reveal ────────────────────────────────
  socket.on('kick_player', ({ name }: { name: string }) => {
    const game = gm.getGameBySocket(socket.id);
    const allowedPhases = ['lobby', 'reveal'] as const;
    if (game?.hostSocketId !== socket.id || !allowedPhases.includes(game.phase as typeof allowedPhases[number])) return;
    const entry = Array.from(game.players.entries()).find(([, p]) => p.name === name);
    if (!entry) return;
    const [kickedId] = entry;
    gm.removeSocket(kickedId);
    io.to(kickedId).emit('kicked');
    io.to(`host:${game.pin}`).emit('player_left', {
      players: Array.from(game.players.values()).map(p => ({ name: p.name })),
    });
  });

  // ── Host: start game → first round ────────────────────────────────────────
  socket.on('start_game', (
    payload?: { settings?: StartGameSettings },
    callback?: (r: { error?: string }) => void,
  ) => {
    const game = gm.getGameBySocket(socket.id);
    if (game?.hostSocketId !== socket.id || game.phase !== 'lobby') return callback?.({ error: 'Not ready' });

    applyStartGameSettings(game, payload?.settings);
    const sourceResult = applySongSource(game, payload?.settings);
    if (!sourceResult.ok) return callback?.({ error: sourceResult.error });

    game.roundIndex = 0;
    beginRound(game);
    callback?.({});
  });

  // ── Player: submit bid ─────────────────────────────────────────────────────
  socket.on('submit_bid', ({ seconds }: { seconds: number }, callback?: (r: { ok: boolean }) => void) => {
    const game = gm.getGameBySocket(socket.id);
    if (!game) return callback?.({ ok: false });
    const ok = gm.recordBid(game, socket.id, seconds);
    callback?.({ ok });
    if (!ok) return;

    const round = game.currentRound!;
    const totalBidders = round.party?.finale
      ? round.party.duelistIds.filter(id => game.players.has(id)).length
      : game.players.size;
    io.to(`host:${game.pin}`).emit('bid_received', {
      bidCount: round.bids.size,
      totalPlayers: totalBidders,
    });

    // Finale classic rounds only accept bids from the two duelists; ordinary
    // rounds continue to wait for every active player.
    if (round.bids.size >= totalBidders) {
      if (game.phaseTimer) clearTimeout(game.phaseTimer);
      closeBettingAndPlay(game);
    }
  });

  // ── Host: song playback confirmed ──────────────────────────────────────────
  socket.on('song_started', () => {
    const game = gm.getGameBySocket(socket.id);
    if (game?.hostSocketId !== socket.id || game.phase !== 'playing') return;
    if (game.phaseTimer) clearTimeout(game.phaseTimer);

    if (raceFlow(game)) {
      gm.markRaceStarted(game);
      const endsAt = game.currentRound!.playStartAt! + game.raceTime * 1000;
      game.phaseEndsAt = endsAt;
      io.to(`player:${game.pin}`).emit('your_turn', { timeLimit: game.raceTime, endsAt });
      game.phaseTimer = setTimeout(() => endRaceRound(game), game.raceTime * 1000);
    } else {
      io.to(`player:${game.pin}`).emit('song_playing');
      game.phaseTimer = setTimeout(() => startGuessingPhase(game), gm.playMsFor(game.currentRound!.lowestBid));
    }
  });

  // ── Player: submit guess ───────────────────────────────────────────────────
  socket.on('submit_guess', ({ text, artistText }: { text: string; artistText?: string }, callback?: (r: { correct: boolean; points?: number; timeMs?: number }) => void) => {
    const game = gm.getGameBySocket(socket.id);
    if (!game) return callback?.({ correct: false });

    if (raceFlow(game)) {
      const r = gm.recordRaceGuess(game, socket.id, text, artistText);
      if (!r) return callback?.({ correct: false });
      callback?.({ correct: r.correct, points: r.points, timeMs: r.elapsedMs });
      io.to(`host:${game.pin}`).emit('answer_received', {
        answered: game.currentRound!.passed.size,
        total: game.players.size,
      });
      if (r.allDone) endRaceRound(game);
      return;
    }

    const result = gm.recordGuess(game, socket.id, text, artistText);
    if (!result) return callback?.({ correct: false });

    callback?.({ correct: result.correct, points: result.correct ? result.points : undefined });

    const round = game.currentRound!;
    if (result.correct) {
      if (game.phaseTimer) clearTimeout(game.phaseTimer);
      game.phase = 'reveal';
      io.to(game.pin).emit('round_result', {
        correct: true,
        guesserName: result.guesserName,
        ...songFields(game, round),
        points: result.points,
        playerGuesses: gm.getRoundGuesses(game),
        yearResults: round.yearResults,
        stealPending: stealPendingName(game, round),
      });
      emitScoreUpdate(game);
      maybeOfferSteal(game);
    } else if (result.allDone) {
      advanceTierOrReveal(game);
    }
  });

  // ── Player: tap a hint during a Chaos Hints round ──────────────────────────
  // Separate from submit_guess since the answer is an option index, not free
  // text — scoring keys on "did you tap the fabricated hint," not a fuzzy
  // text match, so it can't reuse the same event/validation path.
  socket.on('submit_chaos_tap', ({ index }: { index: number }, callback?: (r: { correct: boolean; points?: number; timeMs?: number }) => void) => {
    const game = gm.getGameBySocket(socket.id);
    if (!game) return callback?.({ correct: false });
    const r = gm.recordChaosHintTap(game, socket.id, index);
    if (!r) return callback?.({ correct: false });
    callback?.({ correct: r.correct, points: r.points, timeMs: r.elapsedMs });
    io.to(`host:${game.pin}`).emit('answer_received', {
      answered: game.currentRound!.passed.size,
      total: game.players.size,
    });
    if (r.allDone) endRaceRound(game);
  });

  // ── Player: steal-round winner picks their victim ──────────────────────────
  socket.on('steal_victim', ({ name }: { name: string }) => {
    const game = gm.getGameBySocket(socket.id);
    if (!game) return;
    const result = gm.executeSteal(game, socket.id, name);
    if (!result) return;
    io.to(game.pin).emit('steal_result', result);
    emitScoreUpdate(game);
  });

  // ── Player: steal-round winner declines to steal ───────────────────────────
  socket.on('skip_steal', () => {
    const game = gm.getGameBySocket(socket.id);
    if (!game) return;
    const result = gm.skipSteal(game, socket.id);
    if (!result) return;
    io.to(game.pin).emit('steal_result', { thief: result.thief, victim: '', amount: 0, skipped: true });
  });

  // ── Player: live guess draft (not yet submitted) ──────────────────────────
  socket.on('update_guess_draft', ({ text }: { text: string }) => {
    const game = gm.getGameBySocket(socket.id);
    if (!game) return;
    gm.updateLiveDraft(game, socket.id, text);
  });

  // ── Player: skip guess ─────────────────────────────────────────────────────
  socket.on('skip_guess', () => {
    const game = gm.getGameBySocket(socket.id);
    if (!game) return;

    if (raceFlow(game)) {
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
    if (result.allDone) {
      if (game.phaseTimer) clearTimeout(game.phaseTimer);
      advanceTierOrReveal(game);
    }
  });

  // ── Host: force-skip current guessing turn ────────────────────────────────
  socket.on('host_skip_turn', () => {
    const game = gm.getGameBySocket(socket.id);
    if (game?.hostSocketId !== socket.id) return;
    if (game.phase === 'betting') {
      closeBettingAndPlay(game);
    } else if (game.phase === 'playing') {
      // Song is still playing — skip directly to reveal without going through guessing
      if (raceFlow(game)) endRaceRound(game);
      else revealRound(game);
    } else if (game.phase === 'guessing') {
      if (game.phaseTimer) clearTimeout(game.phaseTimer);
      if (raceFlow(game)) endRaceRound(game);
      else advanceTierOrReveal(game);
    }
  });

  // ── Host: end the game early ───────────────────────────────────────────────
  // Jumps everyone to final scores. From there the host's "New Game" button
  // handles a restart, so this covers both "end now" and "restart now".
  socket.on('end_game', () => {
    const game = gm.getGameBySocket(socket.id);
    if (game?.hostSocketId !== socket.id) return;
    if (game.phase === 'lobby' || game.phase === 'finished') return;
    if (game.phaseTimer) clearTimeout(game.phaseTimer);
    game.phaseEndsAt = null;
    game.phase = 'finished';
    io.to(game.pin).emit('game_over', { leaderboard: gm.getLeaderboard(game), awards: gm.computeAwards(game) });
  });

  // ── Host: advance to next round ────────────────────────────────────────────
  socket.on('next_round', () => {
    const game = gm.getGameBySocket(socket.id);
    if (!game) return;
    if (game.hostSocketId !== socket.id) return;
    // Only between rounds — a double-click on "Next Round" must not skip a
    // round or start two overlapping beginRound() calls.
    if (game.phase !== 'reveal' && game.phase !== 'leaderboard') return;

    // Mid-finale-duel: advance to the next sub-round without touching
    // roundIndex/totalRounds at all, unless the duel just resolved (someone
    // reached 2 wins) — advanceDuelOrResolve already applied the bonus and
    // crowned the Duel Champion in that case, so falling through below ends
    // the game exactly as an ordinary last round would.
    if (game.duelActive) {
      if (gm.advanceDuelOrResolve(game)) {
        beginRound(game);
        return;
      }
    }

    game.roundIndex += 1;
    if (game.roundIndex >= game.totalRounds) {
      game.phase = 'finished';
      io.to(game.pin).emit('game_over', { leaderboard: gm.getLeaderboard(game), awards: gm.computeAwards(game) });
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
          players: Array.from(removed.game.players.values()).map(p => ({ name: p.name, score: p.score, streak: p.streak })),
        });
      }, PLAYER_GRACE_MS);
      playerDisconnectTimers.set(sid, timer);
    }
  });

  // ── Round lifecycle (server-driven timing) ─────────────────────────────────
  type GameObj = ReturnType<typeof gm.getGame> & object;
  type RoundObj = NonNullable<GameObj['currentRound']>;

  // Does the current round run the everyone-at-once race flow? True for race
  // games and for every non-classic party round (race, year, finale).
  function raceFlow(game: GameObj): boolean {
    if (game.mode === 'race') return true;
    const round = game.currentRound;
    return !!round && gm.isRaceFlowRound(game, round);
  }

  // Offer the steal-round winner their pick of victims. Sent at the reveal so
  // the theft plays out while everyone's watching the result. With only one
  // player there's no one to steal from — close it out silently instead of
  // showing an empty picker (and leaving stealPendingName stuck forever).
  function maybeOfferSteal(game: GameObj) {
    const round = game.currentRound;
    if (!round?.stealBy || round.stealDone) return;
    const victims = gm.stealCandidates(game, round.stealBy);
    if (victims.length === 0) { round.stealDone = true; return; }
    io.to(round.stealBy).emit('choose_steal', { victims });
  }

  function stealPendingName(game: GameObj, round: RoundObj): string | undefined {
    if (!round.stealBy || round.stealDone) return undefined;
    return game.players.get(round.stealBy)?.name;
  }

  async function beginRound(game: GameObj) {
    if (!game) return;
    const round = gm.startRound(game);
    const party = gm.partyView(game, round);
    const isRaceFlow = gm.isRaceFlowRound(game, round);
    // Race flow is normally hint-free (the audio itself is the puzzle), but
    // artist-only and year-only rounds can't be inferred from audio alone —
    // this is the only way those toggles have any teeth outside Classic mode.
    // Party rounds keep the existing (hint-free) race behaviour, except:
    // Chaos Hints, where `round.hints` isn't a guessing aid at all, it's the
    // "spot the fake" set itself, which the round is meaningless without;
    // and Underdog Boost, whose whole point is giving the trailing player(s)
    // a real shot, not just the normal hint-free race odds.
    const keepHints = (!round.party && (game.artistOnly || game.yearOnly))
      || round.party?.event === 'chaoshints' || round.party?.event === 'underdog';

    // Prefer the precomputed art from the CSV (Music Popularity Index resolves
    // it offline via Spotify's oEmbed endpoint) so a normal round never calls
    // the Spotify Web API at all; only fall back to the live, quota-limited
    // call for songs the pipeline hasn't covered yet.
    const coverUrl = round.song.albumArtUrl ?? await getAlbumArtUrl(round.song.spotifyTrackId);
    if (coverUrl) {
      round.coverUrl = coverUrl;
      // Classic-flow rounds have a 1-in-4 chance of a blurred-art hint;
      // 'fullhints' and Underdog Boost always get it (Underdog's whole
      // point is a real, guaranteed assist — not a coin flip), 'blind'
      // rounds never do.
      const wantArt = round.party?.event === 'underdog'
        || (!isRaceFlow && (game.mode === 'classic' || game.mode === 'party')
          && round.party?.event !== 'blind'
          && (round.party?.event === 'fullhints' || randomInt(4) === 0));
      if (wantArt) {
        round.hints.push({ label: 'Album art', value: '', imageUrl: coverUrl });
      }
    }

    if (isRaceFlow) {
      if (!keepHints) round.hints = [];
      game.phase = 'playing';
      game.phaseEndsAt = null;

      io.to(`player:${game.pin}`).emit('round_start', {
        roundIndex: game.roundIndex,
        total: game.totalRounds,
        hints: round.hints,
        mode: 'race',
        raceTime: game.raceTime,
        artistOnly: game.artistOnly,
        yearOnly: game.yearOnly,
        party,
        tempo: round.song.tempo,
      });
      io.to(`host:${game.pin}`).emit('host_round_start', {
        roundIndex: game.roundIndex,
        total: game.totalRounds,
        hints: round.hints,
        mode: 'race',
        raceTime: game.raceTime,
        artistOnly: game.artistOnly,
        yearOnly: game.yearOnly,
        party,
        song: {
          title: round.song.title,
          artist: round.song.artist,
          trackId: round.song.spotifyTrackId,
          tempo: round.song.tempo,
        },
      });

      io.to(`host:${game.pin}`).emit('play_song', {
        trackId: round.song.spotifyTrackId,
        durationMs: game.raceTime * 1000,
        countdownMs: PLAYBACK_COUNTDOWN_MS,
        positionMs: round.snippetMs,
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
      artistOnly: game.artistOnly,
      yearOnly: game.yearOnly,
      party,
      // Source of truth for the client's bid picker and its score preview —
      // keeps the UI from drifting out of sync with server-side scoring.
      bidOptions: gm.BID_OPTIONS,
      bidScores: gm.bidScoreTable(),
      tempo: round.song.tempo,
    });
    io.to(`host:${game.pin}`).emit('host_round_start', {
      roundIndex: game.roundIndex,
      total: game.totalRounds,
      hints: round.hints,
      bettingTime: game.bettingTime,
      endsAt: bettingEndsAt,
      mode: 'classic',
      artistOnly: game.artistOnly,
      yearOnly: game.yearOnly,
      party,
      song: {
        title: round.song.title,
        artist: round.song.artist,
        trackId: round.song.spotifyTrackId,
        tempo: round.song.tempo,
      },
    });

    // Extra 500ms lets last-second auto-submits from clients arrive before we close.
    game.phaseTimer = setTimeout(() => closeBettingAndPlay(game), game.bettingTime * 1000 + 500);
  }

  function songFields(game: GameObj, round: RoundObj) {
    return {
      songTitle: round.song.title,
      artist: round.song.artist,
      featuredArtists: round.song.featuredArtists,
      year: round.song.year,
      coverUrl: round.coverUrl,
      // Party rounds carry their own per-round target (title/artist/both),
      // independent of the game-wide artistOnly toggle classic/race use —
      // the reveal card's "song was"/"artist was" label has to match
      // whichever one actually decided the guess, or a correct artist-only
      // guess reads as a title mismatch (and vice versa).
      artistOnly: gm.effectiveTarget(game, round) === 'artist',
      yearOnly: gm.effectiveTarget(game, round) === 'year',
      // Reveal payloads always carry the full party config (mystery revealed).
      party: gm.partyView(game, round, true),
      // 'chaoshints' rounds: which hint (already sent as `hints` at
      // round_start) was the fabricated one — hidden until now.
      chaosFakeIndex: round.chaosFakeIndex,
    };
  }

  function emitScoreUpdate(game: GameObj) {
    const pityAwardedTo = game.currentRound?.pityAwardedTo;
    io.to(game.pin).emit('score_update', {
      players: Array.from(game.players.values()).map(p => ({
        name: p.name, score: p.score, streak: p.streak, pity: pityAwardedTo?.has(p.socketId) ?? false,
      })),
    });
  }

  function endRaceRound(game: GameObj) {
    if (game.phase === 'reveal') return; // guard against timer + allDone race
    if (game.phaseTimer) clearTimeout(game.phaseTimer);
    gm.finalizeRaceDrafts(game);
    const round = game.currentRound!;
    // Year rounds score in one pass now that every distance is known.
    if (gm.effectiveTarget(game, round) === 'year') gm.finalizeYearRound(game);
    game.phase = 'reveal';
    const correctNames = Array.from(round.correctGuessers)
      .map(id => game.players.get(id)?.name ?? '')
      .filter(Boolean);
    io.to(game.pin).emit('round_result', {
      correct: round.correctGuessers.size > 0,
      guesserName: null,
      mode: 'race',
      correctGuessers: correctNames,
      ...songFields(game, round),
      points: 0,
      playerGuesses: gm.getRoundGuesses(game),
      yearResults: round.yearResults,
      stealPending: stealPendingName(game, round),
    });
    gm.settleStreaks(game, round);
    emitScoreUpdate(game);
    maybeOfferSteal(game);
  }

  function closeBettingAndPlay(game: GameObj) {
    if (!game || game.phase !== 'betting') return;
    const round = game.currentRound!;
    const result = gm.closeBetting(game);
    if (!result) {
      // Nobody bid — skip the round. Move the phase along too, or the game
      // stays in 'betting' and a stale bid could re-trigger this round.
      game.phase = 'reveal';
      game.phaseEndsAt = null;
      io.to(game.pin).emit('round_result', {
        correct: false,
        guesserName: null,
        ...songFields(game, round),
        points: 0,
        playerGuesses: [],
      });
      gm.settleStreaks(game, round);
      emitScoreUpdate(game);
      return;
    }
    playTier(game, result);
  }

  // Play the song for the current tier and queue its guessing phase. Reused both
  // for the opening (lowest) tier and each next-lowest tier that gets a turn.
  function playTier(
    game: GameObj,
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
      positionMs: round.snippetMs,
    });

    // Fallback: start guessing if host never confirms song_started. The host
    // first runs a countdown (and buffers the track) before playback begins,
    // so allow for that plus the play duration plus slack.
    game.phaseTimer = setTimeout(() => {
      if (game.phase === 'playing') startGuessingPhase(game);
    }, durationMs + PLAYBACK_COUNTDOWN_MS + 5000);
  }

  // A tier ran out of guesses (all wrong, or time expired). Hand off to the
  // next-lowest bidders if there are any; otherwise reveal that nobody got it
  // — for a year round, that's when the closest guess across every tier wins.
  function revealRound(game: GameObj) {
    const round = game.currentRound!;
    if (game.phaseTimer) clearTimeout(game.phaseTimer);
    game.phase = 'reveal';
    if (gm.effectiveTarget(game, round) === 'year') gm.finalizeClassicYearRound(game);
    io.to(game.pin).emit('round_result', {
      correct: false,
      guesserName: null,
      ...songFields(game, round),
      points: 0,
      playerGuesses: gm.getRoundGuesses(game),
      yearResults: round.yearResults,
    });
    gm.settleStreaks(game, round);
    emitScoreUpdate(game);
  }

  function advanceTierOrReveal(game: GameObj) {
    const next = gm.advanceTier(game);
    if (next) {
      playTier(game, next);
      return;
    }
    revealRound(game);
  }

  function startGuessingPhase(game: GameObj) {
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
      // A guesser's own client auto-submits at this same deadline, but that's
      // a race against the network — this server timer firing first would
      // otherwise just discard whatever they'd typed. Give their live draft
      // one last look before moving the round on.
      const auto = gm.finalizeGuessDrafts(game);
      if (auto) {
        io.to(game.pin).emit('round_result', {
          correct: true,
          guesserName: auto.guesserName,
          ...songFields(game, round),
          points: auto.points,
          playerGuesses: gm.getRoundGuesses(game),
          yearResults: round.yearResults,
          stealPending: stealPendingName(game, round),
        });
        emitScoreUpdate(game);
        maybeOfferSteal(game);
        return;
      }
      advanceTierOrReveal(game);
    }, game.guessingTime * 1000);
  }
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => console.log(`Server on port ${PORT}`));
