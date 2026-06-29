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
  imageUrl?: string;
}

// Bidders grouped by bid value. Tiers are played in ascending bid order: the
// lowest bidders guess first (on the least audio), and each failed tier hands
// off to the next-lowest, who hear their own — longer — bid's worth of audio.
export interface BidTier {
  bid: number;
  socketIds: string[];
}

export interface Round {
  song: Song;
  hints: Hint[];
  coverUrl?: string;
  bids: Map<string, number>;
  bidTiers: BidTier[];
  tierIndex: number;
  guesserSocketIds: string[];
  lowestBid: number;
  answered: boolean;
  passed: Set<string>; // guessers whose turn is over this tier (wrong guess or skip)
  earlyGuessers: Set<string>; // guessers who opted in before their listening time expired
  guesses: Map<string, string | null>; // socketId → text submitted (null = skipped)
  // Race-mode fields
  playStartAt: number | null;      // epoch ms when audio started
  firstCorrectAt: number | null;   // epoch ms of first correct guess (decay origin)
  correctGuessers: Set<string>;    // socketIds who guessed correctly in Race
  guessTimes: Map<string, number>; // socketId → ms from playStartAt to correct guess
}

export interface Player {
  socketId: string;
  name: string;
  score: number;
  streak: number;
}

export type GameMode = 'classic' | 'race';

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
  bettingTime: number;
  guessingTime: number;
  mode: GameMode;
  raceTime: number;
  raceWinnerOnly: boolean;
  currentRound: Round | null;
  usedSongIds: Set<string>;
  phaseTimer: ReturnType<typeof setTimeout> | null;
  phaseEndsAt: number | null; // epoch ms when the current countdown expires
}
