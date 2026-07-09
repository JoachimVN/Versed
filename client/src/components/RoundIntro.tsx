import { useEffect, useRef, useState } from 'react';
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

  useEffect(() => {
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
    transition: 'opacity 0.4s ease',
  };

  const content = (
    <div
      style={{
        textAlign: 'center', padding: '0 28px',
        transform: visible ? 'scale(1) translateY(0)' : 'scale(0.94) translateY(8px)',
        transition: 'transform 0.4s ease',
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

// Party extras shown under the reveal card: revealed multiplier, steal outcome
// (or "picking a victim…" while the thief decides). Shared by host and player.
export function PartyRevealExtras({ result, stealResult, hints }: Readonly<{
  result: RoundResultEvent;
  stealResult: { thief: string; victim: string; amount: number; skipped?: boolean } | null;
  hints?: Hint[];
}>) {
  const party = result.party;
  const chips: { text: string; reveal: boolean }[] = [];
  if (party?.event === 'mystery' && party.multiplier !== null) {
    chips.push({ text: `Mystery multiplier · ×${party.multiplier}`, reveal: true });
  } else if (party?.event === 'double') {
    chips.push({ text: 'Double points · ×2', reveal: false });
  } else if (party?.event === 'chaoshints' && result.chaosFakeIndex != null && hints?.[result.chaosFakeIndex]) {
    chips.push({ text: `The lie was · ${hints[result.chaosFakeIndex].label}`, reveal: true });
  }
  const showPending = !stealResult && !!result.stealPending;
  if (chips.length === 0 && !stealResult && !showPending) return null;
  return (
    <div className="flex flex-col items-center gap-2" style={{ maxWidth: '92vw' }}>
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
