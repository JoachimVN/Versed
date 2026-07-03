// Each bar gets a unique animation name, duration, and delay so they move
// independently. `dur` is the fallback pulse length (seconds) used when a
// song's tempo isn't known; `beats` is how many beats that same pulse should
// span once a real BPM is available, chosen to roughly match `dur` at a
// mid-tempo song so the two modes don't feel jarringly different.
const AUDIO_BARS = [
  { anim: 'audioBarC', dur: 1.1, beats: 0.75, delay: 0    },
  { anim: 'audioBar',  dur: 1.5, beats: 1,    delay: 0.14 },
  { anim: 'audioBarD', dur: 0.85,beats: 0.55, delay: 0.28 },
  { anim: 'audioBarB', dur: 1.7, beats: 1.15, delay: 0.07 },
  { anim: 'audioBar',  dur: 1,   beats: 0.65, delay: 0.42 },
  { anim: 'audioBarC', dur: 1.3, beats: 0.9,  delay: 0.21 },
  { anim: 'audioBarD', dur: 0.9, beats: 0.6,  delay: 0.35 },
  { anim: 'audioBarB', dur: 1.6, beats: 1.05, delay: 0.08 },
  { anim: 'audioBarC', dur: 1.2, beats: 0.8,  delay: 0.26 },
] as const;

const AUDIO_BAR_COLORS: Record<'classic' | 'race' | 'year', string> = {
  classic: 'rgba(150,17,193,0.75)',
  race: 'rgba(234,88,12,0.75)',
  year: 'rgba(0,200,195,0.75)',
};

// Detected tempo can be wildly wrong (half/double-time, or missing) — clamp
// the resulting pulse length so a bad value can't freeze or strobe the bars.
const MIN_BAR_SEC = 0.35;
const MAX_BAR_SEC = 2.2;

function barDuration(bar: (typeof AUDIO_BARS)[number], bpm: number | null | undefined): number {
  if (!bpm || bpm <= 0) return bar.dur;
  const beatSec = 60 / bpm;
  return Math.min(MAX_BAR_SEC, Math.max(MIN_BAR_SEC, beatSec * bar.beats));
}

// Shared "song is playing / get ready" focal point for Host and Play: a flat
// 9-bar equalizer, each bar animating independently. Idle (low, static bars)
// when nothing's playing. Pass `bpm` (the song's tempo) to have the bars
// pulse in time with the track instead of a fixed, tempo-agnostic rhythm.
export function AudioBars({ playing, accent, height, bpm }: Readonly<{ playing: boolean; accent: 'classic' | 'race' | 'year'; height: number; bpm?: number | null }>) {
  const barColor = AUDIO_BAR_COLORS[accent];
  return (
    <div style={{ display: 'flex', gap: '5px', alignItems: 'center', height: `${height}px`, transition: 'opacity 0.3s ease', opacity: playing ? 1 : 0.35 }}>
      {AUDIO_BARS.map((bar) => (
        <div
          key={bar.delay}
          style={{
            width: '3px', height: '100%', borderRadius: '2px',
            background: barColor,
            animation: playing ? `${bar.anim} ${barDuration(bar, bpm)}s ease-in-out infinite` : 'none',
            animationDelay: `${bar.delay}s`,
            transformOrigin: 'center',
            transform: playing ? undefined : 'scaleY(0.07)',
          }}
        />
      ))}
    </div>
  );
}
