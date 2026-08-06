import { useState, useEffect } from 'react';
import { Flame } from 'lucide-react';
import LiquidGlass from '../../components/StableLiquidGlass';
import { PartyBadge } from '../../components/RoundIntro';
import { AudioBars, ACCENT_TINT_CLASS, ACCENT_WASH } from '../../components/AudioBars';
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

  // On short viewports the card's fixed height reservation plus the
  // header/gaps/score card easily add up to more than the viewport has (e.g.
  // a landscape phone at 375px tall), pushing the score card off the bottom
  // of the screen with no way to see it before the round starts. The
  // wrapper's declared height only ever sets the box the glass card is
  // centered inside — never the card's own size — so shrinking it costs
  // nothing on tall screens (see RevealView's identical squeeze pattern).
  const { compact, ultraCompact } = useRevealLayout();
  const compactValue = <T,>(ultraValue: T, compactValue: T, regularValue: T): T => {
    if (ultraCompact) return ultraValue;
    if (compact) return compactValue;
    return regularValue;
  };
  const outerGapClass = compactValue('gap-1', 'gap-4', 'gap-6');
  const outerPaddingClass = compactValue('px-4 py-2', 'px-5 py-5', 'px-5 py-8');
  const headerGapClass = ultraCompact ? 'gap-1' : 'gap-2';
  const cardHeight = compactValue('170px', '280px', '400px');
  const cardGap = compactValue('10px', '18px', '28px');
  const cardPadY = compactValue('min(16px, 3vh)', 'min(36px, 5vh)', '68px');
  const scorePadding = compactValue('6px 20px', '10px 26px', '18px 40px');
  const scoreTextClass = compactValue('text-lg', 'text-xl', 'text-4xl');

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
          <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: ultraCompact ? '0.85rem' : '0.95rem', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600 }}>
            Round {roundIndex + 1}<span style={{ color: 'rgba(255,255,255,0.5)' }}>/{totalRounds}</span>
          </p>
          <PartyBadge party={party} />
          {!party && <TargetChip target={resolveTarget(party, artistOnly, yearOnly)} />}
        </div>

        <div className="flex-1 flex items-center justify-center w-full">
          <div
            className={`liquid-btn relative ${ACCENT_TINT_CLASS[watchAccent]}`}
            style={{
              width: 'min(94vw, 480px)', height: cardHeight,
              animationName: songPlaying ? 'cardGlowPulse' : undefined,
              animationDuration: '4.2s', animationTimingFunction: 'ease-in-out', animationIterationCount: 'infinite',
            }}
          >
            <LiquidGlass
              style={{ position: 'absolute', top: '50%', left: '50%' }}
              displacementScale={58}
              blurAmount={0.06}
              saturation={130}
              aberrationIntensity={1.5}
              elasticity={0.08}
              cornerRadius={28}
              padding={`${cardPadY} min(32px, 7vw)`}
            >
              <div style={{ position: 'relative', width: 'min(360px, 82vw)' }}>
                <div aria-hidden="true" style={{
                  position: 'absolute', top: `calc(-1 * ${cardPadY})`, bottom: `calc(-1 * ${cardPadY})`, left: 'max(-32px, -7vw)', right: 'max(-32px, -7vw)',
                  borderRadius: '28px', zIndex: 0, pointerEvents: 'none', background: ACCENT_WASH[watchAccent],
                }} />
                <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: cardGap }}>
                  <GetReadyBody
                    isDuel={isDuel} isUnderdog={isUnderdog} isRace={isRace} party={party} lowestBid={lowestBid}
                    guesserNames={guesserNames} songPlaying={songPlaying} accent={watchAccent} songTempo={songTempo}
                    compact={compact} ultraCompact={ultraCompact}
                  />
                </div>
              </div>
            </LiquidGlass>
          </div>
        </div>

        <div style={{
          background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '18px',
          padding: scorePadding, textAlign: 'center',
        }}>
          <p className={`text-white font-black tabular-nums ${scoreTextClass}`}>{myScore.toLocaleString()}</p>
          <p className="text-white/45 text-xs uppercase" style={{ letterSpacing: '0.1em' }}>your score</p>
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

function ReadyBody({ children, bodyGap }: Readonly<{ children: React.ReactNode; bodyGap: string }>) {
  return <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: bodyGap }}>{children}</div>;
}

// The small "now playing" icon + eyebrow row every branch below leads with —
// demoted to a compact supporting line so the guesser name underneath can be
// the card's one dominant hero instead of competing with an equal-weight
// visualizer block. Landscape/keyboard-squeezed viewports (ultraCompact) keep
// the bars beside the label to spend their scarce height sparingly; anything
// roomier stacks them above it instead, matching the host's own EyebrowRow
// (PlayingView.tsx) now that there's vertical space in the card to spend on it.
function EyebrowRow({ label, accent, songPlaying, songTempo, ultraCompact, compact }: Readonly<{
  label: string; accent: 'classic' | 'race' | 'year'; songPlaying: boolean; songTempo?: number | null; ultraCompact: boolean; compact: boolean;
}>) {
  return (
    <div style={{ display: 'flex', flexDirection: ultraCompact ? 'row' : 'column', alignItems: 'center', gap: ultraCompact ? '8px' : '6px' }}>
      <AudioBars playing={songPlaying} accent={accent} height={ultraCompact ? 14 : compact ? 16 : 18} bpm={songTempo} />
      <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: ultraCompact ? '0.6rem' : '0.7rem', letterSpacing: '0.2em', textTransform: 'uppercase', fontWeight: 700 }}>
        {label}
      </span>
    </div>
  );
}

function GetReadyBody({ isDuel, isUnderdog, isRace, party, lowestBid, guesserNames, songPlaying, accent, songTempo, compact, ultraCompact }: Readonly<{
  isDuel: boolean; isUnderdog: boolean; isRace: boolean; party: PartyInfo | null; lowestBid: number; guesserNames: string[]; songPlaying: boolean;
  accent: 'classic' | 'race' | 'year'; songTempo?: number | null; compact: boolean; ultraCompact: boolean;
}>) {
  const duelWins = party?.duelProgress?.wins;
  const duelScoreLine = duelWins?.length === 2
    ? `${duelWins[0].name} ${duelWins[0].count} – ${duelWins[1].count} ${duelWins[1].name}`
    : null;
  // A landscape phone (the tightest squeeze) leaves the card only ~100px for
  // this whole block — shrink the gap and headline font so a long duel/race
  // name still lands well inside that budget instead of pushing the score
  // card off the bottom of the screen (see WatchingView's cardHeight tiers).
  const bodyGap = ultraCompact ? '8px' : '14px';
  const headlineSize = ultraCompact ? '1.3rem' : compact ? '2.4rem' : '3.1rem';
  const headlineLineHeight = ultraCompact ? 1.15 : 1.05;
  // Race/year sub-rounds keep the existing "everyone races" duel framing —
  // the classic sub-round (game 1) falls through to the normal bid-based
  // display below instead, just with the duel score appended, since bidding
  // still applies there.
  if (isDuel && isRace) {
    return (
      <ReadyBody bodyGap={bodyGap}>
        <EyebrowRow label="The finale" accent={accent} songPlaying={songPlaying} songTempo={songTempo} ultraCompact={ultraCompact} compact={compact} />
        <span style={{ display: 'inline-block', minWidth: '220px', color: 'white', fontWeight: 900, fontSize: headlineSize, lineHeight: headlineLineHeight, textAlign: 'center' }}>
          {party!.duelists.join(' vs ')}
        </span>
        <span style={{ display: 'inline-block', minWidth: '170px', color: 'rgba(255,255,255,0.45)', fontSize: '0.88rem', textAlign: 'center' }}>
          {duelScoreLine ?? 'First correct wins'}
        </span>
      </ReadyBody>
    );
  }
  if (isUnderdog) {
    return (
      <ReadyBody bodyGap={bodyGap}>
        <EyebrowRow label="Underdog boost" accent={accent} songPlaying={songPlaying} songTempo={songTempo} ultraCompact={ultraCompact} compact={compact} />
        <span style={{ display: 'inline-block', minWidth: '220px', color: 'white', fontWeight: 900, fontSize: headlineSize, lineHeight: headlineLineHeight, textAlign: 'center' }}>
          {party!.restricted.join(' & ')}
        </span>
        <span style={{ display: 'inline-block', minWidth: '170px', color: 'rgba(255,255,255,0.45)', fontSize: '0.88rem', textAlign: 'center' }}>
          Only they can answer
        </span>
      </ReadyBody>
    );
  }
  if (isRace) {
    return (
      <ReadyBody bodyGap={bodyGap}>
        <EyebrowRow label="Get ready" accent={accent} songPlaying={songPlaying} songTempo={songTempo} ultraCompact={ultraCompact} compact={compact} />
        <span style={{ display: 'inline-block', minWidth: '220px', color: 'white', fontWeight: 900, fontSize: headlineSize, lineHeight: headlineLineHeight, textAlign: 'center' }}>
          Everyone guesses at once
        </span>
      </ReadyBody>
    );
  }
  const nameMinWidth = ultraCompact ? '180px' : compact ? '260px' : '320px';
  return (
    <ReadyBody bodyGap={bodyGap}>
      <EyebrowRow label={songPlaying ? 'Listen closely' : 'Get ready'} accent={accent} songPlaying={songPlaying} songTempo={songTempo} ultraCompact={ultraCompact} compact={compact} />
      <span style={{
        display: 'inline-block', minWidth: nameMinWidth, textAlign: 'center',
        fontWeight: 900, fontSize: headlineSize, lineHeight: 1,
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
        <span style={{ display: 'inline-block', color: 'rgba(255,255,255,0.5)', fontSize: ultraCompact ? '0.78rem' : '0.95rem', textAlign: 'center' }}>
          guesses after {lowestBid}s
        </span>
      </div>
      {duelScoreLine && (
        <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.78rem', textAlign: 'center' }}>
          {duelScoreLine}
        </span>
      )}
    </ReadyBody>
  );
}
