import { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock } from 'lucide-react';
import LiquidGlass from '../components/StableLiquidGlass';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { RoundIntro } from '../components/RoundIntro';
import { LIQUID_CARD_PROPS } from '../components/liquidGlassPresets';
import { commonPhaseAnnouncement } from '../utils/phaseAnnouncement';
import type { RoundResultEvent } from '../types';

import { useHostGame } from './host/useHostGame';
import type { Phase } from './host/useHostGame';
import { ConnectView } from './host/ConnectView';
import { LobbyView } from './host/LobbyView';
import { BettingView } from './host/BettingView';
import { PlayingView, GuessingView } from './host/PlayingView';
import { RevealView } from './host/RevealView';
import { LeaderboardView, FinalResultsWrapper } from './host/LeaderboardView';
import { FullScreenDialog } from './host/dialogs';

export type { HostState } from './host/useHostGame';

// Screen-reader narration of major phase changes — the screen itself swaps
// components wholesale on each transition, which gives sighted players a
// visual cue but nothing a screen reader announces on its own.
function phaseAnnouncement(phase: Phase, result: RoundResultEvent | null): string {
  const common = commonPhaseAnnouncement(phase, result);
  if (common !== null) return common;
  switch (phase) {
    case 'lobby': return 'Lobby ready. Players can join.';
    case 'betting': return 'Betting is open.';
    case 'playing': return 'Song is playing.';
    case 'guessing': return 'Guessing has started.';
    default: return '';
  }
}

export default function Host() {
  const game = useHostGame();
  const navigate = useNavigate();
  const { phase, result, reconnecting, reconnectingCount, gameExpired } = game;
  const gameExpiredRef = useRef<HTMLDialogElement>(null);
  const lobbyFadeOutRef = useRef<(() => Promise<void>) | null>(null);
  // Awaited so the fade actually finishes before navigate() unmounts the
  // lobby (and its AudioContext) out from under it.
  const goHome = async () => { await lobbyFadeOutRef.current?.(); navigate('/'); };
  useEscapeKey(goHome, gameExpired);
  useFocusTrap(gameExpiredRef, gameExpired);

  return (
    <div className="relative">
      <div aria-live="polite" className="sr-only">{phaseAnnouncement(phase, result)}</div>
      <RoundIntro party={game.party} roundKey={game.roundIndex} />
      {phase === 'connect' && <ConnectView game={game} />}
      {phase === 'lobby' && <LobbyView game={game} fadeOutRef={lobbyFadeOutRef} />}
      {phase === 'betting' && <BettingView game={game} />}
      {phase === 'playing' && <PlayingView game={game} />}
      {phase === 'guessing' && <GuessingView game={game} />}
      {phase === 'reveal' && result && <RevealView game={game} result={result} />}
      {phase === 'leaderboard' && <LeaderboardView game={game} />}
      {phase === 'finished' && <FinalResultsWrapper game={game} />}

      {reconnecting && !gameExpired && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex flex-col items-center justify-center z-50 gap-3">
          <div className="w-10 h-10 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          <p className="text-white/70 text-sm font-medium">Reconnecting...</p>
          <p className="text-white/45 text-xs">Game is still running</p>
        </div>
      )}
      {gameExpired && (
        <FullScreenDialog ariaLabel="Game expired" dialogRef={gameExpiredRef}>
          <div className="liquid-btn relative" style={{ width: '310px', height: '230px' }}>
            <LiquidGlass
              style={{ position: 'absolute', top: '50%', left: '50%' }}
              {...LIQUID_CARD_PROPS}
              padding="32px 28px"
            >
              <div style={{ width: '254px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                <Clock style={{ width: '30px', height: '30px', color: 'rgba(255,255,255,0.45)' }} strokeWidth={1.5} />
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                  <p style={{ color: 'white', fontWeight: 800, fontSize: '1.2rem', letterSpacing: '-0.01em' }}>Game expired</p>
                  <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.8rem', textAlign: 'center', lineHeight: 1.5 }}>You were away too long and the game was closed.</p>
                </div>
                <button
                  onClick={goHome}
                  style={{ marginTop: '6px', width: '100%', padding: '10px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.12)', cursor: 'pointer', background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.72)', fontWeight: 600, fontSize: '0.875rem', transition: 'background 0.2s ease, border-color 0.2s ease, color 0.2s ease' }}
                  onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = 'rgba(255,255,255,0.13)'; el.style.borderColor = 'rgba(255,255,255,0.22)'; el.style.color = 'white'; }}
                  onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = 'rgba(255,255,255,0.07)'; el.style.borderColor = 'rgba(255,255,255,0.12)'; el.style.color = 'rgba(255,255,255,0.72)'; }}
                >
                  Go home
                </button>
              </div>
            </LiquidGlass>
          </div>
        </FullScreenDialog>
      )}
      {reconnectingCount > 0 && !reconnecting && (
        <div className="fixed bottom-5 right-5 flex items-center gap-2 bg-white/8 backdrop-blur-sm rounded-full px-3 py-1.5 z-40">
          <span className="w-1.5 h-1.5 rounded-full bg-white/50 animate-pulse" />
          <p className="text-white/50 text-xs">
            {reconnectingCount} player{reconnectingCount > 1 ? 's' : ''} reconnecting
          </p>
        </div>
      )}
    </div>
  );
}
