import type { PartyInfo } from '../types';

// Each bar gets a unique animation shape, duration, and delay so they move
// independently. `dur`/`delay` are the fallback (fixed, tempo-agnostic)
// timing used when a song's tempo isn't known. `beats`/`delayFrac` are used
// once a real BPM is available: `beats` is kept close to 1 (one pulse per
// beat, ±15%) rather than the fractional multiples tried earlier — those
// were all under 1.2x combined with a tight clamp floor, so most real songs
// (roughly 90-160bpm) collapsed to nearly the same duration and the tempo
// difference was imperceptible. `delayFrac` is a fraction of the beat
// instead of a fixed seconds value, so the stagger pattern's relative shape
// holds at any tempo instead of vanishing at slow tempos or bunching up at
// fast ones.
// `base` is each bar's resting scaleY — used as the inline transform whenever
// the keyframe animation itself isn't visibly driving the bar: the instant
// before it starts, and (more importantly) under `prefers-reduced-motion`,
// where index.css collapses every animation to ~0 duration with no
// fill-mode, so it reverts to this value immediately. Varying it per bar
// keeps the equalizer looking alive (and screenshots looking right) even
// when the animation itself isn't visibly running.
const AUDIO_BARS = [
  { anim: 'audioBarC', dur: 1.1, beats: 0.95, delay: 0,    delayFrac: 0,    base: 0.55 },
  { anim: 'audioBar',  dur: 1.5, beats: 1.1,  delay: 0.14, delayFrac: 0.12, base: 0.85 },
  { anim: 'audioBarD', dur: 0.85,beats: 0.9,  delay: 0.28, delayFrac: 0.25, base: 0.35 },
  { anim: 'audioBarB', dur: 1.7, beats: 1.15, delay: 0.07, delayFrac: 0.06, base: 0.7  },
  { anim: 'audioBar',  dur: 1,   beats: 0.85, delay: 0.42, delayFrac: 0.38, base: 0.4  },
  { anim: 'audioBarC', dur: 1.3, beats: 1.05, delay: 0.21, delayFrac: 0.19, base: 0.95 },
  { anim: 'audioBarD', dur: 0.9, beats: 0.9,  delay: 0.35, delayFrac: 0.32, base: 0.3  },
  { anim: 'audioBarB', dur: 1.6, beats: 1.1,  delay: 0.08, delayFrac: 0.07, base: 0.8  },
  { anim: 'audioBarC', dur: 1.2, beats: 1,    delay: 0.26, delayFrac: 0.24, base: 0.5  },
] as const;

export type BarAccent = 'classic' | 'race' | 'year' | 'party';

// The single place a round's identity color is decided, shared by Host and
// Play so both ends of the same round read as the same color instead of each
// screen inferring its own: year rounds are aqua, Party keeps its own aqua
// identity across every sub-round format it draws, race is orange, classic
// purple. The player side signals Party via a non-null `party` (its own
// `mode` only ever says classic/race), the host via mode === 'party' — both
// are accepted so one function covers both callers.
export function resolveRoundAccent(mode: 'classic' | 'race' | 'party', yearOnly: boolean, party: PartyInfo | null): BarAccent {
  const isYear = party ? party.format === 'year' : yearOnly;
  if (isYear) return 'year';
  if (party || mode === 'party') return 'party';
  return mode === 'race' ? 'race' : 'classic';
}

// Each accent's hue as a raw "r,g,b" triple, for the places that need it at
// their own alpha (input borders and focus glows, button washes) rather than
// one of the pre-composed colors below.
export const ACCENT_RGB: Record<BarAccent, string> = {
  classic: '158,18,204',
  race: '234,88,12',
  year: '0,238,232',
  party: '0,238,232',
};

export const AUDIO_BAR_COLORS: Record<BarAccent, string> = {
  classic: 'rgba(158,18,204,0.75)',
  race: 'rgba(234,88,12,0.75)',
  year: 'rgba(0,238,232,0.75)',
  // Matches year's cyan — the eq bar/playing-card accent no longer
  // distinguishes party from year (party still keeps its own teal
  // elsewhere, e.g. the Home/Join mode buttons).
  party: 'rgba(0,238,232,0.75)',
};

// Matches the AUDIO_BAR_COLORS hue to the app's existing per-mode glass ring
// treatment (index.css .glass-tint-*, already used by every mode-colored CTA)
// so the "playing" cards can pick up a breathing accent glow without
// inventing a new color system.
export const ACCENT_TINT_CLASS: Record<BarAccent, string> = {
  classic: 'glass-tint-purple',
  race: 'glass-tint-orange',
  year: 'glass-tint-cyan',
  party: 'glass-tint-cyan',
};

// A faint interior wash to lay over a "playing" card's own content area, so
// the accent reads as light filling the glass, not just the edge ring above.
// Deliberately subtle — bled to the card's full edges (see callers), a
// stronger value here reads as a solid colored panel rather than a tint.
export const ACCENT_WASH: Record<BarAccent, string> = {
  classic: 'rgba(158,18,204,0.035)',
  race: 'rgba(234,88,12,0.035)',
  year: 'rgba(0,238,232,0.035)',
  party: 'rgba(0,238,232,0.035)',
};

// The "playing" card's own breathing glow (index.css @keyframes) — one
// single-hue variant per accent, so the glow reads as this round's color
// instead of the generic fixed purple/cyan cardGlowPulse every other glass
// card uses.
export const ACCENT_GLOW_ANIMATION: Record<BarAccent, string> = {
  classic: 'cardGlowPulsePurple',
  race: 'cardGlowPulseOrange',
  year: 'cardGlowPulseCyan',
  party: 'cardGlowPulseCyan',
};

// CSS hue-rotate degree applied to the shared background8-2.png backdrop so
// its native blue tint reads as this round's accent color instead of a
// fixed hue regardless of mode.
export const ACCENT_BG_HUE: Record<BarAccent, number> = {
  classic: 72,
  race: 160,
  year: -22,
  party: -22,
};

// Detected tempo can be wildly wrong (half/double-time, or missing) — clamp
// the resulting pulse length so a bad value can't freeze or strobe the bars.
// Wide enough (0.3s-2s) to stay out of the way for the ~50-190bpm range real
// songs actually fall in, so the pulse visibly tracks tempo instead of
// bottoming out at the same floor for most of that range.
const MIN_BAR_SEC = 0.3;
const MAX_BAR_SEC = 2;

function beatSeconds(bpm: number | null | undefined): number | null {
  if (!bpm || bpm <= 0) return null;
  return 60 / bpm;
}

// Shared "song is playing / get ready" focal point for Host and Play: a flat
// 9-bar equalizer, each bar animating independently. Idle (low, static bars)
// when nothing's playing. Pass `bpm` (the song's tempo) to have the bars
// pulse in time with the track instead of a fixed, tempo-agnostic rhythm.
export function AudioBars({ playing, accent, height, bpm }: Readonly<{ playing: boolean; accent: BarAccent; height: number; bpm?: number | null }>) {
  const barColor = AUDIO_BAR_COLORS[accent];
  const beatSec = beatSeconds(bpm);
  return (
    <div style={{ display: 'flex', gap: '5px', alignItems: 'center', height: `${height}px`, transition: 'opacity 0.3s ease', opacity: playing ? 1 : 0.35 }}>
      {AUDIO_BARS.map((bar) => {
        const dur = beatSec === null ? bar.dur : Math.min(MAX_BAR_SEC, Math.max(MIN_BAR_SEC, beatSec * bar.beats));
        const delay = beatSec === null ? bar.delay : beatSec * bar.delayFrac;
        return (
          <div
            key={bar.delay}
            style={{
              width: '3px', height: '100%', borderRadius: '2px',
              background: barColor,
              animationName: playing ? bar.anim : 'none',
              animationDuration: `${dur}s`,
              animationTimingFunction: 'ease-in-out',
              animationIterationCount: 'infinite',
              animationDelay: `${delay}s`,
              animationFillMode: playing ? 'backwards' : undefined,
              transformOrigin: 'center',
              transform: playing ? `scaleY(${bar.base})` : 'scaleY(0.07)',
            }}
          />
        );
      })}
    </div>
  );
}
