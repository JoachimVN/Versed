import React, { useState, useEffect, useRef } from 'react';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import type { ChaosLevel, PartyEvent, PartyRoundType, SongSource } from '../../types';
import {
  mergeUniqueTracks,
  MAX_POOL_TRACKS,
  ALL_PARTY_EVENTS,
  ALL_PARTY_ROUND_TYPES,
  type HostState,
  type Difficulty,
  type CustomPlaylist,
} from './useHostGame';

export function SettingsPanel({ game, open }: Readonly<{ game: HostState; open: boolean }>) {
  const {
    mode, bettingTimeSetting, guessingTimeSetting, roundsSetting, raceTimeSetting, raceWinnerOnly, artistOnly, yearOnly, multipleChoice, difficulty,
    enabledEvents, enabledRoundTypes, chaosLevel,
    songSource, customPlaylists,
    setBettingTimeSetting, setGuessingTimeSetting, setRoundsSetting, setRaceTimeSetting, setRaceWinnerOnly, setArtistOnly, setYearOnly, setMultipleChoice, setDifficulty,
    toggleEvent, setEnabledEvents, toggleRoundType, setEnabledRoundTypes, setChaosLevel,
    setSongSource, openPlaylistPicker, removePlaylist,
    toggleSettings,
  } = game;
  const panelRef = useRef<HTMLDialogElement>(null);
  useEscapeKey(toggleSettings, open);
  useFocusTrap(panelRef, open);
  return (
    <dialog
      ref={panelRef}
      open
      aria-modal="true"
      aria-label="Game settings"
      className="absolute right-5 z-20"
      style={{
        top: '68px',
        left: 'auto',
        bottom: 'auto',
        margin: 0,
        border: 'none',
        padding: 0,
        background: 'transparent',
        color: 'inherit',
        opacity: open ? 1 : 0,
        transform: open ? 'translateY(0) scale(1)' : 'translateY(-10px) scale(0.96)',
        pointerEvents: open ? 'auto' : 'none',
        transition: 'opacity 0.2s ease, transform 0.22s ease',
        transformOrigin: 'top right',
      }}
    >
      <div
        className="w-72 rounded-2xl overflow-x-hidden overflow-y-auto"
        style={{
          maxHeight: 'calc(100dvh - 88px)',
          overscrollBehavior: 'contain',
          background: 'rgba(10, 6, 26, 0.65)',
          backdropFilter: 'blur(32px)',
          border: '1px solid rgba(255,255,255,0.09)',
          boxShadow: '0 24px 48px rgba(0,0,0,0.4), inset 0 0 0 1px rgba(255,255,255,0.04)',
        }}
      >
        <div className="px-5 py-3.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.6rem', letterSpacing: '0.22em', textTransform: 'uppercase' }}>
            Game Settings
          </p>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div style={{ paddingBottom: '12px', marginBottom: '12px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
            <SongSourceRow value={songSource} onChange={setSongSource} />
            {songSource === 'playlist' && (
              <div className="mt-3 space-y-2">
                <PlaylistList customPlaylists={customPlaylists} onOpen={openPlaylistPicker} onRemove={removePlaylist} />
                <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.75rem' }}>All songs play at equal difficulty</p>
              </div>
            )}
          </div>
          {/* Party mixes classic and race rounds, so it needs all three timers.
              Classic's "Guess the year" still runs the normal bid/tier flow
              (bet time picks the clip, guess time is the per-tier window), so
              it always uses Bet/Guess time, never Round time. */}
          {mode !== 'race' && (
            <>
              <SettingRow label="Bet time" value={bettingTimeSetting} unit="s" min={5}
                onDec={() => setBettingTimeSetting(Math.max(5, bettingTimeSetting - 5))}
                onInc={() => setBettingTimeSetting(Math.min(999, bettingTimeSetting + 5))}
                onChange={setBettingTimeSetting} />
              <SettingRow label="Guess time" value={guessingTimeSetting} unit="s" min={5}
                onDec={() => setGuessingTimeSetting(Math.max(5, guessingTimeSetting - 5))}
                onInc={() => setGuessingTimeSetting(Math.min(999, guessingTimeSetting + 5))}
                onChange={setGuessingTimeSetting} />
            </>
          )}
          {mode !== 'classic' && (
            <SettingRow label={mode === 'party' ? 'Race time' : 'Round time'} value={raceTimeSetting} unit="s" min={10}
              onDec={() => setRaceTimeSetting(Math.max(10, raceTimeSetting - 5))}
              onInc={() => setRaceTimeSetting(Math.min(999, raceTimeSetting + 5))}
              onChange={setRaceTimeSetting} />
          )}
          <SettingRow label="Rounds" value={roundsSetting} unit=""
            onDec={() => setRoundsSetting(Math.max(1, roundsSetting - 1))}
            onInc={() => setRoundsSetting(Math.min(999, roundsSetting + 1))}
            onChange={setRoundsSetting} />
          {songSource === 'library' && <DifficultyRow value={difficulty} onChange={setDifficulty} />}
        </div>

        {/* Party picks guess targets per round, so the game-wide toggles only
            apply to classic and race. */}
        {mode !== 'party' && (
          <div className="px-5 pb-4 space-y-4" style={{ borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: '16px' }}>
            {mode === 'race' && (
              <ToggleRow label="Winner only" value={raceWinnerOnly} onToggle={() => setRaceWinnerOnly(!raceWinnerOnly)} />
            )}
            {/* Both can now be on at once — each round then independently
                rolls artist or year as its target, rather than asking one
                fixed target for the whole game. */}
            <ToggleRow label="Artist only" value={artistOnly} onToggle={() => setArtistOnly(!artistOnly)} />
            <ToggleRow label="Guess the year" value={yearOnly} onToggle={() => setYearOnly(!yearOnly)} />
            <ToggleRow label="Multiple Choice" value={multipleChoice} onToggle={() => setMultipleChoice(!multipleChoice)} />
          </div>
        )}

        {mode === 'party' && (
          <div className="px-5 pb-4 space-y-4" style={{ borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: '16px' }}>
            <ChaosLevelRow value={chaosLevel} onChange={setChaosLevel} disabled={enabledEvents.length === 0} />
            <EventChipGrid enabledEvents={enabledEvents} onToggle={toggleEvent} onSetAll={setEnabledEvents} />
            <RoundTypeChipGrid enabledRoundTypes={enabledRoundTypes} onToggle={toggleRoundType} onSetAll={setEnabledRoundTypes} />
          </div>
        )}
      </div>
    </dialog>
  );
}

const STEPPER_BTN_BG = 'rgba(255,255,255,0.07)';
const STEPPER_BTN_BORDER = 'rgba(255,255,255,0.09)';
const STEPPER_BTN_COLOR = 'rgba(255,255,255,0.55)';
const STEPPER_BTN_BG_HOVER = 'rgba(255,255,255,0.14)';
const STEPPER_BTN_BORDER_HOVER = 'rgba(255,255,255,0.2)';
const STEPPER_BTN_COLOR_HOVER = 'rgba(255,255,255,0.85)';

// Plain inline `style` always wins over a stylesheet `:hover` rule (even one
// from a Tailwind class), so hover here has to be applied via JS instead of
// a `hover:` className — same pattern as the other inline-styled hover
// buttons in this file (e.g. the mode/difficulty pills below).
function SettingStepperButton({ symbol, label, onClick, disabled }: Readonly<{
  symbol: string; label: string; onClick: () => void; disabled?: boolean;
}>) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      aria-label={label}
      className="flex items-center justify-center active:scale-90 transition-transform"
      style={{
        width: '28px', height: '28px', borderRadius: '50%',
        background: STEPPER_BTN_BG,
        border: `1px solid ${STEPPER_BTN_BORDER}`,
        color: STEPPER_BTN_COLOR,
        fontSize: '1.1rem', lineHeight: 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        transition: 'background 0.15s, border-color 0.15s, color 0.15s',
      }}
      onMouseEnter={e => {
        if (disabled) return;
        const el = e.currentTarget;
        el.style.background = STEPPER_BTN_BG_HOVER;
        el.style.borderColor = STEPPER_BTN_BORDER_HOVER;
        el.style.color = STEPPER_BTN_COLOR_HOVER;
      }}
      onMouseLeave={e => {
        const el = e.currentTarget;
        el.style.background = STEPPER_BTN_BG;
        el.style.borderColor = STEPPER_BTN_BORDER;
        el.style.color = STEPPER_BTN_COLOR;
      }}
    >{symbol}</button>
  );
}

function SettingRow({ label, value, unit, onDec, onInc, onChange, min = 1, max = 999, disabled }: Readonly<{
  label: string; value: number; unit: string; onDec: () => void; onInc: () => void;
  onChange?: (v: number) => void; min?: number; max?: number; disabled?: boolean;
}>) {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);

  const commit = () => {
    const n = Number.parseInt(text, 10);
    if (onChange && !Number.isNaN(n)) onChange(Math.min(max, Math.max(min, n)));
    else setText(String(value));
  };

  return (
    <div className="flex items-center justify-between">
      <span style={{ color: disabled ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.5)', fontSize: '0.875rem' }}>
        {label}
      </span>
      <div className="flex items-center gap-2.5">
        <SettingStepperButton symbol="−" label={`Decrease ${label}`} onClick={onDec} disabled={disabled} />
        {onChange ? (
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            aria-label={label}
            value={text}
            disabled={disabled}
            onChange={e => { if (/^\d*$/.test(e.target.value)) setText(e.target.value); }}
            onBlur={commit}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            style={{
              color: disabled ? 'rgba(255,255,255,0.45)' : 'white',
              fontWeight: 700, width: '42px', textAlign: 'center', fontSize: '0.9375rem',
              background: 'transparent', border: 'none', outline: 'none', padding: 0,
            }}
          />
        ) : (
          <span style={{
            color: disabled ? 'rgba(255,255,255,0.45)' : 'white',
            fontWeight: 700, minWidth: '42px', textAlign: 'center', fontSize: '0.9375rem',
          }}>
            {value}{unit}
          </span>
        )}
        <SettingStepperButton symbol="+" label={`Increase ${label}`} onClick={onInc} disabled={disabled} />
      </div>
    </div>
  );
}

const DIFFICULTY_OPTIONS: { key: Difficulty; label: string }[] = [
  { key: 'easy', label: 'Easy' },
  { key: 'medium', label: 'Medium' },
  { key: 'hard', label: 'Hard' },
];

const DIFFICULTY_STYLE: Record<Difficulty, { bg: string; border: string; text: string }> = {
  easy: { bg: 'rgba(16, 185, 129, 0.25)', border: '1px solid rgba(52, 211, 153, 0.45)', text: '#6ee7b7' },
  medium: { bg: 'rgba(217, 119, 6, 0.25)', border: '1px solid rgba(251, 191, 36, 0.45)', text: '#fcd34d' },
  hard: { bg: 'rgba(220, 38, 38, 0.25)', border: '1px solid rgba(248, 113, 113, 0.45)', text: '#fca5a5' },
};

// Restricts the song pool to the most well-known top 20%/50%/100% of tracks —
// see DIFFICULTY_PCT server-side. Sliding highlight mirrors ModeToggle above.
function DifficultyRow({ value, onChange }: Readonly<{ value: Difficulty; onChange: (v: Difficulty) => void }>) {
  const index = DIFFICULTY_OPTIONS.findIndex(d => d.key === value);
  const active = DIFFICULTY_STYLE[value];
  return (
    <div className="space-y-2">
      <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.875rem' }}>Difficulty</span>
      <div
        className="relative flex rounded-xl"
        style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', padding: '3px' }}
      >
        <div
          className="absolute rounded-lg"
          style={{
            top: '3px', bottom: '3px', left: '3px',
            width: 'calc((100% - 6px) / 3)',
            background: active.bg,
            border: active.border,
            transform: `translateX(${index * 100}%)`,
            transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), background 0.25s ease, border-color 0.25s ease',
            pointerEvents: 'none',
          }}
        />
        {DIFFICULTY_OPTIONS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => onChange(key)}
            className="relative flex-1 py-1.5 rounded-lg text-xs font-semibold z-10 transition-colors duration-200"
            style={{
              color: value === key ? DIFFICULTY_STYLE[key].text : 'rgba(255,255,255,0.45)',
              background: 'transparent', border: 'none', cursor: 'pointer',
            }}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

const SONG_SOURCE_OPTIONS: { key: SongSource; label: string }[] = [
  { key: 'library', label: 'Versed Library' },
  { key: 'playlist', label: 'My Playlist' },
];

const SONG_SOURCE_STYLE: Record<SongSource, { bg: string; border: string; text: string }> = {
  library: { bg: 'rgba(178,16,224,0.25)', border: '1px solid rgba(208,46,249,0.45)', text: '#d8b4fe' },
  playlist: { bg: 'rgba(29, 185, 84, 0.25)', border: '1px solid rgba(29, 185, 84, 0.45)', text: '#6ee7a0' },
};

// Same sliding-pill pattern as DifficultyRow, two options instead of three.
function SongSourceRow({ value, onChange }: Readonly<{ value: SongSource; onChange: (v: SongSource) => void }>) {
  const index = SONG_SOURCE_OPTIONS.findIndex(o => o.key === value);
  const active = SONG_SOURCE_STYLE[value];
  return (
    <div className="space-y-2">
      <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.875rem' }}>Song Source</span>
      <div
        className="relative flex rounded-xl"
        style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', padding: '3px' }}
      >
        <div
          className="absolute rounded-lg"
          style={{
            top: '3px', bottom: '3px', left: '3px',
            width: 'calc((100% - 6px) / 2)',
            background: active.bg,
            border: active.border,
            transform: `translateX(${index * 100}%)`,
            transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), background 0.25s ease, border-color 0.25s ease',
            pointerEvents: 'none',
          }}
        />
        {SONG_SOURCE_OPTIONS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => onChange(key)}
            className="relative flex-1 py-1.5 rounded-lg text-xs font-semibold z-10 transition-colors duration-200"
            style={{
              color: value === key ? SONG_SOURCE_STYLE[key].text : 'rgba(255,255,255,0.45)',
              background: 'transparent', border: 'none', cursor: 'pointer',
            }}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

// Brand gradient (see versed-brand-design) reused here instead of a generic
// cyan/lavender/peach scale. The track fills from the left edge to the
// thumb, and that fill shows the exact slice of this gradient that would
// sit there if it ran the full width — so it reads as "revealing" a single
// static gradient rather than a flat tinted bar that moves with the thumb.
const CHAOS_GRADIENT_STOPS: [number, number, number, number][] = [
  [0, 0x00, 0xa6, 0xa3],   // #00a6a3
  [50, 0x3c, 0x2c, 0x66],  // #3c2c66
  [100, 0x9e, 0x12, 0xcc], // #9e12cc
];

function chaosColorAt(value: number): string {
  const [lo, hi] = value <= 50 ? [CHAOS_GRADIENT_STOPS[0], CHAOS_GRADIENT_STOPS[1]] : [CHAOS_GRADIENT_STOPS[1], CHAOS_GRADIENT_STOPS[2]];
  const t = (value - lo[0]) / (hi[0] - lo[0]);
  const r = Math.round(lo[1] + (hi[1] - lo[1]) * t);
  const g = Math.round(lo[2] + (hi[2] - lo[2]) * t);
  const b = Math.round(lo[3] + (hi[3] - lo[3]) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

function chaosTrackBackground(value: number): string {
  const dim = 'rgba(255,255,255,0.14)';
  const stops = ['#00a6a3 0%'];
  if (value > 50) stops.push('#3c2c66 50%');
  stops.push(`${chaosColorAt(value)} ${value}%`, `${dim} ${value}%`, `${dim} 100%`);
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

function ChaosLevelRow({ value, onChange, disabled }: Readonly<{ value: ChaosLevel; onChange: (v: ChaosLevel) => void; disabled?: boolean }>) {
  return (
    <div className="space-y-2" style={{ opacity: disabled ? 0.4 : 1, transition: 'opacity 0.2s ease' }}>
      <div className="flex items-center justify-between">
        <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.875rem' }}>Chaos level</span>
        <span style={{ color: 'white', fontWeight: 700, fontSize: '0.875rem' }}>{Math.round(value)}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        disabled={disabled}
        aria-label="Chaos level"
        aria-valuetext={`${Math.round(value)} percent`}
        className="chaos-slider block w-full"
        style={{
          '--chaos-track-bg': chaosTrackBackground(value),
          '--chaos-color': chaosColorAt(value),
          cursor: disabled ? 'not-allowed' : undefined,
        } as React.CSSProperties}
      />
      <div className="flex justify-between" aria-hidden="true">
        <span style={{ color: '#00a6a3', fontSize: '0.62rem' }}>Chill</span>
        <span style={{ color: '#8b7bb8', fontSize: '0.62rem' }}>Balanced</span>
        <span style={{ color: '#9e12cc', fontSize: '0.62rem' }}>Chaotic</span>
      </div>
    </div>
  );
}

// Human labels for the per-event on/off checklist — kept separate from
// RoundIntro.tsx's EVENT_BITS/server's eventIntros since those live in a
// different module and are styled for in-round display, not a settings list.
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
// server/src/gameManager.ts's eventIntros[...].tag (in-round announcement
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

function EventChipGrid({ enabledEvents, onToggle, onSetAll }: Readonly<{
  enabledEvents: PartyEvent[]; onToggle: (e: PartyEvent) => void; onSetAll: (events: PartyEvent[]) => void;
}>) {
  const [hoveredEvent, setHoveredEvent] = useState<PartyEvent | null>(null);
  const [focusedEvent, setFocusedEvent] = useState<PartyEvent | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<PartyEvent | null>(null);
  const shownEvent = hoveredEvent ?? focusedEvent ?? selectedEvent;

  const setAll = (events: PartyEvent[]) => {
    onSetAll(events);
    setSelectedEvent(null);
  };

  let caption: string;
  let captionColor: string;
  if (shownEvent) {
    caption = EVENT_DESCRIPTIONS[shownEvent];
    captionColor = 'rgba(255,255,255,0.4)';
  } else if (enabledEvents.length === 0) {
    caption = 'No events selected. Party rounds will play without event modifiers.';
    captionColor = 'rgba(255,255,255,0.4)';
  } else {
    caption = 'Tap or hover an event for details.';
    captionColor = 'rgba(255,255,255,0.4)';
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.875rem' }}>Events</span>
        <div className="flex items-center" style={{ gap: '6px', fontSize: '0.7rem' }}>
          <button
            type="button"
            onClick={() => setAll(ALL_PARTY_EVENTS)}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'rgba(255,255,255,0.4)', transition: 'color 0.15s' }}
            onMouseEnter={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.75)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.4)'; }}
          >
            All
          </button>
          <span style={{ color: 'rgba(255,255,255,0.25)' }}>·</span>
          <button
            type="button"
            onClick={() => setAll([])}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'rgba(255,255,255,0.4)', transition: 'color 0.15s' }}
            onMouseEnter={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.75)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.4)'; }}
          >
            None
          </button>
        </div>
      </div>
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
        {ALL_PARTY_EVENTS.map(e => {
          const on = enabledEvents.includes(e);
          return (
            <button
              key={e}
              type="button"
              aria-pressed={on}
              aria-describedby="event-caption"
              onClick={() => { onToggle(e); setSelectedEvent(e); }}
              onMouseEnter={() => setHoveredEvent(e)}
              onMouseLeave={() => setHoveredEvent(null)}
              onFocus={() => setFocusedEvent(e)}
              onBlur={() => setFocusedEvent(null)}
              style={{
                borderRadius: '10px',
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
              }}
            >
              {EVENT_LABELS[e]}
            </button>
          );
        })}
      </div>
      <p id="event-caption" aria-live="polite" style={{ color: captionColor, fontSize: '0.7rem', lineHeight: 1.4, minHeight: '2.1rem' }}>
        {caption}
      </p>
    </div>
  );
}

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

function RoundTypeChipGrid({ enabledRoundTypes, onToggle, onSetAll }: Readonly<{
  enabledRoundTypes: PartyRoundType[]; onToggle: (t: PartyRoundType) => void; onSetAll: (types: PartyRoundType[]) => void;
}>) {
  const [hoveredType, setHoveredType] = useState<PartyRoundType | null>(null);
  const [focusedType, setFocusedType] = useState<PartyRoundType | null>(null);
  const [selectedType, setSelectedType] = useState<PartyRoundType | null>(null);
  const shownType = hoveredType ?? focusedType ?? selectedType;

  const setAll = (types: PartyRoundType[]) => {
    onSetAll(types);
    setSelectedType(null);
  };

  let caption: string;
  if (shownType) {
    caption = ROUND_TYPE_DESCRIPTIONS[shownType];
  } else if (enabledRoundTypes.length === 0) {
    caption = 'No round types selected. Party rounds will fall back to plain classic rounds.';
  } else {
    caption = 'Tap or hover a round type for details.';
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.875rem' }}>Round Types</span>
        <div className="flex items-center" style={{ gap: '6px', fontSize: '0.7rem' }}>
          <button
            type="button"
            onClick={() => setAll(ALL_PARTY_ROUND_TYPES)}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'rgba(255,255,255,0.4)', transition: 'color 0.15s' }}
            onMouseEnter={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.75)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.4)'; }}
          >
            All
          </button>
          <span style={{ color: 'rgba(255,255,255,0.25)' }}>·</span>
          <button
            type="button"
            onClick={() => setAll([])}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'rgba(255,255,255,0.4)', transition: 'color 0.15s' }}
            onMouseEnter={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.75)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.4)'; }}
          >
            None
          </button>
        </div>
      </div>
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
        {ALL_PARTY_ROUND_TYPES.map(t => {
          const on = enabledRoundTypes.includes(t);
          return (
            <button
              key={t}
              type="button"
              aria-pressed={on}
              aria-describedby="round-type-caption"
              onClick={() => { onToggle(t); setSelectedType(t); }}
              onMouseEnter={() => setHoveredType(t)}
              onMouseLeave={() => setHoveredType(null)}
              onFocus={() => setFocusedType(t)}
              onBlur={() => setFocusedType(null)}
              style={{
                borderRadius: '10px',
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
              }}
            >
              {ROUND_TYPE_LABELS[t]}
            </button>
          );
        })}
      </div>
      <p id="round-type-caption" aria-live="polite" style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.7rem', lineHeight: 1.4, minHeight: '2.1rem' }}>
        {caption}
      </p>
    </div>
  );
}

function PlaylistList({ customPlaylists, onOpen, onRemove }: Readonly<{
  customPlaylists: CustomPlaylist[]; onOpen: () => void; onRemove: (id: string) => void;
}>) {
  const uncappedTotal = mergeUniqueTracks(customPlaylists).length;
  const totalTracks = Math.min(uncappedTotal, MAX_POOL_TRACKS);
  const overCap = uncappedTotal > MAX_POOL_TRACKS;
  return (
    <div className="space-y-2">
      {customPlaylists.map(p => (
        <div
          key={p.id}
          className="w-full flex items-center gap-2.5 rounded-xl"
          style={{ padding: '8px 10px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          {p.imageUrl ? (
            <img src={p.imageUrl} alt="" className="w-8 h-8 rounded-md object-cover shrink-0" />
          ) : (
            <div className="w-8 h-8 rounded-md shrink-0" style={{ background: 'rgba(255,255,255,0.08)' }} />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate" style={{ color: 'white', fontWeight: 600, fontSize: '0.8125rem' }}>{p.name}</p>
            <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.6875rem' }}>{p.tracks.length} tracks</p>
          </div>
          <button
            onClick={() => onRemove(p.id)}
            aria-label={`Remove ${p.name}`}
            className="text-white/35 hover:text-white/80 transition-colors"
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', lineHeight: 1, padding: '4px' }}
          >
            ×
          </button>
        </div>
      ))}
      <button
        onClick={onOpen}
        className="w-full flex items-center gap-2.5 rounded-xl text-left"
        style={{ padding: '8px 10px', background: 'rgba(255,255,255,0.05)', border: '1px dashed rgba(255,255,255,0.15)', cursor: 'pointer', transition: 'background 0.15s, border-color 0.15s' }}
        onMouseEnter={e => { const el = e.currentTarget; el.style.background = 'rgba(255,255,255,0.09)'; el.style.borderColor = 'rgba(255,255,255,0.3)'; }}
        onMouseLeave={e => { const el = e.currentTarget; el.style.background = 'rgba(255,255,255,0.05)'; el.style.borderColor = 'rgba(255,255,255,0.15)'; }}
      >
        <div className="min-w-0 flex-1">
          <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.8125rem' }}>
            {customPlaylists.length === 0 ? 'Choose playlists' : '+ Add another playlist'}
          </p>
          {customPlaylists.length > 1 && (
            <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.6875rem' }}>{totalTracks} unique tracks total</p>
          )}
        </div>
        <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.75rem' }}>→</span>
      </button>
      {overCap && (
        <p style={{ color: '#fcd34d', fontSize: '0.6875rem' }}>
          Combined pool capped at {MAX_POOL_TRACKS.toLocaleString()} tracks — {(uncappedTotal - MAX_POOL_TRACKS).toLocaleString()} track{uncappedTotal - MAX_POOL_TRACKS === 1 ? '' : 's'} from the most recently added playlist(s) won't be included.
        </p>
      )}
    </div>
  );
}

function ToggleRow({ label, value, onToggle, disabled }: Readonly<{
  label: string; value: boolean; onToggle: () => void; disabled?: boolean;
}>) {
  return (
    <div className="flex items-center justify-between">
      <span style={{ color: disabled ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.5)', fontSize: '0.875rem' }}>
        {label}
      </span>
      <button
        onClick={disabled ? undefined : onToggle}
        disabled={disabled}
        className="relative shrink-0"
        style={{
          width: '40px', height: '22px', borderRadius: '100px',
          background: value ? 'rgba(178,16,224,0.7)' : 'rgba(255,255,255,0.10)',
          border: value ? '1px solid rgba(198,36,249,0.6)' : '1px solid rgba(255,255,255,0.08)',
          transition: 'background 0.2s ease, border-color 0.2s ease, opacity 0.2s ease',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.4 : 1,
        }}
      >
        <span
          className="absolute"
          style={{
            top: '3px', left: '3px',
            width: '14px', height: '14px',
            borderRadius: '50%',
            background: 'white',
            boxShadow: '0 1px 3px rgba(0,0,0,0.35)',
            transition: 'transform 0.2s ease',
            transform: value ? 'translateX(18px)' : 'translateX(0)',
          }}
        />
      </button>
    </div>
  );
}
