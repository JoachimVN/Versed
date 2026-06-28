import { useState, useEffect, useRef } from 'react';
import { BACKEND_URL } from '../config';

let sdkLoaded = false;

export function useSpotify() {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [playerReady, setPlayerReady] = useState(false);
  const playerRef = useRef<import('../types').SpotifyPlayer | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const at = params.get('access_token');
    const rt = params.get('refresh_token');
    if (at) {
      setAccessToken(at);
      setRefreshToken(rt);
      sessionStorage.setItem('spotify_at', at);
      if (rt) sessionStorage.setItem('spotify_rt', rt);
      window.history.replaceState({}, '', window.location.pathname);
    } else {
      const stored = sessionStorage.getItem('spotify_at');
      const storedRt = sessionStorage.getItem('spotify_rt');
      if (stored) setAccessToken(stored);
      if (storedRt) setRefreshToken(storedRt);
    }
  }, []);

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
      } catch { /* silently retry next interval */ }
    }, 50 * 60 * 1000);
    return () => clearInterval(id);
  }, [refreshToken]);

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

  async function playTrack(trackId: string, positionMs = 0) {
    if (!deviceId || !accessToken) {
      console.error('[Spotify] playTrack called but not ready', { deviceId, hasToken: !!accessToken });
      return;
    }
    const res = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        uris: [`spotify:track:${trackId}`],
        position_ms: positionMs,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`[Spotify] play failed ${res.status}:`, body);
    }
  }

  async function pauseTrack() {
    if (!accessToken) return;
    const res = await fetch('https://api.spotify.com/v1/me/player/pause', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok && res.status !== 204) {
      console.error(`[Spotify] pause failed ${res.status}`);
    }
  }

  return { isConnected: !!accessToken, playerReady, playTrack, pauseTrack };
}
