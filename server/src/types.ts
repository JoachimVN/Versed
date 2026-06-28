export interface Song {
  rank: number;
  title: string;
  artist: string;
  year: number | null;
  decade: number | null;
  bbPeak: number | null;
  bbChartWeeks: number | null;
  spotifyStreams: number | null;
  spotifyTrackId: string;
  finalScore: number;
}

export interface Hint {
  label: string;
  value: string;
}

export interface Round {
  song: Song;
  hints: Hint[];
  bids: Map<string, number>;
  guesserSocketIds: string[];
  lowestBid: number;
  answered: boolean;
  guessAttempts: Set<string>;
}

export interface Player {
  socketId: string;
  name: string;
  score: number;
}

export type GamePhase =
  | 'lobby'
  | 'betting'
  | 'playing'
  | 'guessing'
  | 'reveal'
  | 'leaderboard'
  | 'finished';

export interface Game {
  pin: string;
  hostSocketId: string;
  players: Map<string, Player>;
  phase: GamePhase;
  roundIndex: number;
  totalRounds: number;
  currentRound: Round | null;
  usedSongIds: Set<string>;
  phaseTimer: ReturnType<typeof setTimeout> | null;
}
