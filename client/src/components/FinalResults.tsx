import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { RankBadge } from './RankBadge';
import { useAnimatedScore } from '../hooks/useAnimatedScore';
import { ConfettiBackground } from './ConfettiBackground';
import { AwardsStrip } from './RevealShared';
import type { Award, LeaderboardEntry } from '../types';

type Stage = 'dark' | 'intro' | 'bronze' | 'silver' | 'gold' | 'settled';
type PodiumRank = 1 | 2 | 3;
const STAGE_ORDER: Stage[] = ['dark', 'intro', 'bronze', 'silver', 'gold', 'settled'];
const atLeast = (stage: Stage, target: Stage) => STAGE_ORDER.indexOf(stage) >= STAGE_ORDER.indexOf(target);

const RANK_STAGE: Record<PodiumRank, Stage> = { 3: 'bronze', 2: 'silver', 1: 'gold' };
const PODIUM_HEIGHTS: Record<PodiumRank, number> = { 1: 176, 2: 138, 3: 112 };
const PODIUM_STYLE: Record<PodiumRank, { border: string; glow: string; medal: string }> = {
  1: { border: 'rgba(251,191,36,0.45)', glow: 'rgba(251,191,36,0.16)', medal: '🥇' },
  2: { border: 'rgba(203,213,225,0.4)', glow: 'rgba(203,213,225,0.1)', medal: '🥈' },
  3: { border: 'rgba(217,119,6,0.4)', glow: 'rgba(217,119,6,0.12)', medal: '🥉' },
};

function BackgroundLayer({ backgroundSrc, showConfetti }: Readonly<{ backgroundSrc: string; showConfetti: boolean }>) {
  return (
    <>
      <img
        src={backgroundSrc}
        alt=""
        aria-hidden="true"
        style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 0 }}
      />
      <div
        className="fixed inset-0 pointer-events-none"
        style={{ background: 'rgba(8,8,18,0.94)', backdropFilter: 'blur(48px)', zIndex: 1 }}
      />
      {showConfetti && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 2, pointerEvents: 'none', filter: 'blur(10px)' }}>
          <ConfettiBackground burst persistAfterBurst speedMultiplier={3} />
        </div>
      )}
      <div className="fixed inset-0 pointer-events-none" style={{ background: 'rgba(8,8,18,0.4)', zIndex: 3 }} />
    </>
  );
}

function PendingPedestal({ height }: Readonly<{ height: number }>) {
  return (
    <div
      style={{
        width: '100%', height: `${height}px`, borderRadius: '16px',
        background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)',
        animation: 'pedestalPulse 1.8s ease-in-out infinite',
      }}
    />
  );
}

// Mounted only once its slot reveals -- useAnimatedScore(finalScore, delta, startDelay)
// only animates when delta > 0 (delta <= 0 always short-circuits to displaying finalScore
// immediately). A 0->score count-up needs delta = score itself so the start value
// (finalScore - delta) is 0; firing it at mount time (no extra startDelay) means the
// count-up begins right when the podium slot's reveal already happens. `instant` skips
// the count-up entirely for reduced-motion users, who never see the "0" starting value.
function AnimatedPodiumScore({ score, instant }: Readonly<{ score: number; instant: boolean }>) {
  const { displayScore } = useAnimatedScore(score, score, 0, instant);
  return <>{displayScore.toLocaleString()}</>;
}

function PodiumSlot({ rank, entry, revealed, isMe, reducedMotion }: Readonly<{
  rank: PodiumRank;
  entry: LeaderboardEntry;
  revealed: boolean;
  isMe: boolean;
  reducedMotion: boolean;
}>) {
  const height = PODIUM_HEIGHTS[rank];
  const { border, glow, medal } = PODIUM_STYLE[rank];

  return (
    <div style={{ width: '100%', maxWidth: '112px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      {!revealed ? (
        <PendingPedestal height={height} />
      ) : (
        <div
          style={{
            width: '100%', minHeight: `${height}px`, borderRadius: '16px',
            background: `linear-gradient(180deg, ${glow} 0%, rgba(255,255,255,0.04) 100%)`,
            border: `1px solid ${isMe ? 'rgba(94,234,212,0.6)' : border}`,
            boxShadow: isMe ? '0 0 0 2px rgba(94,234,212,0.22)' : 'none',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end',
            padding: '14px 8px',
            animation: 'podiumRise 0.6s cubic-bezier(0.16,1,0.3,1) both',
          }}
        >
          <span style={{ fontSize: '1.5rem', lineHeight: 1, marginBottom: '4px' }}>{medal}</span>
          <span className="text-white font-bold text-sm text-center" style={{ wordBreak: 'break-word' }}>
            {entry.name}
          </span>
          {isMe && (
            <span style={{ color: 'rgba(94,234,212,0.9)', fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.08em', marginTop: '2px' }}>
              YOU
            </span>
          )}
          <span className="text-white/70 font-semibold text-sm tabular-nums" style={{ marginTop: '4px' }}>
            <AnimatedPodiumScore score={entry.score} instant={reducedMotion} />
          </span>
        </div>
      )}
    </div>
  );
}

function ResultRow({ entry, isMe }: Readonly<{ entry: LeaderboardEntry; isMe: boolean }>) {
  return (
    <div
      className={`flex items-center gap-4 px-4 py-3 rounded-xl ${isMe ? 'bg-white/10' : 'bg-white/5'}`}
      style={isMe ? { boxShadow: '0 0 0 1px rgba(94,234,212,0.35) inset' } : undefined}
    >
      <span className="w-8 flex justify-center">
        <RankBadge rank={entry.rank} />
      </span>
      <span className="text-white font-bold flex-1">
        {entry.name}
        {isMe && (
          <span style={{ color: 'rgba(94,234,212,0.9)', fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.08em', marginLeft: '8px' }}>
            YOU
          </span>
        )}
      </span>
      <p className="text-white/60 font-semibold tabular-nums min-w-[64px] text-right">{entry.score.toLocaleString()}</p>
    </div>
  );
}

function RestResultsList({ entries, myName }: Readonly<{ entries: LeaderboardEntry[]; myName?: string }>) {
  if (entries.length === 0) return null;
  return (
    <div className="flex-1 min-h-0 overflow-y-auto space-y-2 relative z-10 page-enter">
      {entries.map(e => (
        <ResultRow key={e.name} entry={e} isMe={e.name === myName} />
      ))}
    </div>
  );
}

/**
 * Kahoot-style final results ceremony: 3rd, then 2nd, then 1st place reveal in
 * sequence, then everyone else settles in as a plain list. Shared by Host and
 * Play -- callers supply the background asset and footer CTAs.
 */
export function FinalResultsView({ leaderboard, awards, myName, backgroundSrc, footer }: Readonly<{
  leaderboard: LeaderboardEntry[];
  awards: Award[];
  myName?: string;
  backgroundSrc: string;
  footer: ReactNode;
}>) {
  const [reducedMotion] = useState(() => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  const podium = useMemo(() => leaderboard.slice(0, Math.min(3, leaderboard.length)), [leaderboard]);
  const rest = useMemo(() => leaderboard.slice(podium.length), [leaderboard, podium]);

  const [stage, setStage] = useState<Stage>(reducedMotion ? 'settled' : 'dark');

  useEffect(() => {
    if (reducedMotion) { setStage('settled'); return; }
    setStage('dark');
    const introDelay = 950;
    const steps: { stage: Stage; delay: number }[] = [{ stage: 'intro', delay: introDelay }];
    if (podium[2]) steps.push({ stage: 'bronze', delay: introDelay + 650 });
    if (podium[1]) steps.push({ stage: 'silver', delay: introDelay + 1850 });
    if (podium[0]) steps.push({ stage: 'gold', delay: introDelay + 3050 });
    const timers = steps.map(s => setTimeout(() => setStage(s.stage), s.delay));
    const lastDelay = steps.at(-1)?.delay ?? 0;
    timers.push(setTimeout(() => setStage('settled'), lastDelay + 800));
    // Cleanup fires on unmount (leaving the finished screen, or the host
    // starting a new game unmounts this component when the phase changes
    // away) so a stale timer can never fire into gone/replaced state.
    return () => timers.forEach(clearTimeout);
  }, [leaderboard, podium, reducedMotion]);

  const announcement = useMemo(() => {
    if (reducedMotion) {
      const winner = podium[0];
      return winner ? `Final results ready. Winner: ${winner.name} with ${winner.score.toLocaleString()} points.` : 'Final results ready.';
    }
    const lines: string[] = [];
    if (stage === 'dark') return 'Final results.';
    if (atLeast(stage, 'bronze') && podium[2]) lines.push(`3rd place: ${podium[2].name}, ${podium[2].score.toLocaleString()} points.`);
    if (atLeast(stage, 'silver') && podium[1]) lines.push(`2nd place: ${podium[1].name}, ${podium[1].score.toLocaleString()} points.`);
    if (atLeast(stage, 'gold') && podium[0]) lines.push(`1st place: ${podium[0].name}, ${podium[0].score.toLocaleString()} points.`);
    return lines.join(' ');
  }, [stage, reducedMotion, podium]);

  if (leaderboard.length === 0) {
    return (
      <div className="relative min-h-screen flex flex-col items-center justify-center p-6 gap-6">
        <BackgroundLayer backgroundSrc={backgroundSrc} showConfetti={false} />
        <p className="text-white/60 text-lg relative z-10">No scores yet.</p>
        <div className="relative z-10">{footer}</div>
      </div>
    );
  }

  const settled = stage === 'settled';
  const darkIntro = stage === 'dark';
  const showConfetti = !reducedMotion && atLeast(stage, 'gold');

  // Visual order: 2nd (left) - 1st (center) - 3rd (right), classic podium
  // shape. Ranks with no player at all (1- and 2-player games) drop out.
  const columns = ([2, 1, 3] as const)
    .map(rank => ({ rank, entry: podium[rank - 1] ?? null }))
    .filter((c): c is { rank: PodiumRank; entry: LeaderboardEntry } => c.entry !== null);

  return (
    <div className="relative min-h-screen flex flex-col p-6 gap-4">
      <BackgroundLayer backgroundSrc={backgroundSrc} showConfetti={showConfetti} />
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          zIndex: 20,
          background: '#000',
          opacity: darkIntro ? 1 : 0,
          transition: 'opacity 0.55s ease',
        }}
      />

      <div aria-live="polite" className="sr-only">{announcement}</div>

      <h2
        className="text-3xl font-black text-white text-center relative page-enter"
        style={{ zIndex: 21, opacity: darkIntro ? 1 : undefined, transition: 'opacity 0.55s ease' }}
      >
        Final Results
      </h2>

      <div className="relative z-10 flex items-end justify-center gap-3 px-2" style={{ marginTop: '8px' }}>
        {columns.map(c => (
          <PodiumSlot
            key={c.rank}
            rank={c.rank}
            entry={c.entry}
            revealed={atLeast(stage, RANK_STAGE[c.rank])}
            isMe={c.entry.name === myName}
            reducedMotion={reducedMotion}
          />
        ))}
      </div>

      {settled && <RestResultsList entries={rest} myName={myName} />}
      {!settled && <div className="flex-1 min-h-0" />}

      {settled && <div className="relative z-10 page-enter"><AwardsStrip awards={awards} /></div>}

      {settled && <div className="relative z-10 flex flex-col items-center gap-3 page-enter">{footer}</div>}
    </div>
  );
}
