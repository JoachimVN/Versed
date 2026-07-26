import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Hint, PartyInfo, RoundResultEvent } from '../types';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { REEL_STEPS_MS, REEL_LAND_MS, useRevealReelSound } from '../hooks/useRevealReelSound';

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

// Total time (ms) from mount until the reel lands on the real value — other
// reveal timing (e.g. delaying the score count-up) syncs against this so the
// multiplier is always visible before points start moving. Shares its step
// curve and total duration (2 beats at 112bpm) with the year reel — see
// useRevealReelSound.
export const MYSTERY_LANDING_MS = REEL_LAND_MS;

function pickMysteryCandidate(candidates: readonly number[]) {
  const randomValue = new Uint32Array(1);
  crypto.getRandomValues(randomValue);
  return candidates[randomValue[0] % candidates.length]!;
}

// Picks the next decoy, excluding both the real answer (via `pool`, already
// filtered by the caller) and whichever value is currently on screen — a
// flicker that can repeat its immediately-previous frame reads as the reel
// stalling rather than spinning.
function pickNextCandidate(pool: readonly number[], previous: number | null) {
  const options = previous === null ? pool : pool.filter(v => v !== previous);
  return pickMysteryCandidate(options.length > 0 ? options : pool);
}

function mysteryValueFontSize(landed: boolean): string {
  return landed ? '2.2rem' : '1.9rem';
}

// Three color tiers for the chip: a plain cyan/purple brand wash for the
// routine ×1.5-×4 rolls, gold for the ×5-×9 jackpot band, and a distinct
// violet for ×10 — the rarest roll — so it reads as a step up from ×5
// without changing the animation or layout, just the color.
type MysteryTier = 'base' | 'gold' | 'violet';

function mysteryTier(jackpot: boolean, jackpot10: boolean): MysteryTier {
  if (jackpot10) return 'violet';
  if (jackpot) return 'gold';
  return 'base';
}

const MYSTERY_COLORS: Record<MysteryTier, {
  background: string; border: string; label: string; valueGradient: string; glow: string;
}> = {
  base: {
    background: 'linear-gradient(155deg, rgba(0,238,232,0.18) 0%, rgba(158,18,204,0.1) 55%, rgba(255,255,255,0.04) 100%)',
    border: 'rgba(255,255,255,0.14)',
    label: 'rgba(94,234,212,0.9)',
    valueGradient: 'linear-gradient(to bottom left, rgba(0,238,232,0.5) 0%, transparent 55%), linear-gradient(to top right, rgba(158,18,204,0.55) 0%, transparent 55%), #fff',
    glow: 'rgba(251,191,36,0.35)', // unused — base tier never plays mysteryJackpotGlow
  },
  gold: {
    background: 'linear-gradient(155deg, rgba(251,191,36,0.24) 0%, rgba(217,119,6,0.08) 55%, rgba(255,255,255,0.04) 100%)',
    border: 'rgba(251,191,36,0.4)',
    label: 'rgba(253,224,71,0.9)',
    valueGradient: 'linear-gradient(to bottom left, rgba(251,191,36,0.6) 0%, transparent 55%), linear-gradient(to top right, rgba(255,221,120,0.55) 0%, transparent 55%), #fff',
    glow: 'rgba(251,191,36,0.35)',
  },
  violet: {
    background: 'linear-gradient(155deg, rgba(217,70,239,0.24) 0%, rgba(126,34,206,0.08) 55%, rgba(255,255,255,0.04) 100%)',
    border: 'rgba(217,70,239,0.4)',
    label: 'rgba(240,171,252,0.9)',
    valueGradient: 'linear-gradient(to bottom left, rgba(217,70,239,0.6) 0%, transparent 55%), linear-gradient(to top right, rgba(240,171,252,0.55) 0%, transparent 55%), #fff',
    glow: 'rgba(217,70,239,0.35)',
  },
};

// Slot-reel reveal for the mystery multiplier: flickers through a handful of
// decoy values (never repeating the immediately-previous one, see
// pickNextCandidate) before settling on the real one, instead of the value
// just appearing. ×5-×10 (the rare high rolls) keep pulsing gold after
// landing so the jackpot outcome reads as more exciting than a routine
// ×1.5-×4. ×10 — the rarest roll in the pool — reuses the exact same
// animation but in a distinct color, so it reads as a step up from ×5
// without the two competing for "which one is more special."
function MysteryMultiplierChip({ multiplier }: Readonly<{ multiplier: number }>) {
  const [display, setDisplay] = useState(multiplier);
  const [tick, setTick] = useState(0);
  const [landed, setLanded] = useState(false);
  const [reducedMotion] = useState(() => globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const playReveal = useRevealReelSound();

  useEffect(() => {
    if (reducedMotion) {
      setDisplay(multiplier);
      setLanded(true);
      return;
    }
    setLanded(false);
    playReveal(multiplier === 10 ? 3 : multiplier >= 5 ? 2 : 1);
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const pool = MYSTERY_CANDIDATES.filter(v => v !== multiplier);
    let previous: number | null = null;
    let i = 0;
    const step = () => {
      if (cancelled) return;
      if (i >= REEL_STEPS_MS.length) {
        setDisplay(multiplier);
        setLanded(true);
        return;
      }
      const next = pickNextCandidate(pool, previous);
      previous = next;
      setDisplay(next);
      setTick(t => t + 1);
      timer = setTimeout(step, REEL_STEPS_MS[i]);
      i++;
    };
    step();
    // React Strict Mode restarts effects in development. The restarted effect
    // must schedule its own landing timer, or the first random decoy remains
    // blurred indefinitely and can be mistaken for the real multiplier.
    return () => { cancelled = true; clearTimeout(timer); };
  }, [multiplier, reducedMotion, playReveal]);

  const jackpot = landed && multiplier >= 5;
  // ×10 shares every animation and timing beat with ×5-×9 — only the color
  // changes, via jackpot10 below — rather than an extra effect layered on
  // top (the previous diagonal light sweep never rendered reliably).
  const jackpot10 = jackpot && multiplier === 10;
  // Landing gets a one-shot white flash (slotFlash) plus an expanding ring
  // burst (slotLandBurst) on every roll — the jackpot's glow only kicks in
  // afterward, timed past those so nothing fights for the same instant.
  const landAnimation = jackpot
    ? 'slotLand 0.6s cubic-bezier(0.34, 1.56, 0.64, 1), slotFlash 0.7s ease-out, slotLandBurst 0.6s ease-out, mysteryJackpotGlow 1.8s ease-in-out 0.6s infinite'
    : 'slotLand 0.6s cubic-bezier(0.34, 1.56, 0.64, 1), slotFlash 0.7s ease-out, slotLandBurst 0.6s ease-out';
  // A soft diagonal wash (brand cyan→purple; gold for ×5-×9; violet for ×10)
  // plus an inner top highlight and drop shadow reads as a glass card
  // consistent with the rest of the app, rather than a single flat tinted
  // fill with a matching border — the "sticker" look a flat color pill tends
  // to read as.
  const colors = MYSTERY_COLORS[mysteryTier(jackpot, jackpot10)];
  return (
    <span
      // A fresh key per flicker tick (and a distinct one on landing) forces
      // the animation to restart on every value change instead of continuing
      // a stale one — a plain style-string diff wouldn't retrigger it.
      key={landed ? `landed-${multiplier}` : `spin-${tick}`}
      style={{
        position: 'relative', overflow: 'hidden',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px',
        padding: landed ? '12px 28px' : '10px 24px', borderRadius: '18px',
        background: colors.background,
        border: `1px solid ${colors.border}`,
        boxShadow: `inset 0 1px 0 ${jackpot ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.14)'}, 0 10px 26px rgba(0,0,0,0.35)`,
        backdropFilter: 'blur(18px)',
        animation: landed ? landAnimation : 'slotSpinTick 0.14s ease-out',
        '--mystery-glow-color': colors.glow,
      } as CSSProperties}
    >
      <span style={{
        fontSize: '0.62rem', fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase',
        color: colors.label,
      }}>
        Mystery Multiplier
      </span>
      <span style={{
        fontSize: mysteryValueFontSize(landed), fontWeight: 900, lineHeight: 1,
        background: colors.valueGradient,
        WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
        // The chip itself pulses while a sharp, dim value rolls through it;
        // a clear reel motion communicates that this is a decoy without
        // obscuring the number.
        animation: landed ? undefined : 'slotReelTick 0.14s ease-out',
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
