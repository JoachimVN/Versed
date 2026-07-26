import { useState, useEffect, useRef } from 'react';

// Kicked off the moment this module loads — i.e. as soon as the /host route
// renders ConnectView, well before the Spotify OAuth round trip (several
// seconds of redirect + login) completes and LobbyView mounts. That gives the
// fetch a head start so the bytes are already local by the time they're
// needed; decodeAudioData is called fresh each time since it neuters
// (transfers) the ArrayBuffer it's given, so the cached bytes are sliced
// before each decode to stay reusable.
let themeArrayBufferPromise: Promise<ArrayBuffer> | null = null;
function preloadThemeAudio(): Promise<ArrayBuffer> {
  themeArrayBufferPromise ??= fetch(`${import.meta.env.BASE_URL}theme.mp3`).then(res => res.arrayBuffer());
  return themeArrayBufferPromise;
}
// Routes aren't code-split, so every page (including /play joiners who never
// see the lobby) loads this module — gate on the real URL so only genuine
// /host visits pay for the download. /host is only ever reached via a full
// navigation (OAuth redirect callback, or a direct/bookmarked hit), never
// client-side `navigate()`, so location.pathname reflects the actual visit.
if (globalThis.location.pathname.includes('/host')) preloadThemeAudio();

// Waiting-room music: starts the instant LobbyView mounts (right after the
// Spotify OAuth redirect — deliberately not gated on `pin`, since that isn't
// set until the create_game round trip and Spotify device registration both
// finish, several seconds later) and fades out (rather than cutting) when the
// host leaves the lobby, by starting the game or backing out.
//
// Uses the Web Audio API instead of <audio loop>: Chromium doesn't honor an
// MP3's LAME gapless-encoding metadata when it restarts a looping <audio>
// element, leaving an audible click/gap at the loop boundary. decodeAudioData
// does honor it, and looping the decoded AudioBuffer via AudioBufferSourceNode
// is sample-accurate.
export function useLobbyMusic(muffled: boolean) {
  const ctxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const filterRef = useRef<BiquadFilterNode | null>(null);
  const fadeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const volumeRef = useRef(1);
  const lastVolumeRef = useRef(1);
  const [volume, setVolumeState] = useState(1);

  useEffect(() => {
    let cancelled = false;
    const ctx = new AudioContext();
    ctxRef.current = ctx;

    (async () => {
      try {
        const arrayBuffer = (await preloadThemeAudio()).slice(0);
        const buffer = await ctx.decodeAudioData(arrayBuffer);
        if (cancelled) return;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 22050; // fully open — no audible filtering
        const gain = ctx.createGain();
        gain.gain.value = volumeRef.current;
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        source.connect(filter).connect(gain).connect(ctx.destination);
        source.start(0);
        sourceRef.current = source;
        gainRef.current = gain;
        filterRef.current = filter;
      } catch { /* fetch/decode failed; lobby just stays silent */ }
    })();

    // A fresh AudioContext starts suspended until a user gesture. Right after
    // the OAuth redirect there hasn't been one yet, so resume on the first
    // interaction (a harmless no-op once it's already running).
    const resume = () => { ctx.resume().catch(() => {}); };
    document.addEventListener('pointerdown', resume);
    document.addEventListener('keydown', resume);
    // Backgrounding the tab suspends the context; resume the instant it's
    // foregrounded again instead of silently waiting for a click on the page.
    const onVisibility = () => { if (document.visibilityState === 'visible') resume(); };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('pointerdown', resume);
      document.removeEventListener('keydown', resume);
      document.removeEventListener('visibilitychange', onVisibility);
      if (fadeIntervalRef.current) { clearInterval(fadeIntervalRef.current); fadeIntervalRef.current = null; }
      sourceRef.current?.stop();
      ctx.close().catch(() => {});
    };
  }, []);

  // Smoothly filters out the high end when the game-expired dialog pops up,
  // so the music reads as muffled behind the popup instead of playing on
  // as if nothing happened.
  useEffect(() => {
    const ctx = ctxRef.current;
    const filter = filterRef.current;
    if (!ctx || !filter) return;
    filter.frequency.cancelScheduledValues(ctx.currentTime);
    filter.frequency.setValueAtTime(filter.frequency.value, ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(muffled ? 400 : 22050, ctx.currentTime + 1.2);
  }, [muffled]);

  const rampGain = (target: number, durationMs: number) => new Promise<void>(resolve => {
    const gain = gainRef.current;
    if (!gain) { resolve(); return; }
    if (fadeIntervalRef.current) clearInterval(fadeIntervalRef.current);
    const steps = 20;
    const start = gain.gain.value;
    let i = 0;
    fadeIntervalRef.current = setInterval(() => {
      i++;
      gain.gain.value = start + (target - start) * (i / steps);
      if (i >= steps) {
        clearInterval(fadeIntervalRef.current!);
        fadeIntervalRef.current = null;
        gain.gain.value = target;
        resolve();
      }
    }, durationMs / steps);
  });

  // Fades out and stops playback entirely, so callers that navigate away can
  // wait for it first instead of cutting the music off mid-fade. Sweeps the
  // lowpass filter down in lockstep with the volume so the music seems to
  // recede into the distance rather than just going quiet in place.
  const fadeOut = async (durationMs = 800) => {
    const ctx = ctxRef.current;
    const filter = filterRef.current;
    if (ctx && filter) {
      filter.frequency.cancelScheduledValues(ctx.currentTime);
      filter.frequency.setValueAtTime(filter.frequency.value, ctx.currentTime);
      filter.frequency.exponentialRampToValueAtTime(120, ctx.currentTime + durationMs / 1000);
    }
    await rampGain(0, durationMs);
    sourceRef.current?.stop();
  };

  // Drags need to feel instant, so the slider bypasses rampGain and writes
  // the gain directly; only the mute-button toggle gets an animated fade.
  const setVolume = (v: number) => {
    const clamped = Math.min(1, Math.max(0, v));
    volumeRef.current = clamped;
    if (clamped > 0) lastVolumeRef.current = clamped;
    setVolumeState(clamped);
    if (fadeIntervalRef.current) { clearInterval(fadeIntervalRef.current); fadeIntervalRef.current = null; }
    const gain = gainRef.current;
    if (gain) gain.gain.value = clamped;
  };

  const toggleMute = () => {
    if (volumeRef.current > 0) { setVolume(0); return; }
    rampGain(lastVolumeRef.current || 1, 250);
    volumeRef.current = lastVolumeRef.current || 1;
    setVolumeState(volumeRef.current);
  };

  return { fadeOut, volume, setVolume, toggleMute };
}
