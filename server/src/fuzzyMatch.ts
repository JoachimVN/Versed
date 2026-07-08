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

const METADATA_WORDS = 'feat|ft|featuring|from|with|remaster(?:ed)?|live|acoustic|remix|edit|version|radio|original|extended|deluxe|bonus|interlude';
const PAREN_METADATA = new RegExp(String.raw`^\s*(${METADATA_WORDS})\b`, 'i');
const PAREN_RE = /^([^([]*)[([](([^)\]]*?))[)\]]/;

// A metadata word can also sit outside the parenthetical, right before it
// — e.g. Spotify's "34+35 Remix (feat. Doja Cat, Megan Thee Stallion)" —
// so the pre-paren segment needs the same word stripped before comparing.
const TRAILING_METADATA_RE = new RegExp(String.raw`\s+(${METADATA_WORDS})\.?\s*$`, 'i');

function stripTrailingMetadata(s: string): string {
  let out = s;
  let prev: string;
  do {
    prev = out;
    out = out.replace(TRAILING_METADATA_RE, '');
  } while (out !== prev);
  return out;
}

// Some "feature added later" reissues use a bare "Title + Artist" pattern
// instead of "Title (feat. Artist)" — e.g. Spotify's own listing for
// PinkPantheress's "Stateside + Zara Larsson". Only strip it when the text
// after "+" actually names the (featured) artist — plenty of real titles
// contain "+" too (e.g. "Safe + Sound", "Day + Night", "Pink + White").
const PLUS_FEATURE_RE = /^(.+?)\s\+\s(.+)$/;

function normalizeCore(s: string, useHomophones: boolean): string {
  return s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’!.$*]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(the|a|an)\b/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(w => (useHomophones ? HOMOPHONES[w] ?? w : w))
    .join(' ')
    .trim();
}

function normalize(s: string): string {
  return normalizeCore(s, true);
}

// A missing/extra space in a guess (e.g. "close tonyou" for "Close To You")
// can turn a 1-character typo into a huge edit distance once homophone
// substitution has collapsed the target down to something like "close 2 u" —
// so also compare the un-substituted spelling and accept either match.
function normalizeRaw(s: string): string {
  return normalizeCore(s, false);
}

// A flat minimum tolerance of 2 lets unrelated words collide once a title is
// short (e.g. "love" vs "rose" is only 2 edits apart) — titles land there
// often once "the"/"a"/"an" are stripped in normalize(). Scale the tolerance
// down for short strings instead of flooring it, while keeping the original
// generous cap for long, multi-word titles.
function fuzzyThreshold(len: number): number {
  if (len <= 3) return 0;
  if (len <= 6) return 1;
  if (len <= 9) return 2;
  if (len <= 14) return 3;
  return 4;
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

function matchesText(g: string, gRaw: string, candidate: string): boolean {
  if (fuzzyMatch(g, normalize(candidate))) return true;
  return fuzzyMatch(gRaw, normalizeRaw(candidate));
}

export function isCorrectArtistGuess(guess: string, artist: string, featuredArtists?: string): boolean {
  const g = normalize(guess);
  const gRaw = normalizeRaw(guess);
  if (!g) return false;
  if (matchesText(g, gRaw, artist)) return true;
  if (featuredArtists) {
    for (const name of featuredArtists.split(',')) {
      if (matchesText(g, gRaw, name)) return true;
    }
  }
  return false;
}

export function isCorrectGuess(guess: string, title: string, artist?: string, featuredArtists?: string): boolean {
  const g = normalize(guess);
  const gRaw = normalizeRaw(guess);
  if (!g) return false;
  if (matchesText(g, gRaw, title)) return true;

  // Accept a guess matching the title before a parenthetical/subtitle, e.g.
  // "I Wanna Dance With Somebody" for "I Wanna Dance With Somebody (Who Loves Me)".
  // Also accept the parenthetical content itself when it's a true subtitle (not metadata
  // like "feat. X", "from X", "remastered", etc.).
  const parenMatch = PAREN_RE.exec(title);
  if (parenMatch) {
    if (matchesText(g, gRaw, parenMatch[1])) return true;
    if (matchesText(g, gRaw, stripTrailingMetadata(parenMatch[1]))) return true;
    if (!PAREN_METADATA.test(parenMatch[2]) && matchesText(g, gRaw, parenMatch[2])) return true;
  }

  const plusMatch = PLUS_FEATURE_RE.exec(title);
  if (plusMatch && isCorrectArtistGuess(plusMatch[2], artist ?? '', featuredArtists)
    && matchesText(g, gRaw, plusMatch[1])) return true;

  return false;
}
