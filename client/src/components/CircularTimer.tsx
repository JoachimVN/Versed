import { useEffect, useRef, useState } from 'react';

export function timerColor(pct: number): string {
  if (pct > 0.6) return 'rgba(52,211,153,0.9)';
  if (pct > 0.35) return 'rgba(251,191,36,0.9)';
  if (pct > 0.12) return 'rgba(249,115,22,0.9)';
  return 'rgba(239,68,68,0.9)';
}

// Smoothly-animated fraction-remaining, shared by both the circular dial and
// its compact horizontal-bar fallback — the two are just different paint
// jobs on the same countdown.
function useTimerPct(timeLeft: number, total: number): number {
  const endsAtRef = useRef(0);
  const [pct, setPct] = useState(total > 0 ? Math.max(0, Math.min(1, timeLeft / total)) : 0);

  useEffect(() => {
    if (total <= 0) return;
    if (timeLeft <= 0) {
      setPct(0);
      return;
    }
    endsAtRef.current = Date.now() + timeLeft * 1000;
    let rafId: number;
    const tick = () => {
      const remaining = endsAtRef.current - Date.now();
      const p = Math.max(0, Math.min(1, remaining / (total * 1000)));
      setPct(p);
      if (p > 0) rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [timeLeft, total]);

  return pct;
}

// Thin horizontal fill bar with an inline "Ns" readout — the CircularTimer's
// 80px dial doesn't fit a short landscape/keyboard-squeezed guessing screen,
// so this is what GuessingView swaps to under useCompactGuessing().
export function LinearTimer({ timeLeft, total }: Readonly<{ timeLeft: number; total: number }>) {
  const pct = useTimerPct(timeLeft, total);
  return (
    <div className="flex items-center gap-2.5" style={{ width: 'min(70vw, 220px)' }}>
      <div style={{ flex: 1, height: '6px', borderRadius: '999px', background: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
        <div style={{
          width: `${pct * 100}%`, height: '100%', borderRadius: '999px',
          background: timerColor(pct), transition: 'width 0.2s linear, background 0.4s ease',
        }} />
      </div>
      <span className="text-white font-black tabular-nums" style={{ fontSize: '0.95rem', minWidth: '1.6em', textAlign: 'right' }}>{timeLeft}</span>
    </div>
  );
}

export function CircularTimer({ timeLeft, total, size = 128 }: Readonly<{ timeLeft: number; total: number; size?: number }>) {
  const sw = Math.round(size * 0.039);
  const r = (size - sw * 2) / 2;
  const circ = 2 * Math.PI * r;
  const pct = useTimerPct(timeLeft, total);

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="absolute inset-0" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={sw} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={timerColor(pct)}
          strokeWidth={sw}
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - pct)}
          strokeLinecap="round"
          style={{ transition: 'stroke 0.4s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-white font-black" style={{ fontSize: `${size * 0.148}px`, lineHeight: 1 }}>{timeLeft}</span>
        <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: `${size * 0.047}px`, textTransform: 'uppercase', letterSpacing: '0.14em' }}>sec</span>
      </div>
    </div>
  );
}

// Per-mode palettes, deep and muted like the app's classic/year accent hues
// (rgba(158,18,204) / rgba(0,238,232) — see AudioBars' AUDIO_BAR_COLORS) but
// as jewel tones rather than either the fully-saturated brand colors (read
// as a generic punchy "AI gradient") or a white-blended pastel version of
// them (read as too light/washed out) — this sits between the two. The
// middle stop is deliberately the most desaturated of the three so it reads
// as a bridging accent rather than a third competing hue.
const HERO_GRADIENT_STOPS: Record<'classic' | 'race' | 'party', readonly [string, string, string]> = {
  classic: ['#7e5dab', '#5f8f99', '#9c5fa0'],
  race: ['#c07a45', '#7c6a90', '#c99b7d'],
  party: ['#5bacbb', '#7c6a90', '#3d7d76'],
};

// Drop-shadow tint for the ring's glow — the average of each mode's three
// gradient stops above, so the glow reads as "light cast by this ring"
// rather than a generic fixed color that drifts from whatever's actually
// on the stroke.
const HERO_GLOW_COLOR: Record<'classic' | 'race' | 'party', string> = {
  classic: 'rgba(126,110,161,0.22)',
  race: 'rgba(172,128,113,0.22)',
  party: 'rgba(92,134,150,0.22)',
};

// The host "playing" card's dominant hero dial: a thick ring painted with a
// true angular (conic) gradient, compressed into just the swept arc so the
// full 3-color range is visible even on a short arc — a plain 0%-100% div
// diagonal would only show a narrow slice of it at low time-remaining.
// This used to be an SVG <linearGradient> painted across the circle via
// userSpaceOnUse, matching its vector to the arc's own start/end points, but
// a linear gradient interpolates along a straight chord — for points on a
// circular arc that means color pacing is slow near both ends and fast
// through the arc's middle, and undefined outright at a full 360° sweep
// (the chord's two endpoints coincide). conic-gradient interpolates by
// angle instead, so pacing is even all the way around and a full sweep is
// just the ordinary 360° case, no special-casing needed.
export function HeroTimer({ timeLeft, total, size = 200, mode = 'classic' }: Readonly<{ timeLeft: number; total: number; size?: number; mode?: 'classic' | 'race' | 'party' }>) {
  const sw = size * 0.058;
  const r = (size - sw * 2) / 2; // ring centerline radius — matches the old SVG stroke circle's radius exactly
  const pct = useTimerPct(timeLeft, total);
  const center = size / 2;
  const [startColor, midColor, endColor] = HERO_GRADIENT_STOPS[mode];
  // 12 o'clock, sweeping clockwise as pct grows — conic-gradient's own 0deg
  // already points up, so no extra rotation is needed here (unlike the old
  // SVG circle, which had to rotate -90deg to move its 0deg from 3 o'clock).
  const sweepDeg = pct * 360;
  const ringBackground = `conic-gradient(from 0deg, ${startColor} 0deg, ${midColor} ${sweepDeg / 2}deg, ${endColor} ${sweepDeg}deg, transparent ${sweepDeg}deg)`;
  // Explicit pixel radii, not percentages — a radial-gradient's own "100%"
  // is the ending shape's radius, not the box's, so "50%" here would NOT
  // mean "half the box" the way it does for a plain background-position;
  // spelling out the two band edges in px sidesteps that trap entirely.
  const ringMask = `radial-gradient(circle ${r + sw / 2}px at 50% 50%, transparent ${r - sw / 2 - 1}px, black ${r - sw / 2}px, black ${r + sw / 2}px, transparent ${r + sw / 2 + 1}px)`;
  const sweepRad = (sweepDeg * Math.PI) / 180;
  const capX = center + r * Math.sin(sweepRad);
  const capY = center - r * Math.cos(sweepRad);

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <div aria-hidden="true" className="absolute inset-0 rounded-full" style={{ background: 'rgba(255,255,255,0.05)', WebkitMaskImage: ringMask, maskImage: ringMask }} />
      {pct > 0 && (
        <>
          <div
            aria-hidden="true"
            className="absolute inset-0 rounded-full"
            style={{ background: ringBackground, WebkitMaskImage: ringMask, maskImage: ringMask, filter: `drop-shadow(0 0 5px ${HERO_GLOW_COLOR[mode]})` }}
          />
          {/* Round caps at both arc ends — a conic-gradient cuts off flat by
              default, unlike the old SVG stroke's strokeLinecap="round". */}
          <div aria-hidden="true" className="absolute rounded-full" style={{ width: sw, height: sw, left: center - sw / 2, top: center - r - sw / 2, background: startColor }} />
          <div aria-hidden="true" className="absolute rounded-full" style={{ width: sw, height: sw, left: capX - sw / 2, top: capY - sw / 2, background: endColor }} />
        </>
      )}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-white font-black" style={{ fontSize: `${size * 0.2}px`, lineHeight: 1 }}>{timeLeft}</span>
        <span style={{ color: 'rgba(255,255,255,0.55)', fontSize: `${size * 0.05}px`, textTransform: 'uppercase', letterSpacing: '0.14em', marginTop: `${size * 0.015}px` }}>sec</span>
      </div>
    </div>
  );
}
