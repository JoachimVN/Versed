import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useAnimatedScore } from '../hooks/useAnimatedScore';
import { AwardsStrip, AWARD_LABELS } from './RevealShared';
import LiquidGlass from './StableLiquidGlass';
import { LIQUID_CARD_PROPS } from './liquidGlassPresets';
import { CONFETTI_COLORS, GOLD_CONFETTI_COLORS } from './ConfettiBackground';
import {
  AWARD_ROW_H, BackgroundLayer, HOLD_CHAMPION, HUE_BRONZE, HUE_SETTLED, ResultRow, SETTLE_DURATION_MS, STANDINGS_ROW_H,
  estimatePanelHeight, findAward, getCeremonyDuration,
} from './FinalResults';
import type { Award, LeaderboardEntry } from '../types';

type Phase = 'hold' | 'settled';

function PersonalHero({ entry, awards, reducedMotion }: Readonly<{ entry: LeaderboardEntry; awards: Award[]; reducedMotion: boolean }>) {
  const award = findAward(entry.name, awards);
  const { displayScore } = useAnimatedScore(entry.score, entry.score, 0, reducedMotion);

  return (
    <div
      className="flex flex-wrap items-center gap-4 p-4 rounded-2xl"
      style={{ border: '1px solid rgba(94,234,212,0.32)', background: 'linear-gradient(135deg, rgba(94,234,212,0.14), rgba(158,18,204,0.10))' }}
    >
      <span className="font-black" style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '1.7rem', color: '#5eead4', flexShrink: 0 }}>
        #{entry.rank}
      </span>
      <div className="flex flex-col gap-0.5 flex-1 min-w-0">
        <span className="font-bold">
          {entry.name}
          <span style={{ color: '#5eead4', fontSize: '0.6rem', letterSpacing: '0.1em', marginLeft: '7px', fontWeight: 800 }}>YOU</span>
        </span>
        <span className="tabular-nums font-black" style={{ fontSize: '1.05rem', color: 'rgba(255,255,255,0.85)' }}>
          {displayScore.toLocaleString()}
          <small style={{ fontSize: '0.6em', fontWeight: 700, color: 'rgba(255,255,255,0.4)', marginLeft: '3px' }}>PTS</small>
        </span>
      </div>
      {award && (
        <div className="flex items-center gap-2 w-full" style={{ marginTop: '2px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#c9899a', flexShrink: 0 }} />
          <span className="text-sm" style={{ color: 'rgba(255,255,255,0.7)', fontWeight: 700 }}>
            {AWARD_LABELS[award.key]} · {award.detail}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Player's final-results screen: while the host runs its cinematic reveal on
 * the shared board, phones show a calm holding message rather than a second,
 * independently-timed copy of the same ceremony (two unsynced clients
 * running a multi-second scripted sequence would visibly drift against each
 * other). Once the host would have settled, this cuts straight to a personal
 * result card -- rank, score, and this player's own award if they earned one
 * -- followed by the full standings and every award, same as before.
 */
export function FinalResultsPlayerView({ leaderboard, awards, myName, backgroundSrc, footer }: Readonly<{
  leaderboard: LeaderboardEntry[];
  awards: Award[];
  myName: string;
  backgroundSrc: string;
  footer: ReactNode;
}>) {
  const [reducedMotion] = useState(() => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  const [phase, setPhase] = useState<Phase>(reducedMotion || leaderboard.length === 0 ? 'settled' : 'hold');

  // A reconnect (phone locked/backgrounded mid-ceremony, socket drops, then
  // rejoins) makes the server resend this same game_over payload to resync
  // state -- which handed us a brand-new leaderboard array every time and
  // re-triggered the effect below, bouncing an already-settled player back
  // to "look up at the board" for a full replay. Comparing a content
  // signature instead of the array reference tells a genuine resync (same
  // scores) apart from an actual new game (different scores, or a fresh
  // mount with no prior signature at all).
  const leaderboardSignature = useMemo(
    () => leaderboard.map(e => `${e.name}:${e.score}`).join('|'),
    [leaderboard],
  );
  const lastSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    if (reducedMotion || leaderboard.length === 0) { setPhase('settled'); lastSignatureRef.current = leaderboardSignature; return; }
    if (lastSignatureRef.current === leaderboardSignature) return;
    lastSignatureRef.current = leaderboardSignature;
    setPhase('hold');
    const podiumCount = Math.min(3, leaderboard.length);
    const timer = setTimeout(() => setPhase('settled'), getCeremonyDuration(podiumCount));
    return () => clearTimeout(timer);
  }, [leaderboard, leaderboardSignature, reducedMotion]);

  // Echoes the host's confetti arc on landing: a fast gold burst that holds,
  // then eases into the calm cyan/purple confetti the recap settles on. The
  // host staggers its speed and color handoff across two separate stage
  // transitions ('gold' -> 'sweepToSettled' -> 'settled'); here there's only
  // one landing moment, so both change together on one timer instead of
  // visibly drifting apart.
  const [confettiCalm, setConfettiCalm] = useState(false);

  useEffect(() => {
    if (phase !== 'settled') { setConfettiCalm(false); return; }
    setConfettiCalm(false);
    const timer = setTimeout(() => setConfettiCalm(true), HOLD_CHAMPION + SETTLE_DURATION_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  if (leaderboard.length === 0) {
    return (
      <div className="relative min-h-screen flex flex-col items-center justify-center p-6 gap-6">
        <BackgroundLayer backgroundSrc={backgroundSrc} showConfetti={false} />
        <p className="text-white/60 text-lg relative z-10">No scores yet.</p>
        <div className="relative z-10">{footer}</div>
      </div>
    );
  }

  const settled = phase === 'settled';
  const myEntry = leaderboard.find(e => e.name === myName);
  const panelHeight = estimatePanelHeight([
    leaderboard.length * STANDINGS_ROW_H,
    awards.length > 0 ? awards.length * AWARD_ROW_H : 0,
  ]);

  return (
    <div className="relative min-h-screen flex flex-col p-6 gap-4">
      <BackgroundLayer
        backgroundSrc={backgroundSrc}
        showConfetti={!reducedMotion && settled}
        confettiEntrance={settled}
        confettiColors={confettiCalm ? CONFETTI_COLORS : GOLD_CONFETTI_COLORS}
        confettiSpeedMultiplier={confettiCalm ? 1 : 3}
        hueDeg={settled ? HUE_SETTLED : HUE_BRONZE}
      />

      {!settled && (
        <div className="relative z-10 flex-1 flex flex-col items-center justify-center gap-3 text-center page-enter">
          <span style={{ color: '#5eead4', fontWeight: 800, fontSize: '0.78rem', letterSpacing: '0.32em', textTransform: 'uppercase' }}>
            Final Results
          </span>
          <h1 className="font-black uppercase" style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '1.6rem' }}>
            Look up at the board
          </h1>
          <p className="text-white/60 font-semibold">Your result is coming up</p>
        </div>
      )}

      {settled && (
        <div className="relative z-10 flex flex-col flex-1 min-h-0 gap-4 page-enter-fade">
          {myEntry && <PersonalHero entry={myEntry} awards={awards} reducedMotion={reducedMotion} />}
          <div className="flex-1 min-h-0 overflow-y-auto flex">
            <div className="liquid-btn glass-tint-blue relative" style={{ width: 'min(94vw, 520px)', height: `${panelHeight}px`, margin: 'auto' }}>
              <LiquidGlass
                style={{ position: 'absolute', top: '50%', left: '50%' }}
                {...LIQUID_CARD_PROPS}
                elasticity={0}
                cornerRadius={26}
                padding="24px 22px 18px"
              >
                <div style={{ width: 'min(88vw, 472px)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '18px' }}>
                  <div className="standings-list" style={{ width: '100%' }}>
                    {leaderboard.map((e, i) => <ResultRow key={e.name} entry={e} isMe={e.name === myName} delay={i * 60} />)}
                  </div>
                  {awards.length > 0 && (
                    <>
                      <div className="panel-divider" />
                      <AwardsStrip awards={awards} />
                    </>
                  )}
                </div>
              </LiquidGlass>
            </div>
          </div>
          <div className="flex flex-col items-center gap-3">{footer}</div>
        </div>
      )}
    </div>
  );
}
