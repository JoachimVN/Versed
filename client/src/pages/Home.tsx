import { useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import LiquidGlass from 'liquid-glass-react';
import { useLogoMorph } from '../contexts/LogoMorph';
import { APP_NAME, BACKEND_URL } from '../config';

export default function Home() {
  const navigate = useNavigate();
  const [hovered, setHovered] = useState<'host' | 'join' | null>(null);
  const [leaving, setLeaving] = useState(false);
  const logoRef = useRef<HTMLImageElement>(null);
  const { beginMorph, provideTarget, morphing } = useLogoMorph();

  // Mirrors JoinView's arrival handling: only hands off to the overlay if a
  // morph is already in flight (i.e. we arrived via Play's back button) —
  // a fresh visit to "/" should show the logo immediately.
  useLayoutEffect(() => {
    if (morphing && logoRef.current) {
      const r = logoRef.current.getBoundingClientRect();
      provideTarget({ top: r.top, left: r.left, width: r.width, height: r.height });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const goToJoin = () => {
    if (logoRef.current) {
      const r = logoRef.current.getBoundingClientRect();
      beginMorph({ top: r.top, left: r.left, width: r.width, height: r.height });
    }
    setLeaving(true);
    setTimeout(() => navigate('/play'), 220);
  };

  return (
    <div
      className={`relative min-h-screen flex flex-col items-center justify-center gap-10 p-6 ${leaving ? 'page-exit' : 'page-enter'}`}
      style={{ zIndex: 1, pointerEvents: leaving ? 'none' : undefined }}
    >
      <div className="flex flex-col items-center gap-3">
        <img
          ref={logoRef}
          src={`${import.meta.env.BASE_URL}logo.png`}
          alt={APP_NAME}
          className="w-auto drop-shadow-2xl"
          style={{ maxHeight: '225px', maxWidth: '100%', marginBottom: '50px', opacity: (leaving || morphing) ? 0 : 1 }}
        />
        <p className="text-white/60 text-lg tracking-wide"></p>
      </div>

      <div className="flex flex-col items-center gap-8">
        <button
          type="button"
          className="liquid-btn glass-tint-teal relative cursor-pointer border-0 bg-transparent p-0"
          style={{ width: '310px', height: '64px', borderRadius: '100px', background: 'rgba(0,0,0,0.001)' }}
          onMouseEnter={() => setHovered('join')}
          onMouseLeave={() => setHovered(null)}
          onClick={goToJoin}
        >
          <LiquidGlass
            style={{
              position: 'absolute', top: '50%', left: '50%',
              filter: hovered === 'join' ? 'drop-shadow(0 0 10px rgba(0,166,163,0.65))' : 'drop-shadow(0 0 0px rgba(0,166,163,0))',
              transition: 'filter 0.25s ease',
            }}
            displacementScale={64}
            blurAmount={0.05}
            saturation={130}
            aberrationIntensity={2}
            elasticity={0.12}
            cornerRadius={100}
            padding="18px 96px"
          >
            <div style={{ position: 'relative' }}>
              <div style={{ position: 'absolute', inset: '-18px -96px', borderRadius: '100px', pointerEvents: 'none', background: 'rgba(0,166,163,0.088)' }} />
              <span className="text-white font-bold text-xl" style={{ whiteSpace: 'nowrap', position: 'relative' }}>Join a game</span>
            </div>
          </LiquidGlass>
        </button>

        <button
          type="button"
          className="liquid-btn glass-tint-purple relative cursor-pointer border-0 bg-transparent p-0"
          style={{ width: '310px', height: '64px', borderRadius: '100px', background: 'rgba(0,0,0,0.001)' }}
          onMouseEnter={() => setHovered('host')}
          onMouseLeave={() => setHovered(null)}
          onClick={() => (globalThis.location.href = `${BACKEND_URL}/api/auth/spotify`)}
        >
          <LiquidGlass
            style={{
              position: 'absolute', top: '50%', left: '50%',
              filter: hovered === 'host' ? 'drop-shadow(0 0 10px rgba(158,18,204,0.65))' : 'drop-shadow(0 0 0px rgba(158,18,204,0))',
              transition: 'filter 0.25s ease',
            }}
            displacementScale={64}
            blurAmount={0.05}
            saturation={130}
            aberrationIntensity={2}
            elasticity={0.12}
            cornerRadius={100}
            padding="18px 96px"
          >
            <div style={{ position: 'relative' }}>
              <div style={{ position: 'absolute', inset: '-18px -96px', borderRadius: '100px', pointerEvents: 'none', background: 'rgba(158,18,204,0.088)' }} />
              <span className="text-white font-bold text-xl" style={{ whiteSpace: 'nowrap', position: 'relative' }}>Host a game</span>
            </div>
          </LiquidGlass>
        </button>
      </div>
    </div>
  );
}
