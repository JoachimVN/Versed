import { useState, useEffect, useCallback, useLayoutEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { Pencil } from 'lucide-react';
import LiquidGlass from '../../components/StableLiquidGlass';
import { useLogoMorph } from '../../contexts/LogoMorph';
import { BackButton } from '../../components/BackButton';
import { LIQUID_LABEL_PROPS } from '../../components/liquidGlassPresets';
import { APP_NAME } from '../../config';
import type { PlayState } from './usePlayGame';

// Home is already brought to the foreground as soon as Back is pressed, so a
// shorter hand-off keeps the return responsive while leaving time for the
// waiting content's exit animation to complete.
const BACKGROUND_FADE_MS = 500;
const PAGE_EXIT_MS = 320;

export function WaitingView({
  game,
  leaveBackground,
}: Readonly<{ game: PlayState; leaveBackground: () => void }>) {
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [leaving, setLeaving] = useState(false);
  const [backgroundLeaving, setBackgroundLeaving] = useState(false);
  const logoRef = useRef<HTMLImageElement>(null);
  const backPromiseRef = useRef<Promise<void> | null>(null);
  const pageExitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { beginMorph, provideTarget, morphing, reducedMotion } = useLogoMorph();
  const arrivedViaMorph = useRef(morphing).current;

  // Arrival side of JoinView's forward hand-off: only engages if a morph is
  // already in flight (i.e. the player just joined) — landing here directly
  // (e.g. dev reload mid-phase) shows its own logo immediately instead of
  // waiting on a morph that never started.
  useLayoutEffect(() => {
    if (morphing && logoRef.current) {
      const r = logoRef.current.getBoundingClientRect();
      provideTarget({ top: r.top, left: r.left, width: r.width, height: r.height });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => {
    if (pageExitTimerRef.current) clearTimeout(pageExitTimerRef.current);
    if (navigateTimerRef.current) clearTimeout(navigateTimerRef.current);
  }, []);

  // Let the background settle briefly before the route changes.
  // Arm the logo overlay immediately so it remains visible above that entire
  // dissolve; the rest of the content leaves in the final 320ms, then Home
  // supplies the overlay's destination as soon as its layout is available.
  const goBack = useCallback(() => {
    if (reducedMotion) return Promise.resolve();
    if (backPromiseRef.current) return backPromiseRef.current;

    backPromiseRef.current = new Promise<void>(resolve => {
      if (logoRef.current) {
        const r = logoRef.current.getBoundingClientRect();
        beginMorph({ top: r.top, left: r.left, width: r.width, height: r.height });
      }
      setBackgroundLeaving(true);
      leaveBackground();
      pageExitTimerRef.current = setTimeout(() => {
        pageExitTimerRef.current = null;
        setLeaving(true);
      }, BACKGROUND_FADE_MS - PAGE_EXIT_MS);
      navigateTimerRef.current = setTimeout(() => {
        navigateTimerRef.current = null;
        resolve();
      }, BACKGROUND_FADE_MS);
    });
    return backPromiseRef.current;
  }, [beginMorph, leaveBackground, reducedMotion]);

  const startEdit = () => { setDraftName(game.myName); setEditing(true); };
  const cancelEdit = () => setEditing(false);
  const confirmEdit = () => {
    if (!draftName.trim() || draftName.trim() === game.myName) { setEditing(false); return; }
    game.renamePlayer(draftName);
    setEditing(false);
  };
  let contentTransitionClass = 'page-enter';
  if (leaving) contentTransitionClass = 'page-exit';
  else if (backgroundLeaving) contentTransitionClass = '';
  else if (arrivedViaMorph) contentTransitionClass = 'page-enter-morph';

  return (
    <div className="relative min-h-screen overflow-hidden">
      {/* Content */}
      <div
        className={`relative flex flex-col items-center justify-center min-h-screen gap-8 p-6 ${contentTransitionClass}`}
        style={{ zIndex: 3, pointerEvents: backgroundLeaving ? 'none' : undefined }}
      >
        <BackButton beforeNavigate={goBack} />
        <img
          ref={logoRef}
          src={`${import.meta.env.BASE_URL}logo.png`}
          alt={APP_NAME}
          width={2560}
          height={1000}
          className="w-auto drop-shadow-2xl"
          style={{ maxHeight: '140px', maxWidth: '100%', opacity: (morphing || leaving) ? 0 : 1, willChange: 'opacity' }}
        />

        {/* The vinyl record IS the card: a big spinning grooved disc with a
            smaller static circular glass "label" fixed at its center, like a
            real record label sitting on the vinyl. --disc-size and
            --label-size drive every proportional child size below in pure
            CSS, so the whole assembly stays in proportion as the disc
            shrinks to fit narrow viewports. The label is deliberately sized
            well under the disc (not a full inset:0 cover) — the grooved ring
            left visible around it is what actually reads as "vinyl" instead
            of a plain dark blob. */}
        <div
          style={{
            position: 'relative',
            width: 'min(360px, calc(100vw - 2rem))',
            aspectRatio: '1',
            '--disc-size': 'min(360px, calc(100vw - 2rem))',
            '--label-size': 'calc(var(--disc-size) * 0.6)',
          } as CSSProperties}
        >
          {/* Vinyl material — three layers, deliberately split:
              1) the grooved surface. Spins with the label (same 7s linear —
                 they're one rigid record). A perfectly radially-symmetric
                 pattern is invisible when rotated, so the rotation is made
                 visible the way it is on a real record: the groove/ring
                 pattern is drawn very slightly off-center (spinning it
                 produces the classic pressing wobble) and a whisper-faint
                 conic irregularity breaks the angular symmetry. Near-black
                 base (blurred white blobs on a lighter base read as glossy
                 plastic, which is exactly the look to avoid), with two kinds
                 of ring detail: a very tight, very low-contrast repeating
                 groove texture (closer to brushed metal than a bullseye —
                 real grooves are too fine to draw countable rings), and a
                 few faint wider rings at fixed radii, the track-separation
                 gaps a real pressing has. closest-side sizing so 100% = the
                 disc edge.
              2) the light response, static — the light source doesn't rotate
                 with the record. Two low-opacity conic sheen "wings" 180°
                 apart, masked to the groove ring only — that's how light
                 actually reflects across groove ridges (anisotropic, radial)
                 rather than pooling in one blurry hotspot like plastic. Soft
                 multi-stop ramps, so no hard wedge edges. The corner
                 vignette and edge/glow shadows live on a static sibling for
                 the same reason.
              3) a dark tint under the label footprint, fading out past the
                 label edge — reads as the smooth "dead wax" area between
                 label and grooves, and keeps the glass looking like an
                 opaque frosted pane without dimming the groove ring. */}
          <div
            aria-hidden="true"
            style={{
              position: 'absolute', inset: 0, borderRadius: '50%',
              background: `
                conic-gradient(from 0deg, transparent 0deg, rgba(255,255,255,0.022) 70deg, transparent 130deg, rgba(255,255,255,0.014) 205deg, transparent 250deg, rgba(255,255,255,0.025) 305deg, transparent 360deg),
                radial-gradient(circle closest-side at 50.7% 49.6%, transparent 0 67.5%, rgba(255,255,255,0.05) 68%, transparent 68.8%, transparent 77.5%, rgba(255,255,255,0.05) 78%, transparent 78.8%, transparent 86.5%, rgba(255,255,255,0.05) 87%, transparent 87.8%, transparent 100%),
                repeating-radial-gradient(circle at 50.7% 49.6%, rgba(255,255,255,0.04) 0px, rgba(255,255,255,0.04) 1px, transparent 1.5px, transparent 3px),
                radial-gradient(circle closest-side, #1d1926 0%, #121019 45%, #0a0810 78%, #050408 96%, #010102 100%)
              `,
              animationName: 'vinylDiscSpin', animationDuration: '7s', animationTimingFunction: 'linear', animationIterationCount: 'infinite',
            }}
          />
          <div
            aria-hidden="true"
            style={{
              position: 'absolute', inset: 0, borderRadius: '50%', pointerEvents: 'none',
              background: `
                conic-gradient(from 12deg,
                  transparent 0deg, transparent 22deg,
                  rgba(255,255,255,0.05) 46deg, rgba(255,255,255,0.10) 60deg, rgba(255,255,255,0.05) 74deg,
                  transparent 98deg, transparent 202deg,
                  rgba(255,255,255,0.05) 226deg, rgba(255,255,255,0.10) 240deg, rgba(255,255,255,0.05) 254deg,
                  transparent 278deg, transparent 360deg)
              `,
              WebkitMaskImage: 'radial-gradient(circle closest-side, transparent 0 58%, black 68% 94%, transparent 100%)',
              maskImage: 'radial-gradient(circle closest-side, transparent 0 58%, black 68% 94%, transparent 100%)',
            }}
          />
          <div
            aria-hidden="true"
            style={{
              position: 'absolute', inset: 0, borderRadius: '50%', pointerEvents: 'none',
              background: 'radial-gradient(circle at 74% 82%, rgba(0,0,0,0.4), transparent 55%)',
              boxShadow: '0 0 0 1px rgba(255,255,255,0.07) inset, 0 12px 40px rgba(0,0,0,0.55), 0 0 55px rgba(158,18,204,0.14), 0 0 85px rgba(0,238,232,0.05)',
            }}
          />
          <div
            aria-hidden="true"
            style={{
              position: 'absolute', top: '50%', left: '50%', width: 'calc(var(--label-size) * 1.16)', height: 'calc(var(--label-size) * 1.16)',
              transform: 'translate(-50%, -50%)', borderRadius: '50%', pointerEvents: 'none',
              background: 'radial-gradient(circle closest-side, rgba(8,7,14,0.55) 0 80%, rgba(8,7,14,0) 100%)',
              boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            }}
          />

          {/* Circular glass label — sized well under the disc (see note
              above), like a liquid-glass pane laid directly over the vinyl
              surface. Spins at the same 7s rate as the disc surface, so the
              two read as one rigid record. Its content div below
              counter-rotates at the same rate so the spin cancels out for
              the text/name, which stays upright and readable. */}
          <div
            className="liquid-btn glass-tint-purple relative"
            style={{
              position: 'absolute', top: '50%', left: '50%', width: 'var(--label-size)', height: 'var(--label-size)',
              transform: 'translate(-50%, -50%)',
              animationName: 'vinylLabelSpin', animationDuration: '7s', animationTimingFunction: 'linear', animationIterationCount: 'infinite',
            }}
          >
            <LiquidGlass
              style={{
                position: 'absolute', top: '50%', left: '50%',
                animationName: 'cardGlowPulse', animationDuration: '4.2s', animationTimingFunction: 'ease-in-out', animationIterationCount: 'infinite',
              }}
              {...LIQUID_LABEL_PROPS}
              padding="calc(var(--label-size) * 0.09)"
            >
              <div style={{
                position: 'relative',
                width: 'calc(var(--label-size) * 0.82)', aspectRatio: '1',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '10px',
              }}>
                {/* Soft accent wash echoing the heading's gradient, spanning
                    the full glass circle the way Home's button overlays do.
                    Two corner-anchored radial glows rather than a linear
                    wash — a linear-gradient's cutoff reads as a hard diagonal
                    edge/wedge at this opacity, while a radial one fades out
                    smoothly in every direction. No counter-rotation here —
                    it's a backdrop, not text, so it spins along with the
                    glass around it. */}
                <div style={{
                  position: 'absolute', inset: 'calc(var(--label-size) * -0.09)', borderRadius: '50%', pointerEvents: 'none',
                  background: 'radial-gradient(circle at 15% 85%, rgba(158,18,204,0.17) 0%, rgba(158,18,204,0.06) 45%, transparent 100%), radial-gradient(circle at 85% 15%, rgba(0,238,232,0.14) 0%, rgba(0,238,232,0.05) 45%, transparent 100%)',
                }} />
                {/* Text/name UI counter-rotates at the same rate as the
                    parent label's spin, canceling it out so this stays
                    upright and readable while the glass around it turns. */}
                <div style={{
                  position: 'relative',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '10px',
                  animationName: 'vinylLabelSpinCounter', animationDuration: '7s', animationTimingFunction: 'linear', animationIterationCount: 'infinite',
                }}>
                  <span style={{
                    position: 'relative',
                    fontSize: 'clamp(0.95rem, 3.6vw, 1.2rem)', fontFamily: "'Montserrat', sans-serif", fontWeight: 900, letterSpacing: '0.06em', textTransform: 'uppercase',
                    background: 'linear-gradient(to bottom left, rgba(158,18,204,0.45) 0%, transparent 55%), linear-gradient(to top right, rgba(0,238,232,0.45) 0%, transparent 55%), #fff',
                    WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
                  }}>
                    You're in!
                  </span>
                  {editing ? (
                    <>
                      <input
                        autoFocus
                        type="text"
                        aria-label="Your name"
                        value={draftName}
                        onChange={e => setDraftName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') confirmEdit(); else if (e.key === 'Escape') cancelEdit(); }}
                        onBlur={confirmEdit}
                        maxLength={20}
                        style={{
                          position: 'relative',
                          background: 'none', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.25)',
                          color: 'white', fontSize: 'clamp(1.15rem, 5vw, 1.55rem)', fontWeight: 800, textAlign: 'center',
                          outline: 'none', width: '82%', letterSpacing: '-0.01em',
                          padding: '2px 0 4px', fontFamily: 'inherit',
                          overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.3,
                        }}
                      />
                      {game.error && <p style={{ position: 'relative', color: '#f87171', fontSize: '0.65rem' }} aria-live="assertive">{game.error}</p>}
                    </>
                  ) : (
                    <button
                      onClick={startEdit}
                      aria-label="Edit your name"
                      style={{
                        position: 'relative', maxWidth: '85%',
                        display: 'flex', alignItems: 'center', gap: '6px',
                        background: 'none', border: 'none', cursor: 'pointer', color: 'white',
                        fontSize: 'clamp(1.15rem, 5vw, 1.55rem)', fontWeight: 800, letterSpacing: '-0.01em',
                      }}
                    >
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.3 }}>{game.myName}</span>
                      <Pencil style={{ width: '13px', height: '13px', color: 'rgba(255,255,255,0.45)', flexShrink: 0 }} />
                    </button>
                  )}
                </div>
              </div>
            </LiquidGlass>
          </div>
        </div>

        <span
          style={{
            color: 'rgba(255,255,255,0.5)', fontSize: '0.75rem', letterSpacing: '0.03em',
            animationName: 'waitingPulse', animationDuration: '2.6s', animationTimingFunction: 'ease-in-out', animationIterationCount: 'infinite',
          }}
        >
          Waiting for host to start…
        </span>
      </div>
    </div>
  );
}
