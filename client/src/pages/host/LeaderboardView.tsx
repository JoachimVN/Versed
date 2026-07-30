import { socket } from '../../socket';
import { RankBadge } from '../../components/RankBadge';
import { useAnimatedScore } from '../../hooks/useAnimatedScore';
import { PillButton } from '../../components/RevealShared';
import { FinalResultsView } from '../../components/FinalResults';
import type { LeaderboardEntry } from '../../types';
import type { HostState } from './useHostGame';

function LeaderboardRow({ entry, delay, highlight }: Readonly<{ entry: LeaderboardEntry; delay: number; highlight: boolean }>) {
  const { displayScore } = useAnimatedScore(entry.score, 0, delay);
  return (
    <div className={`flex items-center gap-4 px-4 py-3 rounded-xl ${highlight ? 'bg-white/10' : 'bg-white/5'}`}>
      <span className="w-8 flex justify-center">
        <RankBadge rank={entry.rank} />
      </span>
      <span className="text-white font-bold flex-1">{entry.name}</span>
      <p className="text-white/60 font-semibold tabular-nums min-w-[64px] text-right">{displayScore.toLocaleString()}</p>
    </div>
  );
}

export function LeaderboardView({ game }: Readonly<{ game: HostState }>) {
  const { leaderboard, roundIndex, totalRounds } = game;

  return (
    <div className="relative min-h-screen flex flex-col p-6 gap-4">
      <div style={{ background: '#080812', position: 'fixed', inset: 0, zIndex: 0 }} />

      <h2 className="text-3xl font-black text-white text-center relative z-10">Leaderboard</h2>

      <div className="flex-1 min-h-0 overflow-y-auto space-y-3 relative z-10">
        {leaderboard.map((e, i) => (
          <LeaderboardRow
            key={e.name}
            entry={e}
            delay={200 + i * 80}
            highlight={e.rank <= 3}
          />
        ))}
      </div>

      {/* Mid-game leaderboard is the resume point after a host page reload,
          so it needs its own way to continue the game. No "End game" here —
          ending it would just swap to the finished screen, and early-ending
          is already available from every in-round screen. */}
      <div className="relative z-10 flex justify-center pb-2">
        <PillButton
          onClick={() => socket.emit('next_round')}
          label={roundIndex + 1 >= totalRounds ? 'Final Results' : 'Next Round'}
        />
      </div>
    </div>
  );
}

export function FinalResultsWrapper({ game }: Readonly<{ game: HostState }>) {
  const { leaderboard, awards } = game;
  return (
    <FinalResultsView
      leaderboard={leaderboard}
      awards={awards}
      backgroundSrc={`${import.meta.env.BASE_URL}backgrounds/background7.png`}
      footer={<PillButton onClick={game.newGame} label="New Game" />}
      onSkip={() => socket.emit('skip_final_results')}
    />
  );
}

// ─── Component ────────────────────────────────────────────────────────────────
