import { randomInt } from 'node:crypto';
import { Game, Hint, Player, Round, Song } from './types';
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

function getInitials(artist: string): string {
  const main = artist.split(/\s(?:featuring|feat\.|ft\.|x\s)/i)[0].trim();
  return main.split(/\s+/).map(w => (w[0] ?? '').toUpperCase()).join('.') + '.';
}

// "Blinding Lights" → "B _ i _ _ i _ _   L _ _ _ t _"
// Always reveals first letter of each word plus 2 randomly selected inner letters.
function maskTitle(title: string): string {
  const words = title.trim().split(/\s+/);
  const innerLetters: string[] = [];
  for (const w of words) {
    for (let i = 1; i < w.length; i++) {
      const c = w[i].toLowerCase();
      if (/[a-z]/.test(c)) innerLetters.push(c);
    }
  }
  const unique = [...new Set(innerLetters)];
  const extraRevealed = new Set(shuffle(unique).slice(0, Math.min(2, unique.length)));

  return words
    .map(w =>
      w.split('').map((c, i) => {
        if (!/[a-zA-Z]/.test(c)) return c;
        if (i === 0 || extraRevealed.has(c.toLowerCase())) return c;
        return '_';
      }).join(' ')
    )
    .join('   ');
}

function formatStreams(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  return `${(n / 1_000_000).toFixed(0)}M`;
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

function difficultyBonus(rank: number): number {
  return Math.round(500 * Math.max(0, 1 - (rank - 1) / Math.max(songs.length - 1, 1)));
}

export function calcPoints(bid: number, rank: number): number {
  const bidScore = Math.round(1000 * Math.max(0, 1 - bid / 60));
  return 500 + bidScore + difficultyBonus(rank);
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

function buildRound(usedSongIds: Set<string>, artistOnly = false): Round {
  const pool = songs.filter(s => !usedSongIds.has(s.spotifyTrackId));
  const song = pool.length > 0 ? pickRandom(pool) : pickRandom(songs);
  return {
    song,
    hints: generateHints(song, artistOnly),
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

export function createGame(hostSocketId: string): Game {
  const pin = generatePin();
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
  const round = buildRound(game.usedSongIds, game.artistOnly);
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
  text: string
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
  const correct = game.artistOnly
    ? isCorrectArtistGuess(text, round.song.artist, round.song.featuredArtists)
    : isCorrectGuess(text, round.song.title);
  const guesserName = game.players.get(socketId)?.name ?? '';

  if (correct) {
    round.answered = true;
    round.correctGuesserName = guesserName;
    const player = game.players.get(socketId)!;
    const points = calcPoints(round.lowestBid, round.song.rank);
    player.score += points;
    player.streak += 1;
    round.scoredSocketIds.add(socketId);
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

function applyRaceCorrectGuess(game: Game, round: Round, socketId: string, elapsedMs: number): number {
  const isFirst = round.firstCorrectAt === null;
  if (isFirst) round.firstCorrectAt = Date.now();
  round.correctGuessers.add(socketId);
  round.guessTimes.set(socketId, elapsedMs);
  if (!isFirst && game.raceWinnerOnly) return 0;
  const points = game.raceWinnerOnly
    ? calcRaceWinnerPoints(elapsedMs, game.raceTime, round.song.rank)
    : calcRacePoints(isFirst, elapsedMs, round.firstCorrectAt! - round.playStartAt!, round.song.rank);
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
): { correct: boolean; points: number; elapsedMs: number; allDone: boolean } | null {
  const round = game.currentRound;
  if (!round) return null;
  if (!game.players.has(socketId)) return null;
  if (game.phase !== 'guessing') return null;
  if (round.passed.has(socketId)) return null;
  if (game.raceWinnerOnly && round.firstCorrectAt !== null) return null;

  const elapsedMs = Date.now() - (round.playStartAt ?? Date.now());
  round.guesses.set(socketId, text);
  round.passed.add(socketId);
  const correct = game.artistOnly
    ? isCorrectArtistGuess(text, round.song.artist, round.song.featuredArtists)
    : isCorrectGuess(text, round.song.title);

  const points = correct ? applyRaceCorrectGuess(game, round, socketId, elapsedMs) : 0;

  const allDone = (game.raceWinnerOnly && correct)
    || Array.from(game.players.keys()).every(id => round.passed.has(id));
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

  round.guesses.set(socketId, null);
  round.passed.add(socketId);
  const allDone = Array.from(game.players.keys()).every(id => round.passed.has(id));
  return { allDone };
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
  if (game.mode === 'classic' && !round.guesserSocketIds.includes(socketId)) return;
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
