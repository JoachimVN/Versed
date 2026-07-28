import { useCallback, useEffect, useRef, useState } from 'react';

const SOUND_SRCS = {
  1: `${import.meta.env.BASE_URL}sfx/final_results_reveal3.wav`,
  2: `${import.meta.env.BASE_URL}sfx/final_results_reveal2.wav`,
  3: `${import.meta.env.BASE_URL}sfx/final_results_reveal.wav`,
} as const;

let audioContext: AudioContext | null = null;
const bufferPromises = new Map<1 | 2 | 3, Promise<AudioBuffer>>();

function getAudioContext(): AudioContext {
  audioContext ??= new AudioContext();
  return audioContext;
}

function podiumSize(podiumCount: number): 1 | 2 | 3 {
  if (podiumCount <= 1) return 1;
  if (podiumCount === 2) return 2;
  return 3;
}

function loadBuffer(podiumCount: number): Promise<AudioBuffer> {
  const size = podiumSize(podiumCount);
  let bufferPromise = bufferPromises.get(size);
  if (!bufferPromise) {
    bufferPromise = (async () => {
      const response = await fetch(SOUND_SRCS[size]);
    if (!response.ok) throw new Error(`Could not load final-results audio: ${response.status}`);
    return getAudioContext().decodeAudioData(await response.arrayBuffer());
    })();
    bufferPromises.set(size, bufferPromise);
  }
  return bufferPromise;
}

// Begin fetching/decoding every ceremony variant as soon as this code loads.
// The finished screen must start in sync on its first frame, whichever of the
// one-, two-, or three-player endings the game reaches.
try {
  await Promise.all([1, 2, 3].map(loadBuffer));
} catch {
  // preload failures surface again when a screen actually calls loadBuffer
}

const resumeContext = () => { getAudioContext().resume().catch(() => {}); };
document.addEventListener('pointerdown', resumeContext);
document.addEventListener('keydown', resumeContext);

// final_results_reveal* were mastered a few dB quieter than the rest of the
// game's audio (measured via ffmpeg loudnorm: ~-26 to -28 LUFS, vs -22 at the
// top of the game's usual range) — boosted here rather than re-exporting the
// source files, since it's a single constant to re-tune.
const FINAL_RESULTS_GAIN = 2.5;

/**
 * Preloads and plays the one-piece final-results score. `play()` returns a
 * cancel function so leaving the finished screen cannot leave the ceremony
 * playing over a newly started game.
 */
export function useFinalResultsRevealSound(podiumCount = 3) {
  const [ready, setReady] = useState(false);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);

  useEffect(() => {
    let active = true;
    loadBuffer(podiumCount).then(() => {
      if (active) setReady(true);
    }).catch(() => {});
    return () => { active = false; };
  }, [podiumCount]);

  const stop = useCallback(() => {
    const source = sourceRef.current;
    sourceRef.current = null;
    gainRef.current = null;
    if (source) {
      try { source.stop(); } catch { /* source may already have ended */ }
    }
  }, []);

  // Skipping the ceremony shouldn't cut the score off mid-note -- ramps the
  // currently playing source's gain to silence over `durationMs`, then stops
  // it, instead of stop()'s instant cut.
  const fadeOut = useCallback((durationMs = 450) => {
    const source = sourceRef.current;
    const gain = gainRef.current;
    sourceRef.current = null;
    gainRef.current = null;
    if (!source || !gain) return;
    const context = getAudioContext();
    const now = context.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, now + durationMs / 1000);
    setTimeout(() => {
      try { source.stop(); } catch { /* source may already have ended */ }
    }, durationMs + 30);
  }, []);

  const play = useCallback(() => {
    stop();
    let cancelled = false;

    loadBuffer(podiumCount).then(buffer => {
      if (cancelled) return;
      const context = getAudioContext();
      const source = context.createBufferSource();
      const gain = context.createGain();
      gain.gain.value = FINAL_RESULTS_GAIN;
      source.buffer = buffer;
      source.connect(gain);
      gain.connect(context.destination);
      source.onended = () => {
        if (sourceRef.current === source) sourceRef.current = null;
        if (gainRef.current === gain) gainRef.current = null;
      };
      sourceRef.current = source;
      gainRef.current = gain;
      source.start();
    }).catch(() => {});

    return () => {
      cancelled = true;
      stop();
    };
  }, [podiumCount, stop]);

  useEffect(() => stop, [stop]);

  return { ready, play, fadeOut };
}
