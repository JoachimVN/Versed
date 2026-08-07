import { useState, useEffect, useRef } from 'react';
import { BACKEND_URL } from '../config';

let sdkLoaded = false;

// Spotify OAuth tokens are base64url-ish strings. Reject anything that doesn't
// match before it touches localStorage, since both URL params and the
// refresh-token API response are attacker-influenceable (tainted) input.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{10,512}$/;
export function sanitizeToken(value: string | null | undefined): string | null {
  return value && TOKEN_PATTERN.test(value) ? value : null;
}

function spotifyErrorMessage(data: unknown): string {
  if (data && typeof data === 'object' && 'message' in data && typeof data.message === 'string') {
    return data.message;
  }
  if (data instanceof Error && data.message) return data.message;
  return 'Spotify playback failed in this browser. Try reconnecting Spotify or using another browser.';
}

export function useSpotify() {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [playerReady, setPlayerReady] = useState(false);
  // Spotify apps in Development Mode let ANY account complete the OAuth login
  // itself, then silently 403 every API call for accounts the developer hasn't
  // allowlisted. So "unauthorized" can only be detected after the fact, by
  // probing the Web API once we have a token.
  const [unauthorized, setUnauthorized] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
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
  // Aborts a prepareTrack fetch that a newer prepareTrack/pauseTrack has
  // superseded — without this, rapid skips leave every stale PUT request
  // running to completion, flooding Spotify's API and tripping its rate limit.
  const prepareAbortRef = useRef<AbortController | null>(null);
  // Where the prepared track starts (party "snippet" rounds start mid-song);
  // startPrepared seeks here and playback detection is offset by it.
  const preparedPositionRef = useRef(0);
  // True when the access token was restored from localStorage: it may be
  // arbitrarily old (tokens live 1h), so refresh it right away instead of
  // waiting out the first 50-minute interval.
  const staleTokenRef = useRef(false);

  function reportPlaybackError(label: string, data: unknown) {
    const message = spotifyErrorMessage(data);
    console.error(`[Spotify] ${label}:`, data);
    setPlaybackError(message);
  }

  // Keep playback in sync with intent. The SDK can spontaneously pause
  // (buffering) or a queued play command can land late; self-heal both ways.
  function handlePlayerStateChanged(state: any) {
    if (!state) return;
    const phase = playStateRef.current;
    if (phase === 'playing' && state.paused) {
      // Don't auto-resume if the track reached its natural end — that would
      // loop the song indefinitely. Only heal genuine buffering pauses.
      const duration = state.track_window?.current_track?.duration_ms;
      const atEnd = duration && state.position >= duration - 500;
      if (!atEnd) playerRef.current?.resume().catch((err: unknown) => reportPlaybackError('resume failed', err));
    } else if (phase === 'stopping' && !state.paused) {
      playerRef.current?.pause().catch((err: unknown) => reportPlaybackError('pause failed', err));
    }
  }

  function initPlayer() {
    const g = globalThis as Window & typeof globalThis;
    const player = new g.Spotify.Player({
      name: 'Versed',
      getOAuthToken: (cb) => cb(accessTokenRef.current ?? ''),
      volume: 0.8,
    });
    player.addListener('ready', ({ device_id }: { device_id: string }) => {
      deviceIdRef.current = device_id;
      setPlayerReady(true);
      setPlaybackError(null);
    });
    // The device backing deviceIdRef just went offline (tab backgrounded,
    // network blip, playback moved elsewhere). Clear it so prepareTrack fails
    // fast with a clear "not ready" reason instead of silently PUTing to a
    // now-invalid device_id and failing the same confusing way every round
    // until the page is reloaded. The SDK re-fires 'ready' with a device_id
    // (often the same one) once it's back, which repopulates this normally.
    player.addListener('not_ready', () => {
      deviceIdRef.current = null;
      setPlayerReady(false);
    });
    player.addListener('initialization_error', (data: unknown) => reportPlaybackError('initialization_error', data));
    player.addListener('authentication_error', (data: unknown) => reportPlaybackError('authentication_error', data));
    player.addListener('account_error', (data: unknown) => reportPlaybackError('account_error', data));
    player.addListener('playback_error', (data: unknown) => reportPlaybackError('playback_error', data));
    player.addListener('autoplay_failed', (data: unknown) => reportPlaybackError('autoplay_failed', data));
    player.addListener('player_state_changed', handlePlayerStateChanged);
    player.connect()
      .then(connected => {
        if (!connected) reportPlaybackError('connect failed', new Error('Spotify player did not connect.'));
      })
      .catch(err => reportPlaybackError('connect failed', err));
    playerRef.current = player;
  }

  useEffect(() => {
    // Tokens arrive in the URL fragment (never sent to servers); the query
    // string is still checked as a fallback for older deployed servers.
    const hashParams = new URLSearchParams(globalThis.location.hash.slice(1));
    const searchParams = new URLSearchParams(globalThis.location.search);
    const at = sanitizeToken(hashParams.get('access_token') ?? searchParams.get('access_token'));
    const rt = sanitizeToken(hashParams.get('refresh_token') ?? searchParams.get('refresh_token'));
    if (at) {
      accessTokenRef.current = at;
      setAccessToken(at);
      setRefreshToken(rt);
      localStorage.setItem('spotify_at', at);
      if (rt) localStorage.setItem('spotify_rt', rt);
      globalThis.history.replaceState({}, '', globalThis.location.pathname);
    } else {
      const stored = sanitizeToken(localStorage.getItem('spotify_at'));
      const storedRt = sanitizeToken(localStorage.getItem('spotify_rt'));
      if (stored) {
        accessTokenRef.current = stored;
        setAccessToken(stored);
        staleTokenRef.current = true;
      }
      if (storedRt) setRefreshToken(storedRt);
    }
  }, []);

  useEffect(() => {
    if (!refreshToken) return;
    const refresh = async () => {
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
          localStorage.setItem('spotify_at', newAt);
        }
      } catch { /* silently retry next interval */ }
    };
    if (staleTokenRef.current) {
      staleTokenRef.current = false;
      refresh();
    }
    const id = setInterval(refresh, 50 * 60 * 1000);
    return () => clearInterval(id);
  }, [refreshToken]);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    fetch('https://api.spotify.com/v1/me', { headers: { Authorization: `Bearer ${accessToken}` } })
      .then(res => { if (!cancelled && res.status === 403) setUnauthorized(true); })
      .catch(() => { /* transient network error, not an authorization signal */ });
    return () => { cancelled = true; };
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken) return;
    if (sdkLoaded && playerRef.current) return;

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
    try {
      playerRef.current?.activateElement();
    } catch (err) {
      reportPlaybackError('activateElement failed', err);
    }
  }

  function clearStopTimer() {
    if (stopTimerRef.current) { clearTimeout(stopTimerRef.current); stopTimerRef.current = null; }
  }

  // A 'not_ready' device is usually transient (tab was backgrounded, brief
  // network blip, Spotify Connect handed playback elsewhere for a moment) —
  // the SDK reconnects and fires 'ready' again on its own within a couple of
  // seconds. Previously prepareTrack failed immediately and permanently once
  // this happened, breaking every subsequent round (including new games)
  // until the page was reloaded. Give the SDK a real chance to recover
  // before giving up, nudging it with an explicit connect() in case the
  // automatic reconnect stalled.
  function waitForDeviceReady(timeoutMs: number): Promise<string | null> {
    if (deviceIdRef.current) return Promise.resolve(deviceIdRef.current);
    playerRef.current?.connect().catch(() => { /* best-effort nudge */ });
    return new Promise((resolve) => {
      const start = Date.now();
      const poll = setInterval(() => {
        if (deviceIdRef.current) {
          clearInterval(poll);
          resolve(deviceIdRef.current);
        } else if (Date.now() - start > timeoutMs) {
          clearInterval(poll);
          resolve(null);
        }
      }, 150);
    });
  }

  // Resolve once audio is genuinely playing from near the intended start, so
  // the play window is timed from the audible start rather than the resume()
  // call (which precedes real output by 100-300ms of device/SDK latency).
  function waitForPlaybackStart(startPositionMs: number): Promise<boolean> {
    // A pauseTrack/prepareTrack that lands mid-poll (e.g. a fast skip cutting
    // this round short) bumps playGenRef — stop polling immediately instead
    // of continuing to hit getCurrentState for the rest of the 2.5s window.
    const startGen = playGenRef.current;
    return new Promise((resolve) => {
      let done = false;
      const finish = (started: boolean) => {
        if (done) return;
        done = true;
        clearInterval(poll);
        clearTimeout(safety);
        resolve(started);
      };
      const poll = setInterval(async () => {
        if (playGenRef.current !== startGen) { finish(false); return; }
        try {
          const st = await playerRef.current?.getCurrentState();
          // >start+40ms: past the very start, so audio is really flowing.
          // <start+1500ms: not the stale position left over from buffering.
          if (st && !st.paused && st.position > startPositionMs + 40 && st.position < startPositionMs + 1500) finish(true);
        } catch (err) {
          reportPlaybackError('getCurrentState failed', err);
          finish(false);
        }
      }, 20);
      const safety = setTimeout(() => finish(true), 2500);
    });
  }

  // Buffer the track ahead of time, muted, so the actual start is instant and
  // gapless. Returns true once Spotify accepted the play request.
  async function prepareTrack(trackId: string, positionMs = 0) {
    const token = accessTokenRef.current;
    if (!token) {
      reportPlaybackError('prepareTrack called but not ready', { device: deviceIdRef.current, hasToken: false });
      return false;
    }
    const device = deviceIdRef.current ?? await waitForDeviceReady(4000);
    if (!device) {
      reportPlaybackError('prepareTrack called but not ready', { device, hasToken: true });
      return false;
    }
    clearStopTimer();
    // A previous prepareTrack may still be in flight (fast skip landed before
    // it resolved) — abort it so its PUT doesn't keep running alongside this
    // one and pile onto Spotify's rate limit.
    prepareAbortRef.current?.abort();
    const controller = new AbortController();
    prepareAbortRef.current = controller;
    playGenRef.current += 1;
    const myGen = playGenRef.current;
    playStateRef.current = 'preparing';
    preparedPositionRef.current = positionMs;
    try {
      await playerRef.current?.setVolume(0);
      if (myGen !== playGenRef.current) return false; // superseded while awaiting setVolume
      const res = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${device}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ uris: [`spotify:track:${trackId}`], position_ms: positionMs }),
        signal: controller.signal,
      });
      if (myGen !== playGenRef.current) return false; // superseded; a newer prepareTrack already running
      if (!res.ok) {
        const body = await res.text();
        if (res.status === 429) {
          // Transient — almost always caused by a burst of rapid skips, not a
          // real playback failure. The server's fallback timer moves the
          // round along on its own, so don't alarm the host into thinking
          // they need to reconnect Spotify.
          reportPlaybackError(`prepare failed 429`, { message: 'Spotify briefly rate-limited playback — this round will continue automatically.' });
        } else {
          reportPlaybackError(`prepare failed ${res.status}`, body);
        }
        playStateRef.current = 'idle';
        return false;
      }
      setPlaybackError(null);
      return true;
    } catch (err) {
      if (controller.signal.aborted) return false; // expected: superseded by a newer prepareTrack/pauseTrack
      reportPlaybackError('prepare failed', err);
      playStateRef.current = 'idle';
      return false;
    }
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
    const startPos = preparedPositionRef.current;
    playStateRef.current = 'playing';
    try {
      await playerRef.current?.seek(startPos);
      await playerRef.current?.setVolume(0.8);
      await playerRef.current?.resume();
      if (!await waitForPlaybackStart(startPos)) {
        playStateRef.current = 'idle';
        return false;
      }
    } catch (err) {
      reportPlaybackError('start failed', err);
      playStateRef.current = 'idle';
      return false;
    }
    // Another prepareTrack/pauseTrack started while we were waiting — don't
    // arm a stop timer that would fire at the wrong time.
    if (gen !== playGenRef.current) return false;
    stopTimerRef.current = setTimeout(() => { pauseTrack(); }, durationMs);
    return true;
  }

  async function pauseTrack() {
    clearStopTimer();
    prepareAbortRef.current?.abort(); // cancel a still-running prepareTrack fetch
    playGenRef.current += 1; // invalidate any in-flight startPrepared
    playStateRef.current = 'stopping';
    try {
      await playerRef.current?.pause();
    } catch (err) {
      reportPlaybackError('pause failed', err);
    }
  }

  function disconnect() {
    localStorage.removeItem('spotify_at');
    localStorage.removeItem('spotify_rt');
    accessTokenRef.current = null;
    playerRef.current?.disconnect();
    playerRef.current = null;
    deviceIdRef.current = null;
    setAccessToken(null);
    setRefreshToken(null);
    setPlayerReady(false);
    setUnauthorized(false);
    setPlaybackError(null);
  }

  return { isConnected: !!accessToken, accessToken, playerReady, unauthorized, playbackError, prepareTrack, startPrepared, pauseTrack, activatePlayer, disconnect };
}
