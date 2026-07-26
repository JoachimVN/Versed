import { randomInt } from 'node:crypto';

// Shared randomness helpers. All of them go through node:crypto's randomInt
// rather than Math.random — not for cryptographic strength, but so PIN
// generation and song/hint/event picking use one consistent source.

export function pickRandom<T>(arr: T[]): T {
  return arr[randomInt(0, arr.length)];
}

export function shuffle<T>(arr: T[]): T[] {
  const c = [...arr];
  for (let i = c.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [c[i], c[j]] = [c[j], c[i]];
  }
  return c;
}

export function pickWeighted<T>(entries: [T, number][]): T {
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let r = randomInt(0, total);
  for (const [value, w] of entries) {
    if (r < w) return value;
    r -= w;
  }
  return entries[entries.length - 1][0];
}
