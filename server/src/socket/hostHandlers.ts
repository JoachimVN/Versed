import { Socket } from 'socket.io';
import * as gm from '../gameManager';
import { getIo, hostDisconnectTimers, playerDisconnectTimers } from './context';
import { StartGameSettings, applyStartGameSettings, applySongSource } from './settings';
import { beginRound, raceFlow, endRaceRound, startGuessingPhase, closeBettingAndPlay, revealRound, advanceTierOrReveal } from './roundLifecycle';
import { asRecord, logSecurityViolation, parsePlayerName, parsePin, parseSessionToken, respond } from './security';

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
  socket.on('create_game', (callback?: unknown) => {
    if (typeof callback !== 'function') return;
    if (gm.activeGameCount() >= gm.MAX_ACTIVE_GAMES) {
      respond(callback, { error: 'Server is at capacity, try again later' });
      return;
    }

    const ip = socket.handshake.address;
    const now = Date.now();
    const attempts = (createGameAttempts.get(ip) ?? []).filter(t => now - t < CREATE_GAME_WINDOW_MS);
    if (attempts.length >= CREATE_GAME_LIMIT) {
      respond(callback, { error: 'Too many games created, try again later' });
      return;
    }
    createGameAttempts.set(ip, [...attempts, now]);

    const game = gm.createGame(socket.id);
    socket.join(game.pin);
    socket.join(`host:${game.pin}`);
    console.log(`[create_game] socket=${socket.id} pin=${game.pin} rooms=${[...socket.rooms].join(',')}`);
    respond(callback, { pin: game.pin, hostToken: game.hostToken });
  });

  // ── Host: start a new game without a page reload ─────────────────────────
  socket.on('new_game', (callback?: unknown) => {
    if (typeof callback !== 'function') return;
    const oldGame = gm.getGameBySocket(socket.id);
    if (oldGame?.hostSocketId !== socket.id) {
      respond(callback, { error: 'Not a host' });
      return;
    }
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

    respond(callback, { pin: newGame.pin, hostToken: newGame.hostToken });
  });

  // ── Host: rejoin after reconnect or page reload ───────────────────────────
  // `fresh` marks a full page reload: the host client lost all round UI state,
  // so any round in flight can't be resumed. A plain socket reconnect (host
  // tab still alive) keeps the round running as before.
  socket.on('rejoin_host', (payload: unknown, callback?: unknown) => {
    if (typeof callback !== 'function') return;
    const data = asRecord(payload);
    const pin = parsePin(data?.pin);
    const hostToken = parseSessionToken(data?.hostToken);
    const fresh = data?.fresh === true;
    if (!pin || !hostToken) {
      respond(callback, { error: 'Invalid host session' });
      return;
    }

    const game = gm.getGame(pin);
    if (!game || !gm.sessionTokenMatches(game.hostToken, hostToken)) {
      logSecurityViolation(socket, 'rejoin_host');
      respond(callback, { error: 'Game not found' });
      return;
    }

    const previousHostId = game.hostSocketId;

    // Cancel the host grace-period timer so the game survives.
    const hostTimer = hostDisconnectTimers.get(pin);
    if (hostTimer) { clearTimeout(hostTimer); hostDisconnectTimers.delete(pin); }

    // Remove and disconnect the stale host only after the bearer token has
    // proved this reconnect owns the session. The removed lookup means its
    // disconnect handler cannot start a second teardown timer.
    if (previousHostId !== socket.id) gm.removeSocket(previousHostId);

    game.hostSocketId = socket.id;
    socket.join(pin);
    socket.join(`host:${pin}`);
    gm.updateSocketPin(socket.id, pin);
    if (previousHostId !== socket.id) getIo().sockets.sockets.get(previousHostId)?.disconnect(true);
    getIo().to(game.pin).emit('host_reconnected');

    // After a reload mid-round, the safest resume point is the between-rounds
    // leaderboard: abandon the round in flight and park everyone there.
    if (fresh && game.phase !== 'lobby' && game.phase !== 'finished') {
      if (game.phaseTimer) clearTimeout(game.phaseTimer);
      game.phaseEndsAt = null;
      game.phase = 'leaderboard';
      getIo().to(`player:${pin}`).emit('leaderboard', { leaderboard: gm.getLeaderboard(game) });
    }

    respond(callback, {
      players: Array.from(game.players.values()).map(p => ({ name: p.name, score: p.score, streak: p.streak })),
      phase: game.phase,
      roundIndex: game.roundIndex,
      totalRounds: game.totalRounds,
      leaderboard: gm.getLeaderboard(game),
      awards: gm.computeAwards(game),
    });
  });

  // ── Host: kick player from lobby or reveal ────────────────────────────────
  socket.on('kick_player', (payload: unknown) => {
    const name = parsePlayerName(asRecord(payload)?.name);
    if (!name) return;
    const game = gm.getGameBySocket(socket.id);
    const allowedPhases = ['lobby', 'reveal'] as const;
    if (game?.hostSocketId !== socket.id || !allowedPhases.includes(game.phase as typeof allowedPhases[number])) return;
    const entry = Array.from(game.players.entries()).find(([, p]) => p.name === name);
    if (!entry) return;
    const [kickedId] = entry;
    gm.removeSocket(kickedId, false);
    getIo().to(kickedId).emit('kicked');
    getIo().to(`host:${game.pin}`).emit('player_left', {
      players: Array.from(game.players.values()).map(p => ({ name: p.name })),
    });
  });

  // ── Host: start game → first round ────────────────────────────────────────
  socket.on('start_game', (
    payload?: unknown,
    callback?: unknown,
  ) => {
    const game = gm.getGameBySocket(socket.id);
    if (game?.hostSocketId !== socket.id || game.phase !== 'lobby') {
      respond(callback, { error: 'Not ready' });
      return;
    }

    const settings = asRecord(asRecord(payload)?.settings) as StartGameSettings | null;
    applyStartGameSettings(game, settings ?? undefined);
    const sourceResult = applySongSource(game, settings ?? undefined);
    if (!sourceResult.ok) {
      respond(callback, { error: sourceResult.error });
      return;
    }

    game.roundIndex = 0;
    beginRound(game);
    respond(callback, {});
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
    game.finishedAt = Date.now();
    getIo().to(game.pin).emit('game_over', { leaderboard: gm.getLeaderboard(game), awards: gm.computeAwards(game), finishedAt: game.finishedAt });
  });

  // ── Host: skip the final-results cinematic ─────────────────────────────────
  // The host's own skip is purely a local UI shortcut (see FinalResults.tsx),
  // so this just relays it to players — they run their own independently
  // timed "look up at the board" holding screen and have no other way to
  // know the host already settled.
  socket.on('skip_final_results', () => {
    const game = gm.getGameBySocket(socket.id);
    if (game?.hostSocketId !== socket.id) return;
    if (game.phase !== 'finished') return;
    getIo().to(`player:${game.pin}`).emit('final_results_skipped');
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
      game.finishedAt = Date.now();
      getIo().to(game.pin).emit('game_over', { leaderboard: gm.getLeaderboard(game), awards: gm.computeAwards(game), finishedAt: game.finishedAt });
      return;
    }
    beginRound(game);
  });
}
