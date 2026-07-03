import { Check, Trophy, X } from 'lucide-react';
import type { RoundResultEvent } from '../types';

export function NoOneGotItCardContent({ result }: Readonly<{ result: RoundResultEvent }>) {
  const artistOnly = result.artistOnly;
  return (
    <div style={{ width: '262px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
      <div style={{
        width: '52px', height: '52px', borderRadius: '50%',
        background: 'rgba(255,255,255,0.05)',
        border: '1px solid rgba(255,255,255,0.09)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: '10px',
      }}>
        <X style={{ width: '22px', height: '22px', color: 'rgba(255,255,255,0.25)' }} />
      </div>
      <span style={{
        fontSize: '1.4rem', fontWeight: 900, letterSpacing: '0.01em',
        background: 'linear-gradient(to bottom left, rgba(210,70,50,0.4) 0%, transparent 52%), linear-gradient(to top right, rgba(255,165,70,0.28) 0%, transparent 52%), #fff',
        WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
        marginBottom: '14px', display: 'inline-block', minWidth: '200px',
      }}>
        No one got it
      </span>
      <div style={{ width: '100%', height: '1px', background: 'rgba(255,255,255,0.08)', marginBottom: '14px' }} />
      <span style={{
        color: 'rgba(255,255,255,0.28)', fontSize: '0.6rem', letterSpacing: '0.18em', textTransform: 'uppercase',
        marginBottom: '10px', display: 'inline-block',
      }}>
        {artistOnly ? 'The artist was' : 'The song was'}
      </span>
      <SongInfo result={result} />
    </div>
  );
}

function SongInfo({ result }: Readonly<{ result: RoundResultEvent }>) {
  const artistOnly = result.artistOnly;
  return (
    <>
      {result.coverUrl && (
        <img
          src={result.coverUrl} alt="Album art"
          style={{ width: '200px', height: '200px', borderRadius: '16px', objectFit: 'cover', marginBottom: '12px', boxShadow: '0 10px 36px rgba(0,0,0,0.65)' }}
        />
      )}
      {artistOnly ? (
        <>
          <span style={{ color: 'white', fontWeight: 900, fontSize: '1.1rem', lineHeight: 1.3, display: 'inline-block', minWidth: '220px' }}>
            {result.artist}
            {result.featuredArtists && <span style={{ color: 'rgba(255,255,255,0.38)', fontWeight: 400, fontSize: '0.875rem' }}> feat. {result.featuredArtists}</span>}
          </span>
          <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.875rem', marginTop: '3px', display: 'inline-block', minWidth: '220px' }}>
            {result.songTitle}
          </span>
        </>
      ) : (
        <>
          <span style={{ color: 'white', fontWeight: 900, fontSize: '1.1rem', lineHeight: 1.3, display: 'inline-block', minWidth: '220px' }}>
            {result.songTitle}
          </span>
          <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.875rem', marginTop: '3px', display: 'inline-block', minWidth: '220px' }}>
            {result.artist}{result.featuredArtists ? <span style={{ color: 'rgba(255,255,255,0.22)' }}> feat. {result.featuredArtists}</span> : null}
          </span>
        </>
      )}
      {result.year && (
        <span style={{ color: 'rgba(255,255,255,0.22)', fontSize: '0.75rem', marginTop: '4px', display: 'inline-block' }}>
          {result.year}
        </span>
      )}
    </>
  );
}

// Party "guess the year" rounds: the answer is a number, so the card leads
// with the year and the closest player instead of a got-it/no-one-got-it state.
export function YearCardContent({ result }: Readonly<{ result: RoundResultEvent }>) {
  const winner = result.yearResults?.find(r => r.diff !== null);
  const pluralS = winner?.diff === 1 ? '' : 's';
  const winnerDetail = winner && (winner.diff === 0 ? ' — exact!' : ` (${winner.diff} year${pluralS} off)`);
  return (
    <div style={{ width: '262px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
      <span style={{
        color: 'rgba(255,255,255,0.28)', fontSize: '0.6rem', letterSpacing: '0.18em', textTransform: 'uppercase',
        marginBottom: '6px', display: 'inline-block',
      }}>
        The year was
      </span>
      <span style={{
        fontSize: '2.6rem', fontWeight: 900, lineHeight: 1,
        background: 'linear-gradient(to bottom left, rgba(0,200,195,0.5) 0%, transparent 55%), linear-gradient(to top right, rgba(150,17,193,0.5) 0%, transparent 55%), #fff',
        WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
        marginBottom: '8px', display: 'inline-block', minWidth: '160px',
      }}>
        {result.year ? Math.floor(result.year) : '—'}
      </span>
      {winner && (
        <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.82rem', marginBottom: '12px', display: 'inline-block', minWidth: '200px' }}>
          {winner.name} was closest{winnerDetail}
        </span>
      )}
      <div style={{ width: '100%', height: '1px', background: 'rgba(255,255,255,0.08)', marginBottom: '12px' }} />
      {result.coverUrl && (
        <img
          src={result.coverUrl} alt="Album art"
          style={{ width: '170px', height: '170px', borderRadius: '16px', objectFit: 'cover', marginBottom: '12px', boxShadow: '0 10px 36px rgba(0,0,0,0.65)' }}
        />
      )}
      <span style={{ color: 'white', fontWeight: 900, fontSize: '1.05rem', lineHeight: 1.3, display: 'inline-block', minWidth: '220px' }}>
        {result.songTitle}
      </span>
      <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.85rem', marginTop: '3px', display: 'inline-block', minWidth: '220px' }}>
        {result.artist}
      </span>
    </div>
  );
}

export function YearTimelineContent({ result }: Readonly<{ result: RoundResultEvent }>) {
  if (!result.yearResults) return null;

  const year = result.year ? Math.floor(result.year) : null;
  const guesses = result.yearResults.filter(r => r.guess !== null);
  if (!year || guesses.length === 0) return <YearCardContent result={result} />;

  const minGuess = Math.min(...guesses.map(g => g.guess!));
  const maxGuess = Math.max(...guesses.map(g => g.guess!));
  const min = Math.min(year, minGuess);
  const max = Math.max(year, maxGuess);
  const range = max === min ? 1 : max - min;
  const pos = (y: number) => 6 + ((y - min) / range) * 88;

  const sortedResults = [...result.yearResults].sort((a, b) => {
    const diffA = a.diff ?? Infinity;
    const diffB = b.diff ?? Infinity;
    return diffA - diffB;
  });

  return (
    <div style={{ width: '280px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
      <span style={{
        color: 'rgba(255,255,255,0.28)', fontSize: '0.6rem', letterSpacing: '0.18em', textTransform: 'uppercase',
        marginBottom: '8px', display: 'inline-block',
      }}>
        The year was {year}
      </span>

      {/* Timeline */}
      <div style={{ width: '100%', marginBottom: '16px' }}>
        {/* Year markers */}
        <div style={{ position: 'relative', height: '20px', marginBottom: '4px' }}>
          {[min, Math.round(min + range / 2), max].map(y => (
            <div
              key={y}
              style={{
                position: 'absolute',
                left: `${pos(y)}%`,
                transform: 'translateX(-50%)',
                fontSize: '0.65rem',
                color: y === year ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.4)',
                fontWeight: y === year ? 'bold' : 'normal',
              }}
            >
              {y}
            </div>
          ))}
        </div>

        {/* Timeline bar */}
        <div style={{ position: 'relative', height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', marginBottom: '12px' }}>
          {/* Correct year marker */}
          <div
            style={{
              position: 'absolute',
              left: `${pos(year)}%`,
              transform: 'translateX(-50%)',
              width: '8px',
              height: '8px',
              background: 'rgba(0,200,195,0.9)',
              border: '1px solid rgba(0,255,250,0.8)',
              borderRadius: '50%',
              top: '-2px',
            }}
          />

          {/* Guess markers */}
          {sortedResults.map((r, i) => {
            if (r.guess === null) return null;
            const isClosest = i === 0 && r.diff !== null;
            return (
              <div
                key={r.name}
                style={{
                  position: 'absolute',
                  left: `${pos(r.guess)}%`,
                  transform: 'translateX(-50%)',
                  width: isClosest ? '6px' : '4px',
                  height: isClosest ? '6px' : '4px',
                  background: isClosest ? '#fbbf24' : 'rgba(255,255,255,0.4)',
                  borderRadius: '50%',
                  top: isClosest ? '0px' : '2px',
                  transition: 'all 0.2s',
                }}
              />
            );
          })}
        </div>
      </div>

      {/* Results list */}
      <div style={{ width: '100%', maxHeight: '140px', overflowY: 'auto', borderRadius: '8px', background: 'rgba(255,255,255,0.03)', padding: '8px', marginBottom: '12px' }}>
        {sortedResults.map((r, i) => {
          if (r.guess === null) return null;
          const isClosest = i === 0 && r.diff !== null;
          return (
            <div
              key={r.name}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '4px 8px',
                fontSize: '0.75rem',
                borderBottom: i < sortedResults.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
              }}
            >
              <span style={{ color: isClosest ? '#fbbf24' : 'rgba(255,255,255,0.7)', fontWeight: isClosest ? 'bold' : 'normal' }}>
                {r.name}
              </span>
              <span style={{ color: 'rgba(255,255,255,0.4)', marginLeft: '8px' }}>
                {r.guess}{r.diff !== null && r.diff !== 0 ? ` (${r.diff > 0 ? '+' : ''}${r.diff})` : r.diff === 0 ? ' ✓' : ''}
              </span>
            </div>
          );
        })}
        {result.yearResults.filter(r => r.guess === null).length > 0 && (
          <div style={{ padding: '4px 8px', fontSize: '0.75rem', color: 'rgba(255,255,255,0.3)' }}>
            {result.yearResults.filter(r => r.guess === null).length} didn't guess
          </div>
        )}
      </div>

      <div style={{ width: '100%', height: '1px', background: 'rgba(255,255,255,0.08)', marginBottom: '12px' }} />
      {result.coverUrl && (
        <img
          src={result.coverUrl} alt="Album art"
          style={{ width: '140px', height: '140px', borderRadius: '12px', objectFit: 'cover', marginBottom: '12px', boxShadow: '0 10px 36px rgba(0,0,0,0.65)' }}
        />
      )}
      <span style={{ color: 'white', fontWeight: 900, fontSize: '0.95rem', lineHeight: 1.3, display: 'inline-block', minWidth: '220px' }}>
        {result.songTitle}
      </span>
      <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.8rem', marginTop: '3px', display: 'inline-block', minWidth: '220px' }}>
        {result.artist}
      </span>
    </div>
  );
}

export function GotItCardContent({ result, myName }: Readonly<{ result: RoundResultEvent; myName?: string }>) {
  const artistOnly = result.artistOnly;
  const isRace = result.mode === 'race';
  const iWon = isRace
    ? (myName != null && !!result.correctGuessers?.includes(myName))
    : (result.correct && myName != null && result.guesserName === myName);

  let iconNode: React.ReactNode;
  let iconBg: string;
  let iconBorder: string;
  let labelText: string;
  let labelGradient: string;

  if (iWon) {
    iconNode = <Trophy style={{ width: '24px', height: '24px', color: '#fbbf24' }} />;
    iconBg = 'rgba(245,158,11,0.16)';
    iconBorder = 'rgba(245,158,11,0.32)';
    labelText = 'You got it!';
    labelGradient = 'linear-gradient(to bottom left, rgba(30,200,90,0.5) 0%, transparent 52%), linear-gradient(to top right, rgba(250,185,40,0.4) 0%, transparent 52%), #fff';
  } else if (isRace) {
    const count = result.correctGuessers?.length ?? 0;
    iconNode = <Check style={{ width: '24px', height: '24px', color: 'rgba(255,255,255,0.5)' }} />;
    iconBg = 'rgba(255,255,255,0.07)';
    iconBorder = 'rgba(255,255,255,0.12)';
    labelText = count === 1 ? `${result.correctGuessers![0]} got it` : `${count} players got it`;
    labelGradient = 'linear-gradient(to bottom left, rgba(110,32,155,0.4) 0%, transparent 52%), linear-gradient(to top right, rgba(0,200,195,0.3) 0%, transparent 52%), #fff';
  } else {
    const initial = result.guesserName?.[0]?.toUpperCase() ?? '?';
    iconNode = <span style={{ fontSize: '1.25rem', fontWeight: 900, color: 'rgba(255,255,255,0.7)' }}>{initial}</span>;
    iconBg = 'rgba(255,255,255,0.07)';
    iconBorder = 'rgba(255,255,255,0.12)';
    labelText = `${result.guesserName} got it`;
    labelGradient = 'linear-gradient(to bottom left, rgba(110,32,155,0.4) 0%, transparent 52%), linear-gradient(to top right, rgba(0,200,195,0.3) 0%, transparent 52%), #fff';
  }

  return (
    <div style={{ width: '262px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
      <div style={{
        width: '52px', height: '52px', borderRadius: '50%',
        background: iconBg, border: `1px solid ${iconBorder}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: '10px',
      }}>
        {iconNode}
      </div>
      <span style={{
        fontSize: '1.4rem', fontWeight: 900, letterSpacing: '0.01em',
        background: labelGradient,
        WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
        marginBottom: '14px', display: 'inline-block', minWidth: '200px',
      }}>
        {labelText}
      </span>
      <div style={{ width: '100%', height: '1px', background: 'rgba(255,255,255,0.08)', marginBottom: '14px' }} />
      <span style={{
        color: 'rgba(255,255,255,0.28)', fontSize: '0.6rem', letterSpacing: '0.18em', textTransform: 'uppercase',
        marginBottom: '10px', display: 'inline-block',
      }}>
        {artistOnly ? 'The artist was' : 'The song was'}
      </span>
      <SongInfo result={result} />
    </div>
  );
}
