import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface LogoMorphApi {
  /** Called by the departing page with its logo's on-screen rect, right
   *  before it navigates away. Arms a fixed-position overlay at that exact
   *  spot so swapping the real logo for the overlay is invisible. */
  beginMorph: (rect: Rect) => void;
  /** Called by the arriving page once its own logo has laid out, so the
   *  overlay can animate from the departure rect onto this one. */
  provideTarget: (rect: Rect) => void;
  /** True from beginMorph until the overlay finishes landing on the target.
   *  The arriving page should keep its real logo hidden during this window
   *  so it doesn't show alongside the overlay mid-flight. */
  morphing: boolean;
  /** Drops the overlay immediately with no flight — for when a transition
   *  gets cancelled and there's no arriving logo left to morph onto (e.g. a
   *  pending join->waiting handoff interrupted by the game already being in
   *  progress, which skips the waiting screen entirely). Without this the
   *  overlay has no way to resolve and stays stuck on top of the real
   *  screen. */
  dismissMorph: () => void;
  /** Lets callers skip the coordinated exit delay when the OS asks for less
   *  motion. CSS shortens the visual transitions too, but it cannot shorten
   *  JavaScript navigation timers. */
  reducedMotion: boolean;
}

const LogoMorphContext = createContext<LogoMorphApi | null>(null);

export function useLogoMorph() {
  const ctx = useContext(LogoMorphContext);
  if (!ctx) throw new Error('useLogoMorph must be used within LogoMorphProvider');
  return ctx;
}

const DURATION = 800;
const EASING = 'cubic-bezier(0.65, 0, 0.35, 1)';
// The real logo sits at opacity:0 for the entire flight, so browsers don't
// bother compositing it — flipping it visible at the same instant the
// overlay unmounts can lag a frame or two behind the state change (layer
// promotion + first paint), which shows as a brief blank flash even though
// the two are logically in sync. Keeping the overlay mounted, unchanged and
// pixel-identical, for a short buffer after the reveal absorbs that lag.
const REMOVE_DELAY = 120;

export function LogoMorphProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [rect, setRect] = useState<Rect | null>(null);
  const [animate, setAnimate] = useState(false);
  const [morphing, setMorphing] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(
    () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  );
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const removeRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const media = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!media) return;
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  const beginMorph = useCallback((r: Rect) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (removeRef.current) clearTimeout(removeRef.current);
    setAnimate(false);
    setRect(r);
    setMorphing(true);
  }, []);

  const scheduleRemoval = useCallback(() => {
    removeRef.current = setTimeout(() => {
      setRect(null);
      setAnimate(false);
    }, REMOVE_DELAY);
  }, []);

  const finishMorph = useCallback(() => {
    setMorphing(false);
    scheduleRemoval();
  }, [scheduleRemoval]);

  const dismissMorph = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (removeRef.current) clearTimeout(removeRef.current);
    timerRef.current = null;
    removeRef.current = null;
    setMorphing(false);
    setAnimate(false);
    setRect(null);
  }, []);

  const animateToTarget = useCallback(
    (r: Rect) => {
      setAnimate(true);
      setRect(r);
      timerRef.current = setTimeout(finishMorph, DURATION);
    },
    [finishMorph]
  );

  const provideTarget = useCallback(
    (r: Rect) => {
      // Two rAFs: the first lets the browser commit the overlay at its start
      // rect with transitions off, the second flips transitions on and moves
      // to the target — without this split there's no "from" state for the
      // transition to interpolate away from.
      requestAnimationFrame(() => requestAnimationFrame(() => animateToTarget(r)));
    },
    [animateToTarget]
  );

  const value = useMemo(
    () => ({ beginMorph, provideTarget, morphing, dismissMorph, reducedMotion }),
    [beginMorph, provideTarget, morphing, dismissMorph, reducedMotion]
  );

  return (
    <LogoMorphContext.Provider value={value}>
      {children}
      {rect && (
        <img
          src={`${import.meta.env.BASE_URL}logo.png`}
          alt=""
          aria-hidden="true"
          width={2560}
          height={1000}
          style={{
            position: 'fixed',
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
            zIndex: 50,
            pointerEvents: 'none',
            filter: 'drop-shadow(0 18px 22px rgba(0,0,0,0.55))',
            transition: animate
              ? `top ${DURATION}ms ${EASING}, left ${DURATION}ms ${EASING}, width ${DURATION}ms ${EASING}, height ${DURATION}ms ${EASING}`
              : 'none',
          }}
        />
      )}
    </LogoMorphContext.Provider>
  );
}
