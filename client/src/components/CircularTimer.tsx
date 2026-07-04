import { useEffect, useRef, useState } from 'react';

export function timerColor(pct: number): string {
  if (pct > 0.6) return 'rgba(52,211,153,0.9)';
  if (pct > 0.35) return 'rgba(251,191,36,0.9)';
  if (pct > 0.12) return 'rgba(249,115,22,0.9)';
  return 'rgba(239,68,68,0.9)';
}

export function CircularTimer({ timeLeft, total, size = 128 }: Readonly<{ timeLeft: number; total: number; size?: number }>) {
  const sw = Math.round(size * 0.039);
  const r = (size - sw * 2) / 2;
  const circ = 2 * Math.PI * r;

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
