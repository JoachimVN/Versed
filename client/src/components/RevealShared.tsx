import { Trophy, X } from 'lucide-react';
import type { RoundResultEvent } from '../types';

export function RevealStatusHeader({
  result,
  myName,
}: Readonly<{ result: RoundResultEvent; myName?: string }>) {
  const iWon = result.correct && myName != null && result.guesserName === myName;

  let circle: React.ReactNode;
  let bgClass: string;
  if (!result.correct) {
    circle = <X className="w-12 h-12 text-white/30" />;
    bgClass = 'bg-white/5';
  } else if (iWon) {
    circle = <Trophy className="w-12 h-12 text-amber-400" />;
    bgClass = 'bg-amber-500/20';
  } else {
    const initial = result.guesserName?.[0]?.toUpperCase() ?? '?';
    circle = <span className="text-2xl font-black text-white/70">{initial}</span>;
    bgClass = 'bg-white/10';
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div className={`w-24 h-24 rounded-full flex items-center justify-center ${bgClass}`}>
        {circle}
      </div>
      {result.correct
        ? <p className={`text-2xl font-black ${iWon ? 'text-green-400' : 'text-white'}`}>
            {iWon ? `+${result.points} pts!` : `${result.guesserName} got it`}
          </p>
        : <p className="text-white/60 text-xl">No one got it</p>
      }
    </div>
  );
}

export function RevealSongCard({ result }: Readonly<{ result: RoundResultEvent }>) {
  return (
    <div className="flex flex-col items-center text-center gap-3 w-full">
      <p className="text-white/30 text-xs uppercase tracking-widest">The song was</p>
      {result.coverUrl && (
        <img
          src={result.coverUrl}
          alt="Album art"
          className="w-40 h-40 rounded-2xl object-cover shadow-[0_8px_40px_rgba(0,0,0,0.7)]"
        />
      )}
      <div>
        <p className="text-white font-black text-2xl leading-tight">{result.songTitle}</p>
        <p className="text-white/50 mt-1">{result.artist}</p>
        {result.year && <p className="text-white/25 text-sm mt-0.5">{result.year}</p>}
      </div>
    </div>
  );
}
