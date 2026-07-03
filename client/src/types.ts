export interface Hint {
  label: string;
  value: string;
  imageUrl?: string;
}

export interface LeaderboardEntry {
  rank: number;
  name: string;
  score: number;
}

export interface PlayerInfo {
  name: string;
  score?: number;
  streak?: number;
}

// Party mode: the per-round recipe as clients see it. A hidden mystery
// multiplier arrives as null and is revealed (a number) on round_result.
export interface PartyInfo {
  format: 'classic' | 'race' | 'year';
  target: 'title' | 'artist' | 'both';
  event: 'double' | 'mystery' | 'steal' | 'snippet' | 'fullhints' | null;
  multiplier: number | null;
  intro: { title: string; tagline: string };
  finale: boolean;
  duelists: string[];
}

export interface YearResult {
  name: string;
  guess: number | null;
  diff: number | null;
  points: number;
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
  correctGuessers?: string[];
  playerGuesses?: { name: string; guess: string | null; timeMs?: number | null; live?: boolean }[];
  party?: PartyInfo;
  yearResults?: YearResult[];
  stealPending?: string;
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
