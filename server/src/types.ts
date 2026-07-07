export interface Song {
  rank: number;
  title: string;
  artist: string;
  featuredArtists?: string;
  year: number | null;
  decade: number | null;
  bbPeak: number | null;
  bbChartWeeks: number | null;
  durationMs: number | null;
  tempo: number | null;
  spotifyStreams: number | null;
  youtubeViews: number | null;
  spotifyTrackId: string;
  finalScore: number;
  albumArtUrl: string | null;
}

export interface Hint {
  label: string;
  value: string;
  imageUrl?: string;
}

export type SongSource = 'library' | 'playlist';

// Raw shape sent from client -> server as part of start_game's settings
// payload once a host has picked a playlist. Client-supplied, so treated as
// untrusted and re-sanitized in customSongPool.ts before use.
export interface PlaylistTrackInput {
  spotifyTrackId: string;
  title: string;
  artist: string;
  featuredArtists?: string;
  durationMs: number | null;
  year: number | null;
  albumArtUrl: string | null;
}

// ─── Party mode ───────────────────────────────────────────────────────────────

// How a party round plays out. 'classic' and 'race' reuse those modes' whole
// flows; 'year' rides the race flow but everyone answers a release year and
// the closest answer wins.
export type PartyFormat = 'classic' | 'race' | 'year';
export type GuessTarget = 'title' | 'artist' | 'both';
export type PartyEvent = 'double' | 'mystery' | 'steal' | 'snippet' | 'fullhints' | 'blind' | 'outro';

export interface PartyConfig {
  format: PartyFormat;
  target: GuessTarget;              // what the guess is checked against (ignored for 'year')
  event: PartyEvent | null;
  multiplier: number;               // actual value — clients see null while a mystery is unrevealed
  intro: { title: string; tagline: string };
  finale: boolean;                  // last round: top-2 duel, first correct wins
  duelistIds: string[];             // socketIds of the duelists (finale only)
  duelistNames: string[];
}

// What clients are allowed to see of a PartyConfig (no socketIds, mystery
// multiplier hidden until the reveal).
export interface PartyClientView {
  format: PartyFormat;
  target: GuessTarget;
  event: PartyEvent | null;
  multiplier: number | null;
  intro: { title: string; tagline: string };
  finale: boolean;
  duelists: string[];
}

export interface YearResult {
  name: string;
  guess: number | null;             // null = no/invalid answer
  diff: number | null;
  points: number;
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
  // Party-mode fields
  party?: PartyConfig;
  snippetMs?: number;               // 'snippet' event: playback starts here instead of 0
  stealBy?: string;                 // socketId of the round winner allowed to steal
  stealDone?: boolean;
  yearResults?: YearResult[];       // 'year' rounds: filled at round end
  bids: Map<string, number>;
  bidTiers: BidTier[];
  tierIndex: number;
  guesserSocketIds: string[];
  lowestBid: number;
  answered: boolean;
  passed: Set<string>; // guessers whose turn is over this tier (wrong guess or skip)
  earlyGuessers: Set<string>; // guessers who opted in before their listening time expired
  guesses: Map<string, string | null>; // socketId → text submitted (null = skipped)
  liveDrafts: Map<string, string>; // socketId → text currently typed, not yet submitted
  correctGuesserName?: string;      // classic mode: name of the player who got it right
  scoredSocketIds: Set<string>;     // players who earned points this round — everyone else's streak resets when the round ends
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

export type GameMode = 'classic' | 'race' | 'party';

// What slice of the song pool is in play, ranked by popularity (song.rank).
// 'easy' draws only from the most well-known top 20%, 'hard' opens the whole list.
export type Difficulty = 'easy' | 'medium' | 'hard';

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
  formerPlayers: Map<string, { score: number; streak: number }>; // name.toLowerCase() → saved state
  phase: GamePhase;
  roundIndex: number;
  totalRounds: number;
  bettingTime: number;
  guessingTime: number;
  mode: GameMode;
  raceTime: number;
  raceWinnerOnly: boolean;
  artistOnly: boolean;
  yearOnly: boolean;
  difficulty: Difficulty;
  songSource: SongSource;
  songPool?: Song[];
  currentRound: Round | null;
  usedSongIds: Set<string>;
  phaseTimer: ReturnType<typeof setTimeout> | null;
  phaseEndsAt: number | null; // epoch ms when the current countdown expires
}
