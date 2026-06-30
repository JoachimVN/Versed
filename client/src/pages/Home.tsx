import { useNavigate } from 'react-router-dom';
import { APP_NAME, BACKEND_URL } from '../config';
import { ConfettiBackground } from '../components/ConfettiBackground';

const glassHost = {
  backdropFilter: 'blur(32px) saturate(200%)',
  WebkitBackdropFilter: 'blur(32px) saturate(200%)',
  background: 'linear-gradient(140deg, rgba(0,128,126,0.42) 0%, rgba(8,8,18,0.62) 60%, rgba(0,160,150,0.18) 100%)',
  border: '1px solid rgba(0,210,190,0.18)',
  boxShadow: '0 8px 32px rgba(0,0,0,0.6), 0 0 28px rgba(0,128,126,0.18), inset 0 1.5px 0 rgba(255,255,255,0.14), inset 0 -1px 0 rgba(0,200,180,0.07)',
} as const;

const glassJoin = {
  backdropFilter: 'blur(32px) saturate(200%)',
  WebkitBackdropFilter: 'blur(32px) saturate(200%)',
  background: 'linear-gradient(140deg, rgba(110,32,155,0.42) 0%, rgba(8,8,18,0.62) 60%, rgba(150,17,193,0.18) 100%)',
  border: '1px solid rgba(150,17,193,0.18)',
  boxShadow: '0 8px 32px rgba(0,0,0,0.6), 0 0 28px rgba(110,32,155,0.18), inset 0 1.5px 0 rgba(255,255,255,0.14), inset 0 -1px 0 rgba(150,17,193,0.07)',
} as const;

function LiquidButton({
  onClick,
  style,
  children,
}: {
  onClick: () => void;
  style: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="group relative overflow-hidden w-full py-[18px] rounded-full text-white font-bold text-xl transition-all duration-200 hover:scale-[1.025] hover:brightness-110 active:scale-95"
      style={style}
    >
      {/* primary specular — top-left lens flare */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute rounded-full"
        style={{
          inset: 0,
          background: 'linear-gradient(135deg, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.03) 40%, transparent 65%)',
        }}
      />
      {/* secondary specular — bottom-right subtle */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute rounded-full"
        style={{
          inset: 0,
          background: 'radial-gradient(ellipse 60% 55% at 80% 90%, rgba(255,255,255,0.1) 0%, transparent 70%)',
        }}
      />
      <span className="relative">{children}</span>
    </button>
  );
}

export default function Home() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen relative overflow-hidden" style={{ background: '#080812' }}>
      <ConfettiBackground />

      {/* dark frosted overlay */}
      <div
        className="fixed inset-0"
        style={{ backdropFilter: 'blur(7px)', background: 'rgba(8,8,18,0.62)', zIndex: 1 }}
      />

      <div className="relative min-h-screen flex flex-col items-center justify-center gap-10 p-6" style={{ zIndex: 2 }}>
        <div className="flex flex-col items-center gap-3">
          <img
            src={`${import.meta.env.BASE_URL}logo.png`}
            alt={APP_NAME}
            className="h-36 w-auto drop-shadow-2xl"
          />
          <p className="text-white/60 text-lg tracking-wide"></p>
        </div>

        <div className="flex flex-col gap-3 w-full max-w-xs">
          <LiquidButton
            onClick={() => (window.location.href = `${BACKEND_URL}/api/auth/spotify`)}
            style={glassHost}
          >
            Host a game
          </LiquidButton>

          <LiquidButton
            onClick={() => navigate('/play')}
            style={glassJoin}
          >
            Join a game
          </LiquidButton>
        </div>
      </div>

      <p className="absolute bottom-6 inset-x-0 text-white/25 text-sm text-center" style={{ zIndex: 2 }}>
        Hosting requires a Spotify Premium account
      </p>
    </div>
  );
}
