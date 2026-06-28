import { useState, useEffect, useRef } from 'react';
import { SpotifySearchTrack, QuizTrack } from '../types';
import { BACKEND_URL } from '../config';

let sdkLoaded = false;

export function useSpotify() {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [playerReady, setPlayerReady] = useState(false);
  const playerRef = useRef<import('../types').SpotifyPlayer | null>(null);

  // Read token from URL params or sessionStorage on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const atFromUrl = params.get('access_token');
    const rtFromUrl = params.get('refresh_token');

    if (atFromUrl) {
      setAccessToken(atFromUrl);
      setRefreshToken(rtFromUrl);
      sessionStorage.setItem('spotify_at', atFromUrl);
      if (rtFromUrl) sessionStorage.setItem('spotify_rt', rtFromUrl);
      window.history.replaceState({}, '', '/host');
    } else {
      const stored = sessionStorage.getItem('spotify_at');
      const storedRt = sessionStorage.getItem('spotify_rt');
      if (stored) setAccessToken(stored);
      if (storedRt) setRefreshToken(storedRt);
    }
  }, []);

  // Schedule token refresh every 50 minutes
  useEffect(() => {
    if (!refreshToken) return;
    const id = setInterval(async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: refreshToken }),
        });
        const data = await res.json() as { access_token?: string };
        if (data.access_token) {
          setAccessToken(data.access_token);
          sessionStorage.setItem('spotify_at', data.access_token);
        }
      } catch {
        // silently fail; next refresh will retry
      }
    }, 50 * 60 * 1000);
    return () => clearInterval(id);
  }, [refreshToken]);

  // Initialize Spotify Web Playback SDK
  useEffect(() => {
    if (!accessToken) return;
    if (sdkLoaded && playerRef.current) return;

    const initPlayer = () => {
      const player = new window.Spotify.Player({
        name: 'Versed',
        getOAuthToken: (cb) => cb(accessToken),
        volume: 0.8,
      });

      player.addListener('ready', ({ device_id }) => {
        setDeviceId(device_id);
        setPlayerReady(true);
      });

      player.addListener('not_ready', () => setPlayerReady(false));

      player.connect();
      playerRef.current = player;
    };

    if (window.Spotify) {
      initPlayer();
    } else {
      window.onSpotifyWebPlaybackSDKReady = initPlayer;
      if (!sdkLoaded) {
        sdkLoaded = true;
        const script = document.createElement('script');
        script.src = 'https://sdk.scdn.co/spotify-player.js';
        document.body.appendChild(script);
      }
    }
  }, [accessToken]);

  async function searchTracks(query: string): Promise<QuizTrack[]> {
    if (!accessToken) return [];
    const res = await fetch(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=10`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const data = await res.json() as { tracks?: { items: SpotifySearchTrack[] } };
    return (data.tracks?.items ?? []).map((t) => ({
      uri: t.uri,
      name: t.name,
      artist: t.artists.map((a) => a.name).join(', '),
      albumArt: t.album.images[1]?.url ?? t.album.images[0]?.url ?? '',
    }));
  }

  async function playTrack(trackUri: string, positionMs = 0) {
    if (!deviceId || !accessToken) return;
    await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ uris: [trackUri], position_ms: positionMs }),
    });
  }

  async function pauseTrack() {
    if (!accessToken) return;
    await fetch('https://api.spotify.com/v1/me/player/pause', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  }

  return {
    isConnected: !!accessToken,
    playerReady,
    searchTracks,
    playTrack,
    pauseTrack,
  };
}
