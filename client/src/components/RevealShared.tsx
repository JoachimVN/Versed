import { Check, Trophy, X } from 'lucide-react';
import type { RoundResultEvent } from '../types';

export function RevealStatusHeader({
  result,
  myName,
}: Readonly<{ result: RoundResultEvent; myName?: string }>) {
  const isRace = result.mode === 'race';
  const iWon = isRace
    ? (myName != null && !!result.correctGuessers?.includes(myName))
    : (result.correct && myName != null && result.guesserName === myName);

  let circle: React.ReactNode;
  let bgClass: string;
  let label: React.ReactNode;

  if (!result.correct) {
    circle = <X className="w-12 h-12 text-white/30" />;
    bgClass = 'bg-white/5';
    label = <p className="text-white/60 text-xl">No one got it</p>;
  } else if (iWon) {
    circle = <Trophy className="w-12 h-12 text-amber-400" />;
    bgClass = 'bg-amber-500/20';
    label = <p className="text-2xl font-black text-green-400">You got it!</p>;
  } else if (isRace) {
    const count = result.correctGuessers?.length ?? 0;
    circle = <Check className="w-12 h-12 text-white/40" />;
    bgClass = 'bg-white/10';
    const raceLabel = count === 1
      ? `${result.correctGuessers![0]} got it`
      : `${count} players got it`;
    label = <p className="text-2xl font-black text-white">{raceLabel}</p>;
  } else {
    const initial = result.guesserName?.[0]?.toUpperCase() ?? '?';
    circle = <span className="text-2xl font-black text-white/70">{initial}</span>;
    bgClass = 'bg-white/10';
    label = <p className="text-2xl font-black text-white">{result.guesserName} got it</p>;
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div className={`w-24 h-24 rounded-full flex items-center justify-center ${bgClass}`}>
        {circle}
      </div>
      {label}
    </div>
  );
}

export function RevealSongCard({ result }: Readonly<{ result: RoundResultEvent }>) {
  const artistOnly = result.artistOnly;
  return (
    <div className="flex flex-col items-center text-center gap-3 w-full">
      <p className="text-white/30 text-xs uppercase tracking-widest">
        {artistOnly ? 'The artist was' : 'The song was'}
      </p>
      {result.coverUrl && (
        <img
          src={result.coverUrl}
          alt="Album art"
          className="w-40 h-40 rounded-2xl object-cover shadow-[0_8px_40px_rgba(0,0,0,0.7)]"
        />
      )}
      <div>
        {artistOnly ? (
          <>
            <p className="text-white font-black text-2xl leading-tight">
              {result.artist}
              {result.featuredArtists && (
                <span className="text-white/40 font-normal text-lg"> feat. {result.featuredArtists}</span>
              )}
            </p>
            <p className="text-white/50 mt-1">{result.songTitle}</p>
          </>
        ) : (
          <>
            <p className="text-white font-black text-2xl leading-tight">{result.songTitle}</p>
            <p className="text-white/50 mt-1">
              {result.artist}
              {result.featuredArtists && (
                <span className="text-white/25"> feat. {result.featuredArtists}</span>
              )}
            </p>
          </>
        )}
        {result.year && <p className="text-white/25 text-sm mt-0.5">{result.year}</p>}
      </div>
    </div>
  );
}
