import { useState, useEffect, useRef } from 'react';
import { BACKEND_URL } from '../config';

let sdkLoaded = false;

// Spotify OAuth tokens are base64url-ish strings. Reject anything that doesn't
// match before it touches sessionStorage, since both URL params and the
// refresh-token API response are attacker-influenceable (tainted) input.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{10,512}$/;
function sanitizeToken(value: string | null | undefined): string | null {
  return value && TOKEN_PATTERN.test(value) ? value : null;
}

export function useSpotify() {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [playerReady, setPlayerReady] = useState(false);
  const playerRef = useRef<import('../types').SpotifyPlayer | null>(null);
  const deviceIdRef = useRef<string | null>(null);
  const accessTokenRef = useRef<string | null>(null);
  // 'idle'      → nothing scheduled
  // 'preparing' → track buffering, muted, not yet revealed to listeners
  // 'playing'   → audible; auto-resume if Spotify pauses unexpectedly
  // 'stopping'  → must stay paused; re-pause if it slips back into playing
  const playStateRef = useRef<'idle' | 'preparing' | 'playing' | 'stopping'>('idle');
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Incremented by prepareTrack and pauseTrack; startPrepared bails if it
  // changes mid-flight, preventing orphaned stop timers and stale resumes.
  const playGenRef = useRef(0);

  useEffect(() => {
    const params = new URLSearchParams(globalThis.location.search);
    const at = sanitizeToken(params.get('access_token'));
    const rt = sanitizeToken(params.get('refresh_token'));
    if (at) {
      accessTokenRef.current = at;
      setAccessToken(at);
      setRefreshToken(rt);
      sessionStorage.setItem('spotify_at', at);
      if (rt) sessionStorage.setItem('spotify_rt', rt);
      globalThis.history.replaceState({}, '', globalThis.location.pathname);
    } else {
      const stored = sanitizeToken(sessionStorage.getItem('spotify_at'));
      const storedRt = sanitizeToken(sessionStorage.getItem('spotify_rt'));
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
        const newAt = sanitizeToken(data.access_token);
        if (newAt) {
          accessTokenRef.current = newAt;
          setAccessToken(newAt);
          sessionStorage.setItem('spotify_at', newAt);
        }
      } catch { /* silently retry next interval */ }
    }, 50 * 60 * 1000);
    return () => clearInterval(id);
  }, [refreshToken]);

  useEffect(() => {
    if (!accessToken) return;
    if (sdkLoaded && playerRef.current) return;

    const initPlayer = () => {
      const g = globalThis as Window & typeof globalThis;
      const player = new g.Spotify.Player({
        name: 'Versed',
        getOAuthToken: (cb) => cb(accessTokenRef.current ?? ''),
        volume: 0.8,
      });
      player.addListener('ready', ({ device_id }: { device_id: string }) => {
        deviceIdRef.current = device_id;
        setPlayerReady(true);
      });
      player.addListener('not_ready', () => setPlayerReady(false));
      // Keep playback in sync with intent. The SDK can spontaneously pause
      // (buffering) or a queued play command can land late; self-heal both ways.
      player.addListener('player_state_changed', (state: any) => {
        if (!state) return;
        const phase = playStateRef.current;
        if (phase === 'playing' && state.paused) {
          // Don't auto-resume if the track reached its natural end — that would
          // loop the song indefinitely. Only heal genuine buffering pauses.
          const duration = state.track_window?.current_track?.duration_ms;
          const atEnd = duration && state.position >= duration - 500;
          if (!atEnd) playerRef.current?.resume();
        } else if (phase === 'stopping' && !state.paused) {
          playerRef.current?.pause();
        }
      });
      player.connect();
      playerRef.current = player;
    };

    const g = globalThis as Window & typeof globalThis;
    if (g.Spotify) {
      initPlayer();
    } else {
      g.onSpotifyWebPlaybackSDKReady = initPlayer;
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

  function clearStopTimer() {
    if (stopTimerRef.current) { clearTimeout(stopTimerRef.current); stopTimerRef.current = null; }
  }

  // Resolve once audio is genuinely playing from near the start, so the play
  // window is timed from the audible start rather than the resume() call
  // (which precedes real output by 100-300ms of device/SDK latency).
  function waitForPlaybackStart(): Promise<void> {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearInterval(poll);
        clearTimeout(safety);
        resolve();
      };
      const poll = setInterval(async () => {
        const st = await playerRef.current?.getCurrentState();
        // >40ms: past the very start, so audio is really flowing.
        // <1500ms: not the stale position left over from buffering.
        if (st && !st.paused && st.position > 40 && st.position < 1500) finish();
      }, 20);
      const safety = setTimeout(finish, 2500);
    });
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
    clearStopTimer();
    playGenRef.current += 1;
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

  // Reveal the buffered track from the start and play it for exactly
  // durationMs of audible output. Resolves when audio actually begins, so the
  // caller can sync the on-screen timer to the real start.
  // Returns true if playback actually started; false if aborted (caller should
  // not emit song_started or start client-side timers in the false case).
  async function startPrepared(durationMs: number): Promise<boolean> {
    // Only start from a successful prepare. 'stopping' means pauseTrack() ran
    // during the countdown (round already over); 'idle' means prepareTrack
    // failed — resuming then would replay whatever track is still loaded from
    // the previous round.
    if (playStateRef.current !== 'preparing') return false;
    clearStopTimer();
    const gen = playGenRef.current;
    playStateRef.current = 'playing';
    await playerRef.current?.seek(0);
    await playerRef.current?.setVolume(0.8);
    await playerRef.current?.resume();
    await waitForPlaybackStart();
    // Another prepareTrack/pauseTrack started while we were waiting — don't
    // arm a stop timer that would fire at the wrong time.
    if (gen !== playGenRef.current) return false;
    stopTimerRef.current = setTimeout(() => { pauseTrack(); }, durationMs);
    return true;
  }

  async function pauseTrack() {
    clearStopTimer();
    playGenRef.current += 1; // invalidate any in-flight startPrepared
    playStateRef.current = 'stopping';
    await playerRef.current?.pause();
  }

  return { isConnected: !!accessToken, playerReady, prepareTrack, startPrepared, pauseTrack, activatePlayer };
}
