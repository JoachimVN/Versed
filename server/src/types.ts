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
  blurred?: boolean; // image hints only: true = teaser (stays blurred through guessing), unset/false = shown clear
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
// title/artist/year options shown instead of a text input — tapping one
// submits its exact text, so scoring is unchanged from a normal race guess.
export type PartyFormat = 'classic' | 'race' | 'year' | 'choice';
export type GuessTarget = 'title' | 'artist' | 'both';
export type PartyTarget = GuessTarget | 'year';
export type PartyEvent =
  | 'double' | 'mystery' | 'steal' | 'snippet' | 'fullhints' | 'blind' | 'outro' | 'underdog' | 'chaoshints';

// Host-togglable Party round-variant ingredients — 'classic'/'race' gate
// those baseline PartyFormats, 'choice' gates the 'choice' PartyFormat,
// 'year' gates the 'year' PartyFormat, 'artist'/'both' gate those
// GuessTarget pool entries, and 'winnerOnly' gates the winner-only roll.
// Distinct from PartyEvent, which only covers modifiers (Mystery, Steal,
// Snippet, ...) layered on top of whatever round type gets picked.
export type PartyRoundType = 'classic' | 'race' | 'choice' | 'artist' | 'both' | 'year' | 'winnerOnly';

export interface PartyConfig {
  format: PartyFormat;
  target: PartyTarget;              // what the guess is checked against ('year' only for choice/year formats)
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
  choiceOptions?: string[];          // 'choice' format: shuffled title/artist/year options (correct one included)
}

// What clients are allowed to see of a PartyConfig (no socketIds, mystery
// multiplier hidden until the reveal).
export interface PartyClientView {
  format: PartyFormat;
  target: PartyTarget;
  event: PartyEvent | null;
  multiplier: number | null;
  winnerOnly: boolean;
  intro: { title: string; tagline: string };
  finale: boolean;
  duelists: string[];
  restricted: string[];
  choiceOptions?: string[];
  // Finale only: best-of-3 duel progress, so both screens can show
  // "Game N of 3 · Alice 1 – 0 Bob" instead of just "The Finale".
  duelProgress?: { subRoundIndex: number; wins: { name: string; count: number }[] };
}

export interface YearResult {
  name: string;
  guess: number | null;             // null = no/invalid answer
  diff: number | null;
  points: number;
  pity: boolean;
  pityAmount?: number;              // set alongside pity: true — the flat catch-up amount, so the UI can break it out of `points`
  breakdown?: PointsBreakdown;      // same total as `points`, itemized — undefined when points is 0
}

// One named component of a scoring payout (e.g. "Bid bonus", "Difficulty",
// "Title + artist bonus") — pre-multiplier, so the client can show players
// exactly where their points came from instead of a single opaque total.
export interface PointsBreakdownPart {
  label: string;
  amount: number;
}

// Full itemization of a single scoring payout. `parts` sum to the
// pre-multiplier subtotal; `multiplierBonus` is what the event multiplier
// (double/mystery/underdog) added on top of that subtotal, and `pity` is
// added after the multiplier (it's a flat catch-up, not scaled by it).
// `total` always equals round(sum(parts) * multiplier) + pity, matching the
// `points` value awarded alongside it — never recomputed independently on
// the client, just displayed.
export interface PointsBreakdown {
  parts: PointsBreakdownPart[];
  multiplier: number;
  multiplierBonus: number;
  pity: number;
  total: number;
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
  // What this round's guess is checked against — resolved once (in
  // buildRound) for every round, party or not. The single source of truth
  // for effectiveTarget(), so reconnects/scoring/hints all agree on one
  // value for the round's whole lifetime instead of re-deriving it.
  target: GuessTarget | 'year';
  // Classic/Race Multiple Choice only — shuffled options for `target`
  // (titles/artists/years), correct one included. Party rounds keep using
  // party.choiceOptions instead; this field stays undefined for those.
  choiceOptions?: string[];
  // Party-mode fields
  party?: PartyConfig;
  snippetMs?: number;               // 'snippet' event: playback starts here instead of 0
  stealBy?: string;                 // socketId of the round winner allowed to steal
  stealDone?: boolean;
  yearResults?: YearResult[];       // 'year' rounds: filled at round end
  // 'chaoshints' event: `hints` above IS the ~4-hint set shown (one
  // fabricated) — reuses the existing hints transport rather than a
  // parallel payload. chaosFakeIndex says which index is the lie, hidden
  // from clients until reveal.
  chaosFakeIndex?: number;
  chaosTapped: Map<string, number>; // socketId → tapped hint index ('chaoshints' rounds only)
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
  artistGuesses: Map<string, string>; // socketId → artist text submitted (only when target === 'both')
  liveArtistDrafts: Map<string, string>; // socketId → artist text currently typed, not yet submitted
  correctGuesserName?: string;      // classic mode: name of the player who got it right
  scoredSocketIds: Set<string>;     // players who earned points this round — everyone else's streak resets when the round ends
  pityAwardedTo: Set<string>;       // players whose score this round included the catch-up pity bonus
  pointsBreakdown: Map<string, PointsBreakdown>; // socketId → itemization of the points they earned this round
  // Race-mode fields
  playStartAt: number | null;      // epoch ms when audio started
  firstCorrectAt: number | null;   // epoch ms of first correct guess (decay origin)
  correctGuessers: Set<string>;    // socketIds who guessed correctly in Race
  guessTimes: Map<string, number>; // socketId → ms from playStartAt to correct guess
  // Classic-mode field. Race's counterpart to playStartAt: epoch ms when the
  // *current tier's* clip actually started playing, reset to null at the top
  // of every tier (applyTier) so a later tier never inherits an earlier
  // tier's timestamp.
  tierStartAt: number | null;
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
  fastestCorrectMs: number | null; // race-flow (+ chaos hints) only
  fastestClassicMs: number | null; // classic bid/tier flow only — separate scale, not comparable to fastestCorrectMs
  fastestCorrectMoment: AwardMoment | null;
  fastestClassicMoment: AwardMoment | null;
  biggestSwing: number;            // largest single-round point gain
}

// The exact round behind a speed award. It is retained by the authoritative
// game state so the finished screen never has to guess from stale round data.
export interface AwardMoment {
  playerName: string;
  guess: string;
  songTitle: string;
  artist: string;
  coverUrl?: string;
  timeMs: number;
}

// One end-of-game superlative. Ties share the award rather than picking one
// name arbitrarily.
export interface Award {
  key: 'mostCorrect' | 'fastestGuess' | 'fastestClassicGuess' | 'biggestSwing' | 'finaleWinner';
  playerNames: string[];
  detail: string;
  highlights?: AwardMoment[];
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
    totalCorrect: number; totalPasses: number; fastestCorrectMs: number | null; fastestClassicMs: number | null;
    fastestCorrectMoment: AwardMoment | null; fastestClassicMoment: AwardMoment | null; biggestSwing: number;
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
  multipleChoice: boolean;       // classic/race only — party has its own 'choice' round type instead
  difficulty: Difficulty;
  enabledEvents: Set<PartyEvent>; // party mode: which events the host allows into the pool
  enabledRoundTypes: Set<PartyRoundType>; // party mode: which round-type variants the host allows into the pool
  chaosLevel: number;             // 0-100 chaos scale: event frequency + mystery-multiplier spread preset
  finaleEnabled: boolean;         // party mode: whether the last round becomes a top-2 duel; off by default
  duelChampion: string | null;    // party mode: socketId of the finale duel's winner, once resolved
  // Finale best-of-3 duel state — lives on Game (not Round) since it must
  // survive each sub-round's fresh Round object.
  duelActive: boolean;
  duelDuelistIds: string[];         // fixed for the whole best-of-3 once triggered
  duelWins: Record<string, number>; // socketId -> sub-round wins so far (0, 1, or 2)
  duelSubRoundIndex: number;        // 0=classic, 1=race, 2+=year (replayed on tie)
  songSource: SongSource;
  songPool?: Song[];
  playlistId?: string;
  currentRound: Round | null;
  usedSongIds: Set<string>;
  artistWindow: Song[]; // last few rounds' songs, most recent last — see artistWindowSize
  phaseTimer: ReturnType<typeof setTimeout> | null;
  phaseEndsAt: number | null; // epoch ms when the current countdown expires
}
