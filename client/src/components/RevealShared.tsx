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
