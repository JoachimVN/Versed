import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useAnimatedScore } from '../hooks/useAnimatedScore';
import { AwardsStrip, AWARD_LABELS } from './RevealShared';
import LiquidGlass from './StableLiquidGlass';
import { LIQUID_CARD_PROPS } from './liquidGlassPresets';
import { CONFETTI_COLORS, GOLD_CONFETTI_COLORS } from './ConfettiBackground';
import {
  BackgroundLayer, HOLD_CHAMPION, HUE_BRONZE, HUE_SETTLED, ResultRow, SETTLE_DURATION_MS, STANDINGS_ROW_H,
  estimateAwardsHeight, estimatePanelHeight, findAward, getCeremonyDuration,
} from './FinalResults';
import type { Award, LeaderboardEntry } from '../types';

type Phase = 'hold' | 'settled';

function PersonalHero({ entry, awards, reducedMotion }: Readonly<{ entry: LeaderboardEntry; awards: Award[]; reducedMotion: boolean }>) {
  const award = findAward(entry.name, awards);
  const { displayScore } = useAnimatedScore(entry.score, entry.score, 0, reducedMotion);

  return (
    <div
      className="personal-hero-card flex flex-wrap items-center rounded-2xl"
      style={{ border: '1px solid rgba(94,234,212,0.32)', background: 'linear-gradient(135deg, rgba(94,234,212,0.14), rgba(158,18,204,0.10))', width: '100%', maxWidth: '520px', margin: '0 auto' }}
    >
      <span className="font-black" style={{ fontFamily: "'Montserrat', sans-serif", fontSize: 'clamp(1.15rem, calc(5.87vh + 1.97px), 1.7rem)', color: '#5eead4', flexShrink: 0 }}>
        #{entry.rank}
      </span>
      <div className="flex flex-col gap-0.5 flex-1 min-w-0">
        <span className="font-bold">
          {entry.name}
          <span style={{ color: '#5eead4', fontSize: '0.6rem', letterSpacing: '0.1em', marginLeft: '7px', fontWeight: 800 }}>YOU</span>
        </span>
        <span className="tabular-nums font-black" style={{ fontSize: 'clamp(0.85rem, calc(2.13vh + 7.63px), 1.05rem)', color: 'rgba(255,255,255,0.85)' }}>
          {displayScore.toLocaleString()}
          <small style={{ fontSize: '0.6em', fontWeight: 700, color: 'rgba(255,255,255,0.4)', marginLeft: '3px' }}>PTS</small>
        </span>
      </div>
      {award && (
        <div className="personal-hero-award-row flex items-center gap-2 w-full" style={{ marginTop: '2px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
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
export function FinalResultsPlayerView({ leaderboard, awards, myName, backgroundSrc, footer, skipped, finishedAt }: Readonly<{
  leaderboard: LeaderboardEntry[];
  awards: Award[];
  myName: string;
  backgroundSrc: string;
  footer: ReactNode;
  skipped?: boolean;
  finishedAt?: number | null;
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
    if (reducedMotion || leaderboardSignature === '') { setPhase('settled'); lastSignatureRef.current = leaderboardSignature; return; }
    if (lastSignatureRef.current === leaderboardSignature) return;
    lastSignatureRef.current = leaderboardSignature;
    setPhase('hold');
    const podiumCount = Math.min(3, leaderboardSignature.split('|').length);
    // This screen's own text tells the player to look away at the host's
    // board, so the tab backgrounding mid-countdown is the normal case here,
    // not an edge case -- and a backgrounded tab throttles or fully freezes
    // setTimeout. A plain setTimeout can therefore land arbitrarily late (or
    // never) while hidden. Tracking a real deadline and re-checking it on
    // every visibility change means coming back to the tab always settles
    // immediately once the deadline has actually passed, regardless of
    // whether the tab was hidden at the start, hidden partway through, or
    // never hidden at all.
    //
    // Anchored to the server's finishedAt rather than Date.now(): a player
    // who reconnects (socket drop, backgrounded app, page refresh) well
    // after the host's ceremony already finished gets game_over resent with
    // the *original* finishedAt (see sync.ts), so the deadline computed here
    // lands in the past and settleIfDue below resolves it immediately.
    // Using Date.now() here always started a brand-new full-length wait,
    // leaving a late-reconnecting player stuck on "Look up at the board"
    // long after the host's board had already moved on.
    const deadline = (finishedAt ?? Date.now()) + getCeremonyDuration(podiumCount);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settleIfDue = () => { if (Date.now() >= deadline) setPhase('settled'); };
    const armTimer = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(settleIfDue, Math.max(0, deadline - Date.now()));
    };
    const onVisible = () => {
      if (document.hidden) return;
      settleIfDue();
      armTimer();
    };
    armTimer();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // Keying off the content signature (not the `leaderboard` array reference) is
    // deliberate: a reconnect resync resends an equal-content but new-reference
    // array, which would otherwise cancel this timer without rescheduling it,
    // leaving the player stuck on "Look up at the board" forever.
  }, [leaderboardSignature, reducedMotion, finishedAt]);

  // Host held down the hold-to-skip control on their own cinematic — jump
  // straight to settled instead of sitting out the rest of the fixed-length
  // timer above with nothing left on the board to look up at.
  useEffect(() => {
    if (skipped) setPhase('settled');
  }, [skipped]);

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
  // gapPx matches the 18px flex gap on the content wrapper below, and the
  // divider gets its own 1px section so its two surrounding gaps aren't
  // dropped -- both real DOM sections, not decoration.
  const panelHeight = estimatePanelHeight([
    leaderboard.length * STANDINGS_ROW_H,
    awards.length > 0 ? 1 : 0,
    estimateAwardsHeight(awards),
  ], 18);

  return (
    <div className="final-results-player-shell relative h-[100lvh] flex flex-col p-6 gap-4">
      <BackgroundLayer
        backgroundSrc={backgroundSrc}
        showConfetti={!reducedMotion && settled}
        confettiEntrance={settled}
        confettiColors={confettiCalm ? CONFETTI_COLORS : GOLD_CONFETTI_COLORS}
        confettiSpeedMultiplier={confettiCalm ? 1 : 3}
        hueDeg={settled ? HUE_SETTLED : HUE_BRONZE}
        overlayAlpha={0.9}
      />

      {!settled && (
        <div className="relative z-10 flex-1 flex flex-col items-center justify-center gap-3 text-center page-enter">
          <span style={{ color: '#5eead4', fontWeight: 800, fontSize: '0.78rem', letterSpacing: '0.32em', textTransform: 'uppercase' }}>
            Final Results
          </span>
          <h1 className="font-black uppercase" style={{ fontFamily: "'Montserrat', sans-serif", fontSize: '1.6rem' }}>
            Look up at the board
          </h1>
        </div>
      )}

      {settled && (
        <div className="relative z-10 flex flex-col flex-1 min-h-0 gap-1 page-enter-fade">
          {myEntry && <PersonalHero entry={myEntry} awards={awards} reducedMotion={reducedMotion} />}
          {/* justifyContent centers the card horizontally (it's narrower than
              this row past 520px); alignItems pins it to the top instead of
              the vertical centering margin:auto used to do, which split the
              flex-1 area's leftover height evenly above and below the card --
              visibly padding out the gap right under the hero card on short
              leaderboards. Anchoring to the top puts all of that slack below
              the card instead, where it already had room to spare. */}
          <div className="flex-1 min-h-0 overflow-y-auto flex" style={{ justifyContent: 'center', alignItems: 'flex-start' }}>
            <div className="liquid-btn glass-tint-blue relative" style={{ width: '100%', maxWidth: '520px', height: `${panelHeight}px` }}>
              <LiquidGlass
                style={{ position: 'absolute', top: '50%', left: '50%' }}
                {...LIQUID_CARD_PROPS}
                elasticity={0}
                cornerRadius={26}
                padding="24px 22px 18px"
              >
                {/* liquid-glass-react's .glass is inline-flex and shrink-wraps to
                    exactly this width, so it has to be expressed in the same
                    units as the real available space -- not vw alone, which
                    ignores both this page's own p-6 (48px) and the card's own
                    24/22/18 padding (44px), and previously let the glass render
                    wider than its own placement box on any phone-width screen
                    (silently clipped by the scroll container, most visibly
                    eating the "you" row's left accent bar). */}
                <div style={{ width: 'min(calc(100vw - 92px), 476px)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '18px' }}>
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
          <div className="flex flex-col items-center gap-3 mt-3">{footer}</div>
        </div>
      )}
    </div>
  );
}
