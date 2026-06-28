export interface Hint {
  label: string;
  value: string;
}

export interface LeaderboardEntry {
  rank: number;
  name: string;
  score: number;
}

export interface PlayerInfo {
  name: string;
  score?: number;
}

export interface RoundResultEvent {
  correct: boolean;
  guesserName: string | null;
  songTitle: string;
  artist: string;
  points: number;
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
  addListener: (event: string, cb: (data: { device_id: string }) => void) => void;
  removeListener: (event: string) => void;
}
