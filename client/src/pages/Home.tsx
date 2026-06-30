import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import LiquidGlass from 'liquid-glass-react';
import { APP_NAME, BACKEND_URL } from '../config';

export default function Home() {
  const navigate = useNavigate();
  const [hovered, setHovered] = useState<'host' | 'join' | null>(null);

  return (
    <div
      className="page-enter relative min-h-screen flex flex-col items-center justify-center gap-10 p-6"
      style={{ zIndex: 1 }}
    >
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
          onMouseEnter={() => setHovered('join')}
          onMouseLeave={() => setHovered(null)}
          onClick={() => navigate('/play')}
        >
          <div style={{
            position: 'absolute', inset: 0, borderRadius: '100px',
            background: 'rgba(0, 128, 126, 0.04)',
            pointerEvents: 'none',
          }} />
          <LiquidGlass
            style={{
              position: 'absolute', top: '50%', left: '50%',
              filter: hovered === 'join' ? 'drop-shadow(0 0 10px rgba(0, 128, 126, 0.65))' : 'drop-shadow(0 0 0px rgba(0, 128, 126, 0))',
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

        <button
          type="button"
          className="liquid-btn relative cursor-pointer border-0 bg-transparent p-0"
          style={{ width: '310px', height: '64px', borderRadius: '100px', background: 'rgba(0,0,0,0.001)' }}
          onMouseEnter={() => setHovered('host')}
          onMouseLeave={() => setHovered(null)}
          onClick={() => (globalThis.location.href = `${BACKEND_URL}/api/auth/spotify`)}
        >
          <div style={{
            position: 'absolute', inset: 0, borderRadius: '100px',
            background: 'rgba(110, 32, 155, 0.04)',
            pointerEvents: 'none',
          }} />
          <LiquidGlass
            style={{
              position: 'absolute', top: '50%', left: '50%',
              filter: hovered === 'host' ? 'drop-shadow(0 0 10px rgba(110, 32, 155, 0.65))' : 'drop-shadow(0 0 0px rgba(110, 32, 155, 0))',
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
      </div>

      <p className="absolute bottom-6 inset-x-0 text-white/25 text-sm text-center">
        Hosting requires a Spotify Premium account
      </p>
    </div>
  );
}
