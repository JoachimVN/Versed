import React from 'react';
import { PartyBadge } from '../../components/RoundIntro';
import { HeroTimer, LinearTimer } from '../../components/CircularTimer';
import { resolveRoundAccent } from '../../components/AudioBars';
import { useRevealLayout } from '../../components/revealSqueeze';
import type { HostState } from './useHostGame';
import { AlbumArtHint } from './roundBits';
import { EndGameButton } from './dialogs';

export function BettingView({ game }: Readonly<{ game: HostState }>) {
  const { roundIndex, totalRounds, timeLeft, bettingTime, hints, bidCount, players, pin, skipTurn, endGame, party, mode, roundYearOnly } = game;
  const imageHint = hints.find(h => h.imageUrl);
  const textHints = hints.filter(h => !h.imageUrl);
  const accent = resolveRoundAccent(mode, roundYearOnly, party);
  const { compact } = useRevealLayout();

  return (
    <div className="relative min-h-screen flex flex-col overflow-hidden">

      {/* Background */}
      <img
        src={`${import.meta.env.BASE_URL}backgrounds/background2.svg`}
        alt=""
        aria-hidden="true"
        style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 0, transform: 'rotate(90deg)' }}
      />
      <div style={{ position: 'fixed', inset: 0, zIndex: 1, background: 'rgba(5,5,14,0.75)', backdropFilter: 'blur(28px)' }} />

      {/* Top bar */}
      <div className="relative flex items-center justify-between px-9 pt-7" style={{ zIndex: 2 }}>
        <span style={{ color: 'rgba(255,255,255,0.45)', fontWeight: 600, fontSize: '1rem' }}>
          Round{' '}
          <span style={{ color: 'rgba(255,255,255,0.72)', fontWeight: 800 }}>{roundIndex + 1}</span>
          <span style={{ color: 'rgba(255,255,255,0.45)' }}>/{totalRounds}</span>
        </span>
        <span style={{ color: 'rgba(255,255,255,0.45)', fontFamily: 'monospace', letterSpacing: '0.12em', fontSize: '0.9rem' }}>
          PIN {pin}
        </span>
      </div>

      {/* Main content */}
      <div className="flex-1 relative flex flex-col items-center justify-center gap-10 px-8 py-4" style={{ zIndex: 2 }}>

        {/* Album art — centered, above timer */}
        {imageHint?.imageUrl && <AlbumArtHint hint={imageHint} size={180} radius={28} />}

        <PartyBadge party={party} />

        {/* Playback ring, matching the game's mode accent */}
        {compact
          ? <LinearTimer timeLeft={timeLeft} total={bettingTime} />
          : <HeroTimer timeLeft={timeLeft} total={bettingTime} size={128} accent={accent} />}

        {/* Text hints */}
        {textHints.length > 0 && (
          <div
            className="flex items-center justify-center w-full max-w-3xl rounded-3xl"
            style={{
              padding: '24px 52px',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              backdropFilter: 'blur(16px)',
            }}
          >
            {textHints.map((h, i) => (
              <React.Fragment key={h.label}>
                {i > 0 && (
                  <div style={{ width: 1, alignSelf: 'stretch', background: 'rgba(255,255,255,0.08)', margin: '0 40px' }} />
                )}
                <div className="flex flex-col items-center gap-2">
                  <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.2em' }}>
                    {h.label}
                  </span>
                  <span style={{ color: 'white', fontWeight: 900, fontSize: '2.75rem', lineHeight: 1, letterSpacing: '-0.02em' }}>
                    {h.value}
                  </span>
                </div>
              </React.Fragment>
            ))}
          </div>
        )}

        {/* Bid status dots */}
        <div className="flex flex-col items-center gap-3">
          <div className="flex gap-2.5 flex-wrap justify-center">
            {players.map((p, i) => (
              <div
                key={p.name}
                className="rounded-full transition-all duration-500"
                style={{
                  width: 12, height: 12,
                  background: i < bidCount ? 'rgba(158,18,204,0.9)' : 'rgba(255,255,255,0.12)',
                  boxShadow: i < bidCount ? '0 0 8px rgba(158,18,204,0.55)' : 'none',
                  transform: i < bidCount ? 'scale(1)' : 'scale(0.78)',
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Skip / end */}
      <div className="relative flex flex-col justify-center items-center gap-2 pb-7" style={{ zIndex: 2 }}>
        <button
          type="button"
          onClick={skipTurn}
          style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.2)', fontSize: '0.75rem', cursor: 'pointer', transition: 'color 0.2s ease' }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.32)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.2)'; }}
        >
          Skip round
        </button>
        <EndGameButton endGame={endGame} />
      </div>
    </div>
  );
}
