import { randomInt } from 'node:crypto';
import { Difficulty, Game, PartyConfig, PartyTarget, PlaylistTrackInput, Song } from './types';
import { loadSongs } from './songLoader';
import { adaptPlaylistTracks } from './customSongPool';
import { isCorrectArtistGuess, textsCollide } from './fuzzyMatch';
import { ARTIST_WINDOW_DIVISOR, ARTIST_WINDOW_MAX, ARTIST_WINDOW_MIN, MIN_CHOICE_YEAR, YEAR_CHOICE_RADIUS } from './constants';
import { pickRandom, shuffle } from './random';
import { introFor } from './party';

// The song catalog and everything that narrows it down to one song per round:
// difficulty slicing, the avoid-repetition filter chain, multiple-choice
// distractor generation, and the snippet/outro clip offsets.

// ─── Catalog ─────────────────────────────────────────────────────────────────

let songs: Song[] = [];
// Exact Spotify-track-ID lookup into the CSV catalog, used to enrich
// playlist-imported songs (which have no popularity data of their own) with
// tempo/stream counts when the same track also happens to be in the CSV.
let csvByTrackId = new Map<string, Song>();

export function initSongs() {
  songs = loadSongs();
  csvByTrackId = new Map(songs.map(s => [s.spotifyTrackId, s]));
  console.log(`Loaded ${songs.length} playable songs`);
}

// Size of the full library, used to scale the rank-based difficulty bonus.
export function librarySize(): number {
  return songs.length;
}

// Re-validates a host-picked playlist into a usable pool. Re-validation (not
// just trusting the client's own min-track check) matters because
// filtering/dedup happens again here from scratch — a client-side pass and a
// server-side pass could disagree given a malformed payload.
export function buildCustomPool(tracks: PlaylistTrackInput[]): Song[] {
  return adaptPlaylistTracks(tracks, csvByTrackId);
}

// Fraction of the song pool in play per difficulty, taken from the top of the
// rank-sorted list — i.e. the most well-known songs first.
const DIFFICULTY_PCT: Record<Difficulty, number> = { easy: 0.2, medium: 0.5, hard: 1 };

// `songs` is sorted ascending by rank (loadSongs), so the top slice is the
// most well-known songs — that's what makes 'easy' actually easy. A custom
// playlist pool has no popularity ranking to slice by, so difficulty is
// skipped entirely and the whole pool is always in play.
function difficultyPool(game: Game): Song[] {
  if (game.songSource === 'playlist') return game.songPool ?? [];
  const count = Math.max(1, Math.ceil(songs.length * DIFFICULTY_PCT[game.difficulty]));
  return songs.slice(0, count);
}

// ─── Recently-played memory ──────────────────────────────────────────────────

// Keyed per song-pool identity, so a fresh "New Game" doesn't immediately
// resurface songs from the game just played. Process-lifetime only (no
// persistence), same as every other piece of in-memory state here. Library
// plays share one bucket across all difficulties (the slices are prefixes of
// the same rank-sorted array, and "recently heard" shouldn't depend on which
// difficulty was active); each distinct playlist gets its own bucket keyed by
// Spotify playlist ID.
const recentlyPlayedByPool = new Map<string, string[]>();
const RECENT_CAP_RATIO = 0.5;

export function poolKey(game: Game): string {
  return game.songSource === 'playlist' ? `playlist:${game.playlistId ?? 'unknown'}` : 'library';
}

// Sized off the library's full length, not the active difficulty slice, so
// the cap doesn't shift just because the host changed difficulty.
export function poolSizeForCap(game: Game): number {
  return game.songSource === 'playlist' ? (game.songPool?.length ?? 0) : songs.length;
}

// Capped at half the pool so this filter alone can never empty a pool —
// on top of the soft-filter fallback in pickRoundSong.
export function rememberRecentlyPlayed(key: string, trackId: string, poolSize: number): void {
  const cap = Math.max(1, Math.floor(poolSize * RECENT_CAP_RATIO));
  const list = recentlyPlayedByPool.get(key) ?? [];
  const next = list.filter(id => id !== trackId);
  next.push(trackId);
  while (next.length > cap) next.shift();
  recentlyPlayedByPool.set(key, next);
}

// ─── Artist-repetition filtering ─────────────────────────────────────────────

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

function artistWindowSize(poolSize: number): number {
  return Math.min(ARTIST_WINDOW_MAX, Math.max(ARTIST_WINDOW_MIN, Math.floor(poolSize / ARTIST_WINDOW_DIVISOR)));
}

// ─── The filter chain ────────────────────────────────────────────────────────

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

// Round selection applies these constraints strictest/most-essential first,
// softest/most-skippable last — and each stage reverts to its input pool if
// applying it would leave nothing, so the last-applied (softest) filter is
// always the first one sacrificed once a small pool runs out of room.
// Returns the picked song alongside the pool it came from, since the
// multiple-choice and chaos-hint distractors are drawn from that same
// already-filtered pool.
export function pickRoundSong(game: Game, party: PartyConfig | undefined): { song: Song; pool: Song[] } {
  const rawPool = difficultyPool(game);
  const prevSong = game.currentRound?.song;
  const isYearRound = party ? party.format === 'year' || party.target === 'year' : game.yearOnly;

  let pool = restrictToYearPlayable(rawPool, isYearRound);
  pool = avoidImmediateRepeat(pool, prevSong);
  pool = avoidUsedSongs(game, pool, prevSong);
  pool = avoidRecentlyPlayedInPool(game, pool);
  pool = avoidRecentArtists(game, pool, rawPool.length);

  return { song: pickRandom(pool), pool };
}

// ─── Clip offsets ────────────────────────────────────────────────────────────

// Snippet roulette and 'outro' both need a known, long-enough duration to
// aim inside the song; silently downgrade to a plain round when the data's
// missing (or, for 'outro', too short to leave a real "before" to skip).
// Mutates party.event/intro on downgrade — returns the clip's start offset.
export function computeSnippetPosition(song: Song, party: PartyConfig, raceTimeSec: number): number | undefined {
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

// ─── Multiple-choice options ─────────────────────────────────────────────────

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

export function maybeApplyPartyChoiceOptions(song: Song, pool: Song[], party: PartyConfig | undefined): void {
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

export function classicChoiceOptions(
  game: Game, party: PartyConfig | undefined, song: Song, pool: Song[], target: PartyTarget,
): string[] | undefined {
  if (!game.multipleChoice || party) return undefined;
  return pickChoiceOptions(song, pool, choiceFieldForTarget(target));
}
