import { Socket } from 'socket.io';
import * as gm from '../gameManager';
import { Award } from '../types';
import { getIo, hostDisconnectTimers, playerDisconnectTimers } from './context';
import { StartGameSettings, applyStartGameSettings, applySongSource } from './settings';
import { beginRound, raceFlow, endRaceRound, startGuessingPhase, closeBettingAndPlay, revealRound, advanceTierOrReveal } from './roundLifecycle';

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

export function registerHostHandlers(socket: Socket) {
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
    getIo().to(`player:${oldPin}`).emit('game_restarted', { newPin: newGame.pin });

    // Then evict them from the rooms: the new game reuses the PIN, so anyone
    // lingering would otherwise receive events for a game they haven't joined.
    // Pressing "Play Again" re-joins the rooms via the normal join_game path.
    getIo().in(`player:${oldPin}`).socketsLeave([oldPin, `player:${oldPin}`]);

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
    getIo().to(game.pin).emit('host_reconnected');

    // After a reload mid-round, the safest resume point is the between-rounds
    // leaderboard: abandon the round in flight and park everyone there.
    if (fresh && game.phase !== 'lobby' && game.phase !== 'finished') {
      if (game.phaseTimer) clearTimeout(game.phaseTimer);
      game.phaseEndsAt = null;
      game.phase = 'leaderboard';
      getIo().to(`player:${pin}`).emit('leaderboard', { leaderboard: gm.getLeaderboard(game) });
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

  // ── Host: kick player from lobby or reveal ────────────────────────────────
  socket.on('kick_player', ({ name }: { name: string }) => {
    const game = gm.getGameBySocket(socket.id);
    const allowedPhases = ['lobby', 'reveal'] as const;
    if (game?.hostSocketId !== socket.id || !allowedPhases.includes(game.phase as typeof allowedPhases[number])) return;
    const entry = Array.from(game.players.entries()).find(([, p]) => p.name === name);
    if (!entry) return;
    const [kickedId] = entry;
    gm.removeSocket(kickedId);
    getIo().to(kickedId).emit('kicked');
    getIo().to(`host:${game.pin}`).emit('player_left', {
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

  // ── Host: song playback confirmed ──────────────────────────────────────────
  socket.on('song_started', () => {
    const game = gm.getGameBySocket(socket.id);
    if (game?.hostSocketId !== socket.id || game.phase !== 'playing') return;
    if (game.phaseTimer) clearTimeout(game.phaseTimer);

    if (raceFlow(game)) {
      gm.markRaceStarted(game);
      const endsAt = game.currentRound!.playStartAt! + game.raceTime * 1000;
      game.phaseEndsAt = endsAt;
      getIo().to(`player:${game.pin}`).emit('your_turn', { timeLimit: game.raceTime, endsAt });
      game.phaseTimer = setTimeout(() => endRaceRound(game), game.raceTime * 1000);
    } else {
      gm.markTierStarted(game);
      getIo().to(`player:${game.pin}`).emit('song_playing');
      game.phaseTimer = setTimeout(() => startGuessingPhase(game), gm.playMsFor(game.currentRound!.lowestBid));
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
    getIo().to(game.pin).emit('game_over', { leaderboard: gm.getLeaderboard(game), awards: gm.computeAwards(game) });
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
      getIo().to(game.pin).emit('game_over', { leaderboard: gm.getLeaderboard(game), awards: gm.computeAwards(game) });
      return;
    }
    beginRound(game);
  });
}
