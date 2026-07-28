import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import LiquidGlass from './StableLiquidGlass';
import { useAnimatedScore } from '../hooks/useAnimatedScore';
import { CONFETTI_COLORS, ConfettiBackground, GOLD_CONFETTI_COLORS } from './ConfettiBackground';
import { AwardsStrip, AWARD_LABELS } from './RevealShared';
import { LIQUID_CARD_PROPS } from './liquidGlassPresets';
import type { Award, LeaderboardEntry } from '../types';

type PodiumRank = 1 | 2 | 3;
type SweepStage = 'sweepToSilver' | 'sweepToGold' | 'sweepToSettled';
type Stage = 'dark' | 'bronze' | 'silver' | 'gold' | 'settled' | SweepStage;

const REVEAL_STAGE: Record<PodiumRank, Stage> = { 3: 'bronze', 2: 'silver', 1: 'gold' };

// Podium-step heights (the settled screen's recap) are a smaller echo of the
// same 1st > 2nd > 3rd shape as the cinematic reveal. The gap between steps
// is deliberately exaggerated past what the real point gaps would justify --
// at a subtler ratio the "podium" silhouette reads as three near-identical
// boxes instead of an actual riser.
const PODIUM_STEP_HEIGHTS: Record<PodiumRank, number> = { 1: 152, 2: 92, 3: 64 };

// Subtle, desaturated per-rank hues -- gold reads as gold, silver as a soft
// purple, bronze as a soft cyan -- rather than the previous mixed palette
// where the champion's own gradient didn't actually read as gold.
const RANK_STYLE: Record<PodiumRank, { tint: string; gradient: string; label: string }> = {
  1: { tint: '#f2c879', gradient: 'linear-gradient(90deg,#fde8b8,#f3c467 55%,#e7a940)', label: 'Champion' },
  2: { tint: '#c2a8f0', gradient: 'linear-gradient(90deg,#e3d5fb,#b28ded)', label: 'Second Place' },
  3: { tint: '#7de8dd', gradient: 'linear-gradient(90deg,#c9f8f2,#5ecfc3)', label: 'Third Place' },
};

const INTRO_DELAY = 650;
const HOLD_MINOR = 1850;
// Silver's hold runs longer than bronze's -- this is the beat right before
// the champion, giving that reveal a bit more suspense than the others.
const HOLD_SILVER = 3000;
const HOLD_CHAMPION = 3850;
// One shared duration for every sweep, comfortably longer than the podium
// card's own 0.5s fade transition (below) so the outgoing and incoming cards
// never overlap mid-cross-fade, and short enough that the wordless gap
// between cards doesn't read as the screen freezing.
const SWEEP_DURATION_MS = 620;
// The champion->settled cut gets a slightly longer beat than the other
// sweeps -- the champion's own fade-out plus the settled screen fading in
// afterward reads better with a touch more air than a plain card swap.
const SETTLE_DURATION_MS = 750;

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
    t += HOLD_SILVER;
    steps.push({ stage: 'sweepToGold', delay: t });
    t += SWEEP_DURATION_MS;
  }
  steps.push({ stage: 'gold', delay: t });
  t += HOLD_CHAMPION;
  steps.push({ stage: 'sweepToSettled', delay: t });
  t += SETTLE_DURATION_MS;
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

function isSweepStage(stage: Stage): stage is SweepStage {
  return stage === 'sweepToSilver' || stage === 'sweepToGold' || stage === 'sweepToSettled';
}

// ─── EQ / spectrum strip ────────────────────────────────────────────────────
// The reveal's transitions are driven by this bar strip rather than a plain
// crossfade or confetti burst -- it's a literal spectrum analyzer, colored
// across the brand gradient, that gives a subtle lift between ranks (masking
// the cut). Once the podium recap settles in, it powers down instead of
// pulsing on underneath the standings/awards indefinitely: the same wave
// keeps running, but its envelope decays to 0 over SETTLE_DECAY_MS, so the
// bars die out in place rather than visibly switching to a different exit
// animation. Runs its own rAF loop and writes directly to the DOM, matching
// ConfettiBackground's existing hand-rolled pattern rather than pushing
// every frame through React state. Gold holds at the same ambient level as
// every other stage rather than its own rhythmic swell -- that extra
// "breathing" was reserved for the champion alone and read as an unwanted
// extra effect.

const N_BARS = 44;
const BAR_STOPS: [number, number, number][] = [[0, 166, 163], [60, 44, 102], [158, 18, 204]];
const BRONZE_BAR_STOPS: [number, number, number][] = [[125, 232, 221], [31, 192, 181], [0, 133, 132]];
const SILVER_BAR_STOPS: [number, number, number][] = [[227, 213, 251], [178, 141, 237], [120, 65, 178]];
const GOLD_BAR_STOPS: [number, number, number][] = [[243, 196, 103], [248, 207, 104], [201, 134, 34]];
const EQ_PALETTES = [BAR_STOPS, BRONZE_BAR_STOPS, SILVER_BAR_STOPS, GOLD_BAR_STOPS];
const SETTLE_DECAY_MS = 650;

function barColor(i: number, n: number, stops = BAR_STOPS): string {
  const t = i / (n - 1);
  const seg = t < 0.5 ? 0 : 1;
  const localT = t < 0.5 ? t / 0.5 : (t - 0.5) / 0.5;
  const [r1, g1, b1] = stops[seg];
  const [r2, g2, b2] = stops[seg + 1];
  const r = Math.round(r1 + (r2 - r1) * localT);
  const g = Math.round(g1 + (g2 - g1) * localT);
  const b = Math.round(b1 + (b2 - b1) * localT);
  return `rgb(${r},${g},${b})`;
}

const AMBIENT_ENERGY = 0.22;
const SETTLED_ENERGY = 0.16;

// bronze->silver and silver->gold both start and end their hump at the same
// flat ambient level, since gold no longer holds a different energy than
// the other stages.
const SWEEP_BOUNDS: Record<'sweepToSilver' | 'sweepToGold', { from: number; to: number }> = {
  sweepToSilver: { from: AMBIENT_ENERGY, to: AMBIENT_ENERGY },
  sweepToGold: { from: AMBIENT_ENERGY, to: AMBIENT_ENERGY },
};
const SWEEP_PEAK_BOW = 0.16;

function easeOutCubic(p: number): number {
  return 1 - (1 - p) ** 3;
}
function easeInCubic(p: number): number {
  return p ** 3;
}
function easeInOutCubic(p: number): number {
  return p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2;
}

// Rises from `from` to a fixed-height peak by the midpoint, then eases back
// down to `to` -- a smooth hump landing exactly on both neighbors' actual
// levels, rather than the old shared-floor version that snapped at both ends.
function sweepHumpEnergy(from: number, to: number, p: number): number {
  const peak = from + SWEEP_PEAK_BOW;
  if (p < 0.5) return from + (peak - from) * easeOutCubic(p / 0.5);
  return peak + (to - peak) * easeInCubic((p - 0.5) / 0.5);
}

function computeEnergy(stage: Stage, sinceStage: number): number {
  if (stage === 'sweepToSettled') {
    // No hump for the champion->final cut -- the confetti burst already
    // sells it, so this just eases straight down to the settled level.
    const p = Math.min(1, sinceStage / SETTLE_DURATION_MS);
    return AMBIENT_ENERGY + (SETTLED_ENERGY - AMBIENT_ENERGY) * easeInOutCubic(p);
  }
  if (isSweepStage(stage)) {
    const p = Math.min(1, sinceStage / SWEEP_DURATION_MS);
    const { from, to } = SWEEP_BOUNDS[stage];
    return sweepHumpEnergy(from, to, p);
  }
  if (stage === 'dark') return 0.05;
  if (stage === 'settled') return SETTLED_ENERGY;
  return AMBIENT_ENERGY;
}

function eqStopsForStage(stage: Stage) {
  if (stage === 'bronze') return BRONZE_BAR_STOPS;
  if (stage === 'sweepToSilver' || stage === 'silver') return SILVER_BAR_STOPS;
  if (stage === 'sweepToGold' || stage === 'gold' || stage === 'sweepToSettled' || stage === 'settled') return GOLD_BAR_STOPS;
  return BAR_STOPS;
}

function EqStrip({ stage, reducedMotion }: Readonly<{ stage: Stage; reducedMotion: boolean }>) {
  const barRefs = useRef<(HTMLDivElement | null)[]>([]);
  const stageStartRef = useRef(performance.now());
  const settled = stage === 'settled';
  const activeStops = eqStopsForStage(stage);

  useEffect(() => { stageStartRef.current = performance.now(); }, [stage]);

  useEffect(() => {
    if (reducedMotion) {
      barRefs.current.forEach((el, i) => {
        if (!el) return;
        el.style.transform = `scaleY(${settled ? 0 : (0.06 + 0.02 * Math.sin(i * 0.6)).toFixed(3)})`;
        el.style.opacity = settled ? '0' : '0.06';
      });
      return;
    }
    let rafId = 0;
    const tick = (now: number) => {
      const sinceStage = now - stageStartRef.current;
      const energy = computeEnergy(stage, sinceStage);
      // Envelope multiplier, not a swap to a different animation: the wave
      // computation below is untouched, this just scales its result down to
      // 0 once settled, so the bars die out mid-motion instead of cutting.
      const decay = settled ? Math.max(0, 1 - sinceStage / SETTLE_DECAY_MS) : 1;
      barRefs.current.forEach((el, i) => {
        if (!el) return;
        const wave = 0.55 + 0.45 * Math.sin(now * 0.006 - i * 0.28);
        const amp = decay * (0.04 + energy * Math.max(0, wave));
        el.style.transform = `scaleY(${amp.toFixed(3)})`;
        el.style.opacity = (decay * (0.06 + energy * 0.16)).toFixed(2);
      });
      if (settled && decay === 0) return;
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [stage, reducedMotion, settled]);

  return (
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
            flex: 1, minWidth: '2px', height: '100%', borderRadius: '2px 2px 0 0', position: 'relative', overflow: 'hidden',
            transform: 'scaleY(0.04)', transformOrigin: 'bottom', opacity: 0.5,
          }}
        >
          {EQ_PALETTES.map(stops => (
            <div
              key={stops[0].join('-')}
              style={{
                position: 'absolute', inset: 0,
                background: `linear-gradient(180deg, ${barColor(i, N_BARS, stops)}, transparent)`,
                opacity: stops === activeStops ? 1 : 0, transition: 'opacity 0.62s ease',
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── Background ─────────────────────────────────────────────────────────────

// Hue-rotate sweeps one direction ("rightward"/increasing) across the whole
// ceremony rather than snapping through whichever numeric distance is
// shorter -- raw filter values keep climbing past 360 where the visual
// target wraps back around, so every leg of the transition turns the same
// way instead of reversing mid-sweep.
export const HUE_BRONZE = 140;
const HUE_SILVER = 240; // wraps to -120deg
const HUE_CHAMPION = 360; // wraps to 0deg
export const HUE_SETTLED = 540; // wraps to -150deg

const STAGE_HUE: Record<Stage, number> = {
  dark: HUE_BRONZE,
  bronze: HUE_BRONZE,
  sweepToSilver: HUE_SILVER,
  silver: HUE_SILVER,
  sweepToGold: HUE_CHAMPION,
  gold: HUE_CHAMPION,
  sweepToSettled: HUE_SETTLED,
  settled: HUE_SETTLED,
};

// The background stays almost invisible under the overlay throughout --
// the champion card still backs off a touch further than the rest of the
// ceremony, since confetti plus the reveal card's own gradient text sit on
// top of it there.
const OVERLAY_ALPHA_REST = 0.85;
const OVERLAY_ALPHA_WINNER = 0.90;

export function BackgroundLayer({ backgroundSrc, showConfetti, confettiEntrance = false, confettiColors = GOLD_CONFETTI_COLORS, confettiSpeedMultiplier = 3, hueDeg = HUE_BRONZE, overlayAlpha = OVERLAY_ALPHA_REST }: Readonly<{
  backgroundSrc: string;
  showConfetti: boolean;
  confettiEntrance?: boolean;
  confettiColors?: readonly string[];
  confettiSpeedMultiplier?: number;
  hueDeg?: number;
  overlayAlpha?: number;
}>) {
  // Cross-fades between fixed hue values instead of animating the filter's
  // degree, which would sweep visibly through every hue in between (e.g.
  // bronze -> silver would pass through green/blue) rather than dissolving
  // directly from one settled color to the next. Each hue gets its own
  // persistent layer so its filter is applied once, while invisible, and
  // only opacity ever transitions -- reusing one element for both hues
  // made the color itself snap instantly and only the reveal fade smoothly.
  const idRef = useRef(0);
  const [layers, setLayers] = useState(() => [{ id: idRef.current, hue: hueDeg }]);
  const [topId, setTopId] = useState(0);

  useEffect(() => {
    setLayers(prev => {
      if (prev[prev.length - 1].hue === hueDeg) return prev;
      idRef.current += 1;
      return [...prev, { id: idRef.current, hue: hueDeg }];
    });
  }, [hueDeg]);

  useEffect(() => {
    const newest = layers[layers.length - 1];
    if (newest.id === topId) return;
    const raf = requestAnimationFrame(() => setTopId(newest.id));
    return () => cancelAnimationFrame(raf);
  }, [layers, topId]);

  return (
    <>
      {layers.map(layer => (
        <img
          key={layer.id}
          src={backgroundSrc}
          alt=""
          aria-hidden="true"
          style={{
            position: 'fixed', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 0,
            filter: `hue-rotate(${layer.hue}deg)`,
            opacity: layer.id === topId ? 1 : 0, transition: 'opacity 1.5s ease',
          }}
          onTransitionEnd={() => {
            if (layer.id !== topId) return;
            setLayers(prev => (prev.length > 1 ? [prev[prev.length - 1]] : prev));
          }}
        />
      ))}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{ backgroundColor: `rgba(8,8,18,${overlayAlpha})`, backdropFilter: 'blur(48px)', zIndex: 1, transition: 'background-color 1.5s ease' }}
      />
      {showConfetti && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 2, pointerEvents: 'none', filter: 'blur(10px)',
            animation: confettiEntrance ? 'championConfettiIn 1.15s cubic-bezier(0.16, 1, 0.3, 1) both' : undefined,
          }}
        >
          <ConfettiBackground burst persistAfterBurst speedMultiplier={confettiSpeedMultiplier} colors={confettiColors} />
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
  // Once a card has counted up, it keeps showing its resolved score while
  // fading out for the next rank's sweep -- without this, the score element
  // unmounts back to a literal 0 mid-fade, flashing every player's score to
  // zero for the ~0.5s the card is still visible via its opacity transition.
  const hasRevealedRef = useRef(false);
  if (visible) hasRevealedRef.current = true;
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
        {hasRevealedRef.current ? <AnimatedPodiumScore score={entry.score} instant={!visible || reducedMotion} champion={champion} /> : 0}
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

// ─── Settled: one unified recap panel ──────────────────────────────────────
// The whole settled screen -- podium, standings, awards -- lives inside a
// single liquid-glass surface instead of a stack of separately-boxed cards.
// The library measures/centers its glass content once on mount rather than
// tracking layout live (see StableLiquidGlass.tsx), so the wrapper's height
// is an estimate computed from actual row counts up front, matching the
// cardHeight-prop idiom RevealView.tsx already uses for the same reason.

const PANEL_PAD_V = 56;
const PANEL_TITLE_H = 44;
const PANEL_PODIUM_H = 224;
const PANEL_SECTION_GAP = 26;
export const STANDINGS_ROW_H = 46;
export const AWARD_ROW_H = 62;

export function estimatePanelHeight(sectionHeights: number[]): number {
  const present = sectionHeights.filter(h => h > 0);
  const gaps = Math.max(0, present.length - 1) * PANEL_SECTION_GAP;
  return PANEL_PAD_V + present.reduce((a, b) => a + b, 0) + gaps;
}

// Rank badge for a plain list row: ranks 1-3 get a small tinted numeral
// (echoing the podium riser's own numeral) rather than the mid-game
// leaderboard's medal emoji, which reads inconsistently against this
// screen's custom gradient/glass look. Rank 4+ is a plain "#N", matching how
// this screen has always shown the rest of the field.
export function RankMark({ rank }: Readonly<{ rank: number }>) {
  if (rank >= 1 && rank <= 3) {
    const { tint } = RANK_STYLE[rank as PodiumRank];
    return (
      <span
        className="rank-mark"
        style={{
          background: `color-mix(in srgb, ${tint} 22%, transparent)`,
          border: `1px solid color-mix(in srgb, ${tint} 45%, transparent)`,
          color: tint,
        }}
      >
        {rank}
      </span>
    );
  }
  return <span className="rank-mark rank-mark-plain">#{rank}</span>;
}

// One step of the recap podium -- name/score float above the step itself,
// which carries the rank's tinted glass glow and a big translucent rank
// numeral, so the block reads as an actual podium riser rather than a card.
// The champion's name borrows the cinematic reveal's own gradient (at a
// smaller scale) so the recap reads as a continuation of the ceremony that
// just played, not an unrelated summary screen.
function PodiumSpot({ rank, entry, delay }: Readonly<{ rank: PodiumRank; entry: LeaderboardEntry; delay: number }>) {
  const { tint, gradient } = RANK_STYLE[rank];
  const champion = rank === 1;
  return (
    <div className="podium-spot">
      <span
        className={champion ? 'font-black' : 'font-bold'}
        style={{
          fontFamily: champion ? "'Montserrat', sans-serif" : undefined,
          fontSize: champion ? '1.32rem' : '1rem',
          maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          ...(champion
            ? { background: gradient, WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent' }
            : { color: '#fff' }),
        }}
      >
        {entry.name}
      </span>
      <span className="tabular-nums" style={{ fontWeight: 800, fontSize: champion ? '0.98rem' : '0.86rem', color: 'rgba(255,255,255,0.65)' }}>
        {entry.score.toLocaleString()}
      </span>
      <div
        className="podium-riser"
        style={{
          minHeight: `${PODIUM_STEP_HEIGHTS[rank]}px`,
          background: `linear-gradient(180deg, color-mix(in srgb, ${tint} 30%, transparent), color-mix(in srgb, ${tint} 5%, transparent))`,
          border: `1px solid color-mix(in srgb, ${tint} 40%, transparent)`,
          boxShadow: `0 0 22px -6px color-mix(in srgb, ${tint} 60%, transparent) inset`,
          animationDelay: `${delay}ms`,
        }}
      >
        <span className="font-black" style={{ fontSize: champion ? '1.7rem' : '1.3rem', color: `color-mix(in srgb, ${tint} 70%, white)`, opacity: 0.85 }}>
          {rank}
        </span>
      </div>
    </div>
  );
}

function PodiumRow({ podium }: Readonly<{ podium: LeaderboardEntry[] }>) {
  return (
    <div className="podium-row">
      {([2, 1, 3] as const).map((rank, i) => {
        const entry = podium[rank - 1];
        return entry ? <PodiumSpot key={rank} rank={rank} entry={entry} delay={i * 110} /> : <div key={rank} style={{ flex: 1 }} />;
      })}
    </div>
  );
}

// Shared by both the host's rest-of-field rows and the player's full
// standings list -- one row shape for "everyone not on the podium spotlight"
// rather than a card grid on one screen and a different row style on the
// other.
export function ResultRow({ entry, isMe, delay }: Readonly<{ entry: LeaderboardEntry; isMe: boolean; delay?: number }>) {
  return (
    <div
      className={`standings-row${isMe ? ' standings-row-me' : ''}`}
      style={{ animation: delay != null ? `resultRowIn 0.4s cubic-bezier(0.16,1,0.3,1) ${delay}ms both` : undefined }}
    >
      <RankMark rank={entry.rank} />
      <span className="text-white font-bold flex-1 truncate" style={{ fontSize: '0.92rem' }}>
        {entry.name}
        {isMe && <span className="standings-you-tag">YOU</span>}
      </span>
      <span className="standings-row-score tabular-nums">{entry.score.toLocaleString()}</span>
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
  const settling = stage === 'sweepToSettled';
  const dark = stage === 'dark';
  const showConfetti = !reducedMotion && (stage === 'gold' || settling || settled);
  // Set to true to restore the EQ strip after this no-strip visual comparison.
  const showEq = false;
  const confettiSpeedMultiplier = settling || settled ? 1 : 3;
  const confettiColors = settled ? CONFETTI_COLORS : GOLD_CONFETTI_COLORS;
  const hueDeg = STAGE_HUE[stage];
  const overlayAlpha = stage === 'gold' ? OVERLAY_ALPHA_WINNER : OVERLAY_ALPHA_REST;
  const panelHeight = estimatePanelHeight([
    PANEL_TITLE_H,
    PANEL_PODIUM_H,
    rest.length > 0 ? rest.length * STANDINGS_ROW_H : 0,
    awards.length > 0 ? awards.length * AWARD_ROW_H : 0,
  ]);

  return (
    <div className="relative min-h-screen flex flex-col p-6 gap-4">
      <BackgroundLayer
        backgroundSrc={backgroundSrc}
        showConfetti={showConfetti}
        confettiEntrance={stage === 'gold'}
        confettiColors={confettiColors}
        confettiSpeedMultiplier={confettiSpeedMultiplier}
        hueDeg={hueDeg}
        overlayAlpha={overlayAlpha}
      />
      {showEq && <EqStrip stage={stage} reducedMotion={reducedMotion} />}

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
        <div className="relative z-10 flex flex-col flex-1 min-h-0 gap-4">
          <div
            className="relative z-10 flex-1 min-h-0 overflow-y-auto flex"
            style={{ animation: 'settledIn 0.5s cubic-bezier(0.16,1,0.3,1) 0.1s both' }}
          >
            <div className="liquid-btn relative" style={{ width: 'min(94vw, 720px)', height: `${panelHeight}px`, margin: 'auto' }}>
              <LiquidGlass
                style={{ position: 'absolute', top: '50%', left: '50%' }}
                {...LIQUID_CARD_PROPS}
                elasticity={0}
                cornerRadius={28}
                padding="32px 32px 26px"
              >
                <div style={{ width: 'min(88vw, 656px)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '22px' }}>
                  <h2 className="recap-title">Final Results</h2>
                  <PodiumRow podium={podium} />
                  {rest.length > 0 && (
                    <>
                      <div className="panel-divider" />
                      <div className="standings-list" style={{ width: '100%' }}>
                        {rest.map((entry, i) => <ResultRow key={entry.name} entry={entry} isMe={false} delay={i * 60} />)}
                      </div>
                    </>
                  )}
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

          <div className="flex justify-center" style={{ animation: 'settledIn 0.5s cubic-bezier(0.16,1,0.3,1) 0.4s both' }}>
            {footer}
          </div>
        </div>
      )}
    </div>
  );
}
