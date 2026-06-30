import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import LiquidGlass from 'liquid-glass-react';
import { APP_NAME, BACKEND_URL } from '../config';
import { ConfettiBackground } from '../components/ConfettiBackground';

export default function Home() {
  const navigate = useNavigate();
  const [hovered, setHovered] = useState<'host' | 'join' | null>(null);

  return (
    <div className="min-h-screen relative overflow-hidden" style={{ background: '#080812' }}>
      <ConfettiBackground />

      <div className="fixed inset-0" style={{ background: 'radial-gradient(ellipse 48% 105% at 50% -5%, rgba(150,50,220,0.3) 0%, rgba(110,32,155,0.05) 55%, transparent 80%)', zIndex: 0 }} />
      <div className="fixed inset-0" style={{ background: 'rgba(8,8,18,0.7)', backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(6px)', zIndex: 0 }} />

      <div className="relative min-h-screen flex flex-col items-center justify-center gap-10 p-6" style={{ zIndex: 1 }}>
        <div className="flex flex-col items-center gap-3">
          <img
            src={`${import.meta.env.BASE_URL}logo.png`}
            alt={APP_NAME}
            className="h-36 w-auto drop-shadow-2xl"
          />
          <p className="text-white/60 text-lg tracking-wide"></p>
        </div>

        <div className="flex flex-col items-center gap-8">
          <button
            type="button"
            className="liquid-btn relative cursor-pointer border-0 bg-transparent p-0"
            style={{ width: '310px', height: '64px', borderRadius: '100px', background: 'rgba(0,0,0,0.001)' }}
            onMouseEnter={() => setHovered('host')}
            onMouseLeave={() => setHovered(null)}
            onClick={() => (globalThis.location.href = `${BACKEND_URL}/api/auth/spotify`)}
          >
            <LiquidGlass
              style={{
                position: 'absolute', top: '50%', left: '50%',
                filter: hovered === 'host' ? 'drop-shadow(0 0 8px rgba(255,255,255,0.35))' : 'drop-shadow(0 0 0px rgba(255,255,255,0))',
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
              <span className="text-white font-bold text-xl" style={{ whiteSpace: 'nowrap' }}>Host a game</span>
            </LiquidGlass>
          </button>

          <button
            type="button"
            className="liquid-btn relative cursor-pointer border-0 bg-transparent p-0"
            style={{ width: '310px', height: '64px', borderRadius: '100px', background: 'rgba(0,0,0,0.001)' }}
            onMouseEnter={() => setHovered('join')}
            onMouseLeave={() => setHovered(null)}
            onClick={() => navigate('/play')}
          >
            <LiquidGlass
              style={{
                position: 'absolute', top: '50%', left: '50%',
                filter: hovered === 'join' ? 'drop-shadow(0 0 8px rgba(255,255,255,0.35))' : 'drop-shadow(0 0 0px rgba(255,255,255,0))',
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
              <span className="text-white font-bold text-xl" style={{ whiteSpace: 'nowrap' }}>Join a game</span>
            </LiquidGlass>
          </button>
        </div>
      </div>

      <p className="absolute bottom-6 inset-x-0 text-white/25 text-sm text-center" style={{ zIndex: 1 }}>
        Hosting requires a Spotify Premium account
      </p>
    </div>
  );
}
