import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { Hint, PartyInfo, RoundResultEvent } from '../types';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { useFocusTrap } from '../hooks/useFocusTrap';

// How long the announcement stays up. Betting/countdown timers run underneath,
// so this must stay comfortably shorter than the shortest phase (5s minimum).
export const INTRO_MS = 4000;

// Full-screen round announcement for party mode ("DOUBLE POINTS", "THE
// FINALE", …). Purely client-side: mounts on round_start and fades itself
// out. Only the host can dismiss it early by clicking/tapping — players see
// the same announcement everyone else does and can't skip past it, so it
// stays a shared "everyone reads this" beat rather than a per-player one.
export function RoundIntro({ party, roundKey, dismissible = true }: Readonly<{ party: PartyInfo | null; roundKey: number; dismissible?: boolean }>) {
  const [visible, setVisible] = useState(false);

  // Arm the announcement before the browser paints the new round screen.
  // A normal effect leaves one frame where hints can be visible underneath.
  useLayoutEffect(() => {
    if (!party) return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), INTRO_MS);
    return () => clearTimeout(t);
  }, [party, roundKey]);

  const dismiss = () => setVisible(false);
  const overlayRef = useRef<HTMLButtonElement>(null);
  const trapActive = dismissible && visible && !!party;
  useEscapeKey(dismiss, trapActive);
  useFocusTrap(overlayRef, trapActive);

  if (!party) return null;

  // Event/target titles ("Double Points", "Who Sings It?", "The Finale", …)
  // don't say whether this is a bid-and-guess or everyone-at-once round, so
  // a flow badge always shows it up front regardless of which flavor of
  // intro is displayed. Year rounds skip it — "Guess the Year" is already
  // unambiguous on its own.
  let flowBadge: { label: string; color: string; bg: string; border: string } | null = null;
  if (party.format === 'race') {
    flowBadge = { label: 'Race Round', color: 'rgba(253,186,116,0.95)', bg: 'rgba(234,88,12,0.14)', border: 'rgba(234,88,12,0.4)' };
  } else if (party.format === 'classic') {
    flowBadge = { label: 'Classic Round', color: 'rgba(216,180,254,0.95)', bg: 'rgba(158,18,204,0.14)', border: 'rgba(158,18,204,0.4)' };
  }

  const overlayStyle = {
    position: 'fixed' as const, inset: 0, zIndex: 60,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'rgba(5,5,14,0.9)', backdropFilter: 'blur(24px)',
    opacity: visible ? 1 : 0,
    pointerEvents: visible ? 'auto' as const : 'none' as const,
    // Appearing must be instant, never a fade-in: a fading-in overlay spends its
    // first frames translucent, letting the hint screen underneath show through
    // before it's supposed to be revealed. Only the dismiss/timeout transition
    // (going to hidden) animates — that's an intentional reveal, not a race.
    transition: visible ? 'none' : 'opacity 0.4s ease',
  };

  const content = (
    <div
      style={{
        textAlign: 'center', padding: '0 28px',
        // The backdrop itself snaps in instantly (see overlayStyle) so it can
        // never be caught mid-fade with the hint screen showing through — the
        // graceful reveal instead lives here, fading/scaling the announcement
        // in on top of the already-opaque backdrop, which is always safe.
        opacity: visible ? 1 : 0,
        transform: visible ? 'scale(1) translateY(0)' : 'scale(0.94) translateY(8px)',
        transition: 'opacity 0.4s ease, transform 0.4s ease',
      }}
    >
      <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.68rem', letterSpacing: '0.32em', textTransform: 'uppercase', marginBottom: '12px' }}>
        {party.finale ? 'Last round' : 'Next up'}
      </p>
      {flowBadge && (
        <span style={{
          display: 'inline-block', padding: '5px 14px', borderRadius: '100px',
          background: flowBadge.bg, border: `1px solid ${flowBadge.border}`,
          color: flowBadge.color, fontSize: '0.68rem', fontWeight: 800,
          letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: '16px',
        }}>
          {flowBadge.label}
        </span>
      )}
      <h2
        style={{
          fontSize: '2.5rem', fontWeight: 900, lineHeight: 1.1,
          letterSpacing: '0.02em', textTransform: 'uppercase',
          fontFamily: "'Montserrat', sans-serif",
          background: 'linear-gradient(to bottom left, rgba(0,238,232,0.5) 0%, transparent 55%), linear-gradient(to top right, rgba(158,18,204,0.55) 0%, transparent 55%), #fff',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
          marginBottom: '14px',
        }}
      >
        {party.intro.title}
      </h2>
      <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.95rem', lineHeight: 1.5, maxWidth: '340px', margin: '0 auto' }}>
        {party.intro.tagline}
      </p>
      {dismissible && (
        <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.68rem', letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: '22px' }}>
          Tap to skip
        </p>
      )}
    </div>
  );

  if (dismissible) {
    return (
      <button
        ref={overlayRef}
        type="button"
        onClick={dismiss}
        aria-label="Dismiss round announcement"
        tabIndex={visible ? 0 : -1}
        aria-hidden={!visible}
        style={{ ...overlayStyle, border: 'none', padding: 0, margin: 0, font: 'inherit', color: 'inherit', cursor: 'pointer' }}
      >
        {content}
      </button>
    );
  }

  return (
    <div style={{ ...overlayStyle, cursor: 'default' }}>
      {content}
    </div>
  );
}

// Candidate values the reel flickers through before landing — the real
// weight pool from gameManager's MYSTERY_WEIGHTS, minus whatever the actual
// roll landed on (that's added back as the final, held frame).
const MYSTERY_CANDIDATES = [1.5, 2, 3, 4, 5, 10];

// Step durations for the flicker, front-loaded fast then slowing down like a
// wheel losing momentum — the deceleration is what sells "landing" rather
// than "the label just changed". The last two steps are the longest of all,
// stretching out the final "is it going to be a big one?" beat.
const MYSTERY_SPIN_STEPS_MS = [55, 65, 80, 95, 115, 140, 170, 205, 245, 290, 350, 420];

// Total time (ms) from mount until the reel lands on the real value — other
// reveal timing (e.g. delaying the score count-up) syncs against this so the
// multiplier is always visible before points start moving.
export const MYSTERY_LANDING_MS = MYSTERY_SPIN_STEPS_MS.reduce((a, b) => a + b, 0);

function pickMysteryCandidate(candidates: readonly number[]) {
  const randomValue = new Uint32Array(1);
  crypto.getRandomValues(randomValue);
  return candidates[randomValue[0] % candidates.length]!;
}

// Angles for the spark burst fired outward from the chip on a ×10 roll — one
// full ring so it reads as an explosion rather than a directional flick.
const MEGA_SPARK_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];

// One-shot tone with a short exponential attack/decay envelope. Exponential
// ramps can't target exactly 0 (Web Audio throws), hence the 0.0001 floor.
function playTone(ctx: AudioContext, freq: number, type: OscillatorType, startOffset: number, duration: number, peakGain: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const t0 = ctx.currentTime + startOffset;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(peakGain, t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

// Synthesized landing cue, tiered with the visual payoff: every roll gets a
// soft ding, ×5 gets a two-note chime with a shimmer layer, and the rare ×10
// gets a sub "thump" for weight plus a rising major-chord arpeggio (with an
// octave-up shimmer doubling each note) so it reads as the jackpot.
function playMysteryChime(ctx: AudioContext, tier: 'normal' | 'jackpot' | 'mega') {
  if (tier === 'normal') {
    playTone(ctx, 784, 'sine', 0, 0.22, 0.16);
    return;
  }
  if (tier === 'jackpot') {
    playTone(ctx, 587, 'sine', 0, 0.18, 0.18);
    playTone(ctx, 784, 'sine', 0.09, 0.28, 0.2);
    playTone(ctx, 784, 'triangle', 0.09, 0.28, 0.05);
    return;
  }
  playTone(ctx, 90, 'sine', 0, 0.35, 0.3);
  const notes = [523.25, 659.25, 783.99, 1046.5];
  notes.forEach((f, i) => {
    playTone(ctx, f, 'triangle', 0.05 + i * 0.075, 0.3, 0.18);
    playTone(ctx, f * 2, 'sine', 0.05 + i * 0.075, 0.2, 0.05);
  });
}

// Slot-reel reveal for the mystery multiplier: flickers through a handful of
// decoy values before settling on the real one, instead of the value just
// appearing. ×5/×10 (the rare high rolls) keep pulsing gold after landing so
// the jackpot outcome reads as more exciting than a routine ×1.5-×4. ×10
// specifically — the rarest roll in the pool — gets a bigger payoff again on
// top of that: a second expanding ring, an outward spark burst, and a hotter
// glow, so the best possible outcome doesn't look the same as a plain ×5.
function MysteryMultiplierChip({ multiplier }: Readonly<{ multiplier: number }>) {
  const [display, setDisplay] = useState(multiplier);
  const [tick, setTick] = useState(0);
  const [landed, setLanded] = useState(false);
  const spunFor = useRef<number | null>(null);
  const [reducedMotion] = useState(() => globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // A dedicated AudioContext for this chip rather than reusing useSoundEffect
  // (which fetches/decodes a file) — these tones are synthesized, no asset to
  // load. Same resume-on-gesture dance since the context starts suspended.
  useEffect(() => {
    const ctx = new AudioContext();
    audioCtxRef.current = ctx;
    const resume = () => { ctx.resume().catch(() => {}); };
    document.addEventListener('pointerdown', resume);
    document.addEventListener('keydown', resume);
    return () => {
      document.removeEventListener('pointerdown', resume);
      document.removeEventListener('keydown', resume);
      ctx.close().catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (spunFor.current === multiplier) return;
    spunFor.current = multiplier;
    const tier: 'normal' | 'jackpot' | 'mega' = multiplier === 10 ? 'mega' : multiplier >= 5 ? 'jackpot' : 'normal';
    if (reducedMotion) {
      setDisplay(multiplier);
      setLanded(true);
      if (audioCtxRef.current) playMysteryChime(audioCtxRef.current, tier);
      return;
    }
    setLanded(false);
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const pool = MYSTERY_CANDIDATES.filter(v => v !== multiplier);
    let i = 0;
    const step = () => {
      if (cancelled) return;
      if (i >= MYSTERY_SPIN_STEPS_MS.length) {
        setDisplay(multiplier);
        setLanded(true);
        if (audioCtxRef.current) playMysteryChime(audioCtxRef.current, tier);
        return;
      }
      setDisplay(pickMysteryCandidate(pool));
      setTick(t => t + 1);
      timer = setTimeout(step, MYSTERY_SPIN_STEPS_MS[i]);
      i++;
    };
    step();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [multiplier, reducedMotion]);

  const jackpot = landed && multiplier >= 5;
  const superJackpot = jackpot && multiplier === 10 && !reducedMotion;
  // Landing gets a one-shot white flash (slotFlash) plus an expanding ring
  // burst (slotLandBurst) on every roll — the jackpot's gold glow only kicks
  // in afterward, timed past those so nothing fights for the same instant.
  // ×10 layers a second, larger ring (mysteryMegaRing) right after the first
  // and swaps in a hotter continuous glow instead of the standard one.
  const landAnimation = jackpot
    ? [
        'slotLand 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
        'slotFlash 0.7s ease-out',
        'slotLandBurst 0.6s ease-out',
        ...(superJackpot ? ['mysteryMegaRing 0.9s ease-out 0.08s'] : []),
        superJackpot ? 'mysteryMegaGlow 1.4s ease-in-out 0.6s infinite' : 'mysteryJackpotGlow 1.6s ease-in-out 0.6s infinite',
      ].join(', ')
    : 'slotLand 0.6s cubic-bezier(0.34, 1.56, 0.64, 1), slotFlash 0.7s ease-out, slotLandBurst 0.6s ease-out';
  return (
    <span
      // A fresh key per flicker tick (and a distinct one on landing) forces
      // the animation to restart on every value change instead of continuing
      // a stale one — a plain style-string diff wouldn't retrigger it.
      key={landed ? `landed-${multiplier}` : `spin-${tick}`}
      style={{
        position: 'relative',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px',
        padding: landed ? '12px 28px' : '10px 24px', borderRadius: '20px',
        background: jackpot ? 'rgba(251,191,36,0.14)' : 'rgba(0,238,232,0.1)',
        border: `1px solid ${jackpot ? 'rgba(251,191,36,0.45)' : 'rgba(0,238,232,0.3)'}`,
        animation: landed ? landAnimation : 'slotSpinTick 0.14s ease-out',
      }}
    >
      {superJackpot && MEGA_SPARK_ANGLES.map((angle, i) => (
        <span
          key={`spark-${multiplier}-${angle}`}
          style={{
            position: 'absolute', top: '50%', left: '50%', width: '5px', height: '5px',
            borderRadius: '50%', pointerEvents: 'none',
            background: 'radial-gradient(circle, #fff 0%, #fbbf24 60%, transparent 100%)',
            '--spark-angle': `${angle}deg`,
            animation: `mysterySpark 0.7s ease-out ${0.08 + i * 0.015}s backwards`,
          } as React.CSSProperties}
        />
      ))}
      <span style={{
        display: 'flex', alignItems: 'center', gap: '4px',
        fontSize: '0.62rem', fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase',
        color: jackpot ? 'rgba(253,224,71,0.9)' : 'rgba(94,234,212,0.9)',
      }}>
        {jackpot && <Sparkles style={{ width: '10px', height: '10px' }} />}
        Mystery Multiplier
        {jackpot && <Sparkles style={{ width: '10px', height: '10px' }} />}
      </span>
      <span style={{
        fontSize: landed ? (superJackpot ? '2.5rem' : '2.2rem') : '1.9rem', fontWeight: 900, lineHeight: 1,
        background: jackpot
          ? 'linear-gradient(to bottom left, rgba(251,191,36,0.6) 0%, transparent 55%), linear-gradient(to top right, rgba(255,221,120,0.55) 0%, transparent 55%), #fff'
          : 'linear-gradient(to bottom left, rgba(0,238,232,0.5) 0%, transparent 55%), linear-gradient(to top right, rgba(158,18,204,0.55) 0%, transparent 55%), #fff',
        WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
        // Same reasoning as the year reveal (RevealShared.tsx): a decoy tick
        // at full clarity could be mistaken for the real multiplier by
        // anyone glancing at exactly the wrong instant.
        filter: landed ? undefined : 'blur(3px)',
      }}>
        ×{display}
      </span>
    </span>
  );
}

// Party extras shown under the reveal card: revealed multiplier, steal outcome
// (or "picking a victim…" while the thief decides). Shared by host and player
// — hideMysteryChip lets the player's own screen opt out of the slot-reel
// reveal entirely, keeping the "what will it be?" moment host-screen-only
// (e.g. a shared TV) instead of every phone re-running its own reel too.
export function PartyRevealExtras({ result, stealResult, hints, hideMysteryChip = false }: Readonly<{
  result: RoundResultEvent;
  stealResult: { thief: string; victim: string; amount: number; skipped?: boolean } | null;
  hints?: Hint[];
  hideMysteryChip?: boolean;
}>) {
  const party = result.party;
  const mysteryMultiplier = !hideMysteryChip && party?.event === 'mystery' ? party.multiplier : null;
  const chips: { text: string; reveal: boolean }[] = [];
  if (party?.event === 'double') {
    chips.push({ text: 'Double points · ×2', reveal: false });
  } else if (party?.event === 'chaoshints' && result.chaosFakeIndex != null && hints?.[result.chaosFakeIndex]) {
    chips.push({ text: `The lie was · ${hints[result.chaosFakeIndex].label}`, reveal: true });
  }
  const showPending = !stealResult && !!result.stealPending;
  if (mysteryMultiplier === null && chips.length === 0 && !stealResult && !showPending) return null;
  return (
    <div className="flex flex-col items-center gap-2" style={{ maxWidth: '92vw' }}>
      {mysteryMultiplier !== null && <MysteryMultiplierChip multiplier={mysteryMultiplier} />}
      {chips.map(c => (
        <span key={c.text} style={{
          padding: '6px 16px', borderRadius: '100px',
          background: 'rgba(0,238,232,0.1)', border: '1px solid rgba(0,238,232,0.3)',
          color: 'rgba(94,234,212,0.9)', fontSize: '0.72rem', fontWeight: 700,
          letterSpacing: '0.1em', textTransform: 'uppercase',
          // The mystery multiplier is only just now revealed — a quick pop
          // sells it as a reveal rather than a chip that was there all along.
          animation: c.reveal ? 'chipReveal 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)' : undefined,
        }}>{c.text}</span>
      ))}
      {stealResult?.skipped && (
        <span style={{
          padding: '6px 16px', borderRadius: '100px',
          background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
          color: 'rgba(255,255,255,0.5)', fontSize: '0.78rem', fontWeight: 600,
        }}>
          {stealResult.thief} skipped the steal
        </span>
      )}
      {stealResult && !stealResult.skipped && (
        <span style={{
          padding: '6px 16px', borderRadius: '100px',
          background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.35)',
          color: 'rgba(252,165,165,0.95)', fontSize: '0.78rem', fontWeight: 600,
          // This pill only mounts the instant the steal resolves — a quick
          // pop sells it as "this just happened" rather than a chip that was
          // there all along, same as the chaos-hints lie reveal above.
          animation: 'chipReveal 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}>
          {stealResult.thief} stole {stealResult.amount.toLocaleString()} pts from {stealResult.victim}
        </span>
      )}
      {showPending && (
        <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.75rem' }}>
          {result.stealPending} is choosing who to rob…
        </span>
      )}
    </div>
  );
}

// Static label for every event except 'mystery', whose bit depends on the
// revealed multiplier value.
const EVENT_BITS: Partial<Record<NonNullable<PartyInfo['event']>, string>> = {
  double: '2× POINTS',
  steal: 'STEAL ROUND',
  snippet: 'SNIPPET',
  fullhints: 'OPEN BOOK',
  blind: 'BLIND BET · NO HINTS',
  outro: 'DOWN TO THE WIRE',
  underdog: 'UNDERDOG BOOST',
  chaoshints: 'CHAOS HINTS',
};

// Whether this is a bid-and-guess or everyone-at-once round isn't implied by
// the target/event bits below, so it always leads — otherwise a plain round
// with no special target or event shows no badge at all mid-round.
function formatBit(party: PartyInfo): string {
  if (party.format === 'year') return 'GUESS THE YEAR';
  if (party.format === 'choice') return 'MULTIPLE CHOICE';
  return party.format === 'race' ? 'RACE ROUND' : 'CLASSIC ROUND';
}

// Target always gets an explicit bit (title included) — leaving the plain
// title case silent made its absence read as ambiguous rather than as
// "title," especially once the badge also shows during actual guessing.
function targetBit(party: PartyInfo): string {
  if (party.target === 'year') return 'GUESS THE YEAR';
  if (party.target === 'artist') return 'NAME THE ARTIST';
  if (party.target === 'both') return 'TITLE + ARTIST';
  return 'NAME THE SONG';
}

function eventBit(party: PartyInfo): string | null {
  if (party.event === 'mystery') return party.multiplier === null ? 'MYSTERY ×?' : `MYSTERY ×${party.multiplier}`;
  return party.event ? (EVENT_BITS[party.event] ?? null) : null;
}

// Small chip summarising the active round's recipe, shown on in-round screens.
export function PartyBadge({ party }: Readonly<{ party: PartyInfo | null }>) {
  if (!party) return null;
  const bits: string[] = [formatBit(party)];
  if (party.finale) {
    const wins = party.duelProgress?.wins;
    bits.push(wins?.length === 2
      ? `FINALE · ${wins[0].name} ${wins[0].count}–${wins[1].count} ${wins[1].name}`
      : `FINALE · ${party.duelists.join(' vs ')}`);
  }
  else if (party.event === 'underdog') {
    bits.push(party.restricted.length > 0 ? `UNDERDOG ×1.5 · ${party.restricted.join(' & ')}` : 'UNDERDOG BOOST ×1.5');
  } else if (party.winnerOnly) bits.push('WINNER ONLY');
  // Chaos Hints replaces the guessing objective entirely, so the usual
  // "name the song/artist" target bit would be actively misleading here.
  if (party.format !== 'year' && party.event !== 'chaoshints') bits.push(targetBit(party));
  const event = party.event === 'underdog' ? null : eventBit(party);
  if (event) bits.push(event);
  return (
    <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', flexWrap: 'wrap' }}>
      {bits.map(b => (
        <span
          key={b}
          style={{
            padding: '4px 12px', borderRadius: '100px',
            background: 'rgba(0,238,232,0.1)',
            border: '1px solid rgba(0,238,232,0.3)',
            color: 'rgba(94,234,212,0.9)',
            fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.14em',
            whiteSpace: 'nowrap',
          }}
        >
          {b}
        </span>
      ))}
    </div>
  );
}
