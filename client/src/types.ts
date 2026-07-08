export interface Hint {
  label: string;
  value: string;
  imageUrl?: string;
}

export type SongSource = 'library' | 'playlist';

export interface PlaylistTrackInput {
  spotifyTrackId: string;
  title: string;
  artist: string;
  featuredArtists?: string;
  durationMs: number | null;
  year: number | null;
  albumArtUrl: string | null;
}

export interface LeaderboardEntry {
  rank: number;
  name: string;
  score: number;
}

// End-of-game superlative — mirrors server/src/types.ts's Award.
export interface Award {
  key: 'sharpshooter' | 'speedDemon' | 'comebackKid' | 'duelChampion';
  playerNames: string[];
  detail: string;
}

export interface PlayerInfo {
  name: string;
  score?: number;
  streak?: number;
  pity?: boolean;
}

// Mirrors server/src/types.ts's PartyEvent — kept in sync by hand, no shared
// import between the two workspaces.
export type PartyEvent = 'double' | 'mystery' | 'steal' | 'snippet' | 'fullhints' | 'blind' | 'outro' | 'underdog' | 'chaoshints';
export type ChaosLevel = 'chill' | 'balanced' | 'chaotic';

// Party mode: the per-round recipe as clients see it. A hidden mystery
// multiplier arrives as null and is revealed (a number) on round_result.
export interface PartyInfo {
  format: 'classic' | 'race' | 'year' | 'choice';
  target: 'title' | 'artist' | 'both';
  event: PartyEvent | null;
  multiplier: number | null;
  winnerOnly: boolean;
  intro: { title: string; tagline: string };
  finale: boolean;
  duelists: string[];
  restricted: string[];
  choiceOptions?: string[];
  // Finale only: best-of-3 duel progress ("Game N of 3 · Alice 1 – 0 Bob").
  duelProgress?: { subRoundIndex: number; wins: { name: string; count: number }[] };
}

export interface YearResult {
  name: string;
  guess: number | null;
  diff: number | null;
  points: number;
  pity: boolean;
}

export interface RoundResultEvent {
  correct: boolean;
  guesserName: string | null;
  songTitle: string;
  artist: string;
  featuredArtists?: string;
  year?: number | null;
  coverUrl?: string;
  points: number;
  mode?: 'classic' | 'race';
  artistOnly?: boolean;
  yearOnly?: boolean;
  correctGuessers?: string[];
  playerGuesses?: { name: string; guess: string | null; timeMs?: number | null; live?: boolean }[];
  party?: PartyInfo;
  yearResults?: YearResult[];
  stealPending?: string;
  chaosFakeIndex?: number; // 'chaoshints' rounds: which hint (in `hints` sent at round_start) was fabricated
}

declare global {
  interface Window {
    Spotify: {
      Player: new (options: {
        name: string;
        getOAuthToken: (cb: (token: string) => void) => void;
        volume?: number;
      }) => SpotifyPlayer;
    };
    onSpotifyWebPlaybackSDKReady: () => void;
  }
}

export interface SpotifyPlayer {
  connect: () => Promise<boolean>;
  disconnect: () => void;
  addListener: (event: string, cb: (data: any) => void) => void;
  removeListener: (event: string) => void;
  resume: () => Promise<void>;
  pause: () => Promise<void>;
  seek: (positionMs: number) => Promise<void>;
  setVolume: (volume: number) => Promise<void>;
  getCurrentState: () => Promise<{ paused: boolean; position: number } | null>;
  activateElement: () => void;
}
