import { useCallback, useEffect, useRef } from 'react';

// Decodes a short one-shot sound once and returns a stable play() that
// retriggers it from the start on every call (a fresh AudioBufferSourceNode
// per call, since those are single-use) — for rapid-fire cues like a
// countdown tick, where overlapping replays should just restart cleanly.
export function useSoundEffect(src: string) {
  const ctxRef = useRef<AudioContext | null>(null);
  const bufferRef = useRef<AudioBuffer | null>(null);

  useEffect(() => {
    let cancelled = false;
    const ctx = new AudioContext();
    ctxRef.current = ctx;

    (async () => {
      try {
        const res = await fetch(src);
        const arrayBuffer = await res.arrayBuffer();
        const buffer = await ctx.decodeAudioData(arrayBuffer);
        if (!cancelled) bufferRef.current = buffer;
      } catch { /* fetch/decode failed; play() just stays a no-op */ }
    })();

    // A fresh AudioContext starts suspended until a user gesture.
    const resume = () => { ctx.resume().catch(() => {}); };
    document.addEventListener('pointerdown', resume);
    document.addEventListener('keydown', resume);

    return () => {
      cancelled = true;
      document.removeEventListener('pointerdown', resume);
      document.removeEventListener('keydown', resume);
      ctx.close().catch(() => {});
    };
  }, [src]);

  return useCallback(() => {
    const ctx = ctxRef.current;
    const buffer = bufferRef.current;
    if (!ctx || !buffer) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
  }, []);
}
