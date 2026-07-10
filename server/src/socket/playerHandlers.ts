import { Socket } from 'socket.io';
import * as gm from '../gameManager';
import { getIo, playerDisconnectTimers } from './context';
import { syncState } from './sync';
import { raceFlow, endRaceRound, closeBettingAndPlay, advanceTierOrReveal, songFields, stealPendingName, emitScoreUpdate, maybeOfferSteal } from './roundLifecycle';

export function registerPlayerHandlers(socket: Socket) {
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
          getIo().to(`host:${pin}`).emit('player_joined', { players });
        } else {
          syncState(socket, game);
          getIo().to(`host:${pin}`).emit('player_reconnected', { name: rejoined.name, score: rejoined.score, streak: rejoined.streak });
        }
        return;
      }

      const player = gm.addPlayer(game, socket.id, name);
      if (!player) return callback({ error: 'Name already taken' });

      socket.join(pin);
      socket.join(`player:${pin}`);
      callback({ success: true });

      const players = Array.from(game.players.values()).map(p => ({ name: p.name, score: p.score, streak: p.streak }));
      getIo().to(`host:${pin}`).emit('player_joined', { players });

      // New player joining an in-progress game — sync them to the current phase.
      if (game.phase !== 'lobby') syncState(socket, game);
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
    getIo().to(`host:${game.pin}`).emit('player_joined', { players });
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
    syncState(socket, game);
    getIo().to(`host:${pin}`).emit('player_reconnected', { name: player.name, score: player.score, streak: player.streak });
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
  socket.on('submit_guess', ({ text, artistText }: { text: string; artistText?: string }, callback?: (r: { correct: boolean; points?: number; timeMs?: number }) => void) => {
    const game = gm.getGameBySocket(socket.id);
    if (!game) return callback?.({ correct: false });

    if (raceFlow(game)) {
      const r = gm.recordRaceGuess(game, socket.id, text, artistText);
      if (!r) return callback?.({ correct: false });
      callback?.({ correct: r.correct, points: r.points, timeMs: r.elapsedMs });
      getIo().to(`host:${game.pin}`).emit('answer_received', {
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
  socket.on('submit_chaos_tap', ({ index }: { index: number }, callback?: (r: { correct: boolean; points?: number; timeMs?: number }) => void) => {
    const game = gm.getGameBySocket(socket.id);
    if (!game) return callback?.({ correct: false });
    const r = gm.recordChaosHintTap(game, socket.id, index);
    if (!r) return callback?.({ correct: false });
    callback?.({ correct: r.correct, points: r.points, timeMs: r.elapsedMs });
    getIo().to(`host:${game.pin}`).emit('answer_received', {
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
  socket.on('update_guess_draft', ({ text, artistText }: { text: string; artistText?: string }) => {
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
