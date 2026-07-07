import { randomInt } from 'node:crypto';
import {
  Difficulty, Game, GuessTarget, Hint, PartyClientView, PartyConfig, PartyEvent, PartyFormat,
  Player, PlaylistTrackInput, Round, Song, YearResult,
} from './types';
import { loadSongs } from './songLoader';
import { adaptPlaylistTracks } from './customSongPool';
import { isCorrectGuess, isCorrectArtistGuess } from './fuzzyMatch';

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
export const BOTH_ARTIST_BONUS = 300;  // 'both' target: extra for also naming the artist
export const STEAL_PCT = 0.25;         // steal takes 15% of the victim's score…
export const STEAL_MIN = 400;          // …but never less than this (capped at their total)
export const DUEL_WIN_POINTS = 1500;   // finale: first correct duelist takes this
export const YEAR_MAX_POINTS = 1000;   // year round: exact answer
export const YEAR_POINTS_SLOPE = 120;  // …minus this per year off
export const YEAR_WINNER_BONUS = 500;  // closest answer bonus (split on ties)
export const PITY_GAP_THRESHOLD = 3000; // leader's lead must exceed this…
export const PITY_BONUS = 500;          // …for a scorer to get this catch-up bonus

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
const games = new Map<string, Game>();
const socketToPin = new Map<string, string>();

export function initSongs() {
  songs = loadSongs();
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

// ─── Party round recipes ─────────────────────────────────────────────────────

function introFor(format: PartyFormat, target: GuessTarget, event: PartyEvent | null): { title: string; tagline: string } {
  if (format === 'year') return { title: 'Guess the Year', tagline: 'Closest answer wins the round' };
  const flow = format === 'classic' ? 'Bid & guess' : 'Everyone races';
  let goal = 'name the song';
  if (target === 'artist') goal = 'name the artist';
  else if (target === 'both') goal = 'title + artist bonus';
  const eventIntros: Record<PartyEvent, { title: string; tag: string }> = {
    double: { title: 'Double Points', tag: 'Everything is worth 2×' },
    mystery: { title: 'Mystery Multiplier', tag: 'Revealed after the round: ×1, ×2 or ×3' },
    steal: { title: 'Steal Round', tag: 'Win the round, then rob another player' },
    snippet: { title: 'Snippet Roulette', tag: 'The clip starts somewhere mid-song' },
    fullhints: { title: 'Open Book', tag: 'Every hint on the table' },
    blind: { title: 'Blind Bet', tag: 'No hints at all — bid on ears alone' },
    outro: { title: 'Down to the Wire', tag: "The clip plays the song's final stretch" },
  };
  if (event) {
    const e = eventIntros[event];
    return { title: e.title, tagline: `${e.tag} · ${flow} / ${goal}` };
  }
  if (target === 'artist') return { title: 'Who Sings It?', tagline: `${flow} / name the artist` };
  if (target === 'both') return { title: 'Double Duty', tagline: `${flow} / title wins, artist adds +${BOTH_ARTIST_BONUS}` };
  return format === 'race'
    ? { title: 'Race Round', tagline: 'Everyone guesses at once / speed wins' }
    : { title: 'Classic Round', tagline: 'Bid low, score high' };
}

function pickPartyTarget(format: PartyFormat): GuessTarget {
  if (format === 'year') return 'title';
  return pickWeighted<GuessTarget>([['title', 60], ['artist', 25], ['both', 15]]);
}

function pickPartyEvent(game: Game, format: PartyFormat, prevEvent: PartyEvent | null | undefined): PartyEvent | null {
  if (format === 'year' || randomInt(0, 100) >= 60) return null;
  const pool: [PartyEvent, number][] = [['double', 30], ['mystery', 25], ['snippet', 25]];
  if (format === 'classic') pool.push(['fullhints', 20], ['blind', 20]);
  if (format === 'race') pool.push(['outro', 25]);
  // Steal needs someone else to steal from — pointless (and confusing to
  // announce) in a 1-player game.
  if (game.roundIndex >= 2 && game.players.size >= 2) pool.push(['steal', 20]);
  return pickWeighted(pool.filter(([e]) => e !== prevEvent));
}

function eventMultiplier(event: PartyEvent | null): number {
  if (event === 'double') return 2;
  if (event === 'mystery') return 1 + randomInt(0, 3);
  return 1;
}

// One random recipe per round: format + guess target + modifier, with just
// enough constraints to keep it feeling curated — round 1 is a plain warm-up,
// the same event never repeats twice in a row, steal waits until scores exist,
// and the last round is a top-2 duel.
function buildPartyConfig(game: Game): PartyConfig {
  const plain: Omit<PartyConfig, 'format' | 'target' | 'event' | 'multiplier' | 'intro'> = {
    finale: false, duelistIds: [], duelistNames: [],
  };

  const isLast = game.roundIndex === game.totalRounds - 1;
  if (isLast && game.totalRounds > 1 && game.players.size >= 2) {
    const top = Array.from(game.players.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, 2);
    return {
      format: 'race', target: 'title', event: null, multiplier: 1,
      finale: true,
      duelistIds: top.map(p => p.socketId),
      duelistNames: top.map(p => p.name),
      intro: {
        title: 'The Finale',
        tagline: `${top[0].name} vs ${top[1].name} / first correct wins ${DUEL_WIN_POINTS} pts`,
      },
    };
  }

  if (game.roundIndex === 0) {
    return {
      ...plain, format: 'classic', target: 'title', event: null, multiplier: 1,
      intro: { title: 'Warm-Up', tagline: 'A classic round to get going' },
    };
  }

  const prev = game.currentRound?.party;
  let format = pickWeighted<PartyFormat>([['classic', 45], ['race', 40], ['year', 15]]);
  if (format === 'year' && prev?.format === 'year') format = 'race';

  const target = pickPartyTarget(format);
  const event = pickPartyEvent(game, format, prev?.event);
  const multiplier = eventMultiplier(event);

  return { ...plain, format, target, event, multiplier, intro: introFor(format, target, event) };
}

// The sanitized view clients get: no socketIds, and a mystery multiplier stays
// hidden (null) until the reveal.
export function partyView(round: Round, revealed = false): PartyClientView | undefined {
  const p = round.party;
  if (!p) return undefined;
  return {
    format: p.format,
    target: p.target,
    event: p.event,
    multiplier: p.event === 'mystery' && !revealed ? null : p.multiplier,
    intro: p.intro,
    finale: p.finale,
    duelists: p.duelistNames,
  };
}

function roundMultiplier(round: Round): number {
  return round.party?.multiplier ?? 1;
}

// What this round's guess is checked against. Party rounds carry it per-round;
// classic/race games fall back to the game-wide artistOnly toggle.
type EffectiveTarget = GuessTarget | 'year';
export function effectiveTarget(game: Game, round: Round): EffectiveTarget {
  if (round.party) return round.party.format === 'year' ? 'year' : round.party.target;
  if (game.yearOnly) return 'year';
  return game.artistOnly ? 'artist' : 'title';
}

function checkGuess(
  target: GuessTarget, text: string, artistText: string | undefined, song: Song,
): { correct: boolean; artistBonus: boolean } {
  if (target === 'artist') {
    return { correct: isCorrectArtistGuess(text, song.artist, song.featuredArtists), artistBonus: false };
  }
  const correct = isCorrectGuess(text, song.title);
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

// Who actually plays a race-flow round — the duelists in a finale, everyone
// otherwise.
function raceParticipants(game: Game, round: Round): string[] {
  if (round.party?.finale) return round.party.duelistIds.filter(id => game.players.has(id));
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
function pityBonus(scores: Map<string, number>, scorerId: string): number {
  const leaderScore = Math.max(
    0,
    ...Array.from(scores.entries()).filter(([id]) => id !== scorerId).map(([, s]) => s),
  );
  return leaderScore - (scores.get(scorerId) ?? 0) > PITY_GAP_THRESHOLD ? PITY_BONUS : 0;
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
      party.intro = introFor(party.format, party.target, null);
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
      party.intro = introFor(party.format, party.target, null);
      return undefined;
    }
    return song.durationMs - raceMs;
  }
  return undefined;
}

// What's actually being guessed this round — decides which hints would give
// the answer away outright, and which "other" fact is safe (and useful) to
// surface instead. Party rounds carry their own per-round target/format;
// classic/race games fall back to the game-wide toggles.
function roundGuessKind(party: PartyConfig | undefined, artistOnly: boolean, yearOnly: boolean): GuessTarget | 'year' {
  if (party) return party.format === 'year' ? 'year' : party.target;
  if (yearOnly) return 'year';
  return artistOnly ? 'artist' : 'title';
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
  const hints = party?.format === 'classic' && party.event === 'fullhints'
    ? generateAllHints(song, suppressArtist, suppressYear)
    : generateHints(song, suppressArtist, suppressYear, includeTitle);

  return hints;
}

// Round selection applies these constraints strictest/most-essential first,
// softest/most-skippable last — and each stage reverts to its input pool if
// applying it would leave nothing, so the last-applied (softest) filter is
// always the first one sacrificed once a small pool runs out of room:
//   1. year-round playability (a hard mechanical requirement)
//   2. never the literal immediately-preceding song
//   3. not used yet this game (usedSongIds)
//   4. not recently played in a previous game from this same pool
//   5. not the same artist as the previous round
function buildRound(game: Game, party?: PartyConfig): Round {
  const rawPool = difficultyPool(game);
  const prevSong = game.currentRound?.song;

  // A year round is unplayable without a known year — checked first since,
  // unlike the constraints below, this one isn't a variety nicety.
  const isYearRound = party ? party.format === 'year' : game.yearOnly;
  let base = rawPool;
  if (isYearRound) {
    const withYear = rawPool.filter(s => s.year !== null);
    if (withYear.length > 0) base = withYear;
  }

  // Never literally repeat the song that just played, even across a
  // used-pool reshuffle below.
  const noImmediateRepeat = prevSong
    ? base.filter(s => s.spotifyTrackId !== prevSong.spotifyTrackId)
    : base;
  const guardedBase = noImmediateRepeat.length > 0 ? noImmediateRepeat : base;

  // Not used yet this game. On exhaustion, reshuffle — but reseed with just
  // the previous song so the reshuffle itself can't reintroduce a
  // back-to-back repeat.
  let pool = guardedBase.filter(s => !game.usedSongIds.has(s.spotifyTrackId));
  if (pool.length === 0) {
    game.usedSongIds.clear();
    if (prevSong) game.usedSongIds.add(prevSong.spotifyTrackId);
    pool = guardedBase.filter(s => !game.usedSongIds.has(s.spotifyTrackId));
    if (pool.length === 0) pool = guardedBase;
  }

  // Not recently played in a previous game from this same song pool.
  const recentIds = recentlyPlayedByPool.get(poolKey(game));
  if (recentIds && recentIds.length > 0) {
    const recentSet = new Set(recentIds);
    const fresh = pool.filter(s => !recentSet.has(s.spotifyTrackId));
    if (fresh.length > 0) pool = fresh;
  }

  // Not the same artist as the previous round — softest constraint, so it's
  // applied last (first to be dropped if the pool is dominated by one act).
  if (prevSong) {
    const notSameArtist = pool.filter(s => !sameArtist(s, prevSong));
    if (notSameArtist.length > 0) pool = notSameArtist;
  }

  const song = pickRandom(pool);

  const snippetMs = party ? computeSnippetPosition(song, party, game.raceTime) : undefined;
  const guessKind = roundGuessKind(party, game.artistOnly, game.yearOnly);
  const hints = buildRoundHints(song, party, guessKind);

  return {
    song,
    hints,
    party,
    snippetMs,
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
    scoredSocketIds: new Set(),
    playStartAt: null,
    firstCorrectAt: null,
    correctGuessers: new Set(),
    guessTimes: new Map(),
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
    difficulty: 'hard',
    songSource: 'library',
    playlistId: undefined,
    currentRound: null,
    usedSongIds: new Set(),
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
  const pool = adaptPlaylistTracks(tracks);
  if (pool.length < MIN_PLAYLIST_TRACKS) {
    return { ok: false, error: `Only ${pool.length} playable track${pool.length === 1 ? '' : 's'} — need at least ${MIN_PLAYLIST_TRACKS}` };
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
  const player: Player = { socketId, name: name.trim(), score: former?.score ?? 0, streak: former?.streak ?? 0 };
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
  if (round.party) round.party.duelistIds = round.party.duelistIds.map(id => (id === oldId ? newId : id));
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
    if (player) game.formerPlayers.set(player.name.toLowerCase(), { score: player.score, streak: player.streak });
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
  game.currentRound = round;
  game.phase = 'betting';
  return round;
}

export function recordBid(game: Game, socketId: string, seconds: number): boolean {
  if (game.phase !== 'betting') return false;
  if (!game.players.has(socketId)) return false;
  if (!BID_OPTIONS.includes(seconds)) return false;
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
  const target = effectiveTarget(game, round);
  const guesserName = game.players.get(socketId)?.name ?? '';

  if (target === 'year') {
    const guess = parseYearGuess(text);
    const correct = guess !== null && guess === Math.floor(round.song.year ?? 0);
    if (!correct) return failGuess(round, socketId, guesserName);
    const points = calcPoints(game, round.lowestBid, round.song.rank) * roundMultiplier(round)
      + pityBonus(currentScores(game), socketId);
    const result = applyClassicWin(game, round, socketId, guesserName, points);
    // The year reveal UI reads exclusively from `yearResults` (never from
    // correct/guesserName/points), so an early exact-match win still needs a
    // results table — everyone else's guess is shown for context, but only
    // the winner scores.
    finalizeClassicYearWin(game, round, socketId, points);
    return result;
  }

  const { correct, artistBonus } = checkGuess(target, text, artistText, round.song);
  if (!correct) return failGuess(round, socketId, guesserName);

  const points = (calcPoints(game, round.lowestBid, round.song.rank)
    + (artistBonus ? BOTH_ARTIST_BONUS : 0)) * roundMultiplier(round)
    + pityBonus(currentScores(game), socketId);
  return applyClassicWin(game, round, socketId, guesserName, points);
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
  game: Game, round: Round, socketId: string, guesserName: string, points: number,
): { correct: true; points: number; guesserName: string; allDone: false } {
  round.answered = true;
  round.correctGuesserName = guesserName;
  const player = game.players.get(socketId)!;
  player.score += points;
  player.streak += 1;
  round.scoredSocketIds.add(socketId);
  if (round.party?.event === 'steal') {
    round.stealBy = socketId;
    round.stealDone = false;
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
  const allDone = round.guesserSocketIds.every(id => round.passed.has(id));
  return { allDone };
}

export function markRaceStarted(game: Game): void {
  const round = game.currentRound;
  if (!round) return;
  round.playStartAt = Date.now();
  game.phase = 'guessing';
}

function applyRaceCorrectGuess(
  game: Game, round: Round, socketId: string, elapsedMs: number, artistBonus: boolean,
): number {
  const isFirst = round.firstCorrectAt === null;
  if (isFirst) round.firstCorrectAt = Date.now();
  round.correctGuessers.add(socketId);
  round.guessTimes.set(socketId, elapsedMs);
  if (!isFirst && game.raceWinnerOnly) return 0;
  let base: number;
  if (round.party?.finale) {
    // Duel: winner-takes-all, flat stakes.
    base = isFirst ? DUEL_WIN_POINTS : 0;
  } else if (game.raceWinnerOnly) {
    base = calcRaceWinnerPoints(game, elapsedMs, game.raceTime, round.song.rank);
  } else {
    base = calcRacePoints(game, isFirst, elapsedMs, round.firstCorrectAt! - round.playStartAt!, round.song.rank);
  }
  let points = (base + (artistBonus ? BOTH_ARTIST_BONUS : 0)) * roundMultiplier(round);
  if (points > 0) points += pityBonus(currentScores(game), socketId);
  if (isFirst && round.party?.event === 'steal') {
    round.stealBy = socketId;
    round.stealDone = false;
  }
  const player = game.players.get(socketId)!;
  player.score += points;
  if (points > 0) {
    player.streak += 1;
    round.scoredSocketIds.add(socketId);
  }
  return points;
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
  if (round.party?.finale && !round.party.duelistIds.includes(socketId)) return null;
  if ((game.raceWinnerOnly || round.party?.finale) && round.firstCorrectAt !== null) return null;

  const elapsedMs = Date.now() - (round.playStartAt ?? Date.now());
  round.guesses.set(socketId, text);
  round.passed.add(socketId);
  const participants = raceParticipants(game, round);

  const target = effectiveTarget(game, round);
  if (target === 'year') {
    // Year answers are only scored once the round ends and every distance is
    // known — see finalizeYearRound.
    const allDone = participants.every(id => round.passed.has(id));
    return { correct: false, points: 0, elapsedMs, allDone };
  }

  const { correct, artistBonus } = checkGuess(target, text, artistText, round.song);
  const points = correct ? applyRaceCorrectGuess(game, round, socketId, elapsedMs, artistBonus) : 0;

  const allDone = ((game.raceWinnerOnly || round.party?.finale === true) && correct)
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
  if (round.party?.finale && !round.party.duelistIds.includes(socketId)) return null;

  round.guesses.set(socketId, null);
  round.passed.add(socketId);
  const allDone = raceParticipants(game, round).every(id => round.passed.has(id));
  return { allDone };
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
      points *= mult;
    }
    if (points > 0) {
      points += pityBonus(preRoundScores, e.id);
      e.player.score += points;
      e.player.streak += 1;
      round.scoredSocketIds.add(e.id);
    }
    return { name: e.player.name, guess: e.guess, diff: e.diff, points };
  });

  results.sort((a, b) => (a.diff ?? 9999) - (b.diff ?? 9999));
  round.yearResults = results;
  return round.yearResults;
}

// Race-flow year rounds are scored in one pass at the end, once every
// distance is known.
export function finalizeYearRound(game: Game): YearResult[] {
  const round = game.currentRound!;
  return scoreYearGuesses(game, round, roundMultiplier(round), game.raceWinnerOnly);
}

// Classic-flow year round that ended early on an exact guess — scored like
// any other classic round (bid + rank), not the distance formula above. The
// year reveal UI reads only `yearResults`, so this still builds one: every
// other player's guess is shown for context on the timeline, but only the
// winner scores.
function finalizeClassicYearWin(game: Game, round: Round, winnerId: string, winnerPoints: number): YearResult[] {
  const actual = Math.floor(round.song.year ?? 0);
  const entries = yearGuessEntries(game, round, actual);
  const results: YearResult[] = entries.map(e => ({
    name: e.player.name, guess: e.guess, diff: e.diff, points: e.id === winnerId ? winnerPoints : 0,
  }));
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
  for (const id of game.players.keys()) {
    if (round.passed.has(id)) continue;
    const draft = round.liveDrafts.get(id)?.trim();
    if (draft) recordRaceGuess(game, id, draft);
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
    const result = recordGuess(game, id, draft);
    if (result?.correct) return result as { correct: true; points: number; guesserName: string; allDone: boolean };
  }
  return null;
}

// Called on every keystroke so an opponent's in-progress guess survives even
// if the round ends (someone else wins) before they get a chance to submit.
export function updateLiveDraft(game: Game, socketId: string, text: string): void {
  const round = game.currentRound;
  if (!round) return;
  if (!isRaceFlowRound(game, round) && !round.guesserSocketIds.includes(socketId)) return;
  if (game.phase !== 'guessing' && game.phase !== 'playing') return;
  if (round.passed.has(socketId)) return;
  round.liveDrafts.set(socketId, text);
}

export function getRoundGuesses(game: Game): { name: string; guess: string | null; timeMs: number | null; live?: boolean }[] {
  const round = game.currentRound;
  if (!round) return [];
  const results: { name: string; guess: string | null; timeMs: number | null; live?: boolean }[] = [];
  for (const [id, player] of game.players) {
    if (!player.name) continue;
    if (round.guesses.has(id)) {
      results.push({ name: player.name, guess: round.guesses.get(id) ?? null, timeMs: round.guessTimes.get(id) ?? null });
      continue;
    }
    const draft = round.liveDrafts.get(id)?.trim();
    if (draft) results.push({ name: player.name, guess: draft, timeMs: null, live: true });
  }
  return results;
}

export function getLeaderboard(game: Game) {
  return Array.from(game.players.values())
    .sort((a, b) => b.score - a.score)
    .map((p, i) => ({ rank: i + 1, name: p.name, score: p.score }));
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
