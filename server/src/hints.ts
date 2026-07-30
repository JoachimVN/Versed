import { randomInt } from 'node:crypto';
import { GuessTarget, Hint, PartyConfig, Song } from './types';
import { pickRandom, shuffle } from './random';
import { introFor } from './party';

// Everything that turns a Song into the hints a round shows: the value
// formatters, the per-event hint sets (normal, full, underdog, chaos), and the
// policy that picks between them for a given round.

function getInitials(artist: string): string {
  const main = artist.split(/\s(?:featuring|feat\.|ft\.|x\s)/i)[0].trim();
  return main.split(/\s+/).map(w => (w[0] ?? '').toUpperCase()).join('.') + '.';
}

// 100M and 500M are floor/placeholder values in the source data (thousands of
// songs share exactly one of these two figures), not precise counts — mark
// them so the hint doesn't imply false precision.
function formatStreams(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  const plus = n === 100_000_000 || n === 500_000_000 ? '+' : '';
  return `${(n / 1_000_000).toFixed(0)}M${plus}`;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

// The one "when was it out" hint — year and decade must never appear
// together, so this always produces at most one of the two.
function timeHint(song: Song): Hint | null {
  if (song.year && song.decade) {
    return randomInt(0, 2) === 0
      ? { label: 'Era', value: `${song.decade}s` }
      : { label: 'Release year', value: String(Math.floor(song.year)) };
  }
  if (song.decade) return { label: 'Era', value: `${song.decade}s` };
  if (song.year) return { label: 'Release year', value: String(Math.floor(song.year)) };
  return null;
}

function fullArtistLine(song: Song): string {
  return song.featuredArtists ? `${song.artist} feat. ${song.featuredArtists.split(';').join(', ')}` : song.artist;
}

function artistHint(song: Song): Hint {
  return randomInt(0, 2) === 0
    ? { label: 'Artist initials', value: getInitials(song.artist) }
    : { label: 'Artist(s)', value: fullArtistLine(song) };
}

function generateHints(song: Song, suppressArtist = false, suppressYear = false, includeTitle = false): Hint[] {
  const pool: Hint[] = [];

  // Suppressed entirely when the year itself is the answer.
  if (!suppressYear) {
    const hint = timeHint(song);
    if (hint) pool.push(hint);
  }

  if (song.spotifyStreams)
    pool.push({ label: 'Streams', value: formatStreams(song.spotifyStreams) });

  if (song.durationMs)
    pool.push({ label: 'Duration', value: formatDuration(song.durationMs) });

  // Artist hints are suppressed in artist-only mode since the artist IS the answer.
  if (!suppressArtist) pool.push(artistHint(song));

  if (includeTitle) pool.push({ label: 'Song title', value: song.title });

  const count = randomInt(1, 4); // 1–3, always at least one hint
  const shuffled = shuffle(pool);
  let selected = shuffled.slice(0, count);

  // Duration rarely helps identify a song, so it must never be the sole hint.
  if (selected.length === 1 && selected[0].label === 'Duration' && shuffled.length > 1) {
    selected = shuffled.slice(0, 2);
  }

  return selected;
}

// 'fullhints' rounds: every hint we have, deduplicated — one time hint (year
// beats decade), and the full artist line instead of initials.
function generateAllHints(song: Song, suppressArtist: boolean, suppressYear: boolean): Hint[] {
  const hints: Hint[] = [];
  if (!suppressYear) {
    if (song.year) hints.push({ label: 'Release year', value: String(Math.floor(song.year)) });
    else if (song.decade) hints.push({ label: 'Era', value: `${song.decade}s` });
  }
  if (song.spotifyStreams) hints.push({ label: 'Streams', value: formatStreams(song.spotifyStreams) });
  if (song.durationMs) hints.push({ label: 'Duration', value: formatDuration(song.durationMs) });
  if (!suppressArtist) hints.push({ label: 'Artist(s)', value: fullArtistLine(song) });
  return hints;
}

// Underdog Boost's hints: always exactly the release year/era and the full
// artist name (or the title, if the artist is what's being guessed) — no
// random pool/count like a normal round. Cover art is added separately in
// index.ts once resolved (this only builds the text hints). Deliberately
// omits Streams/Duration — this event is meant to give a real, targeted
// assist, not the usual grab-bag of trivia.
function generateUnderdogHints(song: Song, suppressArtist: boolean, suppressYear: boolean, includeTitle: boolean): Hint[] {
  const hints: Hint[] = [];
  if (!suppressYear) {
    if (song.year) hints.push({ label: 'Release year', value: String(Math.floor(song.year)) });
    else if (song.decade) hints.push({ label: 'Era', value: `${song.decade}s` });
  }
  if (!suppressArtist) hints.push({ label: 'Artist(s)', value: fullArtistLine(song) });
  if (includeTitle) hints.push({ label: 'Song title', value: song.title });
  return hints;
}

// Chaos Hints' safe-to-show categories — deliberately excludes Song title and
// the full Artist(s) line entirely (not just from fabrication): a real other
// song's title or artist name would itself read as a plausible, confusing
// "real" answer, rather than a clean fabrication a player can rule out.
function safeChaosHints(song: Song): Hint[] {
  const hints: Hint[] = [];
  if (song.year) hints.push({ label: 'Release year', value: String(Math.floor(song.year)) });
  else if (song.decade) hints.push({ label: 'Era', value: `${song.decade}s` });
  if (song.spotifyStreams) hints.push({ label: 'Streams', value: formatStreams(song.spotifyStreams) });
  if (song.durationMs) hints.push({ label: 'Duration', value: formatDuration(song.durationMs) });
  hints.push({ label: 'Artist initials', value: getInitials(song.artist) });
  return hints;
}

// Builds the "spot the fake hint" set: every safe category for the real
// song, with one entry's value swapped for the same category borrowed from a
// different random song in the pool. Returns undefined if there aren't
// enough categories to make a believable set, or no other song shares the
// picked category (both are just missing-data edge cases on small pools).
function buildChaosHintSet(song: Song, pool: Song[]): { hints: Hint[]; fakeIndex: number } | undefined {
  const real = safeChaosHints(song);
  if (real.length < 2) return undefined;
  const decoyCandidates = pool.filter(s => s.spotifyTrackId !== song.spotifyTrackId);
  if (decoyCandidates.length === 0) return undefined;
  const decoySong = pickRandom(decoyCandidates);
  const decoyHints = safeChaosHints(decoySong);
  // Only fabricate a category the decoy actually has data for, and where the
  // fabricated value would actually differ (an identical stat wouldn't read
  // as a lie at all).
  const fakeCandidates = real
    .map((h, i) => ({ i, decoy: decoyHints.find(d => d.label === h.label) }))
    .filter((c): c is { i: number; decoy: Hint } => !!c.decoy && c.decoy.value !== real[c.i].value);
  if (fakeCandidates.length === 0) return undefined;
  const { i: fakeIndex, decoy } = pickRandom(fakeCandidates);
  const hints = real.map((h, i) => (i === fakeIndex ? { label: h.label, value: decoy.value } : h));
  return { hints, fakeIndex };
}

// Honours 'blind' (no hints) and 'fullhints' (every hint) party events, then
// includes the song title in the hint pool when the title itself isn't the
// answer — guessing the artist or the year doesn't give the title away.
function buildRoundHints(song: Song, party: PartyConfig | undefined, guessKind: GuessTarget | 'year'): Hint[] {
  if (party?.format === 'classic' && party.event === 'blind') return [];

  // Any target other than plain 'title' means the artist is (part of) the
  // answer, so artist hints would give it away.
  const suppressArtist = guessKind === 'artist' || guessKind === 'both';
  const suppressYear = guessKind === 'year';
  const includeTitle = guessKind === 'artist' || guessKind === 'year';
  if (party?.event === 'underdog') return generateUnderdogHints(song, suppressArtist, suppressYear, includeTitle);
  const hints = party?.format === 'classic' && party.event === 'fullhints'
    ? generateAllHints(song, suppressArtist, suppressYear)
    : generateHints(song, suppressArtist, suppressYear, includeTitle);

  return hints;
}

export function resolveRoundHints(
  song: Song,
  pool: Song[],
  party: PartyConfig | undefined,
  target: GuessTarget | 'year',
): { hints: Hint[]; chaosFakeIndex?: number } {
  const chaosSet = party?.event === 'chaoshints' ? buildChaosHintSet(song, pool) : undefined;
  if (party?.event !== 'chaoshints') {
    return { hints: buildRoundHints(song, party, target) };
  }
  if (chaosSet) return { hints: chaosSet.hints, chaosFakeIndex: chaosSet.fakeIndex };

  // Not enough hint categories (or no decoy song shares one) to build a
  // believable set — silently downgrade to a plain round, same precedent
  // as computeSnippetPosition's downgrade for snippet/outro.
  party.event = null;
  party.multiplier = 1;
  party.intro = introFor(party.format, party.target, party.event, party.winnerOnly);
  return { hints: buildRoundHints(song, party, target) };
}
