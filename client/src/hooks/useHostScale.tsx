import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

// The host screen gets cast to a TV/monitor and read from across a room, but
// every card in it is sized in fixed px against a 1440x900 MacBook (see
// viewport-check.js's own comment on the desktop-1440x900 viewport — that
// size is the documented, untouched baseline). Above that size the content
// used to just float in extra background instead of getting physically
// bigger. BASELINE_W/H anchor scale to exactly 1 at that baseline so nothing
// changes there; MAX_SCALE is a starting ceiling on genuinely huge displays
// (4K etc.) — min(vw/1440, vh/900) already self-limits on ultrawide-but-short
// screens, so this rarely binds. Tune both by eye against real screenshots,
// same as every other px threshold in this codebase.
const BASELINE_W = 1440;
const BASELINE_H = 900;
const MAX_SCALE = 1.8;

// The persistent ambient field lives alongside the host route, not inside
// this shell. Publish its scale so that field can stay visually in step with
// the enlarged host UI.
export const HOST_SCALE_CHANGE_EVENT = 'versed:host-scale-change';

function computeScale() {
  const raw = Math.min(window.innerWidth / BASELINE_W, window.innerHeight / BASELINE_H);
  return Math.min(Math.max(raw, 1), MAX_SCALE);
}

// Exposes the same numeric scale useHostScale publishes as --host-scale, for
// the rare spot that needs it as a JS number rather than in CSS — see
// StealFlightOverlay's comment in RevealView.tsx.
export const HostScaleContext = createContext(1);

export function useHostScaleValue() {
  return useContext(HostScaleContext);
}

/**
 * Publishes --host-scale and --host-app-height on the given element, driving
 * the .host-scale-shell rules in index.css. Resize-driven like
 * useViewportLayout's --app-height, and deliberately never below 1 — every
 * viewport at or below the baseline (all of viewport-check.js's phone sizes
 * included, since host has no mobile-squeeze logic of its own) renders
 * exactly as it did before this hook existed.
 *
 * --host-app-height is window.innerHeight pre-divided by the scale, computed
 * here in JS rather than as a CSS calc() built on the existing --app-height.
 * That calc() looks like the standard "shadow a custom property with a
 * scaled copy of itself" pattern (`--x: calc(var(--x) * n)`), but that trick
 * only works when the redeclaration lives on a *different* element than the
 * one it inherits from — written on the same element it's read from (as it
 * would have to be here, since .host-scale-shell is the one element that
 * knows the scale), a custom property referencing itself is a genuine cycle
 * per spec, and the property computes to empty/invalid. Confirmed empirically
 * (getComputedStyle().getPropertyValue('--app-height') on the shell came back
 * "" instead of the divided number), which is what let .min-h-screen pages
 * silently fall through to the un-divided height and overflow by exactly the
 * zoom factor. A plain JS division sidesteps the cycle entirely.
 */
export function useHostScale(ref: React.RefObject<HTMLElement | null>) {
  const [scale, setScale] = useState(computeScale);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const sync = () => {
      const next = computeScale();
      el.style.setProperty('--host-scale', String(next));
      el.style.setProperty('--host-app-height', `${window.innerHeight / next}px`);
      setScale(next);
      window.dispatchEvent(new CustomEvent<number>(HOST_SCALE_CHANGE_EVENT, { detail: next }));
    };

    sync();
    window.addEventListener('resize', sync);
    return () => {
      window.removeEventListener('resize', sync);
      window.dispatchEvent(new CustomEvent<number>(HOST_SCALE_CHANGE_EVENT, { detail: 1 }));
    };
  }, [ref]);

  return scale;
}

// Wraps host content in the ref + provider wiring useHostScale needs. Used by
// Host.tsx for the real app, and by Screenshot.tsx's host-group fixtures so
// the viewport-check script actually exercises this instead of silently
// bypassing it (Screenshot.tsx renders each view standalone, outside Host.tsx
// entirely).
export function HostScaleShell({ children, className, style }: Readonly<{ children: ReactNode; className?: string; style?: CSSProperties }>) {
  const ref = useRef<HTMLDivElement>(null);
  const scale = useHostScale(ref);
  return (
    <HostScaleContext.Provider value={scale}>
      <div ref={ref} className={`host-scale-shell${className ? ` ${className}` : ''}`} style={style}>
        {children}
      </div>
    </HostScaleContext.Provider>
  );
}
