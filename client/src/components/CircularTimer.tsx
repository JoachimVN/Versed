import { useEffect, useId, useRef, useState } from 'react';

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
const HERO_GRADIENT_STOPS: Record<'classic' | 'race' | 'party', readonly [string, string][]> = {
  classic: [
    ['0%', '#7e5dab'],
    ['50%', '#5f8f99'],
    ['100%', '#9c5fa0'],
  ],
  race: [
    ['0%', '#c07a45'],
    ['50%', '#7c6a90'],
    ['100%', '#c99b7d'],
  ],
  party: [
    ['0%', '#5b93a3'],
    ['50%', '#7c6a90'],
    ['100%', '#539c94'],
  ],
};

// The host "playing" card's dominant hero dial: a thick ring painted with
// that fixed gradient. `gradientUnits="userSpaceOnUse"` with x1/y1/x2/y2 set
// to the arc's own start/end points (rather than a plain 0%-100% diagonal
// across the ring's whole bounding box) is what makes the full color range
// visible on a short arc too — a corner-to-corner diagonal only shows a
// narrow slice of the gradient when just 10-20% of the ring is drawn, which
// read as "no gradient" at low time-remaining.
export function HeroTimer({ timeLeft, total, size = 200, mode = 'classic' }: Readonly<{ timeLeft: number; total: number; size?: number; mode?: 'classic' | 'race' | 'party' }>) {
  const sw = size * 0.058;
  const r = (size - sw * 2) / 2;
  const circ = 2 * Math.PI * r;
  const pct = useTimerPct(timeLeft, total);
  const gradId = useId();
  const center = size / 2;
  const gradientStops = HERO_GRADIENT_STOPS[mode];
  // Arc start is fixed at local angle 0 (screen 12 o'clock, after the -90deg
  // rotate below); the visible arc sweeps clockwise on screen as pct grows,
  // which is local angle +pct*360deg (see CircularTimer's identical
  // strokeDasharray/offset mechanic for the underlying geometry).
  const endAngle = pct * 2 * Math.PI;
  const gx1 = center + r;
  const gy1 = center;
  const gx2 = center + r * Math.cos(endAngle);
  const gy2 = center + r * Math.sin(endAngle);

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="absolute inset-0" style={{ transform: 'rotate(-90deg)', overflow: 'visible' }}>
        <defs>
          <linearGradient id={gradId} gradientUnits="userSpaceOnUse" x1={gx1} y1={gy1} x2={gx2} y2={gy2}>
            {gradientStops.map(([offset, color]) => <stop key={offset} offset={offset} stopColor={color} />)}
          </linearGradient>
        </defs>
        <circle cx={center} cy={center} r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={sw} />
        <circle
          cx={center} cy={center} r={r} fill="none"
          stroke={`url(#${gradId})`}
          strokeWidth={sw}
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - pct)}
          strokeLinecap="round"
          style={{ filter: 'drop-shadow(0 0 5px rgba(120,110,150,0.22))' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-white font-black" style={{ fontSize: `${size * 0.2}px`, lineHeight: 1 }}>{timeLeft}</span>
        <span style={{ color: 'rgba(255,255,255,0.55)', fontSize: `${size * 0.05}px`, textTransform: 'uppercase', letterSpacing: '0.14em', marginTop: `${size * 0.015}px` }}>sec</span>
      </div>
    </div>
  );
}
