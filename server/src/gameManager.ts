import { Game, GameQuestion, Player, PlayerAnswer, QuizTrack } from './types';

const games = new Map<string, Game>();
const socketToPin = new Map<string, string>();

function generatePin(): string {
  let pin: string;
  do {
    pin = Math.floor(100000 + Math.random() * 900000).toString();
  } while (games.has(pin));
  return pin;
}

function pickRandom<T>(arr: T[], n: number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

function buildQuestions(tracks: QuizTrack[]): GameQuestion[] {
  const shuffled = pickRandom(tracks, tracks.length);
  return shuffled.map((track) => {
    const others = shuffled.filter((t) => t.uri !== track.uri);
    const wrong = pickRandom(others, 3).map((t) => t.name);
    const allAnswers = [track.name, ...wrong].sort(() => Math.random() - 0.5);
    return {
      trackUri: track.uri,
      trackName: track.name,
      artist: track.artist,
      albumArt: track.albumArt,
      startMs: 30000,
      playDurationMs: 20000,
      answers: allAnswers,
      correctIndex: allAnswers.indexOf(track.name),
      timeLimit: 20,
    };
  });
}

export function createGame(hostSocketId: string, tracks: QuizTrack[]): Game {
  const pin = generatePin();
  const game: Game = {
    pin,
    hostSocketId,
    questions: buildQuestions(tracks),
    players: new Map(),
    phase: 'lobby',
    currentQuestion: 0,
    questionStartTime: 0,
    answers: new Map(),
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
  const nameTaken = Array.from(game.players.values()).some(
    (p) => p.name.toLowerCase() === name.trim().toLowerCase()
  );
  if (nameTaken) return null;

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

export function recordAnswer(
  game: Game,
  socketId: string,
  answerIndex: number
): PlayerAnswer | null {
  if (game.phase !== 'question') return null;
  if (game.answers.has(socketId)) return null;

  const player = game.players.get(socketId);
  if (!player) return null;

  const question = game.questions[game.currentQuestion];
  const elapsed = Date.now() - game.questionStartTime;
  const timeLimitMs = question.timeLimit * 1000;
  const isCorrect = answerIndex === question.correctIndex;

  let points = 0;
  if (isCorrect) {
    const speedRatio = Math.max(0, 1 - elapsed / timeLimitMs);
    points = Math.round(500 + 500 * speedRatio);
    player.score += points;
  }

  const answer: PlayerAnswer = {
    answerIndex,
    isCorrect,
    points,
    answeredAt: Date.now(),
  };
  game.answers.set(socketId, answer);
  return answer;
}

export function getLeaderboard(game: Game) {
  return Array.from(game.players.values())
    .sort((a, b) => b.score - a.score)
    .map((p, i) => ({ rank: i + 1, name: p.name, score: p.score }));
}

export function cleanupGame(pin: string) {
  const game = games.get(pin);
  if (!game) return;
  for (const socketId of game.players.keys()) socketToPin.delete(socketId);
  socketToPin.delete(game.hostSocketId);
  games.delete(pin);
}
