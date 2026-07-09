import { randomInt } from 'node:crypto';
import {
  Award, ChaosLevel, Difficulty, Game, GuessTarget, Hint, PartyClientView, PartyConfig, PartyEvent, PartyFormat, PartyTarget,
  PartyRoundType, Player, PlaylistTrackInput, Round, Song, YearResult,
} from './types';
import { loadSongs } from './songLoader';
import { adaptPlaylistTracks } from './customSongPool';
import { isCorrectGuess, isCorrectArtistGuess, textsCollide } from './fuzzyMatch';

// Below this, rounds start repeating tracks (TOTAL_ROUNDS below) — the client
// warns the host but still allows starting, so this isn't a hard floor here.
export const MIN_PLAYLIST_TRACKS = 10;

export const BID_OPTIONS = [0.1, 0.5, 1, 2, 3, 4, 5, 7, 10, 15, 20, 30, 45, 60];
export const BETTING_TIME = 15;
export const GUESSING_TIME = 15;
export const TOTAL_ROUNDS = 10;
export const MAX_PLAYERS = 50;
export const MAX_ACTIVE_GAMES = 20;

export const RACE_TIME = 30;
export const RACE_DECAY_WINDOW = 12;
export const RACE_FLOOR = 200;
export const RACE_BASE = 1000;

// ─── Party mode tuning ────────────────────────────────────────────────────────
export const STEAL_PCT = 0.25;         // steal takes 15% of the victim's score…
export const STEAL_MIN = 400;          // …but never less than this (capped at their total)
// Finale: flat bonus for winning the best-of-3 duel outright (first to 2
// sub-round wins). Deliberately NOT scaled to the score gap between the
// duelists — "shouldn't be possible to flip a huge score gap based on 3
// rounds" — so it stays meaningful without ever guaranteeing a placement
// flip. Per-sub-round points still score normally on top of this.
export const DUEL_BONUS = 3000;
export const YEAR_MAX_POINTS = 1000;   // year round: exact answer
export const YEAR_POINTS_SLOPE = 120;  // …minus this per year off
export const YEAR_WINNER_BONUS = 500;  // closest answer bonus (split on ties)
export const PITY_GAP_THRESHOLD = 3000; // leader's lead must exceed this…
export const PITY_BONUS = 500;          // …for a scorer to get this catch-up bonus
const YEAR_CHOICE_RADIUS = 10;
const MIN_CHOICE_YEAR = 1900;

// The tiniest bids ask for so little audio that a clip can land entirely inside
// a song's near-silent lead-in and reveal nothing — pure bad luck the bidder
// couldn't foresee. We can't detect silence (Spotify's audio-analysis is gone
// and the SDK is DRM'd), so we instead always play at least this much audio.
// Bids are still shown and scored at face value, so the bid ladder stays
// monotonic (more audio ⇄ lower score) and there's no "always bid 0.1" exploit.
export const MIN_PLAY_MS = 200;

// Actual audible window for a winning bid: the bid itself, floored so the
// shortest clips still have a fighting chance of containing a real transient.
export function playMsFor(bid: number): number {
  return Math.max(bid * 1000, MIN_PLAY_MS);
}

// Fraction of the song pool in play per difficulty, taken from the top of the
// rank-sorted list — i.e. the most well-known songs first.
const DIFFICULTY_PCT: Record<Difficulty, number> = { easy: 0.2, medium: 0.5, hard: 1 };

let songs: Song[] = [];
// Exact Spotify-track-ID lookup into the CSV catalog, used to enrich
// playlist-imported songs (which have no popularity data of their own) with
// tempo/stream counts when the same track also happens to be in the CSV.
let csvByTrackId = new Map<string, Song>();
const games = new Map<string, Game>();
const socketToPin = new Map<string, string>();

export function initSongs() {
  songs = loadSongs();
  csvByTrackId = new Map(songs.map(s => [s.spotifyTrackId, s]));
  console.log(`Loaded ${songs.length} playable songs`);
}

// `songs` is sorted ascending by rank (loadSongs), so the top slice is the
// most well-known songs — that's what makes 'easy' actually easy. A custom
// playlist pool has no popularity ranking to slice by, so difficulty is
// skipped entirely and the whole pool is always in play.
function difficultyPool(game: Game): Song[] {
  if (game.songSource === 'playlist') return game.songPool ?? [];
  const count = Math.max(1, Math.ceil(songs.length * DIFFICULTY_PCT[game.difficulty]));
  return songs.slice(0, count);
}

// Recently-played memory, keyed per song-pool identity, so a fresh "New
// Game" doesn't immediately resurface songs from the game just played.
// Process-lifetime only (no persistence), same as every other piece of
// in-memory state here. Library plays share one bucket across all
// difficulties (the slices are prefixes of the same rank-sorted array, and
// "recently heard" shouldn't depend on which difficulty was active);
// each distinct playlist gets its own bucket keyed by Spotify playlist ID.
const recentlyPlayedByPool = new Map<string, string[]>();
const RECENT_CAP_RATIO = 0.5;

function poolKey(game: Game): string {
  return game.songSource === 'playlist' ? `playlist:${game.playlistId ?? 'unknown'}` : 'library';
}

// Sized off the library's full length, not the active difficulty slice, so
// the cap doesn't shift just because the host changed difficulty.
function poolSizeForCap(game: Game): number {
  return game.songSource === 'playlist' ? (game.songPool?.length ?? 0) : songs.length;
}

// Capped at half the pool so this filter alone can never empty a pool —
// on top of the soft-filter fallback in buildRound.
function rememberRecentlyPlayed(key: string, trackId: string, poolSize: number): void {
  const cap = Math.max(1, Math.floor(poolSize * RECENT_CAP_RATIO));
  const list = recentlyPlayedByPool.get(key) ?? [];
  const next = list.filter(id => id !== trackId);
  next.push(trackId);
  while (next.length > cap) next.shift();
  recentlyPlayedByPool.set(key, next);
}

// Plain literal normalizer for artist-identity comparison — deliberately not
// fuzzyMatch.ts's normalize(), which strips articles and does homophone
// substitution for typo-tolerant guessing and would cause false collisions
// here (e.g. "The Band" vs "Band").
function normalizeArtistName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

// featuredArtists is already comma-joined by the time it reaches Song, both
// via songLoader.ts's CSV parse and customSongPool.ts's playlist adapter.
function artistNames(song: Song): string[] {
  const names = [song.artist, ...(song.featuredArtists ? song.featuredArtists.split(',') : [])];
  return names.map(normalizeArtistName).filter(Boolean);
}

// Checks both songs' primary and featured names, so an artist featured on
// one track and primary on the next still counts as "same artist."
function sameArtist(a: Song, b: Song): boolean {
  const bNames = new Set(artistNames(b));
  return artistNames(a).some(name => bNames.has(name));
}

// How many recent rounds' artists to avoid repeating, scaled to pool size:
// small pools (a 10-track playlist) get a short window so the constraint
// doesn't overreach and get dropped constantly; larger pools cap out at 5 —
// looking back further than that stops being about "feels repetitive" and
// just costs more comparisons for no real benefit.
const ARTIST_WINDOW_MIN = 2;
const ARTIST_WINDOW_MAX = 5;
const ARTIST_WINDOW_DIVISOR = 4;

function artistWindowSize(poolSize: number): number {
  return Math.min(ARTIST_WINDOW_MAX, Math.max(ARTIST_WINDOW_MIN, Math.floor(poolSize / ARTIST_WINDOW_DIVISOR)));
}

function generatePin(): string {
  let pin: string;
  do { pin = (100 + randomInt(0, 900)).toString(); }
  while (games.has(pin));
  return pin;
}

function pickRandom<T>(arr: T[]): T {
  return arr[randomInt(0, arr.length)];
}

function shuffle<T>(arr: T[]): T[] {
  const c = [...arr];
  for (let i = c.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [c[i], c[j]] = [c[j], c[i]];
  }
  return c;
}

function pickWeighted<T>(entries: [T, number][]): T {
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let r = randomInt(0, total);
  for (const [value, w] of entries) {
    if (r < w) return value;
    r -= w;
  }
  return entries[entries.length - 1][0];
}

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

function artistHint(song: Song): Hint {
  const fullArtist = song.featuredArtists
    ? `${song.artist} feat. ${song.featuredArtists}`
    : song.artist;
  return randomInt(0, 2) === 0
    ? { label: 'Artist initials', value: getInitials(song.artist) }
    : { label: 'Artist(s)', value: fullArtist };
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
  if (!suppressArtist) {
    const fullArtist = song.featuredArtists
      ? `${song.artist} feat. ${song.featuredArtists}`
      : song.artist;
    hints.push({ label: 'Artist(s)', value: fullArtist });
  }
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
  if (!suppressArtist) {
    const fullArtist = song.featuredArtists
      ? `${song.artist} feat. ${song.featuredArtists}`
      : song.artist;
    hints.push({ label: 'Artist(s)', value: fullArtist });
  }
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

// ─── Party round recipes ─────────────────────────────────────────────────────

function introFor(
  format: PartyFormat, target: PartyTarget, event: PartyEvent | null, winnerOnly = false,
): { title: string; tagline: string } {
  if (format === 'year') {
    return {
      title: 'Guess the Year',
      tagline: winnerOnly
        ? 'Only the closest guess scores — everyone else gets zero'
        : 'Closest answer wins the round',
    };
  }
  let choiceFlow = 'Tap the right title';
  if (target === 'year') choiceFlow = 'Tap the right year';
  else if (target === 'artist') choiceFlow = 'Tap the right artist';

  let flow = 'Everyone races';
  if (format === 'classic') flow = 'Bid & guess';
  else if (format === 'choice') flow = choiceFlow;
  let goal = 'name the song';
  if (target === 'artist') goal = 'name the artist';
  else if (target === 'both') goal = 'title + artist bonus';
  else if (target === 'year') goal = 'pick the release year';
  const suffix = winnerOnly ? ' / winner takes all' : '';
  const eventIntros: Record<PartyEvent, { title: string; tag: string }> = {
    double: { title: 'Double Points', tag: 'Everything is worth 2×' },
    mystery: { title: 'Mystery Multiplier', tag: 'Revealed after the round: ×1.5 up to ×10' },
    steal: { title: 'Steal Round', tag: 'Win the round, then rob another player' },
    snippet: { title: 'Snippet Roulette', tag: 'The clip starts somewhere mid-song' },
    fullhints: { title: 'Open Book', tag: 'Every hint on the table' },
    blind: { title: 'Blind Bet', tag: 'No hints at all — bid on ears alone' },
    outro: { title: 'Down to the Wire', tag: "The clip plays the song's final stretch" },
    underdog: { title: 'Underdog Boost', tag: 'Only the player(s) in last place can answer — hints on, ×1.5 points' },
    chaoshints: { title: 'Chaos Hints', tag: 'One hint is a lie — tap the fake one, fastest wins' },
  };
  // Chaos Hints replaces the round's whole objective (spot the fake hint,
  // not name the song), so it skips the normal flow/goal composition below
  // — otherwise the tagline would misleadingly still say "name the song".
  if (event === 'chaoshints') {
    return { title: eventIntros.chaoshints.title, tagline: eventIntros.chaoshints.tag };
  }
  if (event) {
    const e = eventIntros[event];
    return { title: e.title, tagline: `${e.tag} · ${flow} / ${goal}${suffix}` };
  }
  if (format === 'choice') {
    return { title: 'Multiple Choice', tagline: `${flow}, fastest wins${suffix}` };
  }
  if (target === 'artist') return { title: 'Who Sings It?', tagline: `${flow} / name the artist${suffix}` };
  if (target === 'both') return { title: 'Double Duty', tagline: `${flow} / name the artist too to double your points${suffix}` };
  if (format === 'race' && winnerOnly) {
    return { title: 'Winner Takes All', tagline: 'Everyone guesses at once / only the first correct answer scores' };
  }
  return format === 'race'
    ? { title: 'Race Round', tagline: 'Everyone guesses at once / speed wins' }
    : { title: 'Classic Round', tagline: 'Bid low, score high' };
}

// 'title' always stays in the pool unconditionally — it's the baseline round
// type, same principle as 'classic'/'race' always staying in buildPartyConfig's
// format pool below — so this never needs an empty-pool fallback the way
// pickPartyEvent's genuinely-can-empty pool does.
function pickPartyTarget(game: Game, format: PartyFormat): PartyTarget {
  if (format === 'year') return 'year';
  const pool: [PartyTarget, number][] = [['title', 60]];
  if (game.enabledRoundTypes.has('artist')) pool.push(['artist', 25]);
  if (format === 'choice' && game.enabledRoundTypes.has('year')) pool.push(['year', 15]);
  // Double Duty has no slot in a tap-to-answer UI, so it can't combine with
  // Multiple Choice — pickPartyTarget only ever gets called with a 'both'
  // possibility outside format === 'choice'.
  if (format !== 'choice' && game.enabledRoundTypes.has('both')) pool.push(['both', 15]);
  return pickWeighted(pool);
}

// Every party event that exists — the default "everything on" set for a new
// game, and what host-supplied enabledEvents lists get validated against.
export const ALL_PARTY_EVENTS: PartyEvent[] = [
  'double', 'mystery', 'steal', 'snippet', 'fullhints', 'blind', 'outro', 'underdog', 'chaoshints',
];

// Every party round-type variant that exists — same "default everything on,
// validate host-supplied lists against this" role as ALL_PARTY_EVENTS, but
// for the format/target/winnerOnly pool instead of event modifiers.
export const ALL_PARTY_ROUND_TYPES: PartyRoundType[] = ['choice', 'artist', 'both', 'year', 'winnerOnly'];

// Interpolate from 80% plain rounds at Chill through 60% at Balanced to 40%
// at Chaotic. Every slider position therefore affects the actual frequency.
function noEventChance(chaosLevel: ChaosLevel): number {
  return 80 - chaosLevel * 0.4;
}

function pickPartyEvent(game: Game, format: PartyFormat, prevEvent: PartyEvent | null | undefined): PartyEvent | null {
  if (format === 'year' || randomInt(0, 100) < noEventChance(game.chaosLevel)) return null;
  const pool: [PartyEvent, number][] = [['double', 30], ['mystery', 25], ['snippet', 25]];
  if (format === 'classic') pool.push(['fullhints', 20], ['blind', 20]);
  // Chaos Hints replaces the whole guessing objective with a tap-the-fake-
  // hint mini-game, which only makes sense riding the plain race flow — not
  // stacked on "guess the year" or the classic bid/tier flow.
  if (format === 'race') pool.push(['outro', 25], ['chaoshints', 15]);
  // Steal needs someone else to steal from — pointless (and confusing to
  // announce) in a 1-player game.
  if (game.roundIndex >= 2 && game.players.size >= 2) pool.push(['steal', 20]);
  // Underdog restricts guessing to whoever's trailing, so it needs someone
  // else to be ahead of — and it rides race/year scoring, not the classic
  // bid/tier flow (that's a deliberately different kind of "not everyone
  // gets a turn").
  if (format !== 'classic' && game.players.size >= 2) pool.push(['underdog', 20]);
  const filtered = pool.filter(([e]) => e !== prevEvent && game.enabledEvents.has(e));
  // The host disabled everything that was otherwise eligible this round —
  // fall back to a plain round rather than erroring.
  if (filtered.length === 0) return null;
  return pickWeighted(filtered);
}

// Mystery weights at the three labelled anchors. Intermediate slider values
// linearly interpolate every weight, rather than snapping to a hidden preset.
const MYSTERY_MULTIPLIERS = [1.5, 2, 3, 4, 5, 10] as const;
const MYSTERY_WEIGHT_ANCHORS = {
  chill: [40, 35, 20, 5, 0, 0],
  balanced: [27, 27, 27, 12, 5, 2],
  chaotic: [12, 16, 17, 20, 18, 17],
} as const;

function mysteryWeights(chaosLevel: ChaosLevel): [number, number][] {
  const lower = chaosLevel <= 50 ? MYSTERY_WEIGHT_ANCHORS.chill : MYSTERY_WEIGHT_ANCHORS.balanced;
  const upper = chaosLevel <= 50 ? MYSTERY_WEIGHT_ANCHORS.balanced : MYSTERY_WEIGHT_ANCHORS.chaotic;
  const progress = chaosLevel <= 50 ? chaosLevel / 50 : (chaosLevel - 50) / 50;
  return MYSTERY_MULTIPLIERS.map((multiplier, index) => [
    multiplier,
    lower[index] + (upper[index] - lower[index]) * progress,
  ]);
}

function eventMultiplier(game: Game, event: PartyEvent | null): number {
  if (event === 'double') return 2;
  if (event === 'mystery') return pickWeighted(mysteryWeights(game.chaosLevel));
  // The "boost" in Underdog Boost — a real payout bump on top of exclusive
  // access to the round, not just first dibs at the normal rate.
  if (event === 'underdog') return 1.5;
  return 1;
}

// One random recipe per round: format + guess target + modifier, with just
// enough constraints to keep it feeling curated — round 1 is a plain warm-up,
// the same event never repeats twice in a row, steal waits until scores exist,
// and the last round is a top-2 duel.
// Whoever's currently tied for the lowest score — everyone at that score, not
// just one of them, since the underdog event lets all of them race for it.
function trailingPlayers(game: Game): { ids: string[]; names: string[] } {
  const players = Array.from(game.players.values());
  const min = Math.min(...players.map(p => p.score));
  const trailing = players.filter(p => p.score === min);
  return { ids: trailing.map(p => p.socketId), names: trailing.map(p => p.name) };
}

function buildPartyConfig(game: Game): PartyConfig {
  const plain: Omit<PartyConfig, 'format' | 'target' | 'event' | 'multiplier' | 'winnerOnly' | 'intro'> = {
    finale: false, duelistIds: [], duelistNames: [], restrictedIds: [], restrictedNames: [],
  };

  const isLast = game.roundIndex === game.totalRounds - 1;
  if (isLast && game.totalRounds > 1 && game.players.size >= 2) {
    if (!game.duelActive) {
      const top = Array.from(game.players.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, 2);
      game.duelActive = true;
      game.duelDuelistIds = top.map(p => p.socketId);
      game.duelWins = { [top[0].socketId]: 0, [top[1].socketId]: 0 };
      game.duelSubRoundIndex = 0;
    }
    return buildDuelSubRoundConfig(game);
  }

  if (game.roundIndex === 0) {
    return {
      ...plain, format: 'classic', target: 'title', event: null, multiplier: 1, winnerOnly: false,
      intro: { title: 'Warm-Up', tagline: 'A classic round to get going' },
    };
  }

  const prev = game.currentRound?.party;
  // 'classic'/'race' always stay unconditional in the pool — same principle
  // as pickPartyTarget's 'title' — so disabling every round type just falls
  // back to plain classic/race rounds (events still layer on top), no
  // explicit empty-pool branch needed the way pickPartyEvent's pool needs one.
  const formatPool: [PartyFormat, number][] = [['classic', 40], ['race', 35]];
  if (game.enabledRoundTypes.has('year')) formatPool.push(['year', 15]);
  if (game.enabledRoundTypes.has('choice')) formatPool.push(['choice', 10]);
  let format = pickWeighted<PartyFormat>(formatPool);
  if (format === 'year' && prev?.format === 'year') format = 'race';

  const target = pickPartyTarget(game, format);
  const event = pickPartyEvent(game, format, prev?.event);
  const multiplier = eventMultiplier(game, event);
  // Only race/year formats can go winner-only — classic already has its own
  // bid/tier stakes, and stacking this on top would just zero out everyone
  // but the lowest bidder.
  const winnerOnly = format !== 'classic' && game.enabledRoundTypes.has('winnerOnly') && randomInt(0, 100) < 25;

  const restricted = event === 'underdog' ? trailingPlayers(game) : { ids: [], names: [] };

  return {
    ...plain, format, target, event, multiplier, winnerOnly,
    restrictedIds: restricted.ids, restrictedNames: restricted.names,
    intro: introFor(format, target, event, winnerOnly),
  };
}

// Best-of-3 finale duel: a fixed format sequence rather than the usual
// random pick — game 1 is a classic bid/tier round, game 2 a race, game 3
// (and any replay of it — see finalizeYearRound) a year decider. Each still
// rolls its own normal event/multiplier, just like a regular round.
// Deliberately ignores enabledRoundTypes: the finale is a fixed, curated
// sequence by design, not a draw from the host's round-type pool — it never
// calls pickPartyTarget and always hardcodes target: 'title'/winnerOnly:
// false below, so it plays out the same finale regardless of which round
// types the host has disabled.
const DUEL_FORMAT_SEQUENCE: PartyFormat[] = ['classic', 'race', 'year'];

function buildDuelSubRoundConfig(game: Game): PartyConfig {
  const format = DUEL_FORMAT_SEQUENCE[Math.min(game.duelSubRoundIndex, DUEL_FORMAT_SEQUENCE.length - 1)];
  const [idA, idB] = game.duelDuelistIds;
  const nameA = game.players.get(idA)?.name ?? '';
  const nameB = game.players.get(idB)?.name ?? '';
  const winsA = game.duelWins[idA] ?? 0;
  const winsB = game.duelWins[idB] ?? 0;

  const prev = game.currentRound?.party;
  const event = pickPartyEvent(game, format, prev?.event);
  const multiplier = eventMultiplier(game, event);

  const gameNum = game.duelSubRoundIndex + 1;
  const gameLabel = gameNum > DUEL_FORMAT_SEQUENCE.length
    ? `Decider replay ${gameNum - DUEL_FORMAT_SEQUENCE.length}`
    : `Game ${gameNum} of 3`;

  return {
    format, target: 'title', event, multiplier, winnerOnly: false,
    finale: true,
    duelistIds: [idA, idB],
    duelistNames: [nameA, nameB],
    restrictedIds: [], restrictedNames: [],
    intro: {
      title: `The Finale · ${gameLabel}`,
      tagline: `${nameA} ${winsA} – ${winsB} ${nameB} · first to 2 wins takes ${DUEL_BONUS.toLocaleString()} pts`,
    },
  };
}

// The sanitized view clients get: no socketIds, and a mystery multiplier stays
// hidden (null) until the reveal.
export function partyView(game: Game, round: Round, revealed = false): PartyClientView | undefined {
  const p = round.party;
  if (!p) return undefined;
  return {
    format: p.format,
    target: p.target,
    event: p.event,
    multiplier: p.event === 'mystery' && !revealed ? null : p.multiplier,
    winnerOnly: p.winnerOnly,
    intro: p.intro,
    finale: p.finale,
    duelists: p.duelistNames,
    restricted: p.restrictedNames,
    choiceOptions: p.choiceOptions,
    duelProgress: p.finale ? {
      subRoundIndex: game.duelSubRoundIndex,
      wins: game.duelDuelistIds.map(id => ({ name: game.players.get(id)?.name ?? '', count: game.duelWins[id] ?? 0 })),
    } : undefined,
  };
}

// True when only the round's winner should score — either the game-wide race
// toggle, or this round's own party recipe called for it.
function isWinnerOnlyRound(game: Game, round: Round): boolean {
  return game.raceWinnerOnly || round.party?.winnerOnly === true;
}

function roundMultiplier(round: Round): number {
  return round.party?.multiplier ?? 1;
}

// What this round's guess is checked against — resolved once per round (see
// resolveRoundTarget, called from buildRound) and stored on round.target, so
// every consumer — scoring, hints, reconnect resends — reads the same value
// for the round's whole lifetime instead of re-deriving it.
export function effectiveTarget(round: Round): GuessTarget | 'year' {
  return round.target;
}

function checkGuess(
  target: GuessTarget, text: string, artistText: string | undefined, song: Song,
): { correct: boolean; artistBonus: boolean } {
  if (target === 'artist') {
    return { correct: isCorrectArtistGuess(text, song.artist, song.featuredArtists), artistBonus: false };
  }
  const correct = isCorrectGuess(text, song.title, song.artist, song.featuredArtists);
  const artistBonus = target === 'both' && correct && !!artistText
    && isCorrectArtistGuess(artistText, song.artist, song.featuredArtists);
  return { correct, artistBonus };
}

// Race-flow rounds are everyone-at-once; party rounds ride it for every
// non-classic format. Classic-mode "Guess the year" still rides the normal
// bid/tier flow — an exact year ends it early like any other classic round,
// otherwise the closest guess wins once every tier's had its turn (see
// `recordGuess`'s 'year' branch and `finalizeClassicYearWin`).
export function isRaceFlowRound(game: Game, round: Round): boolean {
  if (game.mode === 'race') return true;
  if (round.party) return round.party.format !== 'classic';
  return false;
}

// The current round's participant restriction, if any — the finale's
// duelists, or (e.g.) underdog's trailing player(s). Finale and a generic
// restriction never coexist (finale hardcodes its own format/scoring), but
// every gate that cares "who's allowed to guess this round" can check this
// one thing instead of re-deriving finale-vs-event logic each time.
function restrictedParticipantIds(round: Round): string[] | null {
  if (round.party?.finale) return round.party.duelistIds;
  if (round.party?.restrictedIds?.length) return round.party.restrictedIds;
  return null;
}

// Who actually plays a race-flow round — a restricted subset (finale
// duelists, underdog trailers) if this round has one, everyone otherwise.
function raceParticipants(game: Game, round: Round): string[] {
  const restricted = restrictedParticipantIds(round);
  if (restricted) return restricted.filter(id => game.players.has(id));
  return Array.from(game.players.keys());
}

// Playlist songs carry no real popularity ranking (Spotify's per-track
// popularity is deliberately ignored — see the plan), so every playlist song
// gets this flat bonus instead of the rank-scaled one below. It's the
// midpoint of the library formula's 0-500 range, not the max: giving every
// song the max would make playlist games score noticeably easier than
// library 'hard' mode, not merely "equal difficulty."
const FLAT_DIFFICULTY_BONUS = 250;

function difficultyBonus(game: Game, rank: number): number {
  if (game.songSource === 'playlist') return FLAT_DIFFICULTY_BONUS;
  return Math.round(500 * Math.max(0, 1 - (rank - 1) / Math.max(songs.length - 1, 1)));
}

function currentScores(game: Game): Map<string, number> {
  return new Map(Array.from(game.players.entries()).map(([id, p]) => [id, p.score]));
}

// A player who actually scores this round, but was already trailing the
// leader by more than PITY_GAP_THRESHOLD before that score landed, gets a
// flat catch-up bonus on top — never a substitute for scoring, only a nudge
// for players who already got something right. `scores` must reflect every
// player's pre-round total (mutating game.players before calling this would
// let a player's own updated score, or an already-processed player in a
// batch, leak into the leader comparison).
function pityBonus(scores: Map<string, number>, scorerId: string, round: Round): number {
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

// Snippet roulette and 'outro' both need a known, long-enough duration to
// aim inside the song; silently downgrade to a plain round when the data's
// missing (or, for 'outro', too short to leave a real "before" to skip).
// Mutates party.event/intro on downgrade — returns the clip's start offset.
function computeSnippetPosition(song: Song, party: PartyConfig, raceTimeSec: number): number | undefined {
  if (party.event === 'snippet') {
    if (!song.durationMs || song.durationMs <= 60_000) {
      party.event = null;
      party.intro = introFor(party.format, party.target, null, party.winnerOnly);
      return undefined;
    }
    const min = Math.round(song.durationMs * 0.15);
    const max = Math.round(song.durationMs * 0.65);
    return min + randomInt(0, Math.max(1, max - min));
  }
  if (party.event === 'outro') {
    const raceMs = raceTimeSec * 1000;
    if (!song.durationMs || song.durationMs <= raceMs + 20_000) {
      party.event = null;
      party.intro = introFor(party.format, party.target, null, party.winnerOnly);
      return undefined;
    }
    return song.durationMs - raceMs;
  }
  return undefined;
}

// Classic/race's per-round target: both toggles alone are each a fixed
// target for the whole game, but the user's own framing for combining them
// is "the rounds switch between artist/year" — so with both on, each round
// independently rolls one of the two, rather than asking for both at once.
function resolveClassicRaceTarget(game: Game): GuessTarget | 'year' {
  if (game.yearOnly && game.artistOnly) return pickWeighted<'artist' | 'year'>([['artist', 50], ['year', 50]]);
  if (game.yearOnly) return 'year';
  if (game.artistOnly) return 'artist';
  return 'title';
}

// What's actually being guessed this round — decides which hints would give
// the answer away outright, which "other" fact is safe to surface instead,
// and (stored as round.target by the caller) what scoring checks the guess
// against for the round's whole lifetime. Party rounds carry their own
// per-round target/format; classic/race games roll from the game-wide
// toggles. Must be called after any Party downgrade block that can mutate
// party.format/party.target (see buildRound) — never resolved up front.
function resolveRoundTarget(game: Game, party: PartyConfig | undefined): GuessTarget | 'year' {
  if (party) return party.target === 'year' || party.format === 'year' ? 'year' : party.target;
  return resolveClassicRaceTarget(game);
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

// A year round is unplayable without a known year — this is a hard mechanical
// requirement, not a variety nicety, so it's applied before any of the
// avoid-repetition stages below.
function restrictToYearPlayable(pool: Song[], isYearRound: boolean): Song[] {
  if (!isYearRound) return pool;
  const withYear = pool.filter(s => s.year !== null);
  return withYear.length > 0 ? withYear : pool;
}

// Never literally repeat the song that just played, even across a
// used-pool reshuffle in avoidUsedSongs below.
function avoidImmediateRepeat(pool: Song[], prevSong: Song | undefined): Song[] {
  if (!prevSong) return pool;
  const filtered = pool.filter(s => s.spotifyTrackId !== prevSong.spotifyTrackId);
  return filtered.length > 0 ? filtered : pool;
}

// Not used yet this game. On exhaustion, reshuffle — but reseed with just the
// previous song so the reshuffle itself can't reintroduce a back-to-back
// repeat.
function avoidUsedSongs(game: Game, pool: Song[], prevSong: Song | undefined): Song[] {
  const unused = pool.filter(s => !game.usedSongIds.has(s.spotifyTrackId));
  if (unused.length > 0) return unused;

  game.usedSongIds.clear();
  if (prevSong) game.usedSongIds.add(prevSong.spotifyTrackId);
  const reshuffled = pool.filter(s => !game.usedSongIds.has(s.spotifyTrackId));
  return reshuffled.length > 0 ? reshuffled : pool;
}

// Not recently played in a previous game from this same song pool.
function avoidRecentlyPlayedInPool(game: Game, pool: Song[]): Song[] {
  const recentIds = recentlyPlayedByPool.get(poolKey(game));
  if (!recentIds || recentIds.length === 0) return pool;
  const recentSet = new Set(recentIds);
  const fresh = pool.filter(s => !recentSet.has(s.spotifyTrackId));
  return fresh.length > 0 ? fresh : pool;
}

// Not the same artist as any of the last few rounds — the softest
// constraint, so it's applied last (first to be dropped if the pool is
// dominated by one act). Window size scales with pool size.
function avoidRecentArtists(game: Game, pool: Song[], rawPoolSize: number): Song[] {
  if (game.artistWindow.length === 0) return pool;
  const windowSize = artistWindowSize(rawPoolSize);
  const recentForArtistCheck = game.artistWindow.slice(-windowSize);
  const notRecentArtist = pool.filter(s => !recentForArtistCheck.some(recent => sameArtist(s, recent)));
  return notRecentArtist.length > 0 ? notRecentArtist : pool;
}

type ChoiceField = 'title' | 'artist' | 'year';

function choiceFieldValue(song: Song, field: ChoiceField): string | null {
  if (field === 'title') return song.title;
  if (field === 'artist') return song.artist;
  return song.year != null ? String(Math.floor(song.year)) : null;
}

function choiceFieldForTarget(target: PartyTarget): ChoiceField {
  if (target === 'year') return 'year';
  if (target === 'artist') return 'artist';
  return 'title';
}

function pickYearChoiceOptions(song: Song): string[] | undefined {
  if (song.year === null) return undefined;
  const correctYear = Math.floor(song.year);
  const maxYear = Math.max(correctYear, new Date().getFullYear());
  const offsets = Array.from({ length: YEAR_CHOICE_RADIUS * 2 }, (_, i) => {
    const offset = i - YEAR_CHOICE_RADIUS;
    return offset >= 0 ? offset + 1 : offset;
  });
  const candidates = shuffle(
    offsets
      .map(offset => correctYear + offset)
      .filter(year => year >= MIN_CHOICE_YEAR && year <= maxYear),
  );
  const distractors = candidates.slice(0, 3).map(String);
  if (distractors.length < 3) return undefined;
  return shuffle([String(correctYear), ...distractors]);
}

function choiceDistractorValue(
  candidate: Song,
  song: Song,
  field: ChoiceField,
  correct: string,
  distractors: string[],
): string | null {
  if (candidate.spotifyTrackId === song.spotifyTrackId) return null;
  const value = choiceFieldValue(candidate, field);
  if (value === null) return null;
  if (textsCollide(value, correct)) return null;
  if (field === 'artist' && isCorrectArtistGuess(value, song.artist, song.featuredArtists)) return null;
  if (distractors.some(d => textsCollide(d, value))) return null;
  return value;
}

// Multiple Choice's 3 wrong title/artist options are drawn from the same
// (already difficulty/constraint-filtered) pool the round's own song came from,
// so they're naturally the same difficulty tier. Year options use nearby
// plausible years instead, so the answer is not just a decade check. Returns
// undefined if the pool/range can't supply 3 safe distractors, signalling the
// caller to downgrade the round instead.
//
// Title/artist distractors are deduped using the same fuzzy normalization
// isCorrectGuess/isCorrectArtistGuess score against, both against the correct
// answer AND against each other — a naive "just exclude the correct value"
// check would let two songs sharing a year, or two spellings of one artist,
// slip in as two "different" wrong options that actually read the same.
// Years use plain exact-match distinctness instead, since year guessing is
// exact-int, not fuzzy.
function pickChoiceOptions(song: Song, pool: Song[], field: ChoiceField): string[] | undefined {
  if (field === 'year') return pickYearChoiceOptions(song);
  const correct = choiceFieldValue(song, field);
  if (correct === null) return undefined;
  const distractors: string[] = [];
  for (const s of shuffle(pool)) {
    const value = choiceDistractorValue(s, song, field, correct, distractors);
    if (value === null) continue;
    distractors.push(value);
    if (distractors.length === 3) break;
  }
  if (distractors.length < 3) return undefined;
  return shuffle([correct, ...distractors]);
}

function maybeApplyPartyChoiceOptions(song: Song, pool: Song[], party: PartyConfig | undefined): void {
  if (party?.format !== 'choice') return;
  const choiceOptions = pickChoiceOptions(song, pool, choiceFieldForTarget(party.target));
  if (choiceOptions) {
    party.choiceOptions = choiceOptions;
    return;
  }

  // Not enough distinct distractors for this round's target — downgrade
  // to a free-text race round instead of resetting to classic/title, so
  // an artist-target round (Who Sings It as Multiple Choice) doesn't
  // silently turn into a title-guessing round. party.target is
  // deliberately left untouched — that's the whole point of this
  // fallback over the old "reset everything to classic/title" one.
  party.format = 'race';
  party.intro = introFor(party.format, party.target, party.event, party.winnerOnly);
}

function classicChoiceOptions(game: Game, party: PartyConfig | undefined, song: Song, pool: Song[], target: PartyTarget): string[] | undefined {
  if (!game.multipleChoice || party) return undefined;
  return pickChoiceOptions(song, pool, choiceFieldForTarget(target));
}

function resolveRoundHints(
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

// Round selection applies these constraints strictest/most-essential first,
// softest/most-skippable last — and each stage reverts to its input pool if
// applying it would leave nothing, so the last-applied (softest) filter is
// always the first one sacrificed once a small pool runs out of room.
function buildRound(game: Game, party?: PartyConfig): Round {
  const rawPool = difficultyPool(game);
  const prevSong = game.currentRound?.song;
  const isYearRound = party ? party.format === 'year' || party.target === 'year' : game.yearOnly;

  let pool = restrictToYearPlayable(rawPool, isYearRound);
  pool = avoidImmediateRepeat(pool, prevSong);
  pool = avoidUsedSongs(game, pool, prevSong);
  pool = avoidRecentlyPlayedInPool(game, pool);
  pool = avoidRecentArtists(game, pool, rawPool.length);

  const song = pickRandom(pool);

  maybeApplyPartyChoiceOptions(song, pool, party);
  const snippetMs = party ? computeSnippetPosition(song, party, game.raceTime) : undefined;
  // Resolved after the choice-downgrade block above (which can mutate
  // party.format/party.target) so this never reflects a stale pre-downgrade
  // value — see resolveRoundTarget's own comment.
  const target = resolveRoundTarget(game, party);
  const choiceOptions = classicChoiceOptions(game, party, song, pool, target);

  // Chaos Hints repurposes the normal `hints` transport to carry its own
  // 4-hint "spot the fake" set instead of the usual guess-along hints —
  // bypasses buildRoundHints entirely for this event.
  const { hints, chaosFakeIndex } = resolveRoundHints(song, pool, party, target);

  return {
    song,
    hints,
    target,
    choiceOptions,
    party,
    snippetMs,
    chaosFakeIndex,
    chaosTapped: new Map(),
    bids: new Map(),
    bidTiers: [],
    tierIndex: 0,
    guesserSocketIds: [],
    lowestBid: 0,
    answered: false,
    passed: new Set(),
    earlyGuessers: new Set(),
    guesses: new Map(),
    liveDrafts: new Map(),
    artistGuesses: new Map(),
    liveArtistDrafts: new Map(),
    scoredSocketIds: new Set(),
    pityAwardedTo: new Set(),
    playStartAt: null,
    firstCorrectAt: null,
    correctGuessers: new Set(),
    guessTimes: new Map(),
    tierStartAt: null,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function activeGameCount(): number {
  return games.size;
}

// `preferredPin` lets "New Game" reuse the previous game's PIN (once that game
// is cleaned up), so QR codes, deep links and players' saved sessions stay
// valid across a restart. Falls back to a fresh PIN if it's somehow taken.
export function createGame(hostSocketId: string, preferredPin?: string): Game {
  const pin = preferredPin && !games.has(preferredPin) ? preferredPin : generatePin();
  const game: Game = {
    pin,
    hostSocketId,
    players: new Map(),
    formerPlayers: new Map(),
    phase: 'lobby',
    roundIndex: 0,
    totalRounds: TOTAL_ROUNDS,
    bettingTime: BETTING_TIME,
    guessingTime: GUESSING_TIME,
    mode: 'classic',
    raceTime: RACE_TIME,
    raceWinnerOnly: false,
    artistOnly: false,
    yearOnly: false,
    multipleChoice: false,
    difficulty: 'hard',
    enabledEvents: new Set(ALL_PARTY_EVENTS),
    enabledRoundTypes: new Set(ALL_PARTY_ROUND_TYPES),
    chaosLevel: 50,
    duelChampion: null,
    duelActive: false,
    duelDuelistIds: [],
    duelWins: {},
    duelSubRoundIndex: 0,
    songSource: 'library',
    playlistId: undefined,
    currentRound: null,
    usedSongIds: new Set(),
    artistWindow: [],
    phaseTimer: null,
    phaseEndsAt: null,
  };
  games.set(pin, game);
  socketToPin.set(hostSocketId, pin);
  return game;
}

// Re-validates and applies a host-picked playlist as the game's song pool.
// Re-validation (not just trusting the client's own min-track check) matters
// because filtering/dedup happens again here from scratch — a client-side
// pass and a server-side pass could disagree given a malformed payload.
export function setCustomSongPool(
  game: Game, playlistId: string | undefined, tracks: PlaylistTrackInput[],
): { ok: true } | { ok: false; error: string } {
  const pool = adaptPlaylistTracks(tracks, csvByTrackId);
  if (pool.length === 0) {
    return { ok: false, error: 'That playlist has no playable tracks' };
  }
  game.songSource = 'playlist';
  game.songPool = pool;
  game.playlistId = playlistId;
  return { ok: true };
}

export function getGame(pin: string): Game | undefined {
  return games.get(pin);
}

export function getGameBySocket(socketId: string): Game | undefined {
  const pin = socketToPin.get(socketId);
  return pin ? games.get(pin) : undefined;
}

export function addPlayer(game: Game, socketId: string, name: string): Player | null {
  if (game.players.size >= MAX_PLAYERS) return null;
  const taken = Array.from(game.players.values()).some(
    p => p.name.toLowerCase() === name.trim().toLowerCase()
  );
  if (taken) return null;
  const former = game.formerPlayers.get(name.trim().toLowerCase());
  const player: Player = {
    socketId, name: name.trim(), score: former?.score ?? 0, streak: former?.streak ?? 0,
    totalCorrect: former?.totalCorrect ?? 0, totalPasses: former?.totalPasses ?? 0,
    fastestCorrectMs: former?.fastestCorrectMs ?? null, fastestClassicMs: former?.fastestClassicMs ?? null,
    biggestSwing: former?.biggestSwing ?? 0,
  };
  game.players.set(socketId, player);
  socketToPin.set(socketId, game.pin);
  return player;
}

// Re-attach an existing player to a fresh socket id after a reconnect (e.g. a
// dropped connection or a dev hot-reload). Without this the player's socket
// becomes a stranger to the game and every submit_bid / submit_guess is
// silently rejected. Migrates any in-flight round references too, so a round
// already under way keeps working for the reconnected player.
function migrateRoundSocketId(round: Round, oldId: string, newId: string): void {
  const bid = round.bids.get(oldId);
  if (bid !== undefined) { round.bids.set(newId, bid); round.bids.delete(oldId); }
  round.guesserSocketIds = round.guesserSocketIds.map(id => (id === oldId ? newId : id));
  round.bidTiers.forEach(t => { t.socketIds = t.socketIds.map(id => (id === oldId ? newId : id)); });
  if (round.passed.delete(oldId)) round.passed.add(newId);
  const guess = round.guesses.get(oldId);
  if (guess !== undefined) { round.guesses.set(newId, guess); round.guesses.delete(oldId); }
  if (round.correctGuessers.delete(oldId)) round.correctGuessers.add(newId);
  const guessTime = round.guessTimes.get(oldId);
  if (guessTime !== undefined) { round.guessTimes.set(newId, guessTime); round.guessTimes.delete(oldId); }
  const tapped = round.chaosTapped.get(oldId);
  if (tapped !== undefined) { round.chaosTapped.set(newId, tapped); round.chaosTapped.delete(oldId); }
  if (round.party) {
    round.party.duelistIds = round.party.duelistIds.map(id => (id === oldId ? newId : id));
    round.party.restrictedIds = round.party.restrictedIds.map(id => (id === oldId ? newId : id));
  }
  if (round.stealBy === oldId) round.stealBy = newId;
}

export function renamePlayer(game: Game, socketId: string, newName: string): Player | null {
  const player = game.players.get(socketId);
  if (!player) return null;
  const trimmed = newName.trim();
  if (!trimmed) return null;
  const taken = Array.from(game.players.values()).some(
    p => p.socketId !== socketId && p.name.toLowerCase() === trimmed.toLowerCase()
  );
  if (taken) return null;
  player.name = trimmed;
  return player;
}

export function rejoinPlayer(game: Game, newSocketId: string, name: string): Player | null {
  const entry = Array.from(game.players.entries()).find(
    ([, p]) => p.name.toLowerCase() === name.trim().toLowerCase()
  );
  if (!entry) return null;
  const [oldId, player] = entry;

  if (oldId !== newSocketId) {
    game.players.delete(oldId);
    socketToPin.delete(oldId);
    player.socketId = newSocketId;
    game.players.set(newSocketId, player);
    if (game.currentRound) migrateRoundSocketId(game.currentRound, oldId, newSocketId);
    // Duel state lives on Game (not Round), since it must survive each
    // sub-round's fresh Round object — so it needs its own remap here,
    // separate from migrateRoundSocketId's round-scoped one.
    if (game.duelDuelistIds.includes(oldId)) {
      game.duelDuelistIds = game.duelDuelistIds.map(id => (id === oldId ? newSocketId : id));
      const wins = game.duelWins[oldId];
      if (wins !== undefined) { game.duelWins[newSocketId] = wins; delete game.duelWins[oldId]; }
      if (game.duelChampion === oldId) game.duelChampion = newSocketId;
    }
  }
  socketToPin.set(newSocketId, game.pin);
  return player;
}

export function removeSocket(socketId: string): { game: Game; wasHost: boolean } | null {
  const game = getGameBySocket(socketId);
  if (!game) return null;
  socketToPin.delete(socketId);
  const wasHost = game.hostSocketId === socketId;
  if (!wasHost) {
    const player = game.players.get(socketId);
    if (player) {
      game.formerPlayers.set(player.name.toLowerCase(), {
        score: player.score, streak: player.streak,
        totalCorrect: player.totalCorrect, totalPasses: player.totalPasses,
        fastestCorrectMs: player.fastestCorrectMs, fastestClassicMs: player.fastestClassicMs,
        biggestSwing: player.biggestSwing,
      });
    }
    game.players.delete(socketId);
  }
  return { game, wasHost };
}

export function startRound(game: Game): Round {
  if (game.phaseTimer) clearTimeout(game.phaseTimer);
  // Build the party recipe before replacing currentRound — it reads the
  // previous round's format/event to avoid repeats.
  const party = game.mode === 'party' ? buildPartyConfig(game) : undefined;
  const round = buildRound(game, party);
  game.usedSongIds.add(round.song.spotifyTrackId);
  rememberRecentlyPlayed(poolKey(game), round.song.spotifyTrackId, poolSizeForCap(game));
  game.artistWindow.push(round.song);
  if (game.artistWindow.length > ARTIST_WINDOW_MAX) game.artistWindow.shift();
  game.currentRound = round;
  game.phase = 'betting';
  return round;
}

export function recordBid(game: Game, socketId: string, seconds: number): boolean {
  if (game.phase !== 'betting') return false;
  if (!game.players.has(socketId)) return false;
  if (!BID_OPTIONS.includes(seconds)) return false;
  // A finale duel's classic sub-round is only for the two duelists — everyone
  // else just watches (mirrors the finale's existing race-flow restriction,
  // which classic never needed before the duel could ride this format).
  const party = game.currentRound?.party;
  if (party?.finale && !party.duelistIds.includes(socketId)) return false;
  game.currentRound!.bids.set(socketId, seconds);
  return true;
}

export interface TierTurn {
  lowestBid: number;
  guesserSocketIds: string[];
  guesserNames: string[];
}

// Point the round's guessers at the current tier and reset its guess attempts,
// then describe that turn (bid + who's up) for the clients.
function applyTier(game: Game, round: Round): TierTurn {
  const tier = round.bidTiers[round.tierIndex];
  round.lowestBid = tier.bid;
  round.guesserSocketIds = tier.socketIds;
  round.passed = new Set();
  round.earlyGuessers = new Set();
  // Cleared here (not just at round creation) so a later tier never inherits
  // an earlier tier's start time if this one's own song_started is delayed.
  round.tierStartAt = null;
  game.phase = 'playing';
  const guesserNames = tier.socketIds
    .map(id => game.players.get(id)?.name ?? '')
    .filter(Boolean);
  return { lowestBid: tier.bid, guesserSocketIds: tier.socketIds, guesserNames };
}

export function closeBetting(game: Game): TierTurn | null {
  const round = game.currentRound;
  if (!round || game.phase !== 'betting') return null;

  if (round.bids.size === 0) return null;

  const byBid = new Map<number, string[]>();
  for (const [id, bid] of round.bids.entries()) {
    const tier = byBid.get(bid);
    if (tier) tier.push(id);
    else byBid.set(bid, [id]);
  }
  round.bidTiers = Array.from(byBid.entries())
    .sort(([a], [b]) => a - b)
    .map(([bid, socketIds]) => ({ bid, socketIds }));
  round.tierIndex = 0;

  return applyTier(game, round);
}

// After a tier fails, hand off to the next-lowest bidders. Returns null when no
// tier is left (nobody got it) or the song's already been answered.
export function advanceTier(game: Game): TierTurn | null {
  const round = game.currentRound;
  if (!round || round.answered) return null;
  if (round.tierIndex + 1 >= round.bidTiers.length) return null;
  round.tierIndex += 1;
  return applyTier(game, round);
}

// A streak only continues for players who actually score points this round —
// anyone who wasn't reached (a later tier that never got a turn, a disconnect
// mid-round) or scored nothing has theirs cleared once the round is decided.
export function settleStreaks(game: Game, round: Round): void {
  for (const [id, player] of game.players) {
    if (!round.scoredSocketIds.has(id)) player.streak = 0;
  }
}

// One guess per guesser: a correct guess wins, a wrong guess ends that
// guesser's turn. `allDone` is true once every guesser in the tier has had
// their shot (guessed or passed), so the round can move on.
export function recordGuess(
  game: Game,
  socketId: string,
  text: string,
  artistText?: string,
): { correct: boolean; points: number; guesserName: string; allDone: boolean } | null {
  const round = game.currentRound;
  if (!round) return null;
  if (!round.guesserSocketIds.includes(socketId)) return null;
  if (game.phase === 'playing') {
    round.earlyGuessers.add(socketId);
  } else if (game.phase !== 'guessing') {
    return null;
  }
  if (round.answered || round.passed.has(socketId)) return null;

  round.guesses.set(socketId, text);
  const target = effectiveTarget(round);
  const trimmedArtist = artistText?.trim();
  if (target === 'both' && trimmedArtist) round.artistGuesses.set(socketId, trimmedArtist);
  const guesserName = game.players.get(socketId)?.name ?? '';

  const elapsedMs = Date.now() - (round.tierStartAt ?? Date.now());

  if (target === 'year') {
    const guess = parseYearGuess(text);
    const correct = guess !== null && guess === Math.floor(round.song.year ?? 0);
    if (!correct) return failGuess(round, socketId, guesserName);
    const points = Math.round(calcPoints(game, round.lowestBid, round.song.rank) * roundMultiplier(round))
      + pityBonus(currentScores(game), socketId, round);
    const result = applyClassicWin(game, round, socketId, guesserName, points, elapsedMs);
    // The year reveal UI reads exclusively from `yearResults` (never from
    // correct/guesserName/points), so an early exact-match win still needs a
    // results table — everyone else's guess is shown for context, but only
    // the winner scores.
    finalizeClassicYearWin(game, round, socketId, points);
    return result;
  }

  const { correct, artistBonus } = checkGuess(target, text, artistText, round.song);
  if (!correct) return failGuess(round, socketId, guesserName);

  const basePoints = calcPoints(game, round.lowestBid, round.song.rank);
  const points = Math.round((basePoints + (artistBonus ? basePoints : 0)) * roundMultiplier(round))
    + pityBonus(currentScores(game), socketId, round);
  return applyClassicWin(game, round, socketId, guesserName, points, elapsedMs);
}

// A guesser's turn ends without a win — hand them off to "passed" and report
// whether the whole tier is now done (every guesser guessed or passed).
function failGuess(
  round: Round, socketId: string, guesserName: string,
): { correct: false; points: number; guesserName: string; allDone: boolean } {
  round.passed.add(socketId);
  const allDone = round.guesserSocketIds.every(id => round.passed.has(id));
  return { correct: false, points: 0, guesserName, allDone };
}

// Shared bookkeeping for a classic-flow round-winning guess (title, artist,
// or year target): marks the round answered, pays out, extends the streak,
// arms a pending steal if this round has one, and ends the round.
function applyClassicWin(
  game: Game, round: Round, socketId: string, guesserName: string, points: number, elapsedMs: number,
): { correct: true; points: number; guesserName: string; allDone: false } {
  round.answered = true;
  round.correctGuesserName = guesserName;
  const player = game.players.get(socketId)!;
  player.score += points;
  player.streak += 1;
  player.totalCorrect += 1;
  if (points > player.biggestSwing) player.biggestSwing = points;
  round.scoredSocketIds.add(socketId);
  round.guessTimes.set(socketId, elapsedMs);
  player.fastestClassicMs = player.fastestClassicMs === null ? elapsedMs : Math.min(player.fastestClassicMs, elapsedMs);
  if (round.party?.event === 'steal') {
    round.stealBy = socketId;
    round.stealDone = false;
  }
  // Finale classic sub-round: record who took this game of the best-of-3 —
  // separate from (and on top of) the normal points above.
  if (round.party?.finale) {
    game.duelWins[socketId] = (game.duelWins[socketId] ?? 0) + 1;
    resolveDuelIfWon(game, socketId);
  }
  game.phase = 'reveal';
  settleStreaks(game, round);
  return { correct: true, points, guesserName, allDone: false };
}

// A guesser forfeits their turn without guessing. Once every guesser in the
// tier is done, the round moves on (to the next tier or the reveal).
export function skipGuess(game: Game, socketId: string): { allDone: boolean } | null {
  const round = game.currentRound;
  if (!round) return null;
  if (!round.guesserSocketIds.includes(socketId)) return null;
  if (game.phase !== 'guessing' && game.phase !== 'playing') return null;
  if (round.answered || round.passed.has(socketId)) return null;

  round.guesses.set(socketId, null);
  round.passed.add(socketId);
  if (game.phase === 'playing') round.earlyGuessers.add(socketId);
  const player = game.players.get(socketId);
  if (player) player.totalPasses += 1;
  const allDone = round.guesserSocketIds.every(id => round.passed.has(id));
  return { allDone };
}

export function markRaceStarted(game: Game): void {
  const round = game.currentRound;
  if (!round) return;
  round.playStartAt = Date.now();
  game.phase = 'guessing';
}

// Classic-mode counterpart to markRaceStarted: records when the current
// tier's clip actually started playing, so recordGuess can measure elapsed
// time. Guarded so a late song_started after the fallback already fired
// can't clobber the fallback's own timestamp with a later one.
export function markTierStarted(game: Game): void {
  const round = game.currentRound;
  if (round?.tierStartAt !== null) return;
  round.tierStartAt = Date.now();
}

function applyRaceCorrectGuess(
  game: Game, round: Round, socketId: string, elapsedMs: number, artistBonus: boolean,
): number {
  const isFirst = round.firstCorrectAt === null;
  if (isFirst) round.firstCorrectAt = Date.now();
  round.correctGuessers.add(socketId);
  round.guessTimes.set(socketId, elapsedMs);
  if (!isFirst && isWinnerOnlyRound(game, round)) return 0;
  // A finale duelist can never actually reach this function as a non-first
  // guesser — recordRaceGuess already rejects any guess attempt once the
  // round's first correct answer has landed, for any finale round — so
  // `isFirst` is always true here and this scores through the normal
  // first-correct race payout, same as any other race round.
  const base = isWinnerOnlyRound(game, round)
    ? calcRaceWinnerPoints(game, elapsedMs, game.raceTime, round.song.rank)
    : calcRacePoints(game, isFirst, elapsedMs, round.firstCorrectAt! - round.playStartAt!, round.song.rank);
  const preMultiplier = base + (artistBonus ? base : 0);
  let points = Math.round(preMultiplier * roundMultiplier(round));
  if (points > 0) points += pityBonus(currentScores(game), socketId, round);
  if (isFirst && round.party?.event === 'steal') {
    round.stealBy = socketId;
    round.stealDone = false;
  }
  applyRaceScoreToPlayer(game, round, socketId, elapsedMs, points);
  recordFinaleRaceWin(game, round, socketId, isFirst);
  // The mystery multiplier stays hidden until everyone sees the shared
  // reveal, so the guesser's own immediate ack can't carry the true
  // (multiplied) total — that would let them back out ×2 vs ×10 right away.
  // Hand back the pre-multiplier amount instead; the real score still lands
  // via player.score, and score_update carries the true delta at reveal.
  return round.party?.event === 'mystery' ? preMultiplier : points;
}

function applyRaceScoreToPlayer(
  game: Game, round: Round, socketId: string, elapsedMs: number, points: number,
): void {
  const player = game.players.get(socketId)!;
  player.score += points;
  if (points > 0) {
    player.streak += 1;
    player.totalCorrect += 1;
    if (points > player.biggestSwing) player.biggestSwing = points;
    player.fastestCorrectMs = player.fastestCorrectMs === null ? elapsedMs : Math.min(player.fastestCorrectMs, elapsedMs);
    round.scoredSocketIds.add(socketId);
  }
}

function recordFinaleRaceWin(game: Game, round: Round, socketId: string, isFirst: boolean): void {
  // Finale race sub-round: record who took this game of the best-of-3 —
  // separate from (and on top of) the normal points above.
  if (isFirst && round.party?.finale) {
    game.duelWins[socketId] = (game.duelWins[socketId] ?? 0) + 1;
    resolveDuelIfWon(game, socketId);
  }
}

export function recordRaceGuess(
  game: Game,
  socketId: string,
  text: string,
  artistText?: string,
): { correct: boolean; points: number; elapsedMs: number; allDone: boolean } | null {
  const round = game.currentRound;
  if (!round) return null;
  if (!game.players.has(socketId)) return null;
  if (game.phase !== 'guessing') return null;
  if (round.passed.has(socketId)) return null;
  const restricted = restrictedParticipantIds(round);
  if (restricted && !restricted.includes(socketId)) return null;
  if ((isWinnerOnlyRound(game, round) || round.party?.finale) && round.firstCorrectAt !== null) return null;

  const elapsedMs = Date.now() - (round.playStartAt ?? Date.now());
  round.guesses.set(socketId, text);
  round.passed.add(socketId);
  const participants = raceParticipants(game, round);

  const target = effectiveTarget(round);
  if (target === 'year') {
    // Year answers are only scored once the round ends and every distance is
    // known — see finalizeYearRound.
    const allDone = participants.every(id => round.passed.has(id));
    return { correct: false, points: 0, elapsedMs, allDone };
  }

  const { correct, artistBonus } = checkGuess(target, text, artistText, round.song);
  const trimmedArtist = artistText?.trim();
  if (target === 'both' && trimmedArtist) round.artistGuesses.set(socketId, trimmedArtist);
  const points = correct ? applyRaceCorrectGuess(game, round, socketId, elapsedMs, artistBonus) : 0;

  const allDone = ((isWinnerOnlyRound(game, round) || round.party?.finale === true) && correct)
    || participants.every(id => round.passed.has(id));
  return { correct, points, elapsedMs, allDone };
}

export function skipRaceGuess(
  game: Game,
  socketId: string,
): { allDone: boolean } | null {
  const round = game.currentRound;
  if (!round) return null;
  if (!game.players.has(socketId)) return null;
  if (game.phase !== 'guessing') return null;
  if (round.passed.has(socketId)) return null;
  const restricted = restrictedParticipantIds(round);
  if (restricted && !restricted.includes(socketId)) return null;

  round.guesses.set(socketId, null);
  round.passed.add(socketId);
  game.players.get(socketId)!.totalPasses += 1;
  const allDone = raceParticipants(game, round).every(id => round.passed.has(id));
  return { allDone };
}

// Mirrors applyRaceCorrectGuess's decay-scoring math, but correctness is
// "did you tap the fabricated hint" rather than a fuzzy text match. A round
// only ever has one active event, so this never needs to combine with
// mystery's hide-until-reveal return trick — moot by construction.
function applyChaosHintTap(
  game: Game, round: Round, socketId: string, tappedIndex: number, elapsedMs: number,
): number {
  const isCorrect = tappedIndex === round.chaosFakeIndex;
  const isFirst = round.firstCorrectAt === null;
  if (isCorrect) {
    if (isFirst) round.firstCorrectAt = Date.now();
    round.correctGuessers.add(socketId);
    round.guessTimes.set(socketId, elapsedMs);
  }
  if (!isCorrect || (!isFirst && isWinnerOnlyRound(game, round))) return 0;
  const base = isWinnerOnlyRound(game, round)
    ? calcRaceWinnerPoints(game, elapsedMs, game.raceTime, round.song.rank)
    : calcRacePoints(game, isFirst, elapsedMs, round.firstCorrectAt! - round.playStartAt!, round.song.rank);
  let points = Math.round(base * roundMultiplier(round));
  if (points > 0) points += pityBonus(currentScores(game), socketId, round);
  const player = game.players.get(socketId)!;
  player.score += points;
  if (points > 0) {
    player.streak += 1;
    player.totalCorrect += 1;
    if (points > player.biggestSwing) player.biggestSwing = points;
    player.fastestCorrectMs = player.fastestCorrectMs === null ? elapsedMs : Math.min(player.fastestCorrectMs, elapsedMs);
    round.scoredSocketIds.add(socketId);
  }
  recordFinaleRaceWin(game, round, socketId, isFirst);
  return points;
}

export function recordChaosHintTap(
  game: Game, socketId: string, tappedIndex: number,
): { correct: boolean; points: number; elapsedMs: number; allDone: boolean } | null {
  const round = game.currentRound;
  if (!round || round.party?.event !== 'chaoshints') return null;
  if (!game.players.has(socketId)) return null;
  if (game.phase !== 'guessing') return null;
  if (round.passed.has(socketId)) return null;
  const restricted = restrictedParticipantIds(round);
  if (restricted && !restricted.includes(socketId)) return null;
  if ((isWinnerOnlyRound(game, round) || round.party?.finale) && round.firstCorrectAt !== null) return null;

  const elapsedMs = Date.now() - (round.playStartAt ?? Date.now());
  round.chaosTapped.set(socketId, tappedIndex);
  round.passed.add(socketId);
  const participants = raceParticipants(game, round);

  const correct = tappedIndex === round.chaosFakeIndex;
  const points = applyChaosHintTap(game, round, socketId, tappedIndex, elapsedMs);

  const allDone = ((isWinnerOnlyRound(game, round) || round.party?.finale === true) && correct)
    || participants.every(id => round.passed.has(id));
  return { correct, points, elapsedMs, allDone };
}

// Parses a year guess (digits only, plausible range) or null if unusable.
function parseYearGuess(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const parsed = Number.parseInt(raw.replace(/\D/g, ''), 10);
  return Number.isFinite(parsed) && parsed >= 1000 && parsed <= 3000 ? parsed : null;
}

function yearGuessEntries(game: Game, round: Round, actual: number) {
  return Array.from(game.players.entries()).map(([id, player]) => {
    const guess = parseYearGuess(round.guesses.get(id));
    return { id, player, guess, diff: guess === null ? null : Math.abs(guess - actual) };
  });
}

// Shared "closest guess wins" scorer: exact answers pay the most, points fall
// off per year of distance, and the closest player(s) take a winner bonus on
// top. `winnerOnly` restricts scoring to just that closest guess — everyone
// else gets zero, same as winner-only does for title races.
function scoreYearGuesses(game: Game, round: Round, mult: number, winnerOnly: boolean): YearResult[] {
  const actual = Math.floor(round.song.year ?? 0);
  const preRoundScores = currentScores(game);

  const entries = yearGuessEntries(game, round, actual);
  const diffs = entries.filter(e => e.diff !== null).map(e => e.diff!);
  const best = diffs.length > 0 ? Math.min(...diffs) : null;
  const winners = best === null ? 0 : entries.filter(e => e.diff === best).length;

  const results: YearResult[] = entries.map(e => {
    let points = 0;
    if (e.diff !== null && (!winnerOnly || e.diff === best)) {
      points = Math.max(0, YEAR_MAX_POINTS - YEAR_POINTS_SLOPE * e.diff);
      if (e.diff === best) points += Math.round(YEAR_WINNER_BONUS / winners);
      points = Math.round(points * mult);
    }
    if (points > 0) {
      points += pityBonus(preRoundScores, e.id, round);
      e.player.score += points;
      e.player.streak += 1;
      e.player.totalCorrect += 1;
      if (points > e.player.biggestSwing) e.player.biggestSwing = points;
      round.scoredSocketIds.add(e.id);
    }
    const pity = round.pityAwardedTo.has(e.id);
    return { name: e.player.name, guess: e.guess, diff: e.diff, points, pity, pityAmount: pity ? PITY_BONUS : undefined };
  });

  results.sort((a, b) => (a.diff ?? 9999) - (b.diff ?? 9999));
  round.yearResults = results;
  return round.yearResults;
}

// Race-flow year rounds are scored in one pass at the end, once every
// distance is known.
export function finalizeYearRound(game: Game): YearResult[] {
  const round = game.currentRound!;
  const results = scoreYearGuesses(game, round, roundMultiplier(round), isWinnerOnlyRound(game, round));
  if (round.party?.finale) recordDuelYearWin(game, round);
  return results;
}

// Finale year sub-round (the decider): whoever's strictly closest takes this
// game of the best-of-3. An exact tie between the two duelists — or neither
// answering at all — resolves nothing here; advanceDuelOrResolve will notice
// neither reached 2 wins and call for another year sub-round instead of
// ending the duel.
function recordDuelYearWin(game: Game, round: Round): void {
  const actual = Math.floor(round.song.year ?? 0);
  const duelistIds = round.party!.duelistIds;
  const entries = yearGuessEntries(game, round, actual)
    .filter(e => duelistIds.includes(e.id) && e.diff !== null);
  if (entries.length === 0) return;
  const best = Math.min(...entries.map(e => e.diff!));
  const winners = entries.filter(e => e.diff === best);
  if (winners.length === 1) {
    game.duelWins[winners[0].id] = (game.duelWins[winners[0].id] ?? 0) + 1;
    resolveDuelIfWon(game, winners[0].id);
  }
}

// Classic-flow year round that ended early on an exact guess — scored like
// any other classic round (bid + rank), not the distance formula above. The
// year reveal UI reads only `yearResults`, so this still builds one: every
// other player's guess is shown for context on the timeline, but only the
// winner scores.
function finalizeClassicYearWin(game: Game, round: Round, winnerId: string, winnerPoints: number): YearResult[] {
  const actual = Math.floor(round.song.year ?? 0);
  const entries = yearGuessEntries(game, round, actual);
  const results: YearResult[] = entries.map(e => {
    const pity = e.id === winnerId && round.pityAwardedTo.has(winnerId);
    return {
      name: e.player.name, guess: e.guess, diff: e.diff,
      points: e.id === winnerId ? winnerPoints : 0,
      pity, pityAmount: pity ? PITY_BONUS : undefined,
    };
  });
  results.sort((a, b) => (a.diff ?? 9999) - (b.diff ?? 9999));
  round.yearResults = results;
  return round.yearResults;
}

// Classic-flow year round where every tier had its turn and nobody guessed
// exactly right — falls back to closest-guess-wins across everyone who did
// guess. Classic has no "winner only" toggle and no party multiplier.
export function finalizeClassicYearRound(game: Game): YearResult[] {
  const round = game.currentRound!;
  return scoreYearGuesses(game, round, 1, false);
}

// ─── Steal round ─────────────────────────────────────────────────────────────

export function stealCandidates(game: Game, thiefId: string): { name: string; score: number }[] {
  return Array.from(game.players.values())
    .filter(p => p.socketId !== thiefId)
    .sort((a, b) => b.score - a.score)
    .map(p => ({ name: p.name, score: p.score }));
}

export function executeSteal(
  game: Game, thiefId: string, victimName: string,
): { thief: string; victim: string; amount: number } | null {
  const round = game.currentRound;
  if (!round || game.phase !== 'reveal') return null;
  if (round.stealBy !== thiefId || round.stealDone) return null;
  const thief = game.players.get(thiefId);
  const victim = Array.from(game.players.values()).find(p => p.name === victimName);
  if (!thief || !victim || victim.socketId === thiefId) return null;

  const amount = Math.min(victim.score, Math.max(STEAL_MIN, Math.round(victim.score * STEAL_PCT)));
  round.stealDone = true;
  victim.score -= amount;
  thief.score += amount;
  return { thief: thief.name, victim: victim.name, amount };
}

// Thief declines to steal from anyone. Marks the steal resolved (so
// stealPendingName stops reporting them as still deciding) without moving points.
export function skipSteal(game: Game, thiefId: string): { thief: string } | null {
  const round = game.currentRound;
  if (!round || game.phase !== 'reveal') return null;
  if (round.stealBy !== thiefId || round.stealDone) return null;
  const thief = game.players.get(thiefId);
  if (!thief) return null;
  round.stealDone = true;
  return { thief: thief.name };
}

// A race round can end (timeout, or someone winning in winner-only mode)
// while other players are still mid-guess. Their own client tries to
// auto-submit at the same deadline the server uses to end the round, but
// that's a race against the network — the server's own end-of-round broadcast
// almost always arrives first and discards whatever they'd typed. Score their
// last-known draft here instead, server-side, so a timely answer still counts.
export function finalizeRaceDrafts(game: Game): void {
  const round = game.currentRound;
  if (!round || game.phase !== 'guessing') return;
  // Chaos Hints is tap-only — there's no free-text draft to auto-submit.
  if (round.party?.event === 'chaoshints') return;
  for (const id of game.players.keys()) {
    if (round.passed.has(id)) continue;
    const draft = round.liveDrafts.get(id)?.trim();
    if (draft) recordRaceGuess(game, id, draft, round.liveArtistDrafts.get(id)?.trim());
  }
}

// Same idea as finalizeRaceDrafts, but for the classic bid/tier flow: a
// tier's guessing timer expiring used to just advance to the next tier
// (or reveal) without ever looking at what the current guessers had typed,
// so a slow/backgrounded client whose own auto-submit timer missed the
// deadline just lost their answer. Auto-submits the first correct draft
// found (in tier order) so it scores exactly like a real submission would.
export function finalizeGuessDrafts(
  game: Game,
): { correct: true; points: number; guesserName: string; allDone: boolean } | null {
  const round = game.currentRound;
  if (!round || game.phase !== 'guessing' || round.answered) return null;
  for (const id of round.guesserSocketIds) {
    if (round.passed.has(id)) continue;
    const draft = round.liveDrafts.get(id)?.trim();
    if (!draft) continue;
    const result = recordGuess(game, id, draft, round.liveArtistDrafts.get(id)?.trim());
    if (result?.correct) return result as { correct: true; points: number; guesserName: string; allDone: boolean };
  }
  return null;
}

// Called on every keystroke so an opponent's in-progress guess survives even
// if the round ends (someone else wins) before they get a chance to submit.
export function updateLiveDraft(game: Game, socketId: string, text: string, artistText?: string): void {
  const round = game.currentRound;
  if (!round) return;
  if (!isRaceFlowRound(game, round) && !round.guesserSocketIds.includes(socketId)) return;
  if (game.phase !== 'guessing' && game.phase !== 'playing') return;
  if (round.passed.has(socketId)) return;
  round.liveDrafts.set(socketId, text);
  if (artistText !== undefined) round.liveArtistDrafts.set(socketId, artistText);
}

// Artist-guess correctness is computed independently of the title guess and
// scoring: `checkGuess`'s artistBonus is gated on the title also being right
// (it only exists to double the score), so it can't be reused here — a
// player can have the right artist and the wrong title, and the reveal still
// needs to show that artist guess as correct.
export function getRoundGuesses(game: Game): { name: string; guess: string | null; timeMs: number | null; live?: boolean; artistGuess?: string | null; artistCorrect?: boolean }[] {
  const round = game.currentRound;
  if (!round) return [];
  const results: { name: string; guess: string | null; timeMs: number | null; live?: boolean; artistGuess?: string | null; artistCorrect?: boolean }[] = [];
  for (const [id, player] of game.players) {
    if (!player.name) continue;
    if (round.guesses.has(id)) {
      const artistGuess = round.artistGuesses.get(id) ?? null;
      results.push({
        name: player.name,
        guess: round.guesses.get(id) ?? null,
        timeMs: round.guessTimes.get(id) ?? null,
        artistGuess,
        artistCorrect: artistGuess ? isCorrectArtistGuess(artistGuess, round.song.artist, round.song.featuredArtists) : undefined,
      });
      continue;
    }
    const draft = round.liveDrafts.get(id)?.trim();
    if (draft) {
      const artistGuess = round.liveArtistDrafts.get(id)?.trim() || null;
      results.push({
        name: player.name, guess: draft, timeMs: null, live: true,
        artistGuess,
        artistCorrect: artistGuess ? isCorrectArtistGuess(artistGuess, round.song.artist, round.song.featuredArtists) : undefined,
      });
    }
  }
  return results;
}

// Applies the flat DUEL_BONUS and crowns Duel Champion the instant a
// duelist's win count reaches 2 — called right where duelWins is
// incremented (applyClassicWin, applyRaceCorrectGuess, recordDuelYearWin),
// not lazily at the next "next round" click, so the reveal screen for the
// deciding sub-round already shows the true final score instead of jumping
// again once the host continues.
function resolveDuelIfWon(game: Game, socketId: string): void {
  if ((game.duelWins[socketId] ?? 0) < 2) return;
  game.duelChampion = socketId;
  const winner = game.players.get(socketId);
  if (winner) winner.score += DUEL_BONUS;
  game.duelActive = false;
}

// Called from the host's "next round" action while a finale duel is active.
// Returns true if the duel should continue (the caller then starts the next
// sub-round instead of advancing roundIndex/ending the game); false once
// it's resolved (resolveDuelIfWon already flipped duelActive off), in which
// case the caller falls through to the normal end-of-game flow exactly as if
// this were an ordinary last round.
export function advanceDuelOrResolve(game: Game): boolean {
  if (!game.duelActive) return false;
  game.duelSubRoundIndex += 1;
  return true;
}

export function getLeaderboard(game: Game) {
  return Array.from(game.players.values())
    .sort((a, b) => b.score - a.score)
    .map((p, i) => ({ rank: i + 1, name: p.name, score: p.score }));
}

// End-of-game superlatives, computed once the game's over. Ties share the
// award rather than picking one name arbitrarily. A stat of zero doesn't
// count as an achievement, so an award is omitted entirely if nobody
// actually did the thing (e.g. nobody ever guessed correctly).
export function computeAwards(game: Game): Award[] {
  const players = Array.from(game.players.values());
  const awards: Award[] = [];

  const mostCorrect = Math.max(0, ...players.map(p => p.totalCorrect));
  if (mostCorrect > 0) {
    awards.push({
      key: 'mostCorrect',
      playerNames: players.filter(p => p.totalCorrect === mostCorrect).map(p => p.name),
      detail: `${mostCorrect} correct guess${mostCorrect === 1 ? '' : 'es'}`,
    });
  }

  const timed = players.filter(p => p.fastestCorrectMs !== null);
  if (timed.length > 0) {
    const fastestMs = Math.min(...timed.map(p => p.fastestCorrectMs!));
    awards.push({
      key: 'fastestGuess',
      playerNames: timed.filter(p => p.fastestCorrectMs === fastestMs).map(p => p.name),
      detail: `${(fastestMs / 1000).toFixed(1)}s`,
    });
  }

  // Separate award, not merged with the race-flow one above: classic's
  // per-tier timing isn't on the same scale as race's shared-clip-start
  // timing, so comparing them directly would be misleading.
  const timedClassic = players.filter(p => p.fastestClassicMs !== null);
  if (timedClassic.length > 0) {
    const fastestClassicMs = Math.min(...timedClassic.map(p => p.fastestClassicMs!));
    awards.push({
      key: 'fastestClassicGuess',
      playerNames: timedClassic.filter(p => p.fastestClassicMs === fastestClassicMs).map(p => p.name),
      detail: `${(fastestClassicMs / 1000).toFixed(1)}s`,
    });
  }

  const biggestSwing = Math.max(0, ...players.map(p => p.biggestSwing));
  if (biggestSwing > 0) {
    awards.push({
      key: 'biggestSwing',
      playerNames: players.filter(p => p.biggestSwing === biggestSwing).map(p => p.name),
      detail: `+${biggestSwing.toLocaleString()} in one round`,
    });
  }

  if (game.duelChampion) {
    const champ = game.players.get(game.duelChampion);
    if (champ) awards.push({ key: 'finaleWinner', playerNames: [champ.name], detail: 'Won the finale duel' });
  }

  return awards;
}

export function updateSocketPin(socketId: string, pin: string) {
  socketToPin.set(socketId, pin);
}

export function cleanupGame(pin: string) {
  const game = games.get(pin);
  if (!game) return;
  if (game.phaseTimer) clearTimeout(game.phaseTimer);
  for (const id of game.players.keys()) socketToPin.delete(id);
  socketToPin.delete(game.hostSocketId);
  games.delete(pin);
}
