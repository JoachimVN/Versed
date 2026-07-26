import React, { useState, useEffect } from 'react';
import type { SongSource } from '../../../types';
import type { Difficulty } from '../useHostGame';

// The single-line control rows of the settings panel: numeric steppers,
// on/off toggles, the two sliding-pill pickers, and the chaos slider.

const STEPPER_BTN_BG = 'rgba(255,255,255,0.07)';
const STEPPER_BTN_BORDER = 'rgba(255,255,255,0.09)';
const STEPPER_BTN_COLOR = 'rgba(255,255,255,0.55)';
const STEPPER_BTN_BG_HOVER = 'rgba(255,255,255,0.14)';
const STEPPER_BTN_BORDER_HOVER = 'rgba(255,255,255,0.2)';
const STEPPER_BTN_COLOR_HOVER = 'rgba(255,255,255,0.85)';

// Plain inline `style` always wins over a stylesheet `:hover` rule (even one
// from a Tailwind class), so hover here has to be applied via JS instead of
// a `hover:` className — same pattern as the other inline-styled hover
// buttons in this panel (e.g. the mode/difficulty pills below).
function SettingStepperButton({ symbol, label, onClick, disabled }: Readonly<{
  symbol: string; label: string; onClick: () => void; disabled?: boolean;
}>) {
  return (
    <button
      type="button"
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

export function SettingRow({ label, value, unit, onDec, onInc, onChange, min = 1, max = 999, disabled }: Readonly<{
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

export function ToggleRow({ label, value, onToggle, disabled }: Readonly<{
  label: string; value: boolean; onToggle: () => void; disabled?: boolean;
}>) {
  return (
    <div className="flex items-center justify-between">
      <span style={{ color: disabled ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.5)', fontSize: '0.875rem' }}>
        {label}
      </span>
      <button
        type="button"
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

// ─── Sliding-pill pickers ────────────────────────────────────────────────────

type PillStyle = { bg: string; border: string; text: string };

// A segmented control where a single highlight slides between the options
// and takes on the selected option's accent colour. Shared by Difficulty and
// Song Source — the only difference between them is the option list, so the
// pill width divides by however many options are passed in.
function SlidingPillRow<T extends string>({ label, value, onChange, options, styles }: Readonly<{
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { key: T; label: string }[];
  styles: Record<T, PillStyle>;
}>) {
  const index = options.findIndex(o => o.key === value);
  const active = styles[value];
  return (
    <div className="space-y-2">
      <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.875rem' }}>{label}</span>
      <div
        className="relative flex rounded-xl"
        style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', padding: '3px' }}
      >
        <div
          className="absolute rounded-lg"
          style={{
            top: '3px', bottom: '3px', left: '3px',
            width: `calc((100% - 6px) / ${options.length})`,
            background: active.bg,
            border: active.border,
            transform: `translateX(${index * 100}%)`,
            transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), background 0.25s ease, border-color 0.25s ease',
            pointerEvents: 'none',
          }}
        />
        {options.map(({ key, label: optionLabel }) => (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            className="relative flex-1 py-1.5 rounded-lg text-xs font-semibold z-10 transition-colors duration-200"
            style={{
              color: value === key ? styles[key].text : 'rgba(255,255,255,0.45)',
              background: 'transparent', border: 'none', cursor: 'pointer',
            }}
          >
            {optionLabel}
          </button>
        ))}
      </div>
    </div>
  );
}

const DIFFICULTY_OPTIONS: { key: Difficulty; label: string }[] = [
  { key: 'easy', label: 'Easy' },
  { key: 'medium', label: 'Medium' },
  { key: 'hard', label: 'Hard' },
];

const DIFFICULTY_STYLE: Record<Difficulty, PillStyle> = {
  easy: { bg: 'rgba(16, 185, 129, 0.25)', border: '1px solid rgba(52, 211, 153, 0.45)', text: '#6ee7b7' },
  medium: { bg: 'rgba(217, 119, 6, 0.25)', border: '1px solid rgba(251, 191, 36, 0.45)', text: '#fcd34d' },
  hard: { bg: 'rgba(220, 38, 38, 0.25)', border: '1px solid rgba(248, 113, 113, 0.45)', text: '#fca5a5' },
};

// Restricts the song pool to the most well-known top 20%/50%/100% of tracks —
// see DIFFICULTY_PCT server-side.
export function DifficultyRow({ value, onChange }: Readonly<{ value: Difficulty; onChange: (v: Difficulty) => void }>) {
  return <SlidingPillRow label="Difficulty" value={value} onChange={onChange} options={DIFFICULTY_OPTIONS} styles={DIFFICULTY_STYLE} />;
}

const SONG_SOURCE_OPTIONS: { key: SongSource; label: string }[] = [
  { key: 'library', label: 'Versed Library' },
  { key: 'playlist', label: 'My Playlist' },
];

const SONG_SOURCE_STYLE: Record<SongSource, PillStyle> = {
  library: { bg: 'rgba(178,16,224,0.25)', border: '1px solid rgba(208,46,249,0.45)', text: '#d8b4fe' },
  playlist: { bg: 'rgba(29, 185, 84, 0.25)', border: '1px solid rgba(29, 185, 84, 0.45)', text: '#6ee7a0' },
};

export function SongSourceRow({ value, onChange }: Readonly<{ value: SongSource; onChange: (v: SongSource) => void }>) {
  return <SlidingPillRow label="Song Source" value={value} onChange={onChange} options={SONG_SOURCE_OPTIONS} styles={SONG_SOURCE_STYLE} />;
}

// ─── Chaos slider ────────────────────────────────────────────────────────────

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

export function ChaosLevelRow({ value, onChange, disabled }: Readonly<{ value: number; onChange: (v: number) => void; disabled?: boolean }>) {
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
