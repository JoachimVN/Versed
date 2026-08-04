import { useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { BRAND_LOGO_SRC, showBrandLogoFallback } from '../branding';
import LiquidGlass from '../components/StableLiquidGlass';
import { useLogoMorph } from '../contexts/LogoMorph';
import { APP_NAME, BACKEND_URL } from '../config';

export default function Home() {
  const navigate = useNavigate();
  const [hovered, setHovered] = useState<'host' | 'join' | null>(null);
  const [leaving, setLeaving] = useState(false);
  const logoRef = useRef<HTMLImageElement>(null);
  const { beginMorph, provideTarget, morphing, reducedMotion } = useLogoMorph();
  // Capture the arrival mode once. Using the live `morphing` flag for the
  // page class made Home switch to .page-enter when the logo flight ended,
  // which started a fresh 12px slide after the overlay had already landed.
  const arrivedViaMorph = useRef(morphing).current;

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
    if (reducedMotion) {
      navigate('/play');
      return;
    }
    if (logoRef.current) {
      const r = logoRef.current.getBoundingClientRect();
      beginMorph({ top: r.top, left: r.left, width: r.width, height: r.height });
    }
    setLeaving(true);
    setTimeout(() => navigate('/play'), 320);
  };

  let pageAnimClass = 'page-enter';
  if (leaving) pageAnimClass = 'page-exit';
  else if (arrivedViaMorph) pageAnimClass = 'page-enter-morph';

  return (
    <div
      className={`relative min-h-screen flex flex-col items-center justify-center gap-10 p-6 ${pageAnimClass}`}
      style={{ zIndex: 1, pointerEvents: leaving ? 'none' : undefined }}
    >
      <div className="flex flex-col items-center gap-3">
        <img
          ref={logoRef}
          src={BRAND_LOGO_SRC}
          alt={APP_NAME}
          onError={showBrandLogoFallback}
          width={2560}
          height={1000}
          className="versed-logo w-auto drop-shadow-[0_18px_22px_rgba(0,0,0,0.55)]"
          style={{ maxHeight: '225px', maxWidth: '100%', marginBottom: '50px', opacity: (leaving || morphing) ? 0 : 1, willChange: 'opacity' }}
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
