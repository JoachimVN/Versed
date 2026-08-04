import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

// Mirrors useHostScale.tsx's mechanism (see its comments for the `zoom` vs
// `transform: scale` reasoning and the --app-height self-reference pitfall)
// but for player screens, which stay mobile-first even when opened in a
// desktop browser. BASELINE_W is a generous "biggest common phone" width; it
// rarely binds because min(vw/W, vh/H) is dominated by the height ratio on
// any wide desktop window, which is exactly the axis a phone-shaped layout
// runs out of on a tall monitor.
//
// BASELINE_H is pinned at the tallest real phone viewport-check.js tests
// (iphone14-390x844-portrait) rather than lower: zoom scales content and its
// surrounding gaps by the same factor, so pushing scale up meaningfully at
// desktop sizes means pushing this baseline down — but this system also
// covers every real phone in someone's hand mid-game, all individually
// tuned (the compact/ultraCompact squeeze tiers, the exact px thresholds
// throughout GuessingView.tsx) against being exactly this tall with no
// headroom to spare. Below 844 that tuning would start rendering visibly
// bigger than it was measured for, and I can't playtest a real phone myself
// to catch what that breaks. Scale still reaches a real ~1.7x by 2560x1440
// (the 92vw/420px-capped guess input renders at ~714px there instead of
// 420px) — smaller than host's transformation, because there's no
// "sparse-canvas-with-nothing-else-on-it" backdrop issue to fix here, just
// element size, and the ceiling is real-device safety, not aesthetics.
const BASELINE_W = 430;
const BASELINE_H = 844;
const MAX_SCALE = 2.2;

function computeScale() {
  const raw = Math.min(window.innerWidth / BASELINE_W, window.innerHeight / BASELINE_H);
  return Math.min(Math.max(raw, 1), MAX_SCALE);
}

export const PlayerScaleContext = createContext(1);

export function usePlayerScaleValue() {
  return useContext(PlayerScaleContext);
}

/** Publishes --player-scale and --player-app-height on the given element,
 * driving the .player-scale-shell rules in index.css. See useHostScale.tsx
 * for why --player-app-height is computed in JS rather than as a CSS
 * calc()-on-itself. */
export function usePlayerScale(ref: React.RefObject<HTMLElement | null>) {
  const [scale, setScale] = useState(computeScale);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const sync = () => {
      const next = computeScale();
      el.style.setProperty('--player-scale', String(next));
      el.style.setProperty('--player-app-height', `${window.innerHeight / next}px`);
      setScale(next);
    };

    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, [ref]);

  return scale;
}

// Wraps player content in the ref + provider wiring usePlayerScale needs.
// Used by Play.tsx for the real app, and by Screenshot.tsx's player-group
// fixtures for the same reason HostScaleShell wraps host ones there.
export function PlayerScaleShell({ children, className, style }: Readonly<{ children: ReactNode; className?: string; style?: CSSProperties }>) {
  const ref = useRef<HTMLDivElement>(null);
  const scale = usePlayerScale(ref);
  return (
    <PlayerScaleContext.Provider value={scale}>
      <div ref={ref} className={`player-scale-shell${className ? ` ${className}` : ''}`} style={style}>
        {children}
      </div>
    </PlayerScaleContext.Provider>
  );
}
