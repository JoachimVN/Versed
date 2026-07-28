import { useCallback, useEffect, useRef, useState } from 'react';

const SOUND_SRC = `${import.meta.env.BASE_URL}sfx/final_results_reveal.wav`;

let audioContext: AudioContext | null = null;
let bufferPromise: Promise<AudioBuffer> | null = null;

function getAudioContext(): AudioContext {
  audioContext ??= new AudioContext();
  return audioContext;
}

function loadBuffer(): Promise<AudioBuffer> {
  bufferPromise ??= (async () => {
    const response = await fetch(SOUND_SRC);
    if (!response.ok) throw new Error(`Could not load final-results audio: ${response.status}`);
    return getAudioContext().decodeAudioData(await response.arrayBuffer());
  })();
  return bufferPromise;
}

// Begin fetching/decoding as soon as the final-results code is loaded. A
// normal game spends far longer than this in earlier rounds; the manual
// screenshot preview additionally waits for readiness before enabling start.
void loadBuffer().catch(() => {});

const resumeContext = () => { getAudioContext().resume().catch(() => {}); };
document.addEventListener('pointerdown', resumeContext);
document.addEventListener('keydown', resumeContext);

/**
 * Preloads and plays the one-piece final-results score. `play()` returns a
 * cancel function so leaving the finished screen cannot leave the ceremony
 * playing over a newly started game.
 */
export function useFinalResultsRevealSound() {
  const [ready, setReady] = useState(false);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);

  useEffect(() => {
    let active = true;
    loadBuffer().then(() => {
      if (active) setReady(true);
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  const stop = useCallback(() => {
    const source = sourceRef.current;
    sourceRef.current = null;
    if (source) {
      try { source.stop(); } catch { /* source may already have ended */ }
    }
  }, []);

  const play = useCallback(() => {
    stop();
    let cancelled = false;

    loadBuffer().then(buffer => {
      if (cancelled) return;
      const context = getAudioContext();
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.onended = () => {
        if (sourceRef.current === source) sourceRef.current = null;
      };
      sourceRef.current = source;
      source.start();
    }).catch(() => {});

    return () => {
      cancelled = true;
      stop();
    };
  }, [stop]);

  useEffect(() => stop, [stop]);

  return { ready, play };
}
