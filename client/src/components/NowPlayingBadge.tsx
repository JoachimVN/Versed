import { Music } from 'lucide-react';

const ACCENT_COLORS: Record<'classic' | 'race' | 'year', string> = {
  classic: '150,17,193',
  race: '234,88,12',
  year: '0,200,195',
};

// Shared "song is playing / get ready" focal point for Play and Host: a
// circular badge in the app's brand gradient (matching the logo/RoundIntro
// motif) with sonar-style pulse rings while audio plays. Idle otherwise, so
// the same element reads as "waiting" vs "live" without any extra UI.
export function NowPlayingBadge({
  playing, size = 72, accent = 'classic',
}: Readonly<{ playing: boolean; size?: number; accent?: 'classic' | 'race' | 'year' }>) {
  const accentRgb = ACCENT_COLORS[accent];
  return (
    <div className="relative flex items-center justify-center" style={{ width: size * 2, height: size * 2 }}>
      {playing && [0, 1].map(i => (
        <div
          key={i}
          style={{
            position: 'absolute', width: size, height: size, borderRadius: '50%',
            border: `1.5px solid rgba(${accentRgb},0.55)`,
            animation: 'badgePulse 2.2s ease-out infinite',
            animationDelay: `${i * 1.1}s`,
          }}
        />
      ))}
      <div
        style={{
          position: 'relative', width: size, height: size, borderRadius: '50%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'linear-gradient(to bottom left, rgba(0,200,195,0.5) 0%, transparent 55%), linear-gradient(to top right, rgba(150,17,193,0.55) 0%, transparent 55%), rgba(255,255,255,0.08)',
          border: '1px solid rgba(255,255,255,0.14)',
          opacity: playing ? 1 : 0.45,
          transition: 'opacity 0.4s ease',
          animation: playing ? 'badgeBreathe 1.8s ease-in-out infinite' : 'none',
        }}
      >
        <Music style={{ width: size * 0.42, height: size * 0.42, color: 'white' }} />
      </div>
    </div>
  );
}
