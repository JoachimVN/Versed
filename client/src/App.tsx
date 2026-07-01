import { useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { ConfettiBackground, setConfettiSpeedTarget } from './components/ConfettiBackground';
import Home from './pages/Home';
import Host from './pages/Host';
import Play from './pages/Play';
import Screenshot from './pages/Screenshot';

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
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || '/'}>
      <div style={{ minHeight: '100vh', background: '#080812' }}>
        <ConfettiBackground />
        <div
          className="fixed inset-0 pointer-events-none"
          style={{
            background: 'radial-gradient(ellipse 48% 105% at 50% -5%, rgba(150,50,220,0.3) 0%, rgba(110,32,155,0.05) 55%, transparent 80%)',
            zIndex: 0,
          }}
        />
        <div
          className="fixed inset-0 pointer-events-none"
          style={{
            background: 'rgba(8,8,18,0.7)',
            backdropFilter: 'blur(2px)',
            WebkitBackdropFilter: 'blur(6px)',
            zIndex: 0,
          }}
        />
        <RouteTracker />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/host" element={<Host />} />
          <Route path="/play" element={<Play />} />
          <Route path="/play/:pin" element={<Play />} />
          <Route path="/screenshot" element={<Screenshot />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
