// Map text-speak / number homophones to a single canonical token so guesses
// like "Good For U" line up with a title written "Good 4 U" (and vice-versa).
// Both guess and title run through this, so the mapping just has to be
// consistent — it doesn't matter which spelling we collapse to.
const HOMOPHONES: Record<string, string> = {
  for: '4', four: '4',
  to: '2', too: '2', two: '2',
  you: 'u',
  n: 'and',
  are: 'r',
  your: 'ur',
  one: '1', won: '1',
  ate: '8', eight: '8',
  luv: 'love',
  okay: 'ok',
};

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(the|a|an)\b/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(w => HOMOPHONES[w] ?? w)
    .join(' ')
    .trim();
}

function fuzzyThreshold(len: number): number {
  return Math.min(4, Math.max(2, Math.floor(len * 0.2)));
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

export function isCorrectGuess(guess: string, title: string): boolean {
  const g = normalize(guess);
  const t = normalize(title);
  if (!g) return false;
  if (g === t) return true;

  if (levenshtein(g, t) <= fuzzyThreshold(t.length)) return true;

  // Accept a guess that nails every word but the last — "Blinding" for
  // "Blinding Lights", or "Sweet Home" for "Sweet Home Alabama". This stays
  // strict on purpose: a single word of a three-word title isn't enough.
  const words = t.split(' ');
  if (words.length >= 2) {
    const allButLast = words.slice(0, -1).join(' ');
    if (g === allButLast) return true;
    if (levenshtein(g, allButLast) <= Math.min(2, Math.floor(allButLast.length * 0.2))) {
      return true;
    }
  }

  return false;
}
