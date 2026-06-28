import { useState, useEffect, useRef } from 'react';
import { BACKEND_URL } from '../config';

let sdkLoaded = false;

export function useSpotify() {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [playerReady, setPlayerReady] = useState(false);
  const playerRef = useRef<import('../types').SpotifyPlayer | null>(null);
  const deviceIdRef = useRef<string | null>(null);
  const accessTokenRef = useRef<string | null>(null);
  // 'idle'      → nothing scheduled
  // 'preparing' → track buffering, muted, not yet revealed to listeners
  // 'playing'   → audible; auto-resume if Spotify pauses unexpectedly
  // 'stopping'  → must stay paused; re-pause if it slips back into playing
  const playStateRef = useRef<'idle' | 'preparing' | 'playing' | 'stopping'>('idle');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const at = params.get('access_token');
    const rt = params.get('refresh_token');
    if (at) {
      accessTokenRef.current = at;
      setAccessToken(at);
      setRefreshToken(rt);
      sessionStorage.setItem('spotify_at', at);
      if (rt) sessionStorage.setItem('spotify_rt', rt);
      window.history.replaceState({}, '', window.location.pathname);
    } else {
      const stored = sessionStorage.getItem('spotify_at');
      const storedRt = sessionStorage.getItem('spotify_rt');
      if (stored) { accessTokenRef.current = stored; setAccessToken(stored); }
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
          accessTokenRef.current = data.access_token;
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
        getOAuthToken: (cb) => cb(accessTokenRef.current ?? ''),
        volume: 0.8,
      });
      player.addListener('ready', ({ device_id }: { device_id: string }) => {
        deviceIdRef.current = device_id;
        setDeviceId(device_id);
        setPlayerReady(true);
      });
      player.addListener('not_ready', () => setPlayerReady(false));
      // Keep playback in sync with intent. The SDK can spontaneously pause
      // (buffering) or a queued play command can land late; self-heal both ways.
      player.addListener('player_state_changed', (state: any) => {
        if (!state) return;
        const phase = playStateRef.current;
        if (phase === 'playing' && state.paused) {
          playerRef.current?.resume();
        } else if (phase === 'stopping' && !state.paused) {
          playerRef.current?.pause();
        }
      });
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

  function activatePlayer() {
    playerRef.current?.activateElement();
  }

  // Buffer the track ahead of time, muted, so the actual start is instant and
  // gapless. Returns true once Spotify accepted the play request.
  async function prepareTrack(trackId: string) {
    const token = accessTokenRef.current;
    const device = deviceIdRef.current;
    if (!device || !token) {
      console.error('[Spotify] prepareTrack called but not ready', { device, hasToken: !!token });
      return false;
    }
    playStateRef.current = 'preparing';
    await playerRef.current?.setVolume(0);
    const res = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${device}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ uris: [`spotify:track:${trackId}`], position_ms: 0 }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`[Spotify] prepare failed ${res.status}:`, body);
      playStateRef.current = 'idle';
      return false;
    }
    return true;
  }

  // Reveal the buffered track: rewind to 0, unmute, and ensure it's playing.
  async function startPrepared() {
    playStateRef.current = 'playing';
    await playerRef.current?.seek(0);
    await playerRef.current?.setVolume(0.8);
    await playerRef.current?.resume();
  }

  async function pauseTrack() {
    playStateRef.current = 'stopping';
    await playerRef.current?.pause();
  }

  return { isConnected: !!accessToken, playerReady, prepareTrack, startPrepared, pauseTrack, activatePlayer };
}
