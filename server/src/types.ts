export interface QuizTrack {
  uri: string;
  name: string;
  artist: string;
  albumArt: string;
}

export interface GameQuestion {
  trackUri: string;
  trackName: string;
  artist: string;
  albumArt: string;
  startMs: number;
  playDurationMs: number;
  answers: string[];
  correctIndex: number;
  timeLimit: number;
}

export interface Player {
  socketId: string;
  name: string;
  score: number;
}

export interface PlayerAnswer {
  answerIndex: number;
  isCorrect: boolean;
  points: number;
  answeredAt: number;
}

export type GamePhase = 'lobby' | 'question' | 'reveal' | 'leaderboard' | 'finished';

export interface Game {
  pin: string;
  hostSocketId: string;
  questions: GameQuestion[];
  players: Map<string, Player>;
  phase: GamePhase;
  currentQuestion: number;
  questionStartTime: number;
  answers: Map<string, PlayerAnswer>;
}
