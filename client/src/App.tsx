import { lazy, Suspense, useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { ConfettiBackground, setConfettiSpeedTarget } from './components/ConfettiBackground';
import { useViewportHeight } from './hooks/useViewportHeight';
import { LogoMorphProvider } from './contexts/LogoMorph';
import Home from './pages/Home';

// Route-level code splitting: a player's phone never downloads the host's
// Spotify/QR/settings code and vice versa. Home stays eager (landing page).
const Host = lazy(() => import('./pages/Host'));
const Play = lazy(() => import('./pages/Play'));
const Screenshot = lazy(() => import('./pages/Screenshot'));

function RouteTracker() {
  const location = useLocation();
  const firstRender = useRef(true);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const isJoin = location.pathname.startsWith('/play');
    const settleSpeed = isJoin ? 0.38 : 1;

    if (firstRender.current) {
      firstRender.current = false;
      setConfettiSpeedTarget(settleSpeed);
      return;
    }

    // Burst on every route change, then glide to the destination speed.
    setConfettiSpeedTarget(4);
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      setConfettiSpeedTarget(settleSpeed);
    }, 1000);

    return () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
    };
  }, [location.pathname]);

  return null;
}

export default function App() {
  useViewportHeight();

  // Warm the Play chunk right after first paint: the Home -> Play logo morph
  // must not stall on a chunk fetch when someone joins via PIN/QR.
  useEffect(() => {
    void import('./pages/Play');
  }, []);

  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || '/'}>
      {/* LogoMorphProvider lives above Routes (not inside a page) so its
          overlay logo survives the Home -> Play unmount/mount swap and can
          animate across it. */}
      <LogoMorphProvider>
      {/* Background layers: absolutely positioned against #root (sized from
          real document height, see index.css) rather than fixed against the
          viewport — position: fixed elements get visually clipped to the
          shrunk visual viewport by iOS Safari when the keyboard opens on a
          non-scrolling page like ours, which cut this off at the keyboard's
          edge instead of extending behind it. Absolute positioning isn't
          subject to that quirk. */}
      <div className="absolute inset-0" style={{ background: '#080812', zIndex: 0 }} />
      <div
        className="waiting-background"
        aria-hidden="true"
      >
        <img
          src={`${import.meta.env.BASE_URL}background2.svg`}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'rotate(180deg)' }}
        />
      </div>
      {/* Persistent effects layer. Waiting keeps this exact canvas and
          spotlight, but changes the overlay treatment and stops recycling
          particles so the existing confetti naturally drains away. */}
      <div
        className="absolute inset-0"
        style={{
          opacity: 'var(--home-background-opacity, 1)',
          transition: 'opacity var(--home-background-fade-duration, 1s) ease',
          zIndex: 1,
        }}
      >
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            zIndex: 'var(--confetti-layer-z-index, 0)',
            opacity: 'var(--confetti-layer-opacity, 1)',
            transition: 'opacity var(--ambient-surface-duration, 500ms) ease',
          }}
        >
          <ConfettiBackground />
        </div>
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            zIndex: 3,
            opacity: 'var(--confetti-treatment-opacity, 0)',
            background: 'rgba(5,5,14,0.35)',
            backdropFilter: 'blur(5px)',
            WebkitBackdropFilter: 'blur(5px)',
            transition: 'opacity var(--ambient-surface-duration, 500ms) ease',
          }}
        />
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'radial-gradient(ellipse 48% 105% at 50% -5%, rgba(198,36,255,0.3) 0%, rgba(158,18,204,0.05) 55%, transparent 80%)',
            // Keep the spotlight explicitly beneath the Waiting overlay so
            // its darkening and backdrop blur are applied to the purple glow
            // as well as the artwork.
            zIndex: 0,
          }}
        />
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'var(--ambient-overlay-color, rgba(8,8,18,0.7))',
            backdropFilter: 'blur(var(--ambient-overlay-blur, 2px))',
            WebkitBackdropFilter: 'blur(var(--ambient-overlay-webkit-blur, 6px))',
            transition: 'background var(--ambient-surface-duration, 500ms) ease, backdrop-filter var(--ambient-surface-duration, 500ms) ease, -webkit-backdrop-filter var(--ambient-surface-duration, 500ms) ease',
            zIndex: 0,
          }}
        />
      </div>
      {/* Content layer: shrinks to --app-height so it stays anchored to the
          top and reflows above the keyboard instead of being covered by it.
          Offset below the status bar/notch via safe-area-inset-top — with
          viewport-fit=cover (see index.html) the background above is allowed
          to paint full-bleed under the notch and home indicator, but this
          layer (and everything in it: back buttons, nav, etc.) should stay
          clear of them, so it starts below the inset instead of at the true
          top. This div's own height stays the full --app-height (it's just a
          transparent positioning wrapper), but page roots use .min-h-screen,
          which subtracts both the top offset consumed here and the bottom
          inset, so they land flush with the safe area instead of
          overshooting past it. */}
      <div style={{ position: 'fixed', top: 'env(safe-area-inset-top, 0px)', left: 0, right: 0, height: 'var(--app-height, 100vh)', zIndex: 2 }}>
        <RouteTracker />
        {/* Fallback is null: the app background above keeps painting while a
            route chunk loads, which reads as a beat of quiet, not a spinner. */}
        <Suspense fallback={null}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/host" element={<Host />} />
            <Route path="/play" element={<Play />} />
            <Route path="/play/:pin" element={<Play />} />
            <Route path="/screenshot" element={<Screenshot />} />
          </Routes>
        </Suspense>
      </div>
      </LogoMorphProvider>
    </BrowserRouter>
  );
}
