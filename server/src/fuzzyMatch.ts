function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(the|a|an)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
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

  const maxDist = Math.min(4, Math.max(2, Math.floor(t.length * 0.2)));
  if (levenshtein(g, t) <= maxDist) return true;

  // allow a clearly recognisable partial match (e.g. "Blinding" for "Blinding Lights")
  if (g.length >= 5 && t.startsWith(g)) return true;

  return false;
}
