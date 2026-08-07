import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { BRAND_LOGO_SRC, showBrandLogoFallback } from '../../branding';
import LiquidGlass from '../../components/StableLiquidGlass';
import { useLogoMorph } from '../../contexts/LogoMorph';
import { useKeyboardOpen } from '../../hooks/useViewportLayout';
import { BackButton } from '../../components/BackButton';
import { LIQUID_CARD_PROPS, LIQUID_PILL_PROPS, REVEAL_TINT_CLASS, REVEAL_WASH } from '../../components/liquidGlassPresets';
import { APP_NAME } from '../../config';
import type { PlayState } from './usePlayGame';
import { useMorphBack, useWaitingTransitionMorph, pageTransitionClass, readLogoRect } from './morph';

// Collapses an element to nothing while the keyboard is up, keeping it
// mounted (the savedSession card wraps a LiquidGlass that only measures
// itself on mount/resize — unmounting it would cost more than it saves).
// maxHeight is generous enough not to clip anything at rest; it only has to
// be a finite number for the transition to have something to animate
// between.
function collapsedWhenTyping(typing: boolean): React.CSSProperties {
  return {
    maxHeight: typing ? 0 : '180px',
    opacity: typing ? 0 : 1,
    overflow: 'hidden',
    pointerEvents: typing ? 'none' : undefined,
    transition: 'max-height 0.28s ease, opacity 0.2s ease',
  };
}

function canJoinGame(showPinField: boolean, pin: string, name: string): boolean {
  const hasName = name.trim().length > 0;
  return !showPinField || (pin.length === 3 && hasName);
}

function shouldShowPinField(cameFromQR: boolean, pinRevealed: boolean): boolean {
  return !cameFromQR || pinRevealed;
}

function compactValue<T>(ultraCompact: boolean, compact: boolean, ultraValue: T, compactValue: T, regularValue: T): T {
  if (ultraCompact) return ultraValue;
  if (compact) return compactValue;
  return regularValue;
}

function inputLabelColor(focused: boolean): string {
  return focused ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.45)';
}

// Below this viewport height the default spacing pushes the Join button
// (and, with a saved session, the whole rejoin card above it) past the
// bottom edge. The screen must never rely on scrolling to reveal it, so
// these squeeze the logo/gaps/pill heights down instead — mirrors the
// compact/ultraCompact tiers in GuessingView.tsx.
const COMPACT_HEIGHT_PX = 700;
const ULTRA_COMPACT_HEIGHT_PX = 450;

function useJoinLayout(): { compact: boolean; ultraCompact: boolean } {
  const [layout, setLayout] = useState(() => {
    const h = typeof window !== 'undefined' ? window.innerHeight : Infinity;
    return { compact: h < COMPACT_HEIGHT_PX, ultraCompact: h < ULTRA_COMPACT_HEIGHT_PX };
  });
  useEffect(() => {
    const sync = () => {
      const h = window.innerHeight;
      setLayout({ compact: h < COMPACT_HEIGHT_PX, ultraCompact: h < ULTRA_COMPACT_HEIGHT_PX });
    };
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, []);
  return layout;
}

function revealPinOnQrError(cameFromQR: boolean, error: string | null, setPinRevealed: (revealed: boolean) => void) {
  if (cameFromQR && error) setPinRevealed(true);
}

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
    revealPinOnQrError(cameFromQR, error, setPinRevealed);
  }, [cameFromQR, error]);
  const showPinField = shouldShowPinField(cameFromQR, pinRevealed);
  const canJoin = canJoinGame(showPinField, pin, name);
  const controlWidth = 'min(310px, calc(100vw - 48px))';
  const fieldWidth = 'min(262px, calc(100vw - 96px))';
  // LiquidGlass only measures its own size once on mount (and on window
  // resize) — it has no ResizeObserver, so it never notices the card growing
  // as the PIN field appears. Re-firing its resize listener lets it
  // re-measure in place and transition smoothly to the new size.
  useEffect(() => {
    globalThis.dispatchEvent(new Event('resize'));
  }, [showPinField]);
  const keyboardOpen = useKeyboardOpen();
  const { compact, ultraCompact } = useJoinLayout();
  // The pill's rendered height comes from this padding plus its text's line
  // height — not from the button wrapper's own `height` below, which is
  // absolutely-positioned inside and merely reserves layout space. Shrinking
  // the wrapper without shrinking this padding leaves the glass poking past
  // its clipping ancestor (the wrapper's own overflow: hidden / the savedSession
  // block's collapsedWhenTyping), which is what actually cut the button off.
  const joinPaddingV = compactValue(ultraCompact, compact, 10, 14, 18);
  const savedPillPaddingV = compactValue(ultraCompact, compact, 7, 10, 13);
  const layoutGap = keyboardOpen ? '20px' : compactValue(ultraCompact, compact, '10px', '16px', '40px');
  const logoDisplay = keyboardOpen || ultraCompact ? 'none' : undefined;
  const rejoinGap = compactValue(ultraCompact, compact, '6px', '8px', '12px');
  const rejoinHeight = compactValue(ultraCompact, compact, '54px', '60px', '70px');
  const joinHeight = compactValue(ultraCompact, compact, '52px', '58px', '64px');
  const joinPadding = `${joinPaddingV}px min(96px, calc((100vw - 156px) / 2))`;
  const [leaving, setLeaving] = useState(false);
  const logoRef = useRef<HTMLImageElement>(null);
  const { beginMorph, provideTarget, morphing, dismissMorph, reducedMotion } = useLogoMorph();
  const arrivedViaMorph = useRef(morphing).current;

  // Only hands off to the overlay if a morph is already in flight (i.e. we
  // arrived via Home's "Join a game" button) — a direct visit to /play
  // should show its own logo immediately, not wait on a morph that never
  // started.
  useLayoutEffect(() => {
    if (!morphing) return;
    const rect = readLogoRect(logoRef);
    if (rect) provideTarget(rect);
    else dismissMorph();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mirrors Home's goToJoin in reverse.
  const goBack = useMorphBack(logoRef, setLeaving, beginMorph, reducedMotion);

  useWaitingTransitionMorph(game, logoRef, setLeaving, beginMorph, provideTarget, reducedMotion, dismissMorph);

  return (
    <div
      className={`relative min-h-screen ${pageTransitionClass(leaving, arrivedViaMorph)}`}
      style={{
        zIndex: 1,
        // Nothing may scroll while the keyboard is up. Beyond the fact that
        // an overflow container inside a fixed, keyboard-shrunk viewport
        // scrolls terribly on iOS, a scrollable page is also what lets Safari
        // pan the visual viewport — and the background layers behind this are
        // positioned against the document, so panning slides the page off the
        // bottom of the confetti into flat body colour. The layout below is
        // sized to fit exactly, so there is nothing to scroll to anyway.
        overflowY: keyboardOpen ? 'hidden' : 'auto',
        overscrollBehavior: 'contain',
        pointerEvents: leaving ? 'none' : undefined,
      }}
    >
      <BackButton beforeNavigate={goBack} />

      {/* While the keyboard is up this box is pinned to exactly the space
          above it, so `justify-content: center` centers the card and Join
          button in what's actually visible. (Reserving the keyboard's height
          as bottom padding instead looks equivalent but isn't: it leaves the
          border box a full viewport tall, which is enough to make the page
          scrollable and hand Safari the pan described above.) The branding
          collapses so the form fits that space on any phone. */}
      <div
        className="screen-center-safe flex flex-col items-center p-6"
        style={{
          minHeight: 'calc(100% - var(--keyboard-inset, 0px))',
          height: 'calc(100% - var(--keyboard-inset, 0px))',
          gap: layoutGap,
          padding: ultraCompact ? '16px' : undefined,
          transition: 'gap 0.28s ease, height 0.22s ease-out, min-height 0.22s ease-out',
        }}
      >

      {/* display: none, not collapsedWhenTyping's maxHeight collapse: even
          with the transition stripped out, animating the box through
          intermediate sizes let the logo render underneath the card for a
          frame. display: none pulls it out of layout in one step — there's
          no size for it to pass through. */}
      <div className="join-screen-logo" style={{ display: logoDisplay }}>
        <img
          ref={logoRef}
          src={BRAND_LOGO_SRC}
          alt={APP_NAME}
          onError={showBrandLogoFallback}
          width={2560}
          height={1000}
          className="versed-logo w-auto drop-shadow-[0_18px_22px_rgba(0,0,0,0.55)]"
          style={{ maxHeight: compact ? '90px' : '128px', maxWidth: '100%', opacity: (morphing || leaving) ? 0 : 1, willChange: 'opacity' }}
        />
      </div>

      {savedSession && (
        <div className="flex flex-col items-center" style={{ ...collapsedWhenTyping(keyboardOpen), gap: rejoinGap, flexShrink: 0 }}>
          <button
            type="button"
            onClick={rejoinSaved}
            className="liquid-btn glass-tint-purple relative cursor-pointer border-0 bg-transparent p-0"
            style={{ width: controlWidth, height: rejoinHeight, borderRadius: '100px', background: 'rgba(0,0,0,0.001)' }}
          >
            <LiquidGlass
              style={{ position: 'absolute', top: '50%', left: '50%' }}
              {...LIQUID_PILL_PROPS}
              padding={`${savedPillPaddingV}px 48px`}
            >
              <div style={{ position: 'relative' }}>
                <div style={{ position: 'absolute', inset: `-${savedPillPaddingV}px -48px`, borderRadius: '100px', pointerEvents: 'none', background: 'rgba(158,18,204,0.05)' }} />
                <div style={{ position: 'relative', textAlign: 'center', whiteSpace: 'nowrap', minWidth: 'min(214px, calc(100vw - 144px))' }}>
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
      <div className={`liquid-btn relative ${REVEAL_TINT_CLASS}`} style={{ width: controlWidth, height: showPinField ? '165px' : '115px', transition: 'height 0.3s ease', flexShrink: 0 }}>
        <LiquidGlass
          style={{ position: 'absolute', top: '50%', left: '50%' }}
          {...LIQUID_CARD_PROPS}
          padding="20px 24px"
        >
          <div aria-hidden="true" style={{ position: 'absolute', inset: '-24px', borderRadius: '20px', zIndex: 0, pointerEvents: 'none', background: REVEAL_WASH }} />
          <div style={{ position: 'relative', zIndex: 1, width: fieldWidth, textAlign: 'center' }}>
            {showPinField && (
              <>
                {/* PIN */}
                <div style={{ marginBottom: '14px' }}>
                  <span style={{
                    display: 'block',
                    color: inputLabelColor(pinFocused),
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
                color: inputLabelColor(nameFocused),
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
              width: controlWidth,
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
          width: controlWidth,
          height: joinHeight,
          borderRadius: '100px',
          background: 'rgba(0,0,0,0.001)',
          opacity: canJoin ? 1 : 0.3,
          cursor: canJoin ? 'pointer' : 'not-allowed',
          transition: 'opacity 0.25s ease, margin-top 0.25s ease',
          marginTop: showPinField ? '0' : '-20px',
          flexShrink: 0,
        }}
        onMouseEnter={() => setJoinHovered(true)}
        onMouseLeave={() => setJoinHovered(false)}
        // Suppressing the default focus transfer keeps the name field focused
        // through the tap, so the keyboard doesn't start closing (and the
        // layout doesn't start re-centering) out from under the finger that's
        // still mid-press. join() unmounts this screen anyway.
        onMouseDown={e => e.preventDefault()}
        onClick={() => canJoin && join()}
      >
        <LiquidGlass
          style={{
            position: 'absolute', top: '50%', left: '50%',
            filter: joinHovered ? 'drop-shadow(0 0 10px rgba(0,166,163,0.65))' : 'drop-shadow(0 0 0px rgba(0,166,163,0))',
            transition: 'filter 0.25s ease',
          }}
          {...LIQUID_PILL_PROPS}
          padding={joinPadding}
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
