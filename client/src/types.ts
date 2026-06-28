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

export interface RoundResultEvent {
  correct: boolean;
  guesserName: string | null;
  songTitle: string;
  artist: string;
  points: number;
  playerGuesses?: { name: string; guess: string | null }[];
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
