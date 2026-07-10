import { useState, useLayoutEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { Pencil } from 'lucide-react';
import LiquidGlass from 'liquid-glass-react';
import { useLogoMorph } from '../../contexts/LogoMorph';
import { BackButton } from '../../components/BackButton';
import { LIQUID_LABEL_PROPS } from '../../components/liquidGlassPresets';
import { APP_NAME } from '../../config';
import type { PlayState } from './usePlayGame';
import { useMorphBack, pageTransitionClass } from './morph';

export function WaitingView({ game }: Readonly<{ game: PlayState }>) {
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [leaving, setLeaving] = useState(false);
  const logoRef = useRef<HTMLImageElement>(null);
  const { beginMorph, provideTarget, morphing, reducedMotion } = useLogoMorph();

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

  // Mirrors JoinView's goBack.
  const goBack = useMorphBack(logoRef, setLeaving, beginMorph, reducedMotion);

  const startEdit = () => { setDraftName(game.myName); setEditing(true); };
  const cancelEdit = () => setEditing(false);
  const confirmEdit = () => {
    if (!draftName.trim() || draftName.trim() === game.myName) { setEditing(false); return; }
    game.renamePlayer(draftName);
    setEditing(false);
  };

  return (
    <div className="relative min-h-screen overflow-hidden">
      {/* Background */}
      <img
        src={`${import.meta.env.BASE_URL}background.svg`}
        alt=""
        aria-hidden="true"
        style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 0 }}
      />
      {/* Blur + dark scrim */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 1, background: 'rgba(5,5,14,0.80)', backdropFilter: 'blur(28px)' }} />

      {/* Content */}
      <div
        className={`relative flex flex-col items-center justify-center min-h-screen gap-8 p-6 ${pageTransitionClass(leaving, morphing)}`}
        style={{ zIndex: 2, pointerEvents: leaving ? 'none' : undefined }}
      >
        <BackButton beforeNavigate={goBack} />
        <img
          ref={logoRef}
          src={`${import.meta.env.BASE_URL}logo.png`}
          alt={APP_NAME}
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
              1) the grooved surface. Static — the spin lives on the glass
                 label assembly below instead (see there for why). Real vinyl
                 grooves are far too fine to render as individually countable
                 rings without reading as a cheap "target/bullseye" pattern —
                 so this is a single very tight, very low-contrast repeating
                 ring, closer to a brushed texture than a bullseye.
              2) a fixed soft gloss sheen + corner shadow. A blurred
                 elliptical highlight reads as glossy plastic; a hard conic
                 wedge reads as flat/cheap, so this avoids conic-gradient
                 entirely.
              3) a dark tint scoped to the label footprint only (not the
                 whole disc), so the glass reads as an opaque, frosted pane
                 over the record without dimming the visible groove ring. */}
          <div
            aria-hidden="true"
            style={{
              position: 'absolute', inset: 0, borderRadius: '50%',
              background: `
                radial-gradient(ellipse 14% 36% at 78% 26%, rgba(255,255,255,0.20), transparent 72%),
                radial-gradient(ellipse 10% 26% at 20% 74%, rgba(255,255,255,0.13), transparent 72%),
                repeating-radial-gradient(circle, rgba(255,255,255,0.05) 0px, rgba(255,255,255,0.05) 1px, transparent 2px, transparent 4px),
                radial-gradient(circle, #2a2438 0%, #171225 42%, #0a0812 74%, #030204 100%)
              `,
            }}
          />
          <div
            aria-hidden="true"
            style={{
              position: 'absolute', inset: 0, borderRadius: '50%', pointerEvents: 'none',
              background: `
                radial-gradient(ellipse 50% 32% at 30% 18%, rgba(255,255,255,0.16), transparent 72%),
                radial-gradient(circle at 74% 82%, rgba(0,0,0,0.4), transparent 55%)
              `,
              boxShadow: '0 0 0 1px rgba(255,255,255,0.09) inset, 0 12px 40px rgba(0,0,0,0.55), 0 0 55px rgba(158,18,204,0.14), 0 0 85px rgba(0,238,232,0.05)',
            }}
          />
          <div
            aria-hidden="true"
            style={{
              position: 'absolute', top: '50%', left: '50%', width: 'calc(var(--label-size) * 1.06)', height: 'calc(var(--label-size) * 1.06)',
              transform: 'translate(-50%, -50%)', borderRadius: '50%', pointerEvents: 'none',
              background: 'rgba(8,7,14,0.5)',
              boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            }}
          />

          {/* Circular glass label — sized well under the disc (see note
              above), like a liquid-glass pane laid directly over the vinyl
              surface. This is what actually spins (the grooves don't) — the
              glass's own refraction/sheen reads as motion far better than a
              highlight sweeping around static grooves did. Its content div
              below counter-rotates at the same rate so the spin cancels out
              for the text/name, which stays upright and readable. */}
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
