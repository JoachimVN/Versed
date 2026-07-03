// Each bar gets a unique animation name, duration, and delay so they move independently.
const AUDIO_BARS = [
  { anim: 'audioBarC', dur: 1.1, delay: 0    },
  { anim: 'audioBar',  dur: 1.5, delay: 0.14 },
  { anim: 'audioBarD', dur: 0.85,delay: 0.28 },
  { anim: 'audioBarB', dur: 1.7, delay: 0.07 },
  { anim: 'audioBar',  dur: 1, delay: 0.42 },
  { anim: 'audioBarC', dur: 1.3, delay: 0.21 },
  { anim: 'audioBarD', dur: 0.9, delay: 0.35 },
  { anim: 'audioBarB', dur: 1.6, delay: 0.08 },
  { anim: 'audioBarC', dur: 1.2, delay: 0.26 },
] as const;

const AUDIO_BAR_COLORS: Record<'classic' | 'race' | 'year', string> = {
  classic: 'rgba(150,17,193,0.75)',
  race: 'rgba(234,88,12,0.75)',
  year: 'rgba(0,200,195,0.75)',
};

// Shared "song is playing / get ready" focal point for Host and Play: a flat
// 9-bar equalizer, each bar animating independently. Idle (low, static bars)
// when nothing's playing.
export function AudioBars({ playing, accent, height }: Readonly<{ playing: boolean; accent: 'classic' | 'race' | 'year'; height: number }>) {
  const barColor = AUDIO_BAR_COLORS[accent];
  return (
    <div style={{ display: 'flex', gap: '5px', alignItems: 'center', height: `${height}px`, transition: 'opacity 0.3s ease', opacity: playing ? 1 : 0.35 }}>
      {AUDIO_BARS.map((bar) => (
        <div
          key={bar.delay}
          style={{
            width: '3px', height: '100%', borderRadius: '2px',
            background: barColor,
            animation: playing ? `${bar.anim} ${bar.dur}s ease-in-out infinite` : 'none',
            animationDelay: `${bar.delay}s`,
            transformOrigin: 'center',
            transform: playing ? undefined : 'scaleY(0.07)',
          }}
        />
      ))}
    </div>
  );
}
