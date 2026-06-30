import { useState, useEffect } from 'react';

export function useAnimatedScore(finalScore: number, delta: number, startDelay: number, instant = false) {
  const [displayScore, setDisplayScore] = useState(finalScore);
  const [displayDelta, setDisplayDelta] = useState(delta);
  const [deltaFading, setDeltaFading] = useState(false);

  useEffect(() => {
    if (instant || delta <= 0) {
      setDisplayScore(finalScore);
      return;
    }
    setDisplayScore(finalScore - delta);

    const startScore = finalScore - delta;
    const DURATION = 900;
    let rafId = 0;
    let startTime = -1;

    const timeoutId = setTimeout(() => {
      const step = (now: number) => {
        if (startTime < 0) startTime = now;
        const t = Math.min((now - startTime) / DURATION, 1);
        const ease = 1 - (1 - t) ** 3; // ease-out cubic
        const current = Math.round(startScore + delta * ease);
        setDisplayScore(current);
        setDisplayDelta(finalScore - current);
        if (t < 1) {
          rafId = requestAnimationFrame(step);
        } else {
          setDisplayScore(finalScore);
          setDisplayDelta(0);
          setDeltaFading(true);
        }
      };
      rafId = requestAnimationFrame(step);
    }, startDelay + 1000);

    return () => {
      clearTimeout(timeoutId);
      cancelAnimationFrame(rafId);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { displayScore, displayDelta, deltaFading };
}
