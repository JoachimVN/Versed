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
          className="h-[180px] w-auto drop-shadow-2xl"
        />
        <p className="text-white/60 text-lg tracking-wide"></p>
      </div>

      <div className="flex flex-col items-center gap-8">
        <button
          type="button"
          className="liquid-btn home-btn-join relative cursor-pointer border-0 bg-transparent p-0"
          style={{ width: '310px', height: '64px', borderRadius: '100px', background: 'rgba(0,0,0,0.001)' }}
          onMouseEnter={() => setHovered('join')}
          onMouseLeave={() => setHovered(null)}
          onClick={() => navigate('/play')}
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
          className="liquid-btn home-btn-host relative cursor-pointer border-0 bg-transparent p-0"
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

      <p className="absolute bottom-6 inset-x-0 text-white/45 text-sm text-center">
        Hosting requires a Spotify Premium account
      </p>
    </div>
  );
}
