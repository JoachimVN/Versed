import { useEffect, useRef } from 'react';

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  w: number; h: number;
  rot: number; rotV: number;
  color: string;
  circle: boolean;
  alpha: number;
}

const COLORS = [
  '#00807e', '#00b5a3',           // teals
  '#9611c1', '#6e209b', '#804a92', // purples
  '#c84ee8',                       // bright violet
  '#ffffff', '#e0d0ff',            // whites
  '#342758',                       // dark navy (subtle contrast piece)
];
const COUNT = 120;

function makeParticle(W: number, H: number, scattered = false): Particle {
  const circle = Math.random() > 0.72;
  return {
    x: Math.random() * W,
    y: scattered ? Math.random() * H : -30 - Math.random() * 80,
    vx: (Math.random() - 0.5) * 0.5,
    vy: 0.4 + Math.random() * 0.6,
    w: circle ? 6 + Math.random() * 8 : 10 + Math.random() * 16,
    h: circle ? 6 + Math.random() * 8 : 4 + Math.random() * 7,
    rot: Math.random() * Math.PI * 2,
    rotV: (Math.random() - 0.5) * 0.025,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    circle,
    alpha: 0.55 + Math.random() * 0.45,
  };
}

export function ConfettiBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let W = window.innerWidth;
    let H = window.innerHeight;
    canvas.width = W;
    canvas.height = H;

    const particles: Particle[] = Array.from({ length: COUNT }, () => makeParticle(W, H, true));
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const render = () => {
      ctx.clearRect(0, 0, W, H);
      for (const p of particles) {
        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        if (p.circle) {
          ctx.beginPath();
          ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        }
        ctx.restore();
      }
    };

    if (reduced) { render(); return; }

    let rafId: number;
    let last = performance.now();
    let frozen = false;
    let frameCount = 0;
    let fpsWindowStart = performance.now();

    const resetTiming = () => {
      last = performance.now();
      frameCount = 0;
      fpsWindowStart = performance.now();
    };

    const tick = (now: number) => {
      if (frozen) return;

      const dt = Math.min((now - last) / 16.667, 4);
      last = now;

      frameCount++;
      if (now - fpsWindowStart > 2500) {
        const fps = frameCount / ((now - fpsWindowStart) / 1000);
        if (fps < 18) { frozen = true; return; }
        frameCount = 0;
        fpsWindowStart = now;
      }

      for (const p of particles) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.rotV * dt;
        if (p.y > H + 30) Object.assign(p, makeParticle(W, H, false));
      }

      render();
      rafId = requestAnimationFrame(tick);
    };

    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(rafId);
      } else {
        resetTiming();
        rafId = requestAnimationFrame(tick);
      }
    };

    const onResize = () => {
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width = W;
      canvas.height = H;
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('resize', onResize);
    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return <canvas ref={canvasRef} className="fixed inset-0 pointer-events-none" style={{ zIndex: 0 }} />;
}
