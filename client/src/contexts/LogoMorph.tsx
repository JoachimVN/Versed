import { createContext, useCallback, useContext, useRef, useState } from 'react';

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
}

const LogoMorphContext = createContext<LogoMorphApi | null>(null);

export function useLogoMorph() {
  const ctx = useContext(LogoMorphContext);
  if (!ctx) throw new Error('useLogoMorph must be used within LogoMorphProvider');
  return ctx;
}

const DURATION = 380;

export function LogoMorphProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [rect, setRect] = useState<Rect | null>(null);
  const [animate, setAnimate] = useState(false);
  const [morphing, setMorphing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const beginMorph = useCallback((r: Rect) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setAnimate(false);
    setRect(r);
    setMorphing(true);
  }, []);

  const provideTarget = useCallback((r: Rect) => {
    // Two rAFs: the first lets the browser commit the overlay at its start
    // rect with transitions off, the second flips transitions on and moves
    // to the target — without this split there's no "from" state for the
    // transition to interpolate away from.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setAnimate(true);
        setRect(r);
        timerRef.current = setTimeout(() => {
          setMorphing(false);
          setRect(null);
          setAnimate(false);
        }, DURATION);
      });
    });
  }, []);

  return (
    <LogoMorphContext.Provider value={{ beginMorph, provideTarget, morphing }}>
      {children}
      {rect && (
        <img
          src={`${import.meta.env.BASE_URL}logo.png`}
          alt=""
          aria-hidden="true"
          style={{
            position: 'fixed',
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
            zIndex: 50,
            pointerEvents: 'none',
            transition: animate
              ? `top ${DURATION}ms cubic-bezier(0.16, 1, 0.3, 1), left ${DURATION}ms cubic-bezier(0.16, 1, 0.3, 1), width ${DURATION}ms cubic-bezier(0.16, 1, 0.3, 1), height ${DURATION}ms cubic-bezier(0.16, 1, 0.3, 1)`
              : 'none',
          }}
        />
      )}
    </LogoMorphContext.Provider>
  );
}
