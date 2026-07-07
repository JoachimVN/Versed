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

const AUDIO_BAR_COLORS: Record<'classic' | 'race' | 'year', string> = {
  classic: 'rgba(158,18,204,0.75)',
  race: 'rgba(234,88,12,0.75)',
  year: 'rgba(0,238,232,0.75)',
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
export function AudioBars({ playing, accent, height, bpm }: Readonly<{ playing: boolean; accent: 'classic' | 'race' | 'year'; height: number; bpm?: number | null }>) {
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
