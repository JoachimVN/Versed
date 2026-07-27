import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { RankBadge } from './RankBadge';
import { useAnimatedScore } from '../hooks/useAnimatedScore';
import { ConfettiBackground } from './ConfettiBackground';
import { AwardsStrip, AWARD_LABELS } from './RevealShared';
import type { Award, LeaderboardEntry } from '../types';

type PodiumRank = 1 | 2 | 3;
type SweepStage = 'sweepToSilver' | 'sweepToGold' | 'sweepToSettled';
type Stage = 'dark' | 'bronze' | 'silver' | 'gold' | 'settled' | SweepStage;

const REVEAL_STAGE: Record<PodiumRank, Stage> = { 3: 'bronze', 2: 'silver', 1: 'gold' };

// Recap-row heights (the settled screen's compact stepped podium) are a
// smaller echo of the same 1st > 2nd > 3rd shape as the cinematic reveal.
const RECAP_HEIGHTS: Record<PodiumRank, number> = { 1: 150, 2: 118, 3: 96 };

const RANK_STYLE: Record<PodiumRank, { tint: string; gradient: string; label: string }> = {
  1: { tint: '#e2a6f2', gradient: 'linear-gradient(90deg,#5eead4,#c084fc 55%,#e879f9)', label: 'Champion' },
  2: { tint: '#b9a7e0', gradient: 'linear-gradient(90deg,#d9cdf2,#a893db)', label: 'Second Place' },
  3: { tint: '#5ecfc3', gradient: 'linear-gradient(90deg,#8fe6dd,#5ecfc3)', label: 'Third Place' },
};

const INTRO_DELAY = 650;
const HOLD_MINOR = 1850;
const HOLD_CHAMPION = 3850;
// One shared duration for every sweep, comfortably longer than the podium
// card's own 0.5s fade transition (below) so the outgoing and incoming cards
// never overlap mid-cross-fade, and short enough that the wordless gap
// between cards doesn't read as the screen freezing.
const SWEEP_DURATION_MS = 620;
const SWEEP_ENERGY_MUL = 0.95;
const SWEEP_FLASH_MUL = 0.7;

function isSweepStage(stage: Stage): stage is SweepStage {
  return stage === 'sweepToSilver' || stage === 'sweepToGold' || stage === 'sweepToSettled';
}

// Builds the one-shot stage timeline for however many podium spots this game
// actually has -- a 1- or 2-player game skips the ranks that don't exist,
// same rule the podium slots themselves already followed.
function buildTimeline(podiumCount: number): { stage: Stage; delay: number }[] {
  const steps: { stage: Stage; delay: number }[] = [];
  let t = INTRO_DELAY;
  if (podiumCount >= 3) {
    steps.push({ stage: 'bronze', delay: t });
    t += HOLD_MINOR;
    steps.push({ stage: 'sweepToSilver', delay: t });
    t += SWEEP_DURATION_MS;
  }
  if (podiumCount >= 2) {
    steps.push({ stage: 'silver', delay: t });
    t += HOLD_MINOR;
    steps.push({ stage: 'sweepToGold', delay: t });
    t += SWEEP_DURATION_MS;
  }
  steps.push({ stage: 'gold', delay: t });
  t += HOLD_CHAMPION;
  steps.push({ stage: 'sweepToSettled', delay: t });
  t += SWEEP_DURATION_MS;
  steps.push({ stage: 'settled', delay: t });
  return steps;
}

// Exported so the player-side holding screen (FinalResultsPlayer.tsx) can
// time its own "look up at the board" -> personal-result cut to land around
// the same moment the host settles, without needing a dedicated
// server-timestamped signal just for a cosmetic transition.
export function getCeremonyDuration(podiumCount: number): number {
  return buildTimeline(Math.max(1, podiumCount)).at(-1)!.delay;
}

export function findAward(name: string, awards: Award[]): Award | undefined {
  return awards.find(a => a.playerNames.includes(name));
}

// ─── EQ / spectrum strip ────────────────────────────────────────────────────
// The reveal's transitions are driven by this bar strip rather than a plain
// crossfade or confetti burst -- it's a literal spectrum analyzer, colored
// across the brand gradient, that slams to peak between ranks (masking the
// cut) and settles into an ambient pulse the rest of the time. Runs its own
// rAF loop and writes directly to the DOM, matching ConfettiBackground's
// existing hand-rolled pattern rather than pushing every frame through React
// state.

const N_BARS = 44;
const BAR_STOPS: [number, number, number][] = [[0, 166, 163], [60, 44, 102], [158, 18, 204]];

function barColor(i: number, n: number): string {
  const t = i / (n - 1);
  const seg = t < 0.5 ? 0 : 1;
  const localT = t < 0.5 ? t / 0.5 : (t - 0.5) / 0.5;
  const [r1, g1, b1] = BAR_STOPS[seg];
  const [r2, g2, b2] = BAR_STOPS[seg + 1];
  const r = Math.round(r1 + (r2 - r1) * localT);
  const g = Math.round(g1 + (g2 - g1) * localT);
  const b = Math.round(b1 + (b2 - b1) * localT);
  return `rgb(${r},${g},${b})`;
}

function sweepRise(progress: number): number {
  return progress < 0.55 ? progress / 0.55 : 1 - (progress - 0.55) / 0.45;
}

function computeEnergy(stage: Stage, sinceStage: number): { energy: number; flash: number } {
  if (isSweepStage(stage)) {
    const p = Math.min(1, sinceStage / SWEEP_DURATION_MS);
    const rise = Math.max(0, sweepRise(p));
    return { energy: 0.14 + rise * SWEEP_ENERGY_MUL, flash: rise * SWEEP_FLASH_MUL };
  }
  if (stage === 'dark') return { energy: 0.05, flash: 0 };
  if (stage === 'settled') return { energy: 0.16, flash: 0 };
  if (stage === 'gold') {
    // a slow rhythmic swell instead of flat ambient -- the champion's hold
    // should feel alive, like a crowd still cheering
    return { energy: 0.24 + 0.11 * (0.5 + 0.5 * Math.sin(sinceStage * 0.0038)), flash: 0 };
  }
  return { energy: 0.22, flash: 0 };
}

function EqStrip({ stage, reducedMotion }: Readonly<{ stage: Stage; reducedMotion: boolean }>) {
  const barRefs = useRef<(HTMLDivElement | null)[]>([]);
  const flashRef = useRef<HTMLDivElement>(null);
  const stageStartRef = useRef(performance.now());

  useEffect(() => { stageStartRef.current = performance.now(); }, [stage]);

  useEffect(() => {
    if (reducedMotion) {
      barRefs.current.forEach((el, i) => {
        if (!el) return;
        el.style.transform = `scaleY(${(0.06 + 0.02 * Math.sin(i * 0.6)).toFixed(3)})`;
        el.style.opacity = '0.3';
      });
      return;
    }
    let rafId = 0;
    const tick = (now: number) => {
      const { energy, flash } = computeEnergy(stage, now - stageStartRef.current);
      barRefs.current.forEach((el, i) => {
        if (!el) return;
        const wave = 0.55 + 0.45 * Math.sin(now * 0.006 - i * 0.28);
        const amp = 0.04 + energy * Math.max(0, wave);
        el.style.transform = `scaleY(${amp.toFixed(3)})`;
        el.style.opacity = (0.35 + energy * 0.5).toFixed(2);
      });
      if (flashRef.current) flashRef.current.style.opacity = flash.toFixed(2);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [stage, reducedMotion]);

  return (
    <>
      <div
        aria-hidden="true"
        style={{
          position: 'fixed', left: 0, right: 0, bottom: 0, height: '54%',
          display: 'flex', alignItems: 'flex-end', gap: '3px', padding: '0 20px',
          pointerEvents: 'none', zIndex: 1,
        }}
      >
        {Array.from({ length: N_BARS }, (_, i) => (
          <div
            key={i}
            ref={el => { barRefs.current[i] = el; }}
            style={{
              flex: 1, minWidth: '2px', height: '100%', borderRadius: '2px 2px 0 0',
              transform: 'scaleY(0.04)', transformOrigin: 'bottom', opacity: 0.5,
              background: `linear-gradient(180deg, ${barColor(i, N_BARS)}, transparent)`,
            }}
          />
        ))}
      </div>
      <div
        ref={flashRef}
        className="fixed inset-0 pointer-events-none"
        style={{
          zIndex: 3, opacity: 0,
          background: 'radial-gradient(circle at 50% 62%, rgba(255,255,255,0.5), rgba(158,18,204,0.22) 45%, transparent 72%)',
        }}
      />
    </>
  );
}

// ─── Background ─────────────────────────────────────────────────────────────

export function BackgroundLayer({ backgroundSrc, showConfetti }: Readonly<{ backgroundSrc: string; showConfetti: boolean }>) {
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
    </>
  );
}

// ─── Podium reveal card ─────────────────────────────────────────────────────

function AnimatedPodiumScore({ score, instant, champion }: Readonly<{ score: number; instant: boolean; champion: boolean }>) {
  const { displayScore } = useAnimatedScore(score, score, champion ? 300 : 0, instant, false, champion ? 1300 : 900);
  return <>{displayScore.toLocaleString()}</>;
}

function PodiumRevealCard({ rank, entry, awards, visible, reducedMotion }: Readonly<{
  rank: PodiumRank;
  entry: LeaderboardEntry;
  awards: Award[];
  visible: boolean;
  reducedMotion: boolean;
}>) {
  const { tint, gradient, label } = RANK_STYLE[rank];
  const champion = rank === 1;
  const award = findAward(entry.name, awards);
  const nameAnimation = visible && !reducedMotion
    ? (champion ? 'nameIn 0.7s cubic-bezier(0.2,1.4,0.4,1) both, goldGlow 2.6s ease-in-out 0.8s infinite' : 'nameIn 0.7s cubic-bezier(0.2,1.4,0.4,1) both')
    : undefined;

  return (
    <div
      style={{
        position: 'absolute', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px',
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0) scale(1)' : 'translateY(10px) scale(0.985)',
        transition: 'opacity 0.5s cubic-bezier(0.16,1,0.3,1), transform 0.5s cubic-bezier(0.16,1,0.3,1)',
        pointerEvents: visible ? 'auto' : 'none',
        textAlign: 'center', width: '100%',
      }}
    >
      <span style={{ fontWeight: 800, fontSize: '0.78rem', letterSpacing: '0.32em', textTransform: 'uppercase', color: tint, paddingLeft: '0.32em' }}>
        {label}
      </span>
      <h1
        className="font-black uppercase"
        style={{
          fontFamily: "'Montserrat', sans-serif",
          fontSize: champion ? 'clamp(3.6rem, 8vw, 6.4rem)' : 'clamp(3rem, 6.6vw, 5.2rem)',
          lineHeight: 0.98, letterSpacing: '-0.01em',
          background: gradient, WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent',
          animation: nameAnimation,
        }}
      >
        {entry.name}
      </h1>
      <span
        className="tabular-nums"
        style={{ fontFamily: "'Nunito', sans-serif", fontWeight: 900, fontSize: champion ? 'clamp(2rem, 3vw, 2.6rem)' : 'clamp(1.7rem, 2.6vw, 2.2rem)', color: '#fff' }}
      >
        {visible ? <AnimatedPodiumScore score={entry.score} instant={reducedMotion} champion={champion} /> : 0}
        <span style={{ fontSize: '0.5em', fontWeight: 800, color: 'rgba(255,255,255,0.38)', marginLeft: '0.35em' }}>PTS</span>
      </span>
      {award && (
        <p
          className="flex items-center gap-2"
          style={{
            fontWeight: 700, fontSize: '1rem', color: 'rgba(255,255,255,0.62)',
            opacity: champion && !reducedMotion ? 0 : 1,
            animation: champion && visible && !reducedMotion ? 'statIn 0.5s ease 1.55s both' : undefined,
          }}
        >
          <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: tint, flexShrink: 0 }} />
          {AWARD_LABELS[award.key]} · {award.detail}
        </p>
      )}
    </div>
  );
}

// ─── Settled: recap podium + rest of the field ─────────────────────────────

function RecapChip({ rank, entry }: Readonly<{ rank: PodiumRank; entry: LeaderboardEntry }>) {
  const { tint } = RANK_STYLE[rank];
  const label = rank === 1 ? '1st' : rank === 2 ? '2nd' : '3rd';
  return (
    <div
      style={{
        flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: '4px',
        minHeight: `${RECAP_HEIGHTS[rank]}px`, padding: '12px 6px 10px', borderRadius: '14px',
        border: '1px solid rgba(255,255,255,0.09)',
        background: `linear-gradient(180deg, color-mix(in srgb, ${tint} 20%, transparent), transparent)`,
      }}
    >
      <span style={{ fontWeight: 800, fontSize: '0.62rem', letterSpacing: '0.14em', color: tint, textTransform: 'uppercase' }}>{label}</span>
      <span className="font-bold" style={{ fontSize: '1.05rem', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.name}</span>
      <span className="tabular-nums" style={{ fontWeight: 700, fontSize: '0.92rem', color: 'rgba(255,255,255,0.6)' }}>{entry.score.toLocaleString()}</span>
    </div>
  );
}

export function ResultRow({ entry, isMe }: Readonly<{ entry: LeaderboardEntry; isMe: boolean }>) {
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

export function RestResultsList({ entries, myName }: Readonly<{ entries: LeaderboardEntry[]; myName?: string }>) {
  if (entries.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {entries.map(e => (
        <ResultRow key={e.name} entry={e} isMe={e.name === myName} />
      ))}
    </div>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * Host's final-results ceremony: 3rd, then 2nd, then 1st revealed in
 * sequence over a spectrum-analyzer backdrop, then everyone settles into a
 * recap podium + full standings + awards. Landscape, meant for the shared
 * screen -- see FinalResultsPlayer.tsx for the player's phone-side view.
 */
export function FinalResultsView({ leaderboard, awards, backgroundSrc, footer }: Readonly<{
  leaderboard: LeaderboardEntry[];
  awards: Award[];
  backgroundSrc: string;
  footer: ReactNode;
}>) {
  const [reducedMotion] = useState(() => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  const podium = useMemo(() => leaderboard.slice(0, Math.min(3, leaderboard.length)), [leaderboard]);
  const rest = useMemo(() => leaderboard.slice(podium.length), [leaderboard, podium]);

  const [stage, setStage] = useState<Stage>(reducedMotion ? 'settled' : 'dark');

  useEffect(() => {
    if (reducedMotion || podium.length === 0) { setStage('settled'); return; }
    setStage('dark');
    const timeline = buildTimeline(podium.length);
    const timers = timeline.map(step => setTimeout(() => setStage(step.stage), step.delay));
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
    if (stage === 'bronze' && podium[2]) return `Third place: ${podium[2].name}, ${podium[2].score.toLocaleString()} points.`;
    if (stage === 'silver' && podium[1]) return `Second place: ${podium[1].name}, ${podium[1].score.toLocaleString()} points.`;
    if (stage === 'gold' && podium[0]) return `Champion: ${podium[0].name}, ${podium[0].score.toLocaleString()} points.`;
    if (stage === 'settled') return 'Final results ready.';
    return 'Final results.';
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
  const dark = stage === 'dark';
  const showConfetti = !reducedMotion && (stage === 'gold' || stage === 'sweepToSettled' || settled);

  return (
    <div className="relative min-h-screen flex flex-col p-6 gap-4">
      <BackgroundLayer backgroundSrc={backgroundSrc} showConfetti={showConfetti} />
      <EqStrip stage={stage} reducedMotion={reducedMotion} />

      <div
        className="fixed inset-0 pointer-events-none"
        style={{ zIndex: 20, background: '#000', opacity: dark ? 1 : 0, transition: 'opacity 0.55s ease' }}
      />

      <div aria-live="polite" className="sr-only">{announcement}</div>

      {!settled && (
        <div className="relative flex-1 flex items-center justify-center" style={{ zIndex: 21 }}>
          {([3, 2, 1] as const).map(rank => {
            const entry = podium[rank - 1];
            if (!entry) return null;
            return (
              <PodiumRevealCard
                key={rank}
                rank={rank}
                entry={entry}
                awards={awards}
                visible={stage === REVEAL_STAGE[rank]}
                reducedMotion={reducedMotion}
              />
            );
          })}
        </div>
      )}

      {settled && (
        <div className="relative z-10 flex flex-col flex-1 min-h-0 gap-4 page-enter">
          <h2 className="text-3xl font-black text-white text-center" style={{ animation: 'settledIn 0.5s cubic-bezier(0.16,1,0.3,1) 0.05s both' }}>
            Final Results
          </h2>

          <div
            className="flex items-end gap-3"
            style={{ maxWidth: '640px', width: '100%', margin: '0 auto', animation: 'settledIn 0.5s cubic-bezier(0.16,1,0.3,1) 0.13s both' }}
          >
            {([2, 1, 3] as const).map(rank => {
              const entry = podium[rank - 1];
              return entry ? <RecapChip key={rank} rank={rank} entry={entry} /> : null;
            })}
          </div>

          {/* Leaderboard and awards each get their own row rather than sitting
              side by side -- and share one scroll region so a long game's
              awards are still reachable below a long roster, without ever
              showing a scrollbar on a short one. */}
          <div
            className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-6"
            style={{ maxWidth: '640px', width: '100%', margin: '0 auto', animation: 'settledIn 0.5s cubic-bezier(0.16,1,0.3,1) 0.22s both' }}
          >
            <RestResultsList entries={rest} />
            <AwardsStrip awards={awards} />
          </div>

          <div className="flex justify-center" style={{ animation: 'settledIn 0.5s cubic-bezier(0.16,1,0.3,1) 0.4s both' }}>
            {footer}
          </div>
        </div>
      )}
    </div>
  );
}
