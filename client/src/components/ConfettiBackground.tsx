import { useEffect, useRef } from 'react';

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  w: number; h: number;
  rot: number; rotV: number;
  color: string;
  circle: boolean;
  alpha: number;
  initialAlpha: number;
}

const COLORS = [
  '#00a6a3', '#00b5a3',           // teals
  '#9e12cc', '#804a92',            // purples
  '#c84ee8',                       // bright violet
  '#00c4b0', '#b040d8',            // light teal + mid purple
  '#3c2c66',                       // dark navy (subtle contrast piece)
];
const COUNT = 120;

function seededRand(seed: number) {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xffffffff; };
}

function makeParticle(W: number, H: number, scattered = false, rand: () => number = Math.random): Particle {
  const circle = rand() > 0.72;
  const alpha = 0.55 + rand() * 0.45;
  return {
    x: rand() * W,
    y: scattered ? rand() * H : -30 - rand() * 80,
    vx: (rand() - 0.5) * 0.5,
    vy: 0.4 + rand() * 0.6,
    w: circle ? 6 + rand() * 8 : 10 + rand() * 16,
    h: circle ? 6 + rand() * 8 : 4 + rand() * 7,
    rot: rand() * Math.PI * 2,
    rotV: (rand() - 0.5) * 0.025,
    color: COLORS[Math.floor(rand() * COLORS.length)],
    circle,
    alpha,
    initialAlpha: alpha,
  };
}

// Module-level speed so any component can nudge it without React re-renders.
let _speedTarget = 1;
let _currentSpeed = 1;
let _respawning = true;
let _restoreFieldVersion = 0;

export function setConfettiSpeedTarget(speed: number) {
  _speedTarget = speed;
}

// The app-level canvas stays mounted across Home, Join, and Waiting. Turning
// recycling off lets the particles that are already visible finish falling
// out of view without introducing any new ones; turning it back on makes the
// same canvas resume its normal continuous field.
export function setConfettiRespawning(enabled: boolean) {
  _respawning = enabled;
}

// Used when Waiting returns to Home. Particles still on screen keep their
// exact positions; only slots that have already drained below the viewport
// are scattered back into view so Home's full field is present during the
// transition rather than arriving from above afterward.
export function restoreConfettiField() {
  _respawning = true;
  _restoreFieldVersion++;
}

export function ConfettiBackground({ burst = false, persistAfterBurst = false, speedMultiplier = 1 }: Readonly<{ burst?: boolean; persistAfterBurst?: boolean; speedMultiplier?: number }>) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Size from the canvas's containing box, not window.innerHeight — the
    // container spans 100lvh (behind iOS Safari's translucent bottom bar),
    // which is taller than innerHeight while the browser bars are expanded.
    // Reading the containing box also avoids a canvas intrinsic-size race:
    // if the canvas is measured before its absolute parent has settled, CSS
    // can stretch the old bitmap and make every particle look enormous.
    const sizingElement = canvas.parentElement ?? canvas;
    const readCanvasSize = () => {
      const rect = sizingElement.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      return { width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)) };
    };
    const initialSize = readCanvasSize() ?? { width: 1, height: 1 };
    let W = initialSize.width;
    let H = initialSize.height;
    canvas.width = W;
    canvas.height = H;

    const reduced = globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const rand = reduced ? seededRand(0x5eed42) : Math.random;
    const particles: Particle[] = Array.from({ length: COUNT }, () => makeParticle(W, H, true, rand));

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
    let burstStartTime = burst ? performance.now() : 0;
    let restoreFieldVersion = _restoreFieldVersion;

    const resetTiming = () => {
      last = performance.now();
      frameCount = 0;
      fpsWindowStart = performance.now();
    };

    // Returns true when the frame should bail immediately (fps dropped below
    // threshold and the animation isn't pinned open by a persisting burst).
    const updateFrameRate = (now: number): boolean => {
      frameCount++;
      if (now - fpsWindowStart > 2500) {
        const fps = frameCount / ((now - fpsWindowStart) / 1000);
        if (fps < 18) {
          frozen = true;
          if (!(burst && persistAfterBurst)) return true;
        }
        frameCount = 0;
        fpsWindowStart = now;
      }
      return false;
    };

    const updateBurst = (now: number) => {
      const burstElapsed = now - burstStartTime;
      const burstDuration = 1500;
      if (burstElapsed > burstDuration) {
        frozen = true;
      }
      const burstProgress = burstElapsed / burstDuration;
      _currentSpeed = (persistAfterBurst ? 0.5 : 3 * (1 - burstProgress)) * speedMultiplier;
      for (const p of particles) {
        if (persistAfterBurst || burstProgress < 0.6) {
          p.alpha = p.initialAlpha;
        } else {
          const fadeProgress = (burstProgress - 0.6) / 0.4;
          p.alpha = p.initialAlpha * Math.max(0, 1 - fadeProgress);
        }
      }
    };

    const advanceParticles = (dt: number) => {
      for (const p of particles) {
        p.x += p.vx * dt * _currentSpeed;
        p.y += p.vy * dt * _currentSpeed;
        p.rot += p.rotV * dt * _currentSpeed;
        if (p.y > H + 30 && !burst && _respawning) {
          Object.assign(p, makeParticle(W, H, false));
        }
      }
    };

    const restoreDrainedParticles = () => {
      if (restoreFieldVersion === _restoreFieldVersion) return;
      restoreFieldVersion = _restoreFieldVersion;
      for (const p of particles) {
        if (p.y > H + 30) Object.assign(p, makeParticle(W, H, true));
      }
    };

    const tick = (now: number) => {
      if (frozen && !(burst && persistAfterBurst)) return;

      const dt = Math.min((now - last) / 16.667, 4);
      last = now;

      if (updateFrameRate(now)) return;

      restoreDrainedParticles();

      if (burst) {
        updateBurst(now);
      } else {
        // Smooth-lerp toward the current speed target.
        _currentSpeed += (_speedTarget - _currentSpeed) * 0.055;
      }

      advanceParticles(dt);

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

    const resizeCanvas = () => {
      const nextSize = readCanvasSize();
      if (!nextSize) return;
      const { width: newW, height: newH } = nextSize;
      if (newW === W && newH === H) return;
      if (W > 0 && H > 0) {
        const scaleX = newW / W;
        const scaleY = newH / H;
        for (const p of particles) {
          p.x *= scaleX;
          p.y *= scaleY;
        }
      }
      W = newW;
      H = newH;
      canvas.width = W;
      canvas.height = H;
    };

    const onResize = () => resizeCanvas();
    const resizeObserver = new ResizeObserver(resizeCanvas);
    resizeObserver.observe(sizingElement);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('resize', onResize);
    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 0, display: 'block' }} />;
}
