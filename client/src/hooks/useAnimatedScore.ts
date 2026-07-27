import { useState, useEffect } from 'react';

// holdDelta: for a mystery round the multiplied delta must stay hidden until
// the slot reel actually lands — otherwise the "+N pts" chip (which normally
// shows the full delta immediately, before the count-up even starts) gives
// away the size of the bonus while the reel is still spinning. When set,
// displayDelta starts at 0 and only becomes real once the delayed count-up
// begins, exactly the moment the reel has landed.
export function useAnimatedScore(finalScore: number, delta: number, startDelay: number, instant = false, holdDelta = false, duration = 900) {
  const [displayScore, setDisplayScore] = useState(finalScore);
  const [displayDelta, setDisplayDelta] = useState(holdDelta ? 0 : delta);
  const [deltaFading, setDeltaFading] = useState(false);
  const [revealed, setRevealed] = useState(!holdDelta);

  useEffect(() => {
    // delta < 0 (a steal victim) counts down same as delta > 0 counts up —
    // only an actual no-op (delta === 0) skips the animation.
    if (instant || delta === 0) {
      setDisplayScore(finalScore);
      setRevealed(true);
      return;
    }
    setDisplayScore(finalScore - delta);
    if (holdDelta) {
      setDisplayDelta(0);
      setRevealed(false);
    }

    const startScore = finalScore - delta;
    let rafId = 0;
    let startTime = -1;

    const timeoutId = setTimeout(() => {
      setRevealed(true);
      const step = (now: number) => {
        if (startTime < 0) startTime = now;
        const t = Math.min((now - startTime) / duration, 1);
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
    // round_result mounts this before score_update delivers the real delta/score,
    // so the animation must restart once those props catch up to their real values.
  }, [finalScore, delta, startDelay, instant, holdDelta, duration]);

  return { displayScore, displayDelta, deltaFading, revealed };
}
