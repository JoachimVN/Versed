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
// the closest answer wins; 'choice' also rides the race flow, but with 4
// title options shown instead of a text input — tapping one submits its
// exact text, so scoring is unchanged from a normal race guess.
export type PartyFormat = 'classic' | 'race' | 'year' | 'choice';
export type GuessTarget = 'title' | 'artist' | 'both';
export type PartyEvent =
  | 'double' | 'mystery' | 'steal' | 'snippet' | 'fullhints' | 'blind' | 'outro' | 'underdog';

// Chill/chaotic tune how often party events fire and how wild mystery's
// multiplier spread gets — see NO_EVENT_CHANCE/MYSTERY_MULTIPLIERS_BY_CHAOS
// in gameManager.ts. 'balanced' matches the original hardcoded tuning.
export type ChaosLevel = 'chill' | 'balanced' | 'chaotic';

export interface PartyConfig {
  format: PartyFormat;
  target: GuessTarget;              // what the guess is checked against (ignored for 'year')
  event: PartyEvent | null;
  multiplier: number;               // actual value — clients see null while a mystery is unrevealed
  winnerOnly: boolean;               // race/year only: just the winner scores, everyone else gets zero
  intro: { title: string; tagline: string };
  finale: boolean;                  // last round: top-2 duel, first correct wins
  duelistIds: string[];             // socketIds of the duelists (finale only)
  duelistNames: string[];
  // Generic "only these players may guess this round" restriction — distinct
  // from duelistIds/finale so the finale's flat duel payout never leaks onto
  // a restricted-but-not-finale round (e.g. 'underdog').
  restrictedIds: string[];
  restrictedNames: string[];
  choiceOptions?: string[];          // 'choice' format: shuffled title options (correct one included)
}

// What clients are allowed to see of a PartyConfig (no socketIds, mystery
// multiplier hidden until the reveal).
export interface PartyClientView {
  format: PartyFormat;
  target: GuessTarget;
  event: PartyEvent | null;
  multiplier: number | null;
  winnerOnly: boolean;
  intro: { title: string; tagline: string };
  finale: boolean;
  duelists: string[];
  restricted: string[];
  choiceOptions?: string[];
}

export interface YearResult {
  name: string;
  guess: number | null;             // null = no/invalid answer
  diff: number | null;
  points: number;
  pity: boolean;
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
  pityAwardedTo: Set<string>;       // players whose score this round included the catch-up pity bonus
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
  // Running, whole-game stats — never reset mid-game (unlike Round's
  // per-round-only tracking) — used to compute end-of-game awards.
  totalCorrect: number;
  totalPasses: number;
  fastestCorrectMs: number | null; // race-flow only; classic has no per-player timing
  biggestSwing: number;            // largest single-round point gain
}

// One end-of-game superlative. Ties share the award rather than picking one
// name arbitrarily.
export interface Award {
  key: 'sharpshooter' | 'speedDemon' | 'comebackKid' | 'duelChampion';
  playerNames: string[];
  detail: string;
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
  // name.toLowerCase() → saved state, restored on rejoin
  formerPlayers: Map<string, {
    score: number; streak: number;
    totalCorrect: number; totalPasses: number; fastestCorrectMs: number | null; biggestSwing: number;
  }>;
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
  enabledEvents: Set<PartyEvent>; // party mode: which events the host allows into the pool
  chaosLevel: ChaosLevel;         // party mode: event frequency + mystery-multiplier spread preset
  duelChampion: string | null;    // party mode: socketId of the finale duel's winner, once resolved
  songSource: SongSource;
  songPool?: Song[];
  playlistId?: string;
  currentRound: Round | null;
  usedSongIds: Set<string>;
  artistWindow: Song[]; // last few rounds' songs, most recent last — see artistWindowSize
  phaseTimer: ReturnType<typeof setTimeout> | null;
  phaseEndsAt: number | null; // epoch ms when the current countdown expires
}
