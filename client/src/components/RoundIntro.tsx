import { useEffect, useState } from 'react';
import type { PartyInfo, RoundResultEvent } from '../types';

// How long the announcement stays up. Betting/countdown timers run underneath,
// so this must stay comfortably shorter than the shortest phase.
export const INTRO_MS = 2800;

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

  if (!party) return null;

  const dismiss = () => setVisible(false);

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
      <p style={{ color: 'rgba(255,255,255,0.32)', fontSize: '0.68rem', letterSpacing: '0.32em', textTransform: 'uppercase', marginBottom: '12px' }}>
        {party.finale ? 'Last round' : 'Next up'}
      </p>
      <h2
        style={{
          fontSize: '2.5rem', fontWeight: 900, lineHeight: 1.1,
          letterSpacing: '0.02em', textTransform: 'uppercase',
          fontFamily: "'Montserrat', sans-serif",
          background: 'linear-gradient(to bottom left, rgba(0,200,195,0.5) 0%, transparent 55%), linear-gradient(to top right, rgba(150,17,193,0.55) 0%, transparent 55%), #fff',
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
        <p style={{ color: 'rgba(255,255,255,0.22)', fontSize: '0.68rem', letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: '22px' }}>
          Tap to skip
        </p>
      )}
    </div>
  );

  if (dismissible) {
    return (
      <button
        type="button"
        onClick={dismiss}
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
export function PartyRevealExtras({ result, stealResult }: Readonly<{
  result: RoundResultEvent;
  stealResult: { thief: string; victim: string; amount: number; skipped?: boolean } | null;
}>) {
  const party = result.party;
  const chips: string[] = [];
  if (party?.event === 'mystery' && party.multiplier !== null) chips.push(`Mystery multiplier · ×${party.multiplier}`);
  else if (party?.event === 'double') chips.push('Double points · ×2');
  const showPending = !stealResult && !!result.stealPending;
  if (chips.length === 0 && !stealResult && !showPending) return null;
  return (
    <div className="flex flex-col items-center gap-2" style={{ maxWidth: '92vw' }}>
      {chips.map(c => (
        <span key={c} style={{
          padding: '6px 16px', borderRadius: '100px',
          background: 'rgba(0,200,195,0.1)', border: '1px solid rgba(0,200,195,0.3)',
          color: 'rgba(94,234,212,0.9)', fontSize: '0.72rem', fontWeight: 700,
          letterSpacing: '0.1em', textTransform: 'uppercase',
        }}>{c}</span>
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
        <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.75rem' }}>
          {result.stealPending} is choosing who to rob…
        </span>
      )}
    </div>
  );
}

// Small chip summarising the active round's recipe, shown on in-round screens.
export function PartyBadge({ party }: Readonly<{ party: PartyInfo | null }>) {
  if (!party) return null;
  const bits: string[] = [];
  if (party.finale) bits.push(`FINALE · ${party.duelists.join(' vs ')}`);
  if (party.format === 'year') bits.push('GUESS THE YEAR');
  else if (party.target === 'artist') bits.push('NAME THE ARTIST');
  else if (party.target === 'both') bits.push('TITLE + ARTIST');
  if (party.event === 'double') bits.push('2× POINTS');
  if (party.event === 'mystery') bits.push(party.multiplier === null ? 'MYSTERY ×?' : `MYSTERY ×${party.multiplier}`);
  if (party.event === 'steal') bits.push('STEAL ROUND');
  if (party.event === 'snippet') bits.push('SNIPPET');
  if (party.event === 'fullhints') bits.push('OPEN BOOK');
  if (bits.length === 0) return null;
  return (
    <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', flexWrap: 'wrap' }}>
      {bits.map(b => (
        <span
          key={b}
          style={{
            padding: '4px 12px', borderRadius: '100px',
            background: 'rgba(0,200,195,0.1)',
            border: '1px solid rgba(0,200,195,0.3)',
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
