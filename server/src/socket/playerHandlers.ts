import { Socket } from 'socket.io';
import * as gm from '../gameManager';
import { Game, Player } from '../types';
import { getIo, playerDisconnectTimers } from './context';
import { syncState } from './sync';
import { raceFlow, endRaceRound, closeBettingAndPlay, advanceTierOrReveal, songFields, stealPendingName, emitScoreUpdate, maybeOfferSteal } from './roundLifecycle';
import {
  asRecord, logSecurityViolation, MAX_NAME_LENGTH, parseFiniteNumber, parseGuessText, parseInteger, parsePin,
  parsePlayerName, parseSessionToken, respond,
} from './security';

type JoinRequest = { pin: string; name: string; sessionToken?: string };

// Validates a join_game payload down to the three fields the handler needs,
// or the message to send back when it doesn't hold up. Check order decides
// which complaint a bad payload gets, so it matches the order players hit
// them: name length, then PIN, then name, then token.
function parseJoinRequest(payload: unknown): { ok: true; request: JoinRequest } | { ok: false; error: string } {
  const data = asRecord(payload);
  const pin = parsePin(data?.pin);
  const name = parsePlayerName(data?.name);
  const parsedToken = data?.playerToken === undefined ? undefined : parseSessionToken(data.playerToken);
  if (typeof data?.name === 'string' && data.name.trim().length > MAX_NAME_LENGTH) {
    return { ok: false, error: `Name must be ${MAX_NAME_LENGTH} characters or fewer` };
  }
  if (!pin) return { ok: false, error: 'PIN must be exactly 3 digits' };
  if (!name) return { ok: false, error: 'Enter a valid name' };
  if (data?.playerToken !== undefined && !parsedToken) return { ok: false, error: 'Invalid join details' };
  return { ok: true, request: { pin, name, sessionToken: parsedToken ?? undefined } };
}

// The host's lobby roster, re-sent whenever the player list changes.
function broadcastLobby(game: Game): void {
  const players = Array.from(game.players.values()).map(p => ({ name: p.name, score: p.score, streak: p.streak }));
  getIo().to(`host:${game.pin}`).emit('player_joined', { players });
}

// A name already in the game means a reconnect: cancel any pending removal
// timer, migrate the socket ID off the stale connection, and snap the player
// to the current phase.
function resumeRejoinedPlayer(
  socket: Socket, game: Game, oldId: string, rejoined: Player, callback: unknown,
): void {
  const t = playerDisconnectTimers.get(oldId);
  if (t) { clearTimeout(t); playerDisconnectTimers.delete(oldId); }
  socket.join(game.pin);
  socket.join(`player:${game.pin}`);
  if (oldId !== socket.id) getIo().sockets.sockets.get(oldId)?.disconnect(true);
  respond(callback, { success: true, playerToken: rejoined.sessionToken });
  if (game.phase === 'lobby') {
    broadcastLobby(game);
  } else {
    syncState(socket, game);
    getIo().to(`host:${game.pin}`).emit('player_reconnected', {
      name: rejoined.name, score: rejoined.score, streak: rejoined.streak,
    });
  }
}

export function registerPlayerHandlers(socket: Socket) {
  // ── Player: check if a game PIN is still active ───────────────────────────
  socket.on('check_game', (payload: unknown, callback?: unknown) => {
    if (typeof callback !== 'function') return;
    const pin = parsePin(asRecord(payload)?.pin);
    respond(callback, { exists: !!pin && !!gm.getGame(pin) });
  });

  // ── Player: join game (lobby or mid-game) ─────────────────────────────────
  socket.on(
    'join_game',
    (payload: unknown, callback?: unknown) => {
      if (typeof callback !== 'function') return;
      const parsed = parseJoinRequest(payload);
      if (!parsed.ok) {
        respond(callback, { error: parsed.error });
        return;
      }
      const { pin, name, sessionToken } = parsed.request;
      const game = gm.getGame(pin);
      if (!game) {
        respond(callback, { error: 'Game not found' });
        return;
      }

      // If this name is already in the game (lobby or mid-game), it's either a
      // reconnect holding the matching session token, or someone trying to
      // take over a name that isn't theirs.
      const oldEntry = Array.from(game.players.entries())
        .find(([, p]) => p.name.toLowerCase() === name.trim().toLowerCase());
      if (oldEntry) {
        const rejoined = gm.rejoinPlayer(game, socket.id, name, sessionToken);
        if (!rejoined) {
          logSecurityViolation(socket, 'join_game_identity');
          respond(callback, { error: 'Name already taken' });
          return;
        }
        resumeRejoinedPlayer(socket, game, oldEntry[0], rejoined, callback);
        return;
      }

      const player = gm.addPlayer(game, socket.id, name, sessionToken);
      if (!player) {
        respond(callback, { error: 'Name already taken' });
        return;
      }

      socket.join(pin);
      socket.join(`player:${pin}`);
      respond(callback, { success: true, playerToken: player.sessionToken });
      broadcastLobby(game);

      // New player joining an in-progress game — sync them to the current phase.
      if (game.phase !== 'lobby') syncState(socket, game);
    }
  );

  // ── Player: rename in lobby ────────────────────────────────────────────────
  socket.on('rename_player', (payload: unknown, callback?: unknown) => {
    if (typeof callback !== 'function') return;
    const newName = parsePlayerName(asRecord(payload)?.newName);
    if (!newName) {
      respond(callback, { error: 'Invalid name' });
      return;
    }
    const game = gm.getGameBySocket(socket.id);
    if (game?.phase !== 'lobby') {
      respond(callback, { error: 'Cannot rename now' });
      return;
    }
    const player = gm.renamePlayer(game, socket.id, newName);
    if (!player) {
      respond(callback, { error: 'Name already taken' });
      return;
    }
    respond(callback, { success: true });
    broadcastLobby(game);
  });

  // ── Player: rejoin after reconnect ─────────────────────────────────────────
  socket.on('rejoin_player', (payload: unknown, callback?: unknown) => {
    if (typeof callback !== 'function') return;
    const data = asRecord(payload);
    const pin = parsePin(data?.pin);
    const name = parsePlayerName(data?.name);
    const sessionToken = parseSessionToken(data?.playerToken);
    if (!pin || !name || !sessionToken) {
      respond(callback, { ok: false });
      return;
    }
    const game = gm.getGame(pin);
    if (!game) {
      respond(callback, { ok: false });
      return;
    }

    const oldEntry = Array.from(game.players.entries())
      .find(([, p]) => p.name.toLowerCase() === name.trim().toLowerCase());
    const player = oldEntry
      ? gm.rejoinPlayer(game, socket.id, name, sessionToken)
      : gm.addPlayer(game, socket.id, name, sessionToken);
    if (!player) {
      logSecurityViolation(socket, 'rejoin_player');
      respond(callback, { ok: false });
      return;
    }
    const oldId = oldEntry?.[0];
    if (oldId) {
      const t = playerDisconnectTimers.get(oldId);
      if (t) { clearTimeout(t); playerDisconnectTimers.delete(oldId); }
    }
    socket.join(pin);
    socket.join(`player:${pin}`);
    if (oldId && oldId !== socket.id) getIo().sockets.sockets.get(oldId)?.disconnect(true);
    respond(callback, { ok: true });
    syncState(socket, game);
    getIo().to(`host:${pin}`).emit('player_reconnected', { name: player.name, score: player.score, streak: player.streak });
  });

  // ── Player: submit bid ─────────────────────────────────────────────────────
  socket.on('submit_bid', (payload: unknown, callback?: unknown) => {
    const seconds = parseFiniteNumber(asRecord(payload)?.seconds);
    if (seconds === null) {
      respond(callback, { ok: false });
      return;
    }
    const game = gm.getGameBySocket(socket.id);
    if (!game) {
      respond(callback, { ok: false });
      return;
    }
    const ok = gm.recordBid(game, socket.id, seconds);
    respond(callback, { ok });
    if (!ok) return;

    const round = game.currentRound!;
    const totalBidders = round.party?.finale
      ? round.party.duelistIds.filter(id => game.players.has(id)).length
      : game.players.size;
    getIo().to(`host:${game.pin}`).emit('bid_received', {
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

  // ── Player: submit guess ───────────────────────────────────────────────────
  socket.on('submit_guess', (payload: unknown, callback?: unknown) => {
    const data = asRecord(payload);
    const text = parseGuessText(data?.text);
    const artistText = parseGuessText(data?.artistText, true);
    if (text === null || text === undefined || artistText === null) {
      respond(callback, { correct: false });
      return;
    }
    const game = gm.getGameBySocket(socket.id);
    if (!game) {
      respond(callback, { correct: false });
      return;
    }

    if (raceFlow(game)) {
      const r = gm.recordRaceGuess(game, socket.id, text, artistText);
      if (!r) {
        respond(callback, { correct: false });
        return;
      }
      respond(callback, { correct: r.correct, points: r.points, timeMs: r.elapsedMs });
      getIo().to(`host:${game.pin}`).emit('answer_received', {
        answered: game.currentRound!.passed.size,
        total: game.players.size,
      });
      if (r.allDone) endRaceRound(game);
      return;
    }

    const result = gm.recordGuess(game, socket.id, text, artistText);
    if (!result) {
      respond(callback, { correct: false });
      return;
    }

    respond(callback, { correct: result.correct, points: result.correct ? result.points : undefined });

    const round = game.currentRound!;
    if (result.correct) {
      if (game.phaseTimer) clearTimeout(game.phaseTimer);
      game.phase = 'reveal';
      getIo().to(game.pin).emit('round_result', {
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
  socket.on('submit_chaos_tap', (payload: unknown, callback?: unknown) => {
    const index = parseInteger(asRecord(payload)?.index, 0, 10);
    if (index === null) {
      respond(callback, { correct: false });
      return;
    }
    const game = gm.getGameBySocket(socket.id);
    if (!game) {
      respond(callback, { correct: false });
      return;
    }
    const r = gm.recordChaosHintTap(game, socket.id, index);
    if (!r) {
      respond(callback, { correct: false });
      return;
    }
    respond(callback, { correct: r.correct, points: r.points, timeMs: r.elapsedMs });
    getIo().to(`host:${game.pin}`).emit('answer_received', {
      answered: game.currentRound!.passed.size,
      total: game.players.size,
    });
    if (r.allDone) endRaceRound(game);
  });

  // ── Player: steal-round winner picks their victim ──────────────────────────
  socket.on('steal_victim', (payload: unknown) => {
    const name = parsePlayerName(asRecord(payload)?.name);
    if (!name) return;
    const game = gm.getGameBySocket(socket.id);
    if (!game) return;
    const result = gm.executeSteal(game, socket.id, name);
    if (!result) return;
    getIo().to(game.pin).emit('steal_result', result);
    emitScoreUpdate(game);
  });

  // ── Player: steal-round winner declines to steal ───────────────────────────
  socket.on('skip_steal', () => {
    const game = gm.getGameBySocket(socket.id);
    if (!game) return;
    const result = gm.skipSteal(game, socket.id);
    if (!result) return;
    getIo().to(game.pin).emit('steal_result', { thief: result.thief, victim: '', amount: 0, skipped: true });
  });

  // ── Player: live guess draft (not yet submitted) ──────────────────────────
  socket.on('update_guess_draft', (payload: unknown) => {
    const data = asRecord(payload);
    const text = parseGuessText(data?.text);
    const artistText = parseGuessText(data?.artistText, true);
    if (text === null || text === undefined || artistText === null) return;
    const game = gm.getGameBySocket(socket.id);
    if (!game) return;
    gm.updateLiveDraft(game, socket.id, text, artistText);
  });

  // ── Player: skip guess ─────────────────────────────────────────────────────
  socket.on('skip_guess', () => {
    const game = gm.getGameBySocket(socket.id);
    if (!game) return;

    if (raceFlow(game)) {
      const r = gm.skipRaceGuess(game, socket.id);
      if (!r) return;
      getIo().to(`host:${game.pin}`).emit('answer_received', {
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
}
