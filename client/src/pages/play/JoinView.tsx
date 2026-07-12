import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import LiquidGlass from '../../components/StableLiquidGlass';
import { useLogoMorph } from '../../contexts/LogoMorph';
import { useKeyboardOpen } from '../../hooks/useViewportHeight';
import { BackButton } from '../../components/BackButton';
import { LIQUID_CARD_PROPS, LIQUID_PILL_PROPS } from '../../components/liquidGlassPresets';
import { APP_NAME } from '../../config';
import type { PlayState } from './usePlayGame';
import { useMorphBack, useWaitingTransitionMorph, pageTransitionClass } from './morph';

export function JoinView({ game }: Readonly<{ game: PlayState }>) {
  const { pin, name, error, savedSession, cameFromQR, setPin, setName, join, rejoinSaved } = game;
  const [joinHovered, setJoinHovered] = useState(false);
  const [pinFocused, setPinFocused] = useState(false);
  const [nameFocused, setNameFocused] = useState(false);
  const [pinRevealed, setPinRevealed] = useState(false);
  // A QR join skips the PIN field, but if the encoded PIN is stale/wrong the
  // "game not found" error leaves the player stuck with no way to fix it —
  // reveal the field so they can type the right one.
  useEffect(() => {
    if (cameFromQR && error) setPinRevealed(true);
  }, [cameFromQR, error]);
  const showPinField = !cameFromQR || pinRevealed;
  const canJoin = showPinField ? (pin.length === 3 && name.trim().length > 0) : name.trim().length > 0;
  // LiquidGlass only measures its own size once on mount (and on window
  // resize) — it has no ResizeObserver, so it never notices the card growing
  // as the PIN field appears. Re-firing its resize listener lets it
  // re-measure in place and transition smoothly to the new size.
  useEffect(() => {
    globalThis.dispatchEvent(new Event('resize'));
  }, [showPinField]);
  const keyboardOpen = useKeyboardOpen();
  const [leaving, setLeaving] = useState(false);
  const logoRef = useRef<HTMLImageElement>(null);
  const { beginMorph, provideTarget, morphing, reducedMotion } = useLogoMorph();
  const arrivedViaMorph = useRef(morphing).current;

  // Only hands off to the overlay if a morph is already in flight (i.e. we
  // arrived via Home's "Join a game" button) — a direct visit to /play
  // should show its own logo immediately, not wait on a morph that never
  // started.
  useLayoutEffect(() => {
    if (morphing && logoRef.current) {
      const r = logoRef.current.getBoundingClientRect();
      provideTarget({ top: r.top, left: r.left, width: r.width, height: r.height });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mirrors Home's goToJoin in reverse.
  const goBack = useMorphBack(logoRef, setLeaving, beginMorph, reducedMotion);

  useWaitingTransitionMorph(game, logoRef, setLeaving, beginMorph, provideTarget, reducedMotion);

  return (
    <div
      className={`relative min-h-screen keyboard-resize ${pageTransitionClass(leaving, arrivedViaMorph)}`}
      style={{ zIndex: 1, overflowY: 'auto', pointerEvents: leaving ? 'none' : undefined }}
    >
      <BackButton beforeNavigate={goBack} />

      {/* minHeight (not height) lets this grow past the viewport instead of
          fighting it for space — centered when it fits, top-to-bottom
          scrollable overflow (no Safari "unreachable centered overflow"
          quirk) when the keyboard shrinks the viewport past what fits.
          Centering splits that overflow between top and bottom though, which
          traps the Join button under the keyboard with no way to scroll to
          it — so once a field is focused, align to the top instead, where
          plain top-to-bottom scrolling reaches everything. */}
      <div className="flex flex-col items-center p-6 gap-10" style={{ minHeight: '100%', justifyContent: keyboardOpen ? 'flex-start' : 'center' }}>

      <img
        ref={logoRef}
        src={`${import.meta.env.BASE_URL}logo.png`}
        alt={APP_NAME}
        width={2560}
        height={1000}
        className="w-auto drop-shadow-2xl"
        style={{ maxHeight: '128px', maxWidth: '100%', opacity: (morphing || leaving) ? 0 : 1, willChange: 'opacity' }}
      />

      {savedSession && (
        <div className="flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={rejoinSaved}
            className="liquid-btn glass-tint-purple relative cursor-pointer border-0 bg-transparent p-0"
            style={{ width: '310px', height: '70px', borderRadius: '100px', background: 'rgba(0,0,0,0.001)' }}
          >
            <LiquidGlass
              style={{ position: 'absolute', top: '50%', left: '50%' }}
              {...LIQUID_PILL_PROPS}
              padding="13px 48px"
            >
              <div style={{ position: 'relative' }}>
                <div style={{ position: 'absolute', inset: '-13px -48px', borderRadius: '100px', pointerEvents: 'none', background: 'rgba(158,18,204,0.05)' }} />
                <div style={{ position: 'relative', textAlign: 'center', whiteSpace: 'nowrap', minWidth: '214px' }}>
                  <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.6rem', letterSpacing: '0.18em', textTransform: 'uppercase', lineHeight: 1, marginBottom: '5px' }}>
                    Rejoin as · {savedSession.pin}
                  </p>
                  <p className="text-white font-black text-xl" style={{ lineHeight: 1.2 }}>{savedSession.name}</p>
                </div>
              </div>
            </LiquidGlass>
          </button>
          <p className="text-white/45 text-xs tracking-wider">or join a different game</p>
        </div>
      )}

      {/* Input card: LiquidGlass */}
      <div className="liquid-btn relative" style={{ width: '310px', height: showPinField ? '165px' : '115px', transition: 'height 0.3s ease' }}>
        <LiquidGlass
          style={{ position: 'absolute', top: '50%', left: '50%' }}
          {...LIQUID_CARD_PROPS}
          padding="20px 24px"
        >
          <div style={{ width: '262px', textAlign: 'center' }}>
            {showPinField && (
              <>
                {/* PIN */}
                <div style={{ marginBottom: '14px' }}>
                  <span style={{
                    display: 'block',
                    color: pinFocused ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.45)',
                    fontSize: '0.6rem', letterSpacing: '0.18em', textTransform: 'uppercase',
                    marginBottom: '6px', transition: 'color 0.2s ease',
                  }}>Game PIN</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder="1 2 3"
                    value={pin}
                    onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
                    maxLength={3}
                    onFocus={() => setPinFocused(true)}
                    onBlur={() => setPinFocused(false)}
                    className="text-white font-black outline-none bg-transparent w-full text-center placeholder-white/20"
                    style={{ fontSize: '2rem', letterSpacing: '0.4em', textIndent: '0.4em', lineHeight: '1', display: 'block' }}
                  />
                </div>
                <div style={{ height: '1px', background: 'rgba(255,255,255,0.10)', marginBottom: '14px' }} />
              </>
            )}
            {/* Name */}
            <div>
              <span style={{
                display: 'block',
                color: nameFocused ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.45)',
                fontSize: '0.6rem', letterSpacing: '0.18em', textTransform: 'uppercase',
                marginBottom: '6px', transition: 'color 0.2s ease',
              }}>Your name</span>
              <input
                type="text"
                placeholder="Enter your name"
                value={name}
                onChange={e => setName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && join()}
                onFocus={() => setNameFocused(true)}
                onBlur={() => setNameFocused(false)}
                maxLength={20}
                className="text-white text-xl font-semibold placeholder-white/22 outline-none bg-transparent w-full text-center"
                style={{ lineHeight: '1.4', display: 'block' }}
              />
            </div>
          </div>
        </LiquidGlass>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateRows: error ? '1fr' : '0fr',
        transition: 'grid-template-rows 0.25s ease',
      }}>
        <div style={{ overflow: 'hidden' }}>
          <p
            className="text-sm text-center"
            aria-live="assertive"
            style={{
              width: '310px',
              paddingTop: '2px',
              opacity: error ? 1 : 0,
              transition: 'opacity 0.2s ease',
              color: 'rgba(248, 113, 113, 0.9)',
              letterSpacing: '0.01em',
            }}
          >{error}</p>
        </div>
      </div>

      <button
        type="button"
        className="liquid-btn glass-tint-teal relative border-0 bg-transparent p-0"
        style={{
          width: '310px',
          height: '64px',
          borderRadius: '100px',
          background: 'rgba(0,0,0,0.001)',
          opacity: canJoin ? 1 : 0.3,
          cursor: canJoin ? 'pointer' : 'not-allowed',
          transition: 'opacity 0.25s ease, margin-top 0.25s ease',
          marginTop: showPinField ? '0' : '-20px',
        }}
        onMouseEnter={() => setJoinHovered(true)}
        onMouseLeave={() => setJoinHovered(false)}
        onClick={() => canJoin && join()}
      >
        <LiquidGlass
          style={{
            position: 'absolute', top: '50%', left: '50%',
            filter: joinHovered ? 'drop-shadow(0 0 10px rgba(0,166,163,0.65))' : 'drop-shadow(0 0 0px rgba(0,166,163,0))',
            transition: 'filter 0.25s ease',
          }}
          {...LIQUID_PILL_PROPS}
          padding="18px 96px"
        >
          <div style={{ position: 'relative' }}>
            <div style={{ position: 'absolute', inset: '-18px -96px', borderRadius: '100px', pointerEvents: 'none', background: 'rgba(0,166,163,0.088)' }} />
            <span className="text-white font-bold text-xl" style={{ whiteSpace: 'nowrap', position: 'relative' }}>Join game</span>
          </div>
        </LiquidGlass>
      </button>
      </div>
    </div>
  );
}
