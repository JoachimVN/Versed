import React, { useState, useEffect } from 'react';
import type { SongSource } from '../../../types';
import type { Difficulty } from '../useHostGame';
import LiquidGlass from '../../../components/StableLiquidGlass';
import { LIQUID_CONTROL_PROPS } from '../../../components/liquidGlassPresets';

// The single-line control rows of the settings panel: numeric steppers,
// on/off toggles, the two sliding-pill pickers, and the chaos slider.

// Panel content is a fixed w-72 (288px) minus px-5 (20px) padding on each
// side — never responsive, so (unlike the lobby's ModeToggle) these pills
// can hardcode one width instead of a per-breakpoint CSS rule. Exported so
// PlaylistList's "Choose playlists" glass button can size to the same
// content column.
export const SETTINGS_CONTENT_WIDTH = 248;

// Each +/- is its own small real LiquidGlass circle (same fixed-box-plus-
// centred-glass pattern as the lobby's volume/settings pills, just circular
// and tiny) rather than a CSS-only bead — displacement/aberration are dialled
// way down from LIQUID_CONTROL_PROPS, both because a 28px circle has much
// less edge to refract against than that preset's pill shapes, and because
// these repeat up to 8 times a panel and shouldn't compete for attention.
const STEPPER_GLASS_PROPS = {
  displacementScale: 10,
  blurAmount: 0.015,
  saturation: 120,
  aberrationIntensity: 0.5,
  elasticity: 0,
  cornerRadius: 100,
} as const;

function SettingStepperButton({ symbol, label, onClick, disabled }: Readonly<{
  symbol: string; label: string; onClick: () => void; disabled?: boolean;
}>) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      className="liquid-btn glass-tint-purple subtle-glass-chip relative shrink-0"
      style={{ width: '28px', height: '28px', opacity: disabled ? 0.4 : 1 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <LiquidGlass
        style={{
          position: 'absolute', top: '50%', left: '50%',
          filter: hovered && !disabled ? 'drop-shadow(0 0 4px rgba(192,132,252,0.3))' : 'drop-shadow(0 0 0px rgba(192,132,252,0))',
          transition: 'filter 0.2s ease',
        }}
        {...STEPPER_GLASS_PROPS}
        padding="0"
      >
        <button
          type="button"
          onClick={disabled ? undefined : onClick}
          disabled={disabled}
          aria-label={label}
          className="flex items-center justify-center active:scale-90 transition-transform"
          style={{
            width: '28px', height: '28px', borderRadius: '50%',
            background: 'transparent', border: 'none', padding: 0,
            color: hovered && !disabled ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.6)',
            fontSize: '1.1rem', lineHeight: 1,
            cursor: disabled ? 'not-allowed' : 'pointer',
            transition: 'color 0.15s',
          }}
        >{symbol}</button>
      </LiquidGlass>
    </div>
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
      {/* Same subtle real-LiquidGlass treatment as the +/- steppers (see
          SettingStepperButton) rather than a flat rgba track — the on/off
          fill and knob still carry the state, the glass is just the same
          quiet chrome the rest of the panel's small controls share now. */}
      <div className="liquid-btn glass-tint-purple subtle-glass-chip relative shrink-0" style={{ width: '42px', height: '24px', opacity: disabled ? 0.4 : 1 }}>
        <LiquidGlass style={{ position: 'absolute', top: '50%', left: '50%' }} {...STEPPER_GLASS_PROPS} padding="0">
          <button
            type="button"
            onClick={disabled ? undefined : onToggle}
            disabled={disabled}
            aria-pressed={value}
            className="relative block"
            style={{
              width: '42px', height: '24px', borderRadius: '100px', border: 'none', padding: 0,
              background: value
                ? 'linear-gradient(135deg, rgba(216,70,255,0.75), rgba(147,51,194,0.7))'
                : 'rgba(255,255,255,0.05)',
              transition: 'background 0.25s ease',
              cursor: disabled ? 'not-allowed' : 'pointer',
            }}
          >
            <span
              className="absolute"
              style={{
                top: '3px', left: '3px',
                width: '18px', height: '18px',
                borderRadius: '50%',
                background: 'radial-gradient(circle at 35% 30%, #ffffff, #e2e2e2 70%)',
                boxShadow: '0 1px 3px rgba(0,0,0,0.4), inset 0 -1px 1px rgba(0,0,0,0.08)',
                transition: 'transform 0.22s cubic-bezier(0.4, 0, 0.2, 1)',
                transform: value ? 'translateX(18px)' : 'translateX(0)',
              }}
            />
          </button>
        </LiquidGlass>
      </div>
    </div>
  );
}

// ─── Sliding-pill pickers ────────────────────────────────────────────────────

type PillStyle = { bg: string; text: string; tint: string; wash: string };

// A segmented control where a single highlight slides between the options
// and takes on the selected option's accent colour — the same LiquidGlass
// track/highlight mechanics as the lobby's ModeToggle (tint wash behind the
// track, active pill as an inset-ring capsule, ring color swapped per
// selection via glass-tint-*), just resized to this panel's fixed content
// width instead of ModeToggle's responsive breakpoints. Shared by Difficulty
// and Song Source — the only difference between them is the option list.
function SlidingPillRow<T extends string>({ label, value, onChange, options, styles }: Readonly<{
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { key: T; label: string }[];
  styles: Record<T, PillStyle>;
}>) {
  const index = options.findIndex(o => o.key === value);
  const active = styles[value];
  const trackWidth = SETTINGS_CONTENT_WIDTH - 8;
  return (
    <div className="space-y-2">
      <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.7rem', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        {label}
      </span>
      <div className={`liquid-btn ${active.tint} settings-pill-glass relative w-full`} style={{ height: '40px' }}>
        <LiquidGlass style={{ position: 'absolute', top: '50%', left: '50%' }} {...LIQUID_CONTROL_PROPS} cornerRadius={100} padding="4px">
          <div style={{ position: 'relative' }}>
            <div
              className="absolute rounded-full"
              style={{ inset: '-4px', background: active.wash, transition: 'background 0.3s ease', pointerEvents: 'none' }}
            />
            <div className="relative flex rounded-full" style={{ width: `${trackWidth}px` }}>
              <div
                className="absolute rounded-full"
                style={{
                  top: 0, bottom: 0, left: 0,
                  width: `calc(100% / ${options.length})`,
                  background: active.bg,
                  boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.2), 0 2px 8px rgba(0,0,0,0.25)',
                  transform: `translateX(${index * 100}%)`,
                  transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), background 0.25s ease',
                  pointerEvents: 'none',
                }}
              />
              {options.map(({ key, label: optionLabel }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => onChange(key)}
                  className="relative flex-1 py-1.5 rounded-full text-xs font-semibold z-10 transition-colors duration-200"
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
        </LiquidGlass>
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
  easy: { bg: 'rgba(16,185,129,0.34)', text: '#6ee7b7', tint: 'glass-tint-green', wash: 'rgba(16,185,129,0.07)' },
  medium: { bg: 'rgba(217,119,6,0.34)', text: '#fcd34d', tint: 'glass-tint-amber', wash: 'rgba(217,119,6,0.07)' },
  hard: { bg: 'rgba(220,38,38,0.34)', text: '#fca5a5', tint: 'glass-tint-red', wash: 'rgba(220,38,38,0.07)' },
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
  library: { bg: 'rgba(191,29,235,0.34)', text: 'white', tint: 'glass-tint-purple', wash: 'rgba(158,18,204,0.07)' },
  playlist: { bg: 'rgba(29,185,84,0.34)', text: '#bbf7d0', tint: 'glass-tint-green', wash: 'rgba(29,185,84,0.07)' },
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
