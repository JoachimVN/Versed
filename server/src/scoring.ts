import { Game, PointsBreakdown, PointsBreakdownPart, Round } from './types';
import {
  BID_OPTIONS, PITY_BONUS, PITY_GAP_THRESHOLD, RACE_BASE, RACE_DECAY_WINDOW, RACE_FLOOR,
} from './constants';
import { librarySize } from './songPool';

// Every points formula in the game. Pure arithmetic over a Game/Round — the
// only mutation is pityBonus recording who received the catch-up bonus, so the
// reveal can label it.

// Playlist songs carry no real popularity ranking (Spotify's per-track
// popularity is deliberately ignored — see the plan), so every playlist song
// gets this flat bonus instead of the rank-scaled one below. It's the
// midpoint of the library formula's 0-500 range, not the max: giving every
// song the max would make playlist games score noticeably easier than
// library 'hard' mode, not merely "equal difficulty."
const FLAT_DIFFICULTY_BONUS = 250;

export function difficultyBonus(game: Game, rank: number): number {
  if (game.songSource === 'playlist') return FLAT_DIFFICULTY_BONUS;
  return Math.round(500 * Math.max(0, 1 - (rank - 1) / Math.max(librarySize() - 1, 1)));
}

// Assembles a PointsBreakdown from a payout's named pre-multiplier
// components — `parts` must sum to the exact pre-multiplier subtotal each
// call site already computes today, so `total` here always matches the
// `points` value awarded alongside it (same Math.round, same operand order).
export function buildBreakdown(parts: PointsBreakdownPart[], multiplier: number, pity: number): PointsBreakdown {
  const preMultiplier = parts.reduce((sum, p) => sum + p.amount, 0);
  const multiplied = Math.round(preMultiplier * multiplier);
  return { parts, multiplier, multiplierBonus: multiplied - preMultiplier, pity, total: multiplied + pity };
}

export function currentScores(game: Game): Map<string, number> {
  return new Map(Array.from(game.players.entries()).map(([id, p]) => [id, p.score]));
}

// A player who actually scores this round, but was already trailing the
// leader by more than PITY_GAP_THRESHOLD before that score landed, gets a
// flat catch-up bonus on top — never a substitute for scoring, only a nudge
// for players who already got something right. `scores` must reflect every
// player's pre-round total (mutating game.players before calling this would
// let a player's own updated score, or an already-processed player in a
// batch, leak into the leader comparison).
export function pityBonus(scores: Map<string, number>, scorerId: string, round: Round): number {
  const leaderScore = Math.max(
    0,
    ...Array.from(scores.entries()).filter(([id]) => id !== scorerId).map(([, s]) => s),
  );
  if (leaderScore - (scores.get(scorerId) ?? 0) <= PITY_GAP_THRESHOLD) return 0;
  round.pityAwardedTo.add(scorerId);
  return PITY_BONUS;
}

// The bid reward steps down the BID_OPTIONS ladder rather than scaling with
// raw seconds: a linear-in-seconds curve pays 0.1s only ~1.5% more than 1s,
// even though 0.1s is a far harder feat. One ladder position = one equal
// notch of reward, so the daring end of the ladder is actually worth taking.
export function bidScore(bid: number): number {
  const idx = BID_OPTIONS.indexOf(bid);
  if (idx === -1) return Math.round(1000 * Math.max(0, 1 - bid / 60));
  return Math.round(1000 * (1 - idx / (BID_OPTIONS.length - 1)));
}

// Potential points per bid option, sent to clients with round_start so the
// bid picker's score preview always matches the server's actual scoring.
export function bidScoreTable(): number[] {
  return BID_OPTIONS.map(b => 500 + bidScore(b));
}

export function calcPoints(game: Game, bid: number, rank: number): number {
  return 500 + bidScore(bid) + difficultyBonus(game, rank);
}

export function calcRacePoints(
  game: Game, isFirst: boolean, elapsedMs: number, firstElapsedMs: number, rank: number,
): number {
  if (isFirst) return RACE_BASE + difficultyBonus(game, rank);
  const gapSec = Math.max(0, (elapsedMs - firstElapsedMs) / 1000);
  const speed = Math.max(RACE_FLOOR, Math.round(RACE_BASE * (1 - gapSec / RACE_DECAY_WINDOW)));
  return speed + difficultyBonus(game, rank);
}

export function calcRaceWinnerPoints(game: Game, elapsedMs: number, raceTime: number, rank: number): number {
  const speed = Math.max(0, Math.round(RACE_BASE * (1 - elapsedMs / (raceTime * 1000))));
  return speed + difficultyBonus(game, rank);
}
