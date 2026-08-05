import { useState, useEffect } from 'react';
import { Flame } from 'lucide-react';
import LiquidGlass from '../../components/StableLiquidGlass';
import { PartyBadge } from '../../components/RoundIntro';
import { AudioBars } from '../../components/AudioBars';
import { useRevealLayout } from '../../components/revealSqueeze';
import type { PartyInfo } from '../../types';
import type { PlayState } from './usePlayGame';
import { resolveTarget, TargetChip } from './guessTarget';

export function WatchingView({ game }: Readonly<{ game: PlayState }>) {
  const { lowestBid, guesserNames, mode, artistOnly, yearOnly, songPlaying, songTempo, party, roundIndex, totalRounds, myScore, myStreak } = game;
  const [visible, setVisible] = useState(false);
  useEffect(() => { const t = setTimeout(() => setVisible(true), 30); return () => clearTimeout(t); }, []);
  const isRace = mode === 'race';
  const isDuel = !!party?.finale;
  const isUnderdog = party?.event === 'underdog';
  const isYear = party ? party.format === 'year' : yearOnly;
  const nonYearAccent = isRace ? 'race' : 'classic';
  const watchAccent = isYear ? 'year' : nonYearAccent;

  // On short viewports the card's fixed `min(75vh, 620px)` reservation plus
  // the header/gaps/score card easily add up to more than the viewport has
  // (e.g. a landscape phone at 375px tall), pushing the score card off the
  // bottom of the screen with no way to see it before the round starts. The
  // wrapper's declared height only ever sets the box the glass card is
  // centered inside — never the card's own size — so shrinking it costs
  // nothing on tall screens (see RevealView's identical squeeze pattern).
  const { compact, ultraCompact } = useRevealLayout();
  const outerGapClass = ultraCompact ? 'gap-1' : compact ? 'gap-4' : 'gap-6';
  const outerPaddingClass = ultraCompact ? 'px-4 py-2' : compact ? 'px-5 py-5' : 'px-5 py-8';
  const headerGapClass = ultraCompact ? 'gap-1' : 'gap-2';
  const cardHeight = ultraCompact ? '175px' : compact ? '300px' : 'min(75vh, 620px)';
  const cardGap = ultraCompact ? '14px' : compact ? '26px' : '44px';
  const cardPadY = ultraCompact ? 'min(14px, 3vh)' : compact ? 'min(40px, 6vh)' : 'min(80px, 9vh)';
  const barsHeight = ultraCompact ? 26 : compact ? 40 : 56;
  const scorePadding = ultraCompact ? '6px 20px' : compact ? '10px 26px' : '10px 30px';
  const scoreTextClass = ultraCompact ? 'text-lg' : compact ? 'text-xl' : 'text-2xl';

  return (
    <div className="relative min-h-screen overflow-x-hidden overflow-y-auto overscroll-contain">
      {/* Background */}
      <img
        src={`${import.meta.env.BASE_URL}backgrounds/background4.svg`}
        alt=""
        aria-hidden="true"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 0, transform: 'rotate(180deg)' }}
      />
      <div style={{ position: 'absolute', inset: 0, zIndex: 1, background: 'rgba(5,5,14,0.82)', backdropFilter: 'blur(36px)' }} />

      {/* Content */}
      <div
        className={`relative flex flex-col items-center min-h-screen ${outerGapClass} ${outerPaddingClass}`}
        style={{
          zIndex: 2,
          transition: 'opacity 0.4s ease, transform 0.4s ease',
          opacity: visible ? 1 : 0,
          transform: visible ? 'translateY(0)' : 'translateY(14px)',
        }}
      >
        <div className={`flex flex-col items-center ${headerGapClass}`}>
          <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.85rem' }}>
            Round {roundIndex + 1}<span style={{ color: 'rgba(255,255,255,0.45)' }}>/{totalRounds}</span>
          </p>
          <PartyBadge party={party} />
          {!party && <TargetChip target={resolveTarget(party, artistOnly, yearOnly)} />}
        </div>

        <div className="flex-1 flex items-center justify-center w-full">
          <div className="liquid-btn relative" style={{ width: 'min(90vw, 360px)', height: cardHeight }}>
            <LiquidGlass
              style={{ position: 'absolute', top: '50%', left: '50%' }}
              displacementScale={58}
              blurAmount={0.06}
              saturation={130}
              aberrationIntensity={1.5}
              elasticity={0.08}
              cornerRadius={28}
              padding={`${cardPadY} min(24px, 6vw)`}
            >
              <div style={{ width: 'min(298px, 78vw)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: cardGap }}>

                <AudioBars playing={songPlaying} accent={watchAccent} height={barsHeight} bpm={songTempo} />

                <div style={{ width: '100%', height: '1px', background: 'rgba(255,255,255,0.07)' }} />

                <GetReadyBody
                  isDuel={isDuel} isUnderdog={isUnderdog} isRace={isRace} party={party} lowestBid={lowestBid}
                  guesserNames={guesserNames} songPlaying={songPlaying} compact={compact} ultraCompact={ultraCompact}
                />
              </div>
            </LiquidGlass>
          </div>
        </div>

        <div style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', padding: scorePadding, textAlign: 'center' }}>
          <p className={`text-white font-black tabular-nums ${scoreTextClass}`}>{myScore.toLocaleString()}</p>
          <p className="text-white/45 text-xs">your score</p>
          {myStreak >= 2 && (
            <p className="flex items-center justify-center gap-1 text-orange-400 text-xs font-bold mt-1">
              <Flame className="w-3 h-3" />{myStreak} in a row
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function GetReadyBody({ isDuel, isUnderdog, isRace, party, lowestBid, guesserNames, songPlaying, ultraCompact }: Readonly<{
  isDuel: boolean; isUnderdog: boolean; isRace: boolean; party: PartyInfo | null; lowestBid: number; guesserNames: string[]; songPlaying: boolean;
  compact: boolean; ultraCompact: boolean;
}>) {
  const duelWins = party?.duelProgress?.wins;
  const duelScoreLine = duelWins?.length === 2
    ? `${duelWins[0].name} ${duelWins[0].count} – ${duelWins[1].count} ${duelWins[1].name}`
    : null;
  // A landscape phone (the tightest squeeze) leaves the card only ~100px for
  // this whole block — shrink the gap and headline font so a long duel/race
  // name still lands well inside that budget instead of pushing the score
  // card off the bottom of the screen (see WatchingView's cardHeight tiers).
  const bodyGap = ultraCompact ? '6px' : '10px';
  const headlineSize = ultraCompact ? '1.15rem' : '1.65rem';
  const headlineLineHeight = ultraCompact ? 1.2 : 1.3;
  // Race/year sub-rounds keep the existing "everyone races" duel framing —
  // the classic sub-round (game 1) falls through to the normal bid-based
  // display below instead, just with the duel score appended, since bidding
  // still applies there.
  if (isDuel && isRace) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: bodyGap }}>
        <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.65rem', letterSpacing: '0.2em', textTransform: 'uppercase' }}>
          The finale
        </span>
        <span style={{ display: 'inline-block', minWidth: '220px', color: 'white', fontWeight: 900, fontSize: headlineSize, lineHeight: headlineLineHeight, textAlign: 'center' }}>
          {party!.duelists.join(' vs ')}
        </span>
        <span style={{ display: 'inline-block', minWidth: '170px', color: 'rgba(255,255,255,0.45)', fontSize: '0.88rem', textAlign: 'center' }}>
          {duelScoreLine ?? 'First correct wins'}
        </span>
      </div>
    );
  }
  if (isUnderdog) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: bodyGap }}>
        <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.65rem', letterSpacing: '0.2em', textTransform: 'uppercase' }}>
          Underdog Boost
        </span>
        <span style={{ display: 'inline-block', minWidth: '220px', color: 'white', fontWeight: 900, fontSize: headlineSize, lineHeight: headlineLineHeight, textAlign: 'center' }}>
          {party!.restricted.join(' & ')}
        </span>
        <span style={{ display: 'inline-block', minWidth: '170px', color: 'rgba(255,255,255,0.45)', fontSize: '0.88rem', textAlign: 'center' }}>
          Only they can answer
        </span>
      </div>
    );
  }
  if (isRace) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: bodyGap }}>
        <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.65rem', letterSpacing: '0.2em', textTransform: 'uppercase' }}>
          Get ready
        </span>
        <span style={{ display: 'inline-block', minWidth: '220px', color: 'white', fontWeight: 900, fontSize: headlineSize, lineHeight: headlineLineHeight, textAlign: 'center' }}>
          Everyone guesses at once
        </span>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: bodyGap }}>
      <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.65rem', letterSpacing: '0.2em', textTransform: 'uppercase' }}>
        {songPlaying ? 'Listen closely' : 'Get ready'}
      </span>
      <span style={{
        display: 'inline-block', minWidth: '220px', textAlign: 'center',
        fontWeight: 900, fontSize: ultraCompact ? '1.2rem' : '1.75rem', lineHeight: 1.25,
        background: 'linear-gradient(to bottom left, rgba(0,238,232,0.4) 0%, transparent 55%), linear-gradient(to top right, rgba(158,18,204,0.5) 0%, transparent 55%), #fff',
        WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
      }}>
        {guesserNames.join(' & ')}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
        <div style={{ display: 'flex', gap: '3px' }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{
              width: '4px', height: '4px', borderRadius: '50%', background: 'rgba(158,18,204,0.8)',
              animationName: 'dotBounce', animationDuration: '1.4s', animationTimingFunction: 'ease-in-out', animationIterationCount: 'infinite',
              animationDelay: `${i * 0.18}s`,
            }} />
          ))}
        </div>
        <span style={{ display: 'inline-block', color: 'rgba(255,255,255,0.45)', fontSize: '0.88rem', textAlign: 'center' }}>
          guesses after {lowestBid}s
        </span>
      </div>
      {duelScoreLine && (
        <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.78rem', textAlign: 'center' }}>
          {duelScoreLine}
        </span>
      )}
    </div>
  );
}
