import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router';
import { Disc3 } from 'lucide-react';
import { RoundIntro } from '../components/RoundIntro';
import { commonPhaseAnnouncement } from '../utils/phaseAnnouncement';
import { useWakeLock } from '../hooks/useWakeLock';
import type { RoundResultEvent } from '../types';

import { usePlayGame } from './play/usePlayGame';
import type { Phase } from './play/usePlayGame';
import { JoinView } from './play/JoinView';
import { WaitingAtmosphere } from './play/WaitingAtmosphere';
import { WaitingView } from './play/WaitingView';
import { BettingView, BidSubmittedView } from './play/BettingView';
import { WatchingView } from './play/WatchingView';
import { GuessingView, PassedView, StealPicker } from './play/GuessingView';
import { RevealView, YearRevealView } from './play/RevealView';
import { LeaderboardView, FinalResultsWrapper } from './play/LeaderboardView';

export type { PlayState } from './play/usePlayGame';

// Screen-reader narration of major phase changes — see the matching function
// in Host.tsx for why this exists.
function phaseAnnouncement(phase: Phase, result: RoundResultEvent | null): string {
  const common = commonPhaseAnnouncement(phase, result);
  if (common !== null) return common;
  switch (phase) {
    case 'waiting': return 'Waiting for the host to start.';
    case 'betting': return 'Place your bid.';
    case 'bid_submitted': return 'Bid submitted. Waiting for others.';
    case 'watching': return 'Get ready. Listen closely.';
    case 'guessing': return 'Your turn to guess.';
    case 'passed': return 'Answer submitted.';
    default: return '';
  }
}

export default function Play() {
  const { pin: pinParam } = useParams<{ pin?: string }>();
  const game = usePlayGame(pinParam);
  const { phase, result, reconnecting, hostReconnecting, guesserNames, myName } = game;
  const imGuessing = guesserNames.includes(myName);
  const isJoin = phase === 'join';
  const showsGuessInput = phase === 'guessing' || (phase === 'watching' && imGuessing);
  const showWaitingBackground = phase === 'waiting' || game.waitingTransitionPending;
  useWakeLock(!isJoin);
  const [waitingBackgroundLeaving, setWaitingBackgroundLeaving] = useState(false);
  const leaveWaitingBackground = useCallback(() => setWaitingBackgroundLeaving(true), []);

  // Fade the glow in after mount, out when leaving join phase.
  const [glowMounted, setGlowMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setGlowMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div
      className="relative"
      style={isJoin ? undefined : {
        ...(phase === 'waiting' ? {} : { background: '#080812' }),
        height: 'var(--app-height, 100vh)',
        minHeight: 'var(--app-height, 100vh)',
        ...(showsGuessInput ? { transition: 'height 0.25s ease, min-height 0.25s ease' } : {}),
      }}
    >
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse 80% 55% at 50% 115%, rgba(134,6,189,0.26) 0%, rgba(60,44,102,0.10) 45%, transparent 65%)',
          opacity: glowMounted && isJoin && !game.waitingTransitionPending ? 1 : 0,
          transition: 'opacity 0.45s ease',
          zIndex: 0,
        }}
      />
      {showWaitingBackground && <WaitingAtmosphere leaving={waitingBackgroundLeaving} />}
      <div aria-live="polite" className="sr-only">{phaseAnnouncement(phase, result)}</div>
      {phase === 'join' && <JoinView game={game} />}
      {phase === 'waiting' && (
        <WaitingView game={game} leaveBackground={leaveWaitingBackground} />
      )}
      {phase === 'betting' && <BettingView game={game} />}
      {phase === 'bid_submitted' && <BidSubmittedView game={game} />}
      {phase === 'watching' && !imGuessing && <WatchingView game={game} />}
      {(phase === 'guessing' || (phase === 'watching' && imGuessing)) && <GuessingView game={game} />}
      {phase === 'passed' && <PassedView game={game} />}
      {phase === 'reveal' && result && (
        result.party?.format === 'year' || result.yearOnly
          ? <YearRevealView game={game} result={result} />
          : <RevealView game={game} result={result} />
      )}
      {phase === 'leaderboard' && <LeaderboardView game={game} />}
      {phase === 'finished' && <FinalResultsWrapper game={game} />}

      <RoundIntro party={game.party} roundKey={game.roundIndex} dismissible={false} />
      {game.stealVictims && <StealPicker victims={game.stealVictims} onPick={game.submitStealVictim} onSkip={game.skipSteal} />}

      {reconnecting && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex flex-col items-center justify-center z-50 gap-3">
          <Disc3 className="w-10 h-10 text-white/70 animate-spin" strokeWidth={1.5} />
          <p className="text-white/70 text-sm font-medium">Reconnecting...</p>
        </div>
      )}
      {hostReconnecting && !reconnecting && (
        <div className="fixed bottom-5 right-5 flex items-center gap-2 bg-white/8 backdrop-blur-sm rounded-full px-3 py-1.5 z-40">
          <span className="w-1.5 h-1.5 rounded-full bg-white/50 animate-pulse" />
          <p className="text-white/50 text-xs">Host reconnecting</p>
        </div>
      )}
    </div>
  );
}
