import React, { useState } from 'react';
import type { PartyEvent, PartyRoundType } from '../../../types';
import { ALL_PARTY_EVENTS, ALL_PARTY_ROUND_TYPES } from '../useHostGame';

// Party mode's two on/off checklists. Both work the same way — a grid of
// toggle chips, All/None bulk actions, and a caption that describes whichever
// chip is hovered, focused or last tapped — so that shared machinery lives
// here once and each grid only supplies its own labels and wiring.

// ─── Shared chip machinery ───────────────────────────────────────────────────

function chipStyle(on: boolean): React.CSSProperties {
  return {
    borderRadius: '12px',
    minHeight: '46px',
    padding: '6px 10px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '0.78rem',
    fontWeight: on ? 600 : 400,
    textAlign: 'center',
    lineHeight: 1.25,
    cursor: 'pointer',
    color: on ? 'white' : 'rgba(255,255,255,0.5)',
    backdropFilter: 'blur(10px) saturate(130%)',
    background: on
      ? 'linear-gradient(135deg, rgba(0,128,126,0.22), rgba(52,39,88,0.26) 55%, rgba(110,32,155,0.32))'
      : 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
    boxShadow: on ? 'inset 0 1px 0 rgba(255,255,255,0.16)' : 'inset 0 1px 0 rgba(255,255,255,0.04)',
    transition: 'background 0.2s ease, border-color 0.2s ease, color 0.2s ease, box-shadow 0.2s ease',
  };
}

const BULK_BTN_STYLE: React.CSSProperties = {
  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
  color: 'rgba(255,255,255,0.4)', transition: 'color 0.15s',
};

function BulkButton({ label, onClick }: Readonly<{ label: string; onClick: () => void }>) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={BULK_BTN_STYLE}
      onMouseEnter={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.75)'; }}
      onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.4)'; }}
    >
      {label}
    </button>
  );
}

function ChipSectionHeader({ label, onAll, onNone }: Readonly<{ label: string; onAll: () => void; onNone: () => void }>) {
  return (
    <div className="flex items-center justify-between">
      <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.875rem' }}>{label}</span>
      <div className="flex items-center" style={{ gap: '6px', fontSize: '0.7rem' }}>
        <BulkButton label="All" onClick={onAll} />
        <span style={{ color: 'rgba(255,255,255,0.25)' }}>·</span>
        <BulkButton label="None" onClick={onNone} />
      </div>
    </div>
  );
}

// Which chip the caption is currently describing: hover wins over keyboard
// focus, which wins over the last one tapped (so a touch user keeps seeing
// the description of the chip they just toggled).
function useChipCaption<T extends string>() {
  const [hovered, setHovered] = useState<T | null>(null);
  const [focused, setFocused] = useState<T | null>(null);
  const [selected, setSelected] = useState<T | null>(null);
  return {
    shown: hovered ?? focused ?? selected,
    setSelected,
    handlersFor: (key: T) => ({
      onMouseEnter: () => setHovered(key),
      onMouseLeave: () => setHovered(null),
      onFocus: () => setFocused(key),
      onBlur: () => setFocused(null),
    }),
  };
}

function ChipCaption({ id, text }: Readonly<{ id: string; text: string }>) {
  return (
    <p id={id} aria-live="polite" style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.7rem', lineHeight: 1.4, minHeight: '2.1rem' }}>
      {text}
    </p>
  );
}

// ─── Events ──────────────────────────────────────────────────────────────────

// Human labels for the per-event on/off checklist — kept separate from
// RoundIntro.tsx's EVENT_BITS/the server's PARTY_EVENT_INTROS since those live
// in different modules and are styled for in-round display, not a settings list.
const EVENT_LABELS: Record<PartyEvent, string> = {
  double: 'Double Points',
  mystery: 'Mystery Multiplier',
  steal: 'Steal Round',
  snippet: 'Snippet Roulette',
  fullhints: 'Open Book',
  blind: 'Blind Bet',
  outro: 'Down to the Wire',
  underdog: 'Underdog Boost',
  chaoshints: 'Chaos Hints',
};

// One-line explanation shown under the Events chip grid. Adapted from
// server/src/party.ts's PARTY_EVENT_INTROS[...].tag (in-round announcement
// copy), but hand-maintained here as separate, settings-list-appropriate
// wording — can drift from the server copy if either changes.
const EVENT_DESCRIPTIONS: Record<PartyEvent, string> = {
  double: 'Everything is worth 2×',
  mystery: 'Revealed after the round: ×1.5 up to ×10',
  steal: 'Win the round, then rob another player',
  snippet: 'The clip starts somewhere mid-song',
  fullhints: 'Every hint on the table',
  blind: 'No hints at all. Bid on ears alone.',
  outro: "The clip plays the song's final stretch",
  underdog: 'Only players in last place can answer. Hints on, ×1.5 points.',
  chaoshints: 'One hint is a lie. Tap the fake one, fastest wins.',
};

export function EventChipGrid({ enabledEvents, onToggle, onSetAll }: Readonly<{
  enabledEvents: PartyEvent[]; onToggle: (e: PartyEvent) => void; onSetAll: (events: PartyEvent[]) => void;
}>) {
  const { shown, setSelected, handlersFor } = useChipCaption<PartyEvent>();

  const setAll = (events: PartyEvent[]) => {
    onSetAll(events);
    setSelected(null);
  };

  let caption: string;
  if (shown) {
    caption = EVENT_DESCRIPTIONS[shown];
  } else if (enabledEvents.length === 0) {
    caption = 'No events selected. Party rounds will play without event modifiers.';
  } else {
    caption = 'Tap or hover an event for details.';
  }

  return (
    <div className="space-y-2">
      <ChipSectionHeader label="Events" onAll={() => setAll(ALL_PARTY_EVENTS)} onNone={() => setAll([])} />
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
        {ALL_PARTY_EVENTS.map(e => {
          const on = enabledEvents.includes(e);
          return (
            <button
              key={e}
              type="button"
              aria-pressed={on}
              aria-describedby="event-caption"
              onClick={() => { onToggle(e); setSelected(e); }}
              {...handlersFor(e)}
              style={chipStyle(on)}
            >
              {EVENT_LABELS[e]}
            </button>
          );
        })}
      </div>
      <ChipCaption id="event-caption" text={caption} />
    </div>
  );
}

// ─── Round types ─────────────────────────────────────────────────────────────

// Human labels/descriptions for the Round Types checklist — the format/
// target/scoring variants a party round can roll (distinct from Events
// above, which are modifiers layered on top of whatever round type is
// picked). 'both'/Double Duty never combines with 'choice'/Multiple Choice
// (no UI slot for a second bonus answer), while 'year' can appear either as
// closest-guess year format or as a multiple-choice year target.
const ROUND_TYPE_LABELS: Record<PartyRoundType, string> = {
  classic: 'Classic',
  race: 'Race',
  choice: 'Multiple Choice',
  artist: 'Who Sings It?',
  both: 'Double Duty',
  year: 'Guess the Year',
  winnerOnly: 'Winner Takes All',
};
const ROUND_TYPE_DESCRIPTIONS: Record<PartyRoundType, string> = {
  classic: 'Bid low, score high',
  race: 'Everyone guesses at once — speed wins',
  choice: 'Tap the right answer from 4 options',
  artist: 'Name the artist instead of the title',
  both: 'Name the title — bonus for the artist too',
  year: 'Closest release-year guess wins the round',
  winnerOnly: 'Only the round winner scores — everyone else gets zero',
};

// 'finale' isn't a PartyRoundType — it doesn't get randomly rolled into a
// round like the others, it deterministically replaces the *last* round
// with a fixed best-of-3 duel (see party.ts's maybeBuildFinaleDuelConfig).
// It's shown as a chip here for visual/UX consistency, but stays wired to
// its own game-wide finaleEnabled boolean rather than the enabledRoundTypes
// set, and is excluded from the grid's All/None bulk actions.
type RoundTypeChipKey = PartyRoundType | 'finale';

const FINALE_CAPTION = 'Last round becomes a top-2 duel — first to answer correctly wins each of best-of-3.';

export function RoundTypeChipGrid({ enabledRoundTypes, onToggle, onSetAll, finaleEnabled, onToggleFinale }: Readonly<{
  enabledRoundTypes: PartyRoundType[]; onToggle: (t: PartyRoundType) => void; onSetAll: (types: PartyRoundType[]) => void;
  finaleEnabled: boolean; onToggleFinale: () => void;
}>) {
  const { shown, setSelected, handlersFor } = useChipCaption<RoundTypeChipKey>();

  const setAll = (types: PartyRoundType[]) => {
    onSetAll(types);
    setSelected(null);
  };

  let caption: string;
  if (shown === 'finale') {
    caption = FINALE_CAPTION;
  } else if (shown) {
    caption = ROUND_TYPE_DESCRIPTIONS[shown];
  } else if (enabledRoundTypes.length === 0) {
    caption = 'No round types selected. Party rounds will fall back to plain classic rounds.';
  } else {
    caption = 'Tap or hover a round type for details.';
  }

  return (
    <div className="space-y-2">
      <ChipSectionHeader label="Round Types" onAll={() => setAll(ALL_PARTY_ROUND_TYPES)} onNone={() => setAll([])} />
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
        {ALL_PARTY_ROUND_TYPES.map(t => {
          const on = enabledRoundTypes.includes(t);
          return (
            <button
              key={t}
              type="button"
              aria-pressed={on}
              aria-describedby="round-type-caption"
              onClick={() => { onToggle(t); setSelected(t); }}
              {...handlersFor(t)}
              style={chipStyle(on)}
            >
              {ROUND_TYPE_LABELS[t]}
            </button>
          );
        })}
        {/* Full-width and visually set apart (amethyst accent matching the
            finale-winner award color) since it isn't a random-pool ingredient
            like the chips above — it's a fixed, deterministic last round. */}
        <button
          type="button"
          aria-pressed={finaleEnabled}
          aria-describedby="round-type-caption"
          onClick={() => { onToggleFinale(); setSelected('finale'); }}
          {...handlersFor('finale')}
          style={{
            ...chipStyle(finaleEnabled),
            gridColumn: '1 / -1',
            background: finaleEnabled
              ? 'linear-gradient(135deg, rgba(198,95,232,0.28), rgba(110,32,155,0.32))'
              : 'rgba(255,255,255,0.03)',
            border: finaleEnabled ? '1px solid rgba(198,95,232,0.4)' : '1px solid rgba(255,255,255,0.06)',
          }}
        >
          Finale Duel
        </button>
      </div>
      <ChipCaption id="round-type-caption" text={caption} />
    </div>
  );
}
