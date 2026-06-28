import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import dotenv from 'dotenv';
import authRouter from './spotifyAuth';
import * as gm from './gameManager';

dotenv.config();
gm.initSongs();

// Countdown shown on the host before a song plays, used to buffer the track.
const PLAYBACK_COUNTDOWN_MS = 3000;

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

app.use(cors({ origin: '*' }));
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

  // ── Player: join lobby ─────────────────────────────────────────────────────
  socket.on(
    'join_game',
    ({ pin, name }: { pin: string; name: string }, callback: (r: { error?: string; success?: boolean }) => void) => {
      const game = gm.getGame(pin);
      if (!game) return callback({ error: 'Game not found' });
      if (game.phase !== 'lobby') return callback({ error: 'Game already started' });

      const player = gm.addPlayer(game, socket.id, name);
      if (!player) return callback({ error: 'Name already taken' });

      socket.join(pin);
      socket.join(`player:${pin}`);
      callback({ success: true });

      const players = Array.from(game.players.values()).map(p => ({ name: p.name }));
      const hostRoom = io.sockets.adapter.rooms.get(`host:${pin}`);
      console.log(`[join_game] pin=${pin} name=${name} hostRoom=host:${pin} hostSockets=${hostRoom ? [...hostRoom].join(',') : 'EMPTY'}`);
      io.to(`host:${pin}`).emit('player_joined', { players });
    }
  );

  // ── Host: start game → first round ────────────────────────────────────────
  socket.on('start_game', () => {
    const game = gm.getGameBySocket(socket.id);
    if (!game || game.hostSocketId !== socket.id || game.phase !== 'lobby') return;
    game.roundIndex = 0;
    beginRound(game);
  });

  // ── Player: submit bid ─────────────────────────────────────────────────────
  socket.on('submit_bid', ({ seconds }: { seconds: number }) => {
    const game = gm.getGameBySocket(socket.id);
    if (!game) return;
    const ok = gm.recordBid(game, socket.id, seconds);
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
    if (!game || game.hostSocketId !== socket.id || game.phase !== 'playing') return;
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
    } else if (result.allAttempted) {
      // Current tier struck out — give the next-lowest bidders a turn, if any.
      advanceTierOrReveal(game);
    }
  });

  // ── Player: skip guess ─────────────────────────────────────────────────────
  socket.on('skip_guess', () => {
    const game = gm.getGameBySocket(socket.id);
    if (!game) return;
    const result = gm.skipGuess(game, socket.id);
    if (!result) return;
    // Once everyone in the tier has guessed or passed, hand off / reveal.
    if (result.allAttempted) advanceTierOrReveal(game);
  });

  // ── Host: advance to next round ────────────────────────────────────────────
  socket.on('next_round', () => {
    const game = gm.getGameBySocket(socket.id);
    if (!game || game.hostSocketId !== socket.id) return;

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

    io.to(`player:${game.pin}`).emit('round_start', {
      roundIndex: game.roundIndex,
      total: game.totalRounds,
      hints: round.hints,
      bettingTime: gm.BETTING_TIME,
    });
    io.to(`host:${game.pin}`).emit('host_round_start', {
      roundIndex: game.roundIndex,
      total: game.totalRounds,
      hints: round.hints,
      bettingTime: gm.BETTING_TIME,
      song: {
        title: round.song.title,
        artist: round.song.artist,
        trackId: round.song.spotifyTrackId,
      },
    });

    game.phaseTimer = setTimeout(() => closeBettingAndPlay(game), gm.BETTING_TIME * 1000);
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
    io.to(game.pin).emit('betting_closed', { lowestBid, guesserNames });
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
    if (!game) return;
    const round = game.currentRound!;
    const guesserSocketIds = round.guesserSocketIds;
    const guesserNames = guesserSocketIds
      .map(id => game.players.get(id)?.name ?? '')
      .filter(Boolean);

    if (game.phaseTimer) clearTimeout(game.phaseTimer);
    game.phase = 'guessing';
    io.to(game.pin).emit('guessing_start', { guesserNames, timeLimit: gm.GUESSING_TIME });
    for (const sid of guesserSocketIds) {
      io.to(sid).emit('your_turn', { timeLimit: gm.GUESSING_TIME });
    }

    game.phaseTimer = setTimeout(() => {
      if (game.phase !== 'guessing' || round.answered) return;
      advanceTierOrReveal(game);
    }, gm.GUESSING_TIME * 1000);
  }
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => console.log(`Server on port ${PORT}`));
