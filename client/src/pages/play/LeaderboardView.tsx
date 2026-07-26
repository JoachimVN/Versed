import { useNavigate } from 'react-router';
import LiquidGlass from '../../components/StableLiquidGlass';
import { RankBadge } from '../../components/RankBadge';
import { useAnimatedScore } from '../../hooks/useAnimatedScore';
import { FinalResultsView } from '../../components/FinalResults';
import { LIQUID_PILL_PROPS } from '../../components/liquidGlassPresets';
import type { LeaderboardEntry } from '../../types';
import type { PlayState } from './usePlayGame';

function PlayerLeaderboardRow({ entry, delay, isMe }: Readonly<{ entry: LeaderboardEntry; delay: number; isMe: boolean }>) {
  const { displayScore } = useAnimatedScore(entry.score, 0, delay);
  return (
    <div className={`flex items-center gap-4 px-4 py-3 rounded-xl ${isMe ? 'bg-white/10' : 'bg-white/5'}`}>
      <span className="w-8 flex justify-center">
        <RankBadge rank={entry.rank} />
      </span>
      <span className="text-white font-bold flex-1">{entry.name}</span>
      <p className="text-white/60 font-semibold tabular-nums min-w-[56px] text-right">{displayScore.toLocaleString()}</p>
    </div>
  );
}

function MyScoreCard({ entry, delay }: Readonly<{ entry: LeaderboardEntry; delay: number }>) {
  const { displayScore } = useAnimatedScore(entry.score, 0, delay);
  return (
    <div className="liquid-btn relative mx-auto" style={{ width: '240px', height: '92px' }}>
      <LiquidGlass
        style={{ position: 'absolute', top: '50%', left: '50%' }}
        displacementScale={50}
        blurAmount={0.06}
        saturation={130}
        aberrationIntensity={1.5}
        elasticity={0.08}
        cornerRadius={18}
        padding="16px 24px"
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, width: '192px' }}>
          <span style={{ display: 'inline-block', color: 'rgba(255,255,255,0.6)', fontSize: '0.875rem' }}>You're #{entry.rank}</span>
          <span className="tabular-nums" style={{ display: 'inline-block', color: 'white', fontWeight: 900, fontSize: '1.5rem' }}>
            {displayScore.toLocaleString()} pts
          </span>
        </div>
      </LiquidGlass>
    </div>
  );
}

export function LeaderboardView({ game }: Readonly<{ game: PlayState }>) {
  const { myName, leaderboard } = game;
  const myEntry = leaderboard.find(e => e.name === myName);

  return (
    <div className="relative min-h-screen flex flex-col p-6 gap-4">
      <h2 className="text-3xl font-black text-white text-center relative z-10">Leaderboard</h2>

      {myEntry && (
        <div className="relative z-10">
          <MyScoreCard
            entry={myEntry}
            delay={0}
          />
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto space-y-3 relative z-10">
        {leaderboard.slice(0, 10).map((e, i) => (
          <PlayerLeaderboardRow
            key={e.name}
            entry={e}
            delay={100 + i * 80}
            isMe={e.name === myName}
          />
        ))}
      </div>

      <p className="text-center text-white/45 text-sm relative z-10">Waiting for the host to start the next round…</p>
    </div>
  );
}

function FinalResultsFooter({ game }: Readonly<{ game: PlayState }>) {
  const { newGamePin, rejoinNewGame } = game;
  const navigate = useNavigate();
  return (
    <>
      {newGamePin && (
        <>
          <div
            className="flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-center"
            style={{
              background: 'linear-gradient(90deg, rgba(0,166,163,0.16) 0%, rgba(158,18,204,0.16) 100%)',
              border: '1px solid rgba(0,235,219,0.35)',
              boxShadow: '0 0 24px rgba(0,166,163,0.12)',
            }}
          >
            <p className="text-sm font-semibold" style={{ color: '#5eead4' }}>Host started a new game!</p>
          </div>
          <button
            type="button"
            className="liquid-btn glass-tint-teal relative cursor-pointer border-0 bg-transparent p-0"
            style={{ width: '310px', height: '64px', borderRadius: '100px', background: 'rgba(0,0,0,0.001)' }}
            onClick={rejoinNewGame}
          >
            <LiquidGlass
              style={{ position: 'absolute', top: '50%', left: '50%' }}
              {...LIQUID_PILL_PROPS}
            >
              <div style={{ position: 'relative' }}>
                <div style={{ position: 'absolute', inset: '-18px -36px', borderRadius: '100px', pointerEvents: 'none', background: 'rgba(0,166,163,0.18)' }} />
                <span className="text-white font-bold text-xl" style={{ whiteSpace: 'nowrap', position: 'relative', display: 'inline-block', minWidth: '210px', textAlign: 'center' }}>
                  Play Again
                </span>
              </div>
            </LiquidGlass>
          </button>
        </>
      )}

      <button
        type="button"
        className="liquid-btn relative cursor-pointer border-0 bg-transparent p-0"
        style={{ width: '310px', height: '64px', borderRadius: '100px', background: 'rgba(0,0,0,0.001)' }}
        onClick={() => navigate('/')}
      >
        <LiquidGlass
          style={{ position: 'absolute', top: '50%', left: '50%' }}
          {...LIQUID_PILL_PROPS}
        >
          <span className="text-white font-bold text-xl" style={{ whiteSpace: 'nowrap', position: 'relative', display: 'inline-block', minWidth: '210px', textAlign: 'center' }}>
            Leave
          </span>
        </LiquidGlass>
      </button>
    </>
  );
}

export function FinalResultsWrapper({ game }: Readonly<{ game: PlayState }>) {
  const { leaderboard, awards, myName } = game;
  return (
    <FinalResultsView
      leaderboard={leaderboard}
      awards={awards}
      myName={myName}
      backgroundSrc={`${import.meta.env.BASE_URL}background5.svg`}
      footer={<FinalResultsFooter game={game} />}
    />
  );
}
