import { randomInt } from 'node:crypto';
import {
  Game, GuessTarget, Hint, PartyClientView, PartyConfig, PartyEvent, PartyFormat,
  Player, Round, Song, YearResult,
} from './types';
import { loadSongs } from './songLoader';
import { isCorrectGuess, isCorrectArtistGuess } from './fuzzyMatch';

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
export const STEAL_PCT = 0.15;         // steal takes 15% of the victim's score…
export const STEAL_MIN = 300;          // …but never less than this (capped at their total)
export const DUEL_WIN_POINTS = 1500;   // finale: first correct duelist takes this
export const YEAR_MAX_POINTS = 1000;   // year round: exact answer
export const YEAR_POINTS_SLOPE = 120;  // …minus this per year off
export const YEAR_WINNER_BONUS = 500;  // closest answer bonus (split on ties)

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

let songs: Song[] = [];
const games = new Map<string, Game>();
const socketToPin = new Map<string, string>();

export function initSongs() {
  songs = loadSongs();
  console.log(`Loaded ${songs.length} playable songs`);
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

function generateHints(song: Song, artistOnly = false): Hint[] {
  const pool: Hint[] = [];

  // Only ever one time hint — year and decade must not appear together.
  if (song.year && song.decade) {
    pool.push(
      randomInt(0, 2) === 0
        ? { label: 'Era', value: `${song.decade}s` }
        : { label: 'Release year', value: String(Math.floor(song.year)) }
    );
  } else if (song.decade) {
    pool.push({ label: 'Era', value: `${song.decade}s` });
  } else if (song.year) {
    pool.push({ label: 'Release year', value: String(Math.floor(song.year)) });
  }

  if (song.spotifyStreams)
    pool.push({ label: 'Streams', value: formatStreams(song.spotifyStreams) });

  if (song.durationMs)
    pool.push({ label: 'Duration', value: formatDuration(song.durationMs) });

  // Artist hints are suppressed in artist-only mode since the artist IS the answer.
  if (!artistOnly) {
    const fullArtist = song.featuredArtists
      ? `${song.artist} feat. ${song.featuredArtists}`
      : song.artist;
    pool.push(
      randomInt(0, 2) === 0
        ? { label: 'Artist initials', value: getInitials(song.artist) }
        : { label: 'Artist(s)', value: fullArtist }
    );
  }

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
function generateAllHints(song: Song, suppressArtist: boolean): Hint[] {
  const hints: Hint[] = [];
  if (song.year) hints.push({ label: 'Release year', value: String(Math.floor(song.year)) });
  else if (song.decade) hints.push({ label: 'Era', value: `${song.decade}s` });
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
  if (format === 'classic') pool.push(['fullhints', 20]);
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
function effectiveTarget(game: Game, round: Round): EffectiveTarget {
  if (round.party) return round.party.format === 'year' ? 'year' : round.party.target;
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
// non-classic format.
export function isRaceFlowRound(game: Game, round: Round): boolean {
  if (game.mode === 'race') return true;
  return !!round.party && round.party.format !== 'classic';
}

// Who actually plays a race-flow round — the duelists in a finale, everyone
// otherwise.
function raceParticipants(game: Game, round: Round): string[] {
  if (round.party?.finale) return round.party.duelistIds.filter(id => game.players.has(id));
  return Array.from(game.players.keys());
}

function difficultyBonus(rank: number): number {
  return Math.round(500 * Math.max(0, 1 - (rank - 1) / Math.max(songs.length - 1, 1)));
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

export function calcPoints(bid: number, rank: number): number {
  return 500 + bidScore(bid) + difficultyBonus(rank);
}

export function calcRacePoints(
  isFirst: boolean, elapsedMs: number, firstElapsedMs: number, rank: number,
): number {
  if (isFirst) return RACE_BASE + difficultyBonus(rank);
  const gapSec = Math.max(0, (elapsedMs - firstElapsedMs) / 1000);
  const speed = Math.max(RACE_FLOOR, Math.round(RACE_BASE * (1 - gapSec / RACE_DECAY_WINDOW)));
  return speed + difficultyBonus(rank);
}

export function calcRaceWinnerPoints(elapsedMs: number, raceTime: number, rank: number): number {
  const speed = Math.max(0, Math.round(RACE_BASE * (1 - elapsedMs / (raceTime * 1000))));
  return speed + difficultyBonus(rank);
}

function buildRound(usedSongIds: Set<string>, artistOnly = false, party?: PartyConfig): Round {
  let pool = songs.filter(s => !usedSongIds.has(s.spotifyTrackId));
  if (pool.length === 0) pool = songs;
  // A year round is unplayable without a known year.
  if (party?.format === 'year') {
    const withYear = pool.filter(s => s.year !== null);
    if (withYear.length > 0) pool = withYear;
  }
  const song = pickRandom(pool);

  // Snippet roulette needs a known, long-enough duration to aim inside the
  // song; silently downgrade to a plain round when the data's missing.
  let snippetMs: number | undefined;
  if (party?.event === 'snippet') {
    if (song.durationMs && song.durationMs > 60_000) {
      const min = Math.round(song.durationMs * 0.15);
      const max = Math.round(song.durationMs * 0.65);
      snippetMs = min + randomInt(0, Math.max(1, max - min));
    } else {
      party.event = null;
      party.intro = introFor(party.format, party.target, null);
    }
  }

  // Any target other than plain 'title' means the artist is (part of) the
  // answer, so artist hints would give it away.
  const suppressArtist = party ? party.target !== 'title' : artistOnly;
  const hints = party?.format === 'classic' && party.event === 'fullhints'
    ? generateAllHints(song, suppressArtist)
    : generateHints(song, suppressArtist);

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
    currentRound: null,
    usedSongIds: new Set(),
    phaseTimer: null,
    phaseEndsAt: null,
  };
  games.set(pin, game);
  socketToPin.set(hostSocketId, pin);
  return game;
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
  const round = buildRound(game.usedSongIds, game.artistOnly, party);
  game.usedSongIds.add(round.song.spotifyTrackId);
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
  if (target === 'year') return null; // year rounds never run the classic flow
  const { correct, artistBonus } = checkGuess(target, text, artistText, round.song);
  const guesserName = game.players.get(socketId)?.name ?? '';

  if (correct) {
    round.answered = true;
    round.correctGuesserName = guesserName;
    const player = game.players.get(socketId)!;
    const points = (calcPoints(round.lowestBid, round.song.rank)
      + (artistBonus ? BOTH_ARTIST_BONUS : 0)) * roundMultiplier(round);
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

  round.passed.add(socketId);
  const allDone = round.guesserSocketIds.every(id => round.passed.has(id));
  return { correct: false, points: 0, guesserName, allDone };
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
    base = calcRaceWinnerPoints(elapsedMs, game.raceTime, round.song.rank);
  } else {
    base = calcRacePoints(isFirst, elapsedMs, round.firstCorrectAt! - round.playStartAt!, round.song.rank);
  }
  const points = (base + (artistBonus ? BOTH_ARTIST_BONUS : 0)) * roundMultiplier(round);
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

// Year rounds are scored in one pass at the end: exact answers pay the most,
// points fall off per year of distance, and the closest player(s) take a
// winner bonus on top.
export function finalizeYearRound(game: Game): YearResult[] {
  const round = game.currentRound!;
  const actual = Math.floor(round.song.year ?? 0);
  const mult = roundMultiplier(round);

  const entries = Array.from(game.players.entries()).map(([id, player]) => {
    const raw = round.guesses.get(id);
    const parsed = raw ? Number.parseInt(raw.replace(/\D/g, ''), 10) : Number.NaN;
    const valid = Number.isFinite(parsed) && parsed >= 1000 && parsed <= 3000;
    return {
      id, player,
      guess: valid ? parsed : null,
      diff: valid ? Math.abs(parsed - actual) : null,
    };
  });

  const diffs = entries.filter(e => e.diff !== null).map(e => e.diff!);
  const best = diffs.length > 0 ? Math.min(...diffs) : null;
  const winners = best === null ? 0 : entries.filter(e => e.diff === best).length;

  const results: YearResult[] = entries.map(e => {
    let points = 0;
    if (e.diff !== null) {
      points = Math.max(0, YEAR_MAX_POINTS - YEAR_POINTS_SLOPE * e.diff);
      if (e.diff === best) points += Math.round(YEAR_WINNER_BONUS / winners);
      points *= mult;
    }
    if (points > 0) {
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
