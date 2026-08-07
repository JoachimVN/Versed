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

// Per-mode palettes — each ring ends on the same saturated hue already used
// as that mode's icon/accent color elsewhere (LobbyView's ModeToggle: purple
// #c084fc for classic, orange #fb923c for race, teal #2dd4bf for party), so
// the playing screen's dial reads as the same color identity rather than its
// own separate, more muted gradient. The middle stop stays a bridging tone
// between the two ends rather than a third competing hue.
const HERO_GRADIENT_STOPS: Record<'classic' | 'race' | 'party' | 'year', readonly [string, string, string]> = {
  classic: ['#9d34d9', '#8a4aa8', '#c084fc'],
  race: ['#e2650d', '#c97b3f', '#fb923c'],
  party: ['#0ea89a', '#279a9e', '#2dd4bf'],
  year: ['#2e6e82', '#517685', '#4fc0d1'],
};

// Thin horizontal fill bar with an inline "Ns" readout — HeroTimer's ring
// doesn't fit a short landscape/keyboard-squeezed or otherwise cramped
// screen, so this is what every timer placement swaps to once compact.
// `accent`, when given, paints the fill with that mode's own HeroTimer hue
// (its brightest stop) instead of the red/amber/green urgency ramp — for a
// placement where HeroTimer's ring already reads as "this screen's own
// color" and the default rainbow fill would look like a mismatched second
// timer rather than the same dial in a different shape.
export function LinearTimer({ timeLeft, total, accent }: Readonly<{ timeLeft: number; total: number; accent?: 'classic' | 'race' | 'party' | 'year' }>) {
  const pct = useTimerPct(timeLeft, total);
  const fill = accent ? HERO_GRADIENT_STOPS[accent][2] : timerColor(pct);
  return (
    <div className="flex items-center gap-2.5" style={{ width: 'min(70vw, 220px)' }}>
      <div style={{ flex: 1, height: '6px', borderRadius: '999px', background: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
        <div style={{
          width: `${pct * 100}%`, height: '100%', borderRadius: '999px',
          background: fill, transition: 'width 0.2s linear, background 0.4s ease',
        }} />
      </div>
      <span className="text-white font-black tabular-nums" style={{ fontSize: '0.95rem', minWidth: '1.6em', textAlign: 'right' }}>{timeLeft}</span>
    </div>
  );
}

// Drop-shadow tint for the ring's glow — the average of each mode's three
// gradient stops above, so the glow reads as "light cast by this ring"
// rather than a generic fixed color that drifts from whatever's actually
// on the stroke.
const HERO_GLOW_COLOR: Record<'classic' | 'race' | 'party' | 'year', string> = {
  classic: 'rgba(162,86,212,0.26)',
  race: 'rgba(226,123,45,0.26)',
  party: 'rgba(33,178,168,0.26)',
  year: 'rgba(75,142,158,0.24)',
};

function hexToRgb(hex: string): readonly [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function lerpColor(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return `rgb(${Math.round(ar + (br - ar) * t)},${Math.round(ag + (bg - ag) * t)},${Math.round(ab + (bb - ab) * t)})`;
}

// The host "playing" card's dominant hero dial: a thick ring painted with a
// true angular (conic) gradient. The 3 colors are anchored to fixed points
// around the circle (0deg/180deg/360deg) rather than rescaled to fit
// whatever's currently swept — so the ring is a single gradient "painting"
// that a shrinking/growing arc reveals more or less of, not a gradient that
// itself stretches and squashes as the arc changes size. This used to be an
// SVG <linearGradient> painted across the circle via userSpaceOnUse,
// matching its vector to the arc's own start/end points, but a linear
// gradient interpolates along a straight chord — for points on a circular
// arc that means color pacing is slow near both ends and fast through the
// arc's middle, and undefined outright at a full 360° sweep (the chord's two
// endpoints coincide). conic-gradient interpolates by angle instead, so
// pacing is even all the way around and a full sweep is just the ordinary
// 360° case, no special-casing needed.
export function HeroTimer({ timeLeft, total, size = 200, accent = 'classic' }: Readonly<{ timeLeft: number; total: number; size?: number; accent?: 'classic' | 'race' | 'party' | 'year' }>) {
  const sw = size * 0.058;
  const r = (size - sw * 2) / 2; // ring centerline radius — matches the old SVG stroke circle's radius exactly
  const pct = useTimerPct(timeLeft, total);
  const center = size / 2;
  const [startColor, midColor, endColor] = HERO_GRADIENT_STOPS[accent];
  // 12 o'clock, sweeping clockwise as pct grows — conic-gradient's own 0deg
  // already points up, so no extra rotation is needed here (unlike the old
  // SVG circle, which had to rotate -90deg to move its 0deg from 3 o'clock).
  const sweepDeg = pct * 360;
  // The color exactly at the sweep's cutoff, on the *fixed* 0/180/360 ramp —
  // used both to paint the hard transparent cutoff at the right color (so it
  // doesn't jump) and to color the moving cap dot below.
  const cutoffColor = sweepDeg <= 180 ? lerpColor(startColor, midColor, sweepDeg / 180) : lerpColor(midColor, endColor, (sweepDeg - 180) / 180);
  const ringBackground = sweepDeg <= 180
    ? `conic-gradient(from 0deg, ${startColor} 0deg, ${cutoffColor} ${sweepDeg}deg, transparent ${sweepDeg}deg, transparent 360deg)`
    : `conic-gradient(from 0deg, ${startColor} 0deg, ${midColor} 180deg, ${cutoffColor} ${sweepDeg}deg, transparent ${sweepDeg}deg, transparent 360deg)`;
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
            style={{ background: ringBackground, WebkitMaskImage: ringMask, maskImage: ringMask, filter: `drop-shadow(0 0 5px ${HERO_GLOW_COLOR[accent]})` }}
          />
          {/* Round caps at both arc ends — a conic-gradient cuts off flat by
              default, unlike the old SVG stroke's strokeLinecap="round". */}
          <div aria-hidden="true" className="absolute rounded-full" style={{ width: sw, height: sw, left: center - sw / 2, top: center - r - sw / 2, background: startColor }} />
          <div aria-hidden="true" className="absolute rounded-full" style={{ width: sw, height: sw, left: capX - sw / 2, top: capY - sw / 2, background: cutoffColor }} />
        </>
      )}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-white font-black" style={{ fontSize: `${size * 0.2}px`, lineHeight: 1 }}>{timeLeft}</span>
        <span style={{ color: 'rgba(255,255,255,0.55)', fontSize: `${size * 0.05}px`, textTransform: 'uppercase', letterSpacing: '0.14em', marginTop: `${size * 0.015}px` }}>sec</span>
      </div>
    </div>
  );
}
