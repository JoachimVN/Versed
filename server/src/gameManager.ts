import { Game, Hint, Player, Round, Song } from './types';
import { loadSongs } from './songLoader';
import { isCorrectGuess } from './fuzzyMatch';

export const BID_OPTIONS = [0.1, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 7, 10, 15, 20, 30, 45, 60];
export const BETTING_TIME = 15;
export const GUESSING_TIME = 15;
export const TOTAL_ROUNDS = 10;

let songs: Song[] = [];
const games = new Map<string, Game>();
const socketToPin = new Map<string, string>();

export function initSongs() {
  songs = loadSongs();
  console.log(`Loaded ${songs.length} playable songs`);
}

function generatePin(): string {
  let pin: string;
  do { pin = Math.floor(100 + Math.random() * 900).toString(); }
  while (games.has(pin));
  return pin;
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffle<T>(arr: T[]): T[] {
  const c = [...arr];
  for (let i = c.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [c[i], c[j]] = [c[j], c[i]];
  }
  return c;
}

function getInitials(artist: string): string {
  const main = artist.split(/\s+(?:featuring|feat\.|ft\.|x\s)/i)[0].trim();
  return main.split(/\s+/).map(w => (w[0] ?? '').toUpperCase()).join('.') + '.';
}

function formatStreams(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  return `${(n / 1_000_000).toFixed(0)}M`;
}

function generateHints(song: Song): Hint[] {
  const pool: Hint[] = [];
  if (song.decade) pool.push({ label: 'Era', value: `${song.decade}s` });
  if (song.year) pool.push({ label: 'Release year', value: String(Math.floor(song.year)) });
  if (song.bbChartWeeks && song.bbChartWeeks > 0)
    pool.push({ label: 'Billboard weeks', value: `${Math.floor(song.bbChartWeeks)} weeks` });
  if (song.bbPeak)
    pool.push({ label: 'Chart peak', value: `#${Math.floor(song.bbPeak)}` });
  if (song.spotifyStreams)
    pool.push({ label: 'Streams', value: formatStreams(song.spotifyStreams) });
  pool.push({ label: 'Artist initials', value: getInitials(song.artist) });

  const count = Math.floor(Math.random() * 4); // 0–3
  return shuffle(pool).slice(0, count);
}

export function calcPoints(bid: number, rank: number): number {
  const bidScore = Math.round(1000 * Math.max(0, 1 - bid / 60));
  const diffScore = Math.round(500 * Math.max(0, 1 - (rank - 1) / Math.max(songs.length - 1, 1)));
  return 500 + bidScore + diffScore;
}

function buildRound(usedSongIds: Set<string>): Round {
  const pool = songs.filter(s => !usedSongIds.has(s.spotifyTrackId));
  const song = pool.length > 0 ? pickRandom(pool) : pickRandom(songs);
  return {
    song,
    hints: generateHints(song),
    bids: new Map(),
    guesserSocketIds: [],
    lowestBid: 0,
    answered: false,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function createGame(hostSocketId: string): Game {
  const pin = generatePin();
  const game: Game = {
    pin,
    hostSocketId,
    players: new Map(),
    phase: 'lobby',
    roundIndex: 0,
    totalRounds: TOTAL_ROUNDS,
    currentRound: null,
    usedSongIds: new Set(),
    phaseTimer: null,
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
  const taken = Array.from(game.players.values()).some(
    p => p.name.toLowerCase() === name.trim().toLowerCase()
  );
  if (taken) return null;
  const player: Player = { socketId, name: name.trim(), score: 0 };
  game.players.set(socketId, player);
  socketToPin.set(socketId, game.pin);
  return player;
}

export function removeSocket(socketId: string): { game: Game; wasHost: boolean } | null {
  const game = getGameBySocket(socketId);
  if (!game) return null;
  socketToPin.delete(socketId);
  const wasHost = game.hostSocketId === socketId;
  if (!wasHost) game.players.delete(socketId);
  return { game, wasHost };
}

export function startRound(game: Game): Round {
  if (game.phaseTimer) clearTimeout(game.phaseTimer);
  const round = buildRound(game.usedSongIds);
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

export function closeBetting(game: Game): {
  lowestBid: number;
  guesserSocketIds: string[];
  guesserNames: string[];
} | null {
  const round = game.currentRound;
  if (!round || game.phase !== 'betting') return null;
  if (round.bids.size === 0) return null;

  const minBid = Math.min(...round.bids.values());
  const guesserIds = Array.from(round.bids.entries())
    .filter(([, bid]) => bid === minBid)
    .map(([id]) => id);

  round.lowestBid = minBid;
  round.guesserSocketIds = guesserIds;
  game.phase = 'playing';

  const guesserNames = guesserIds
    .map(id => game.players.get(id)?.name ?? '')
    .filter(Boolean);

  return { lowestBid: minBid, guesserSocketIds: guesserIds, guesserNames };
}

export function recordGuess(
  game: Game,
  socketId: string,
  text: string
): { correct: boolean; points: number; guesserName: string } | null {
  const round = game.currentRound;
  if (!round || game.phase !== 'guessing') return null;
  if (!round.guesserSocketIds.includes(socketId)) return null;
  if (round.answered) return null;

  const correct = isCorrectGuess(text, round.song.title);
  const guesserName = game.players.get(socketId)?.name ?? '';

  if (correct) {
    round.answered = true;
    const player = game.players.get(socketId)!;
    const points = calcPoints(round.lowestBid, round.song.rank);
    player.score += points;
    game.phase = 'reveal';
    return { correct: true, points, guesserName };
  }

  return { correct: false, points: 0, guesserName };
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
