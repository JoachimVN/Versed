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

const PAREN_METADATA = /^\s*(feat|ft|featuring|from|with|remaster|live|acoustic|remix|edit|version|radio|original|extended|deluxe|bonus|interlude)\b/i;
const PAREN_RE = /^([^([]*)[([](([^)\]]*?))[)\]]/;

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’!.$*]/g, '')
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
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) => {
    return Array.from({ length: n + 1 }, (_, j) => {
      if (i === 0) return j;
      return j === 0 ? i : 0;
    });
  });
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

function fuzzyMatch(g: string, candidate: string): boolean {
  if (!candidate) return false;
  if (g === candidate) return true;
  return levenshtein(g, candidate) <= fuzzyThreshold(candidate.length);
}

export function isCorrectArtistGuess(guess: string, artist: string): boolean {
  const g = normalize(guess);
  const a = normalize(artist);
  if (!g) return false;
  return fuzzyMatch(g, a);
}

export function isCorrectGuess(guess: string, title: string): boolean {
  const g = normalize(guess);
  const t = normalize(title);
  if (!g) return false;
  if (fuzzyMatch(g, t)) return true;

  // Accept a guess matching the title before a parenthetical/subtitle, e.g.
  // "I Wanna Dance With Somebody" for "I Wanna Dance With Somebody (Who Loves Me)".
  // Also accept the parenthetical content itself when it's a true subtitle (not metadata
  // like "feat. X", "from X", "remastered", etc.).
  const parenMatch = PAREN_RE.exec(title);
  if (parenMatch) {
    if (fuzzyMatch(g, normalize(parenMatch[1]))) return true;
    if (!PAREN_METADATA.test(parenMatch[2]) && fuzzyMatch(g, normalize(parenMatch[2]))) return true;
  }

  return false;
}
