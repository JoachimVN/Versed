import { Socket } from 'socket.io';
import * as gm from '../gameManager';
import { Game, Round } from '../types';
import { raceFlow, songFields, stealPendingName } from './roundLifecycle';

// Always send the player their current score so the client doesn't show 0
// after a reconnect. This is a distinct event from `score_update` — that one
// means "you just scored," and the client renders it as a round delta. This
// is just a state sync, so it must not be mistaken for points just earned.
export function emitSelfScore(socket: Socket, game: Game) {
  const selfPlayer = game.players.get(socket.id);
  if (selfPlayer) {
    socket.emit('score_sync', {
      score: selfPlayer.score,
      streak: selfPlayer.streak,
    });
  }
}

export function emitRevealSnapshot(socket: Socket, game: Game, round: Round) {
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

export function emitRaceTurnSnapshot(socket: Socket, game: Game, round: Round | null) {
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
    artistOnly: round.target === 'artist',
    yearOnly: round.target === 'year',
    choiceOptions: round.choiceOptions,
    party: gm.partyView(game, round),
    tempo: round.song.tempo,
    resync: true,
  });
  if (game.phase === 'guessing' && round.playStartAt && game.phaseEndsAt && !round.passed.has(socket.id)) {
    socket.emit('your_turn', { timeLimit: game.raceTime, endsAt: game.phaseEndsAt });
  }
}

export function emitClassicPhaseSnapshot(socket: Socket, game: Game, round: Round | null) {
  if (game.phase === 'betting' && round && game.phaseEndsAt) {
    socket.emit('round_start', {
      roundIndex: game.roundIndex,
      total: game.totalRounds,
      hints: round.hints,
      bettingTime: game.bettingTime,
      endsAt: game.phaseEndsAt,
      mode: 'classic',
      artistOnly: round.target === 'artist',
      yearOnly: round.target === 'year',
      choiceOptions: round.choiceOptions,
      party: gm.partyView(game, round),
      bidOptions: gm.BID_OPTIONS,
      bidScores: gm.bidScoreTable(),
      tempo: round.song.tempo,
      resync: true,
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
    artistOnly: round.target === 'artist',
    yearOnly: round.target === 'year',
    choiceOptions: round.choiceOptions,
    party: gm.partyView(game, round),
    bidOptions: gm.BID_OPTIONS,
    bidScores: gm.bidScoreTable(),
    tempo: round.song.tempo,
    resync: true,
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
export function syncState(socket: Socket, game: Game) {
  emitSelfScore(socket, game);
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
    emitRevealSnapshot(socket, game, round);
    return;
  }

  if (raceFlow(game)) {
    emitRaceTurnSnapshot(socket, game, round);
    return;
  }

  emitClassicPhaseSnapshot(socket, game, round);
}
