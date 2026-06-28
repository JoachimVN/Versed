export interface QuizTrack {
  uri: string;
  name: string;
  artist: string;
  albumArt: string;
}

export interface SpotifySearchTrack {
  uri: string;
  name: string;
  artists: { name: string }[];
  album: {
    name: string;
    images: { url: string; width: number; height: number }[];
  };
  duration_ms: number;
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

export interface LeaderboardEntry {
  rank: number;
  name: string;
  score: number;
}

export interface PlayerResult {
  name: string;
  answerIndex: number;
  isCorrect: boolean;
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
  getCurrentState: () => Promise<unknown>;
}
