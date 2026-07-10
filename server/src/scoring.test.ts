import { describe, it, expect } from 'vitest';
import {
  BID_OPTIONS, bidScore, bidScoreTable, calcPoints, calcRacePoints, calcRaceWinnerPoints,
  RACE_BASE, RACE_FLOOR,
} from './gameManager';
import type { Game } from './types';

// songSource 'playlist' pins difficultyBonus to its flat 250 so these tests
// never depend on the CSV dataset being loaded.
const game = { songSource: 'playlist' } as Game;
const FLAT_BONUS = 250;

describe('bidScore', () => {
  it('pays the full 1000 at the most daring bid and 0 at the safest', () => {
    expect(bidScore(BID_OPTIONS[0])).toBe(1000);
    expect(bidScore(BID_OPTIONS[BID_OPTIONS.length - 1])).toBe(0);
  });

  it('steps down one equal notch per ladder position', () => {
    const notch = 1000 / (BID_OPTIONS.length - 1);
    BID_OPTIONS.forEach((bid, i) => {
      expect(bidScore(bid)).toBe(Math.round(1000 * (1 - i / (BID_OPTIONS.length - 1))));
      expect(bidScore(bid)).toBeCloseTo(1000 - i * notch, -1);
    });
  });

  it('is monotonically decreasing along the ladder', () => {
    for (let i = 1; i < BID_OPTIONS.length; i++) {
      expect(bidScore(BID_OPTIONS[i])).toBeLessThan(bidScore(BID_OPTIONS[i - 1]));
    }
  });

  it('falls back to linear-in-seconds for off-ladder bids', () => {
    expect(bidScore(25)).toBe(Math.round(1000 * (1 - 25 / 60)));
  });
});

describe('bidScoreTable', () => {
  it('is base 500 plus the bid score, per option (what the client previews)', () => {
    expect(bidScoreTable()).toEqual(BID_OPTIONS.map(b => 500 + bidScore(b)));
  });
});

describe('calcPoints (classic)', () => {
  it('is base + bid bonus + difficulty bonus', () => {
    expect(calcPoints(game, BID_OPTIONS[0], 1)).toBe(500 + 1000 + FLAT_BONUS);
    expect(calcPoints(game, BID_OPTIONS[BID_OPTIONS.length - 1], 1)).toBe(500 + 0 + FLAT_BONUS);
  });
});

describe('calcRacePoints', () => {
  it('pays the first correct guesser full base regardless of time', () => {
    expect(calcRacePoints(game, true, 30_000, 30_000, 1)).toBe(RACE_BASE + FLAT_BONUS);
  });

  it('decays with the gap behind the first guesser', () => {
    // 6s behind on a 12s decay window = half the base.
    expect(calcRacePoints(game, false, 8_000, 2_000, 1)).toBe(RACE_BASE / 2 + FLAT_BONUS);
  });

  it('never pays below the floor', () => {
    expect(calcRacePoints(game, false, 60_000, 1_000, 1)).toBe(RACE_FLOOR + FLAT_BONUS);
  });
});

describe('calcRaceWinnerPoints', () => {
  it('pays full base for an instant answer and only the bonus at the buzzer', () => {
    expect(calcRaceWinnerPoints(game, 0, 30, 1)).toBe(RACE_BASE + FLAT_BONUS);
    expect(calcRaceWinnerPoints(game, 30_000, 30, 1)).toBe(0 + FLAT_BONUS);
  });
});
