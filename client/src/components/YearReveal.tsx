import { useEffect, useState } from 'react';
import type { RoundResultEvent } from '../types';
import { REEL_STEPS_MS, REEL_LAND_MS, useRevealReelSound } from '../hooks/useRevealReelSound';
import type { RevealHitTier } from '../hooks/useRevealReelSound';
import { runWhenVisible } from '../hooks/runWhenVisible';
import type { CardSqueeze } from './revealSqueeze';
import { cardContentWidth } from './revealSqueeze';

function squeezeValueWithMid<T>(layout: { ultra: boolean; mid: boolean; compact: boolean }, values: { ultra: T; midCompact: T; mid: T; compact: T; regular: T }): T {
  const { ultra, mid, compact } = layout;
  const { ultra: ultraValue, midCompact: midCompactValue, mid: midValue, compact: compactValue, regular: regularValue } = values;
  if (ultra) return ultraValue;
  if (mid && compact) return midCompactValue;
  if (mid) return midValue;
  if (compact) return compactValue;
  return regularValue;
}

function timelinePixelWidth(ultra: boolean, landscape: boolean): number {
  if (ultra && landscape) return 380;
  return ultra ? 260 : 300;
}

function timelineDisplayWidth(ultra: boolean, landscape: boolean): string {
  if (ultra && landscape) return 'min(90vw, 420px)';
  if (ultra) return 'min(88vw, 300px)';
  return 'min(84vw, 330px)';
}

function coverBorderRadius(mid: boolean, ultra: boolean, compact: boolean): string {
  if (mid || ultra) return '12px';
  if (compact) return '16px';
  return '12px';
}

type TimelineLabel = { xPct: number; label: string; fontPx: number };
type YearGuess = NonNullable<RoundResultEvent['yearResults']>[number];
type TimelineGroup = { guess: number; entries: YearGuess[] };
type TimelineMarkerPalette = { nameColor: string; nameWeight: number; dotBackground: string; dotBorder: string; dotAnimation: string; yearColor: string; yearWeight: number };

function packTimelineLanes(items: TimelineLabel[], timelinePx: number): number[] {
  const laneEnds: number[] = [];
  return items.map(({ xPct, label, fontPx }) => {
    const xPx = (xPct / 100) * timelinePx;
    const halfWidth = (label.length * fontPx * 0.58 + 4) / 2;
    const left = xPx - halfWidth;
    const right = xPx + halfWidth;
    let lane = 0;
    while (lane < laneEnds.length && left < laneEnds[lane] + 6) lane++;
    laneEnds[lane] = right;
    return lane;
  });
}

function groupYearGuesses(guesses: YearGuess[]): TimelineGroup[] {
  const groups: TimelineGroup[] = [];
  for (const guess of guesses) {
    const existing = groups.find(group => group.guess === guess.guess);
    if (existing) existing.entries.push(guess);
    else groups.push({ guess: guess.guess!, entries: [guess] });
  }
  return groups.sort((a, b) => a.guess - b.guess);
}

function timelineMetrics(year: number, guesses: YearGuess[], ultra: boolean, landscape: boolean) {
  const minGuess = Math.min(...guesses.map(guess => guess.guess!));
  const maxGuess = Math.max(...guesses.map(guess => guess.guess!));
  const min = Math.min(year, minGuess);
  const max = Math.max(year, maxGuess);
  const pos = (value: number) => (max === min ? 50 : 11 + ((value - min) / (max - min)) * 78);
  const groups = groupYearGuesses(guesses);
  const timelinePx = timelinePixelWidth(ultra, landscape);
  const nameLanes = packTimelineLanes(groups.map(group => ({ xPct: pos(group.guess), label: group.entries.map(entry => entry.name).join(', '), fontPx: ultra ? 8.6 : 9.9 })), timelinePx);
  const nonExactGroups = groups.filter(group => group.guess !== year);
  const yearLaneByGuess = new Map<number, number>();
  packTimelineLanes(nonExactGroups.map(group => ({ xPct: pos(group.guess), label: String(group.guess), fontPx: ultra ? 8.3 : 9.6 })), timelinePx).forEach((lane, index) => {
    yearLaneByGuess.set(nonExactGroups[index].guess, lane);
  });
  const maxNameLane = Math.max(0, ...nameLanes);
  const maxYearLane = Math.max(0, ...yearLaneByGuess.values());
  const nameLaneStep = ultra ? 11 : 13;
  const yearLaneStep = ultra ? 10 : 12;
  return {
    groups, maxNameLane, maxYearLane, nameLaneByGuess: new Map(groups.map((group, index) => [group.guess, nameLanes[index]])),
    nameLaneStep, nonExactGroups, pos, timelineHeight: (ultra ? 70 : 96) + maxNameLane * nameLaneStep + maxYearLane * yearLaneStep,
    yearLaneByGuess, yearLaneStep,
  };
}

function timelineMarkerLayout(group: TimelineGroup, ultra: boolean, isBest: boolean, nameLaneByGuess: Map<number, number>, nameLaneStep: number, yearLaneByGuess: Map<number, number>, yearLaneStep: number) {
  const baseOffset = ultra ? 10 : 13;
  let size: number;
  if (isBest) {
    size = ultra ? 8 : 10;
  } else {
    size = ultra ? 5 : 6;
  }
  return {
    dotSize: size,
    markerTop: ultra ? 32 : 43,
    nameFontSize: ultra ? '0.54rem' : '0.62rem',
    nameOffset: baseOffset + (nameLaneByGuess.get(group.guess) ?? 0) * nameLaneStep,
    yearFontSize: ultra ? '0.52rem' : '0.6rem',
    yearOffset: baseOffset + (yearLaneByGuess.get(group.guess) ?? 0) * yearLaneStep,
  };
}

function timelineMarkerPalette(isBest: boolean, winnerColor: string, winnerColorSoft: string, winnerGlowAnim: string, delayS: number): TimelineMarkerPalette {
  if (isBest) {
    return {
      nameColor: winnerColor, nameWeight: 800, dotBackground: winnerColor, dotBorder: '2px solid rgba(255,255,255,0.5)',
      dotAnimation: `${winnerGlowAnim} 1.8s ease-in-out ${delayS + 0.65}s infinite`, yearColor: winnerColorSoft, yearWeight: 700,
    };
  }
  return {
    nameColor: 'rgba(255,255,255,0.55)', nameWeight: 600, dotBackground: 'rgba(255,255,255,0.5)', dotBorder: 'none',
    dotAnimation: 'none', yearColor: 'rgba(255,255,255,0.45)', yearWeight: 500,
  };
}

function shouldUseCompactTimeline(year: number | null, guessCount: number, ultra: boolean, landscape: boolean): boolean {
  return !year || guessCount === 0 || (ultra && landscape);
}

function timelineColors(exactMatch: boolean) {
  if (exactMatch) return { winnerColor: '#fbbf24', winnerColorSoft: 'rgba(251,191,36,0.85)', winnerGlowAnim: 'markerGlowPulse' };
  return { winnerColor: '#4ade80', winnerColorSoft: 'rgba(74,222,128,0.85)', winnerGlowAnim: 'markerGlowPulseGreen' };
}

function TimelineMarker({
  group, delayS, isBest, year, pos, ultra, nameLaneByGuess, nameLaneStep, yearLaneByGuess, yearLaneStep,
  winnerColor, winnerColorSoft, winnerGlowAnim, showGuessValues,
}: Readonly<{
  group: TimelineGroup; delayS: number; isBest: boolean; year: number; pos: (value: number) => number; ultra: boolean;
  nameLaneByGuess: Map<number, number>; nameLaneStep: number; yearLaneByGuess: Map<number, number>; yearLaneStep: number;
  winnerColor: string; winnerColorSoft: string; winnerGlowAnim: string; showGuessValues: boolean;
}>) {
  const isExact = group.guess === year;
  const names = group.entries.map(entry => entry.name).join(', ');
  const layout = timelineMarkerLayout(group, ultra, isBest, nameLaneByGuess, nameLaneStep, yearLaneByGuess, yearLaneStep);
  const palette = timelineMarkerPalette(isBest, winnerColor, winnerColorSoft, winnerGlowAnim, delayS);
  return (
    <div style={{ position: 'absolute', left: `${pos(group.guess)}%`, top: `${layout.markerTop}px`, transform: 'translate(-50%, -50%)', animationName: isBest ? 'winnerMarkerLand' : 'markerCelebrate', animationDuration: isBest ? '0.65s' : '0.5s', animationTimingFunction: 'ease-out', animationFillMode: 'both', animationDelay: `${delayS}s` }}>
      <span style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', bottom: `${layout.nameOffset}px`, fontSize: layout.nameFontSize, whiteSpace: 'nowrap', color: palette.nameColor, fontWeight: palette.nameWeight }}>{names}</span>
      <div style={{ width: `${layout.dotSize}px`, height: `${layout.dotSize}px`, borderRadius: '50%', background: palette.dotBackground, border: palette.dotBorder, animation: palette.dotAnimation }} />
      {showGuessValues && !isExact && (
        <span style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: `${layout.yearOffset}px`, fontSize: layout.yearFontSize, whiteSpace: 'nowrap', color: palette.yearColor, fontWeight: palette.yearWeight }}>{group.guess}</span>
      )}
    </div>
  );
}

// Spot-on year guesses get a beefier hit than the routine reveal — and a
// second exact guess (rare — two people landing the exact year) bumps it
// again, same "rarer roll, bigger sting" idea as the mystery multiplier tiers.
function pickYearHitTier(result: RoundResultEvent): RevealHitTier {
  const exactCount = result.yearResults?.filter(r => r.diff === 0).length ?? 0;
  if (exactCount > 1) return 3;
  if (exactCount === 1) return 2;
  return 1;
}

// The "guess the year" reveal: a slot-reel that lands on the real year, and
// the timeline that then builds in underneath it showing where everyone's
// guesses fell. Used by both the host and player reveal screens, and by
// RevealShared's final-round card.

// Total time (ms) from mount until the year lands — YearTimelineContent
// times its marker entrances to start after this, so the timeline builds in
// as a second beat once the year itself has landed, not simultaneously.
export const YEAR_LAND_MS = REEL_LAND_MS;

const CURRENT_YEAR = new Date().getFullYear();

// Always noticeably wrong (4-53 years off) so no decoy could be mistaken for
// the real answer mid-flicker. Never flickers past the real current year —
// no song has been released in the future, so an "up" jitter that would
// cross it falls back to "down" instead.
function pickYearCandidate(real: number): number {
  const r = new Uint32Array(2);
  crypto.getRandomValues(r);
  const jitter = 4 + (r[0] % 50);
  const goUp = r[1] % 2 === 0 && real + jitter <= CURRENT_YEAR;
  return goUp ? real + jitter : real - jitter;
}

// The "year was" label + big gradient number, wrapped in the same pill-chip
// container and spin/land/flash/burst animation set as the mystery multiplier
// chip (RoundIntro.tsx) so both "hidden number" reveals feel like one system.
// Skipped for the '-'/'–' placeholder shown when there's no year data. Shared
// by the compact no-timeline fallback card and the full timeline card, which
// only differ in sizing. `muted` skips the reveal SFX — both host and player
// devices render this reel, but on the same table/room they'd otherwise both
// play reveal_rise/reveal_hit at once, so only the host's copy sounds.
export function YearHeading({ year, compact, muted = false, hitTier = 1, squeeze }: Readonly<{ year: number | string; compact: boolean; muted?: boolean; hitTier?: RevealHitTier; squeeze?: CardSqueeze }>) {
  const isNumber = typeof year === 'number';
  const [display, setDisplay] = useState<number | string>(year);
  const [tick, setTick] = useState(0);
  const [landed, setLanded] = useState(!isNumber);
  const playReveal = useRevealReelSound();
  // Squeeze's own compact/ultraCompact tiers (window-height driven) are a
  // separate axis from this component's `compact` prop (which tier of card
  // — the no-timeline mini card vs the full timeline — it's rendered on),
  // so both stack: squeeze shrinks further on top of whatever `compact`
  // already picked.
  const { compact: mid = false, ultraCompact: ultra = false } = squeeze ?? {};
  const layout = { ultra, mid, compact };
  const headingMargin = squeezeValueWithMid(layout, { ultra: '6px', midCompact: '12px', mid: '12px', compact: '8px', regular: '22px' });
  const headingFontSize = squeezeValueWithMid(layout, { ultra: compact ? '1.9rem' : '1.6rem', midCompact: '2.3rem', mid: '2rem', compact: '2.6rem', regular: '2.2rem' });
  const headingMinWidth = squeezeValueWithMid(layout, { ultra: '110px', midCompact: '130px', mid: '130px', compact: '160px', regular: '140px' });

  useEffect(() => {
    if (!isNumber) { setDisplay(year); setLanded(true); return; }
    if (globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDisplay(year);
      setLanded(true);
      return;
    }
    setLanded(false);
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    // Waits for the tab to actually be visible before playing the SFX or
    // starting the flicker: starting either while backgrounded either feeds a
    // suspended AudioContext (rise/hit end up bursting out together on
    // refocus instead of landing REEL_SEC apart) or gets the flicker's
    // setTimeout chain throttled and stretched out, so the reel looks stuck.
    const stopWaiting = runWhenVisible(() => {
      if (cancelled) return;
      if (!muted) playReveal(hitTier);
      let i = 0;
      const step = () => {
        if (cancelled) return;
        if (i >= REEL_STEPS_MS.length) {
          setDisplay(year);
          setLanded(true);
          return;
        }
        setDisplay(pickYearCandidate(year));
        setTick(t => t + 1);
        timer = setTimeout(step, REEL_STEPS_MS[i]);
        i++;
      };
      step();
    });
    // React Strict Mode intentionally cleans up and restarts effects in
    // development. Let the restarted effect own a fresh timer: suppressing
    // it after the first pass leaves the randomly chosen decoy on screen,
    // blurred forever, and makes every device show a different "answer".
    return () => { cancelled = true; clearTimeout(timer); stopWaiting(); };
  }, [year, isNumber, muted, hitTier, playReveal]);

  // Same land animation as the mystery chip's non-jackpot roll: flash + a
  // one-shot ring burst off the chip's own box-shadow, so landing on the
  // year reads as a payoff rather than the label just changing.
  const landAnimation = 'slotLand 0.6s cubic-bezier(0.34, 1.56, 0.64, 1), slotFlash 0.7s ease-out, slotLandBurst 0.6s ease-out';
  let containerAnimation: string | undefined;
  if (isNumber) containerAnimation = landed ? landAnimation : 'slotSpinTick 0.14s ease-out';

  return (
    <span
      // A fresh key per flicker tick (and a distinct one on landing) forces
      // the animation to restart on every value change instead of continuing
      // a stale one — a plain style-string diff wouldn't retrigger it. Key
      // lives on the chip so the container's spin/land animation and the
      // value text's reel animation restart in lockstep, same as the mystery
      // chip.
      key={landed ? `landed-${year}` : `spin-${tick}`}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px',
        marginBottom: headingMargin,
        animation: containerAnimation,
      }}
    >
      <span style={{
        color: 'rgba(94,234,212,0.9)', fontSize: ultra ? '0.56rem' : '0.62rem', fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase',
      }}>
        The year was
      </span>
      <span style={{
        fontSize: headingFontSize,
        fontWeight: 900, lineHeight: 1, textAlign: 'center',
        background: 'linear-gradient(to bottom left, rgba(0,238,232,0.5) 0%, transparent 55%), linear-gradient(to top right, rgba(158,18,204,0.5) 0%, transparent 55%), #fff',
        WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
        display: 'inline-block', minWidth: headingMinWidth,
        // Decoys move through the reel sharply but briefly and dimly. That
        // makes the resolving state clear without blurring the answer text.
        animation: isNumber && !landed ? 'slotReelTick 0.14s ease-out' : undefined,
      }}>
        {display}
      </span>
    </span>
  );
}

// Cover art + title + artist footer shared by the same two year cards.
export function YearSongFooter({ result, compact, squeeze }: Readonly<{ result: RoundResultEvent; compact: boolean; squeeze?: CardSqueeze }>) {
  const { compact: mid = false, ultraCompact: ultra = false, landscape = false } = squeeze ?? {};
  const layout = { ultra, mid, compact };
  const coverSize = squeezeValueWithMid(layout, { ultra: 64, midCompact: 130, mid: 110, compact: 170, regular: 140 });
  const titleFontSize = squeezeValueWithMid(layout, { ultra: '0.85rem', midCompact: '0.98rem', mid: '0.9rem', compact: '1.05rem', regular: '0.95rem' });
  const artistFontSize = squeezeValueWithMid(layout, { ultra: '0.7rem', midCompact: '0.8rem', mid: '0.76rem', compact: '0.85rem', regular: '0.8rem' });

  const textBlock = (
    <>
      <span style={{ color: 'white', fontWeight: 900, fontSize: titleFontSize, lineHeight: 1.3, display: 'inline-block', minWidth: ultra ? '0' : '220px' }}>
        {result.songTitle}
      </span>
      <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: artistFontSize, marginTop: '3px', display: 'inline-block', minWidth: ultra ? '0' : '220px' }}>
        {result.artist}
      </span>
    </>
  );

  // Same idea as SongInfo's landscape branch in RevealShared.tsx: a
  // landscape phone has width to spare even at the tightest squeeze, so the
  // cover sits beside the text instead of above it, dropping the cover's own
  // height out of the vertical stack entirely.
  if (ultra && landscape && result.coverUrl) {
    return (
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '10px', width: '100%', textAlign: 'left' }}>
        <img
          src={result.coverUrl} alt="Album art"
          style={{ width: `${coverSize}px`, height: `${coverSize}px`, borderRadius: '12px', objectFit: 'cover', flexShrink: 0, boxShadow: '0 10px 36px rgba(0,0,0,0.65)' }}
        />
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', lineHeight: 1.3 }}>{textBlock}</span>
      </div>
    );
  }

  return (
    <>
      {result.coverUrl && (
        <img
          src={result.coverUrl} alt="Album art"
          style={{
            width: `${coverSize}px`, height: `${coverSize}px`,
            borderRadius: coverBorderRadius(mid, ultra, compact), objectFit: 'cover', marginBottom: ultra ? '6px' : '12px',
            boxShadow: '0 10px 36px rgba(0,0,0,0.65)',
          }}
        />
      )}
      {textBlock}
    </>
  );
}

// Winner line + divider + song footer for the compact "guess the year" card
// — everything below YearHeading. Split out so YearTimelineContent can render
// this behind the same YearHeading instance it already mounted for the full
// timeline, instead of swapping in a whole separate YearCardContent element
// (see the comment on isCompactFallback there for why that swap matters).
function YearCardBody({ result, squeeze }: Readonly<{ result: RoundResultEvent; squeeze?: CardSqueeze }>) {
  const { ultraCompact: ultra = false } = squeeze ?? {};
  const winner = result.yearResults?.find(r => r.diff !== null);
  const bestDiff = winner?.diff ?? null;
  const winnerNames = bestDiff === null ? [] : (result.yearResults ?? []).filter(r => r.diff === bestDiff).map(r => r.name);
  const pluralS = bestDiff === 1 ? '' : 's';
  const winnerDetail = winner && (bestDiff === 0 ? ' · exact!' : ` (${bestDiff} year${pluralS} off)`);
  return (
    <>
      {winner && (
        <span style={{
          color: 'rgba(255,255,255,0.5)', fontSize: ultra ? '0.72rem' : '0.82rem', marginBottom: ultra ? '8px' : '12px', display: 'inline-block', minWidth: ultra ? '0' : '200px',
          // Waits for the year chip above to finish its own reveal (YearHeading)
          // so "who won" reads as the payoff of that reveal, not a
          // simultaneous, unrelated line of text.
          animation: `fadeIn 0.4s ease-out ${(YEAR_LAND_MS + 150) / 1000}s both`,
        }}>
          {winnerNames.join(', ')} {winnerNames.length === 1 ? 'was' : 'were'} closest{winnerDetail}
        </span>
      )}
      <div style={{ width: '100%', height: '1px', background: 'rgba(255,255,255,0.08)', marginBottom: ultra ? '8px' : '12px' }} />
      <YearSongFooter result={result} compact squeeze={squeeze} />
    </>
  );
}

// Party "guess the year" rounds: the answer is a number, so the card leads
// with the year and the closest player instead of a got-it/no-one-got-it state.
export function YearCardContent({ result, muted = false, squeeze }: Readonly<{ result: RoundResultEvent; muted?: boolean; squeeze?: CardSqueeze }>) {
  return (
    <div style={{ width: cardContentWidth(squeeze), display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
      <YearHeading year={result.year ? Math.floor(result.year) : '–'} compact muted={muted} hitTier={pickYearHitTier(result)} squeeze={squeeze} />
      <YearCardBody result={result} squeeze={squeeze} />
    </div>
  );
}

// How many extra vertical lanes the timeline's name/year labels need to
// stack into to avoid overlapping, for this round's actual guesses — the
// same greedy interval-packing YearTimelineContent uses internally to
// position its labels (kept in sync manually; the packing math itself is
// cheap and self-contained enough that duplicating it here beats threading
// a whole layout object out of the component). host/RevealView.tsx's
// cardHeight budget (computeYearCardHeight) adds this on top of its base
// per-tier number — a crowded round with several close, distinct guesses
// (the "crowd" screenshot fixture: 5+ guesses spanning a handful of years)
// needs real extra room, and StableLiquidGlass centers its measured content
// inside our declared box — so underbudgeting doesn't just clip, it pushes
// the card upward past the box's top edge and into the round counter above.
export function yearTimelineLaneCounts(result: RoundResultEvent, squeeze?: CardSqueeze): { nameLanes: number; yearLanes: number } {
  const { ultraCompact: ultra = false, landscape = false } = squeeze ?? {};
  const year = result.year ? Math.floor(result.year) : null;
  const guesses = (result.yearResults ?? []).filter(r => r.guess !== null);
  if (!year || guesses.length === 0) return { nameLanes: 0, yearLanes: 0 };

  const { maxNameLane, maxYearLane } = timelineMetrics(year, guesses, ultra, landscape);
  return { nameLanes: maxNameLane, yearLanes: maxYearLane };
}

export function YearTimelineContent({ result, showGuessValues = true, muted = false, squeeze }: Readonly<{ result: RoundResultEvent; showGuessValues?: boolean; muted?: boolean; squeeze?: CardSqueeze }>) {
  if (!result.yearResults) return null;
  const { ultraCompact: ultra = false, landscape = false } = squeeze ?? {};

  const year = result.year ? Math.floor(result.year) : null;
  const guesses = result.yearResults.filter(r => r.guess !== null);
  // A landscape phone's short window can't fit the full timeline chart
  // *and* the roster/next-round button below it, no matter how tightly the
  // chart itself is budgeted — there just isn't enough combined height (see
  // computeYearCardHeight in host/RevealView.tsx, which budgets for this
  // exact fallback rather than the chart). Falls back to the same compact
  // summary used when there's no guess data to chart at all.
  //
  // Rendered as YearHeading's own `compact` prop, with YearHeading kept as
  // this div's first child in both branches below — rather than returning a
  // separate <YearCardContent> element, which is a different component type
  // at the same tree position. A resize that crosses the ultraCompact+
  // landscape threshold mid-round (e.g. rotating a phone) flips this same
  // way; swapping component types there would unmount/remount YearHeading
  // and replay its slot-reel + SFX for a round the player already saw land.
  const isCompactTimeline = shouldUseCompactTimeline(year, guesses.length, ultra, landscape);
  const heading = (
    <YearHeading
      year={year ?? '–'}
      compact={isCompactTimeline}
      muted={muted}
      hitTier={pickYearHitTier(result)}
      squeeze={squeeze}
    />
  );
  if (isCompactTimeline) {
    return (
      <div style={{ width: cardContentWidth(squeeze), display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
        {heading}
        <YearCardBody result={result} squeeze={squeeze} />
      </div>
    );
  }
  if (year === null) return null;

  const bestDiff = result.yearResults.find(r => r.diff !== null)?.diff ?? null;
  const {
    groups, maxYearLane, nameLaneByGuess, nameLaneStep, pos,
    timelineHeight, yearLaneByGuess, yearLaneStep,
  } = timelineMetrics(year, guesses, ultra, landscape);

  // Someone nailed the year exactly — the actual-year tick and its label
  // pick up the same gold as the winning dot, instead of staying teal.
  const exactMatch = bestDiff === 0;
  // The winner's marker is gold only for a spot-on guess; otherwise "just
  // won" (closest, not exact) reads as the same green as a correct guess.
  const { winnerColor, winnerColorSoft, winnerGlowAnim } = timelineColors(exactMatch);

  const passCount = result.yearResults.length - guesses.length;

  // Same "hidden number resolves, then everything downstream reacts" beat as
  // the mystery multiplier chip (RoundIntro.tsx) — the timeline waits for
  // the year itself to finish its slot-reel reveal before building in,
  // rather than appearing simultaneously and racing it.
  const timelineRevealS = (YEAR_LAND_MS + 200) / 1000;
  // Ties land in different groups (grouped by guessed value, not by diff), so
  // find every group tied for the best diff rather than just the first.
  const bestGroups = groups.filter(g => bestDiff !== null && g.entries[0].diff === bestDiff);
  const otherGroups = groups.filter(g => !bestGroups.includes(g));
  const trackTop = ultra ? 32 : 43;
  const tickHeight = ultra ? 22 : 30;
  const markerYearFontSize = ultra ? '0.52rem' : '0.6rem';

  const timelineWidth = timelineDisplayWidth(ultra, landscape);

  return (
    <div style={{ width: timelineWidth, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
      {heading}

      {/* Timeline */}
      <div style={{ position: 'relative', width: '100%', height: `${timelineHeight}px`, marginBottom: ultra ? '4px' : '8px' }}>
        <div style={{ position: 'absolute', left: 0, right: 0, top: `${trackTop}px`, height: '3px', background: 'rgba(255,255,255,0.08)', borderRadius: '2px' }} />

        {/* Actual-year tick — fades in once the year number above has landed */}
        <div style={{
          position: 'absolute', left: `${pos(year)}%`, top: `${trackTop - tickHeight / 2}px`, transform: 'translateX(-50%)',
          width: '2px', height: `${tickHeight}px`, borderRadius: '1px',
          background: exactMatch ? 'rgba(251,191,36,0.7)' : 'rgba(0,238,232,0.5)',
          animation: `fadeIn 0.4s ease-out ${timelineRevealS}s both`,
        }} />
        <div style={{
          position: 'absolute', left: `${pos(year)}%`, top: `${trackTop + 23 + maxYearLane * yearLaneStep}px`, transform: 'translateX(-50%)',
          fontSize: markerYearFontSize, fontWeight: 700, whiteSpace: 'nowrap',
          color: exactMatch ? '#fbbf24' : 'rgba(94,234,212,0.9)',
          animation: `fadeIn 0.4s ease-out ${timelineRevealS}s both`,
        }}>
          {year}
        </div>

        {otherGroups.map((group, index) => (
          <TimelineMarker
            key={group.guess}
            group={group}
            delayS={timelineRevealS + index * 0.09}
            isBest={false}
            year={year}
            pos={pos}
            ultra={ultra}
            nameLaneByGuess={nameLaneByGuess}
            nameLaneStep={nameLaneStep}
            yearLaneByGuess={yearLaneByGuess}
            yearLaneStep={yearLaneStep}
            winnerColor={winnerColor}
            winnerColorSoft={winnerColorSoft}
            winnerGlowAnim={winnerGlowAnim}
            showGuessValues={showGuessValues}
          />
        ))}
        {bestGroups.map((group, index) => (
          <TimelineMarker
            key={group.guess}
            group={group}
            delayS={timelineRevealS + otherGroups.length * 0.09 + 0.25 + index * 0.09}
            isBest
            year={year}
            pos={pos}
            ultra={ultra}
            nameLaneByGuess={nameLaneByGuess}
            nameLaneStep={nameLaneStep}
            yearLaneByGuess={yearLaneByGuess}
            yearLaneStep={yearLaneStep}
            winnerColor={winnerColor}
            winnerColorSoft={winnerColorSoft}
            winnerGlowAnim={winnerGlowAnim}
            showGuessValues={showGuessValues}
          />
        ))}
      </div>

      {passCount > 0 && (
        <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: ultra ? '0.6rem' : '0.68rem', marginBottom: ultra ? '2px' : '4px' }}>
          {passCount} didn't guess
        </span>
      )}

      <div style={{ width: '100%', height: '1px', background: 'rgba(255,255,255,0.08)', marginTop: ultra ? '4px' : '8px', marginBottom: ultra ? '8px' : '12px' }} />
      <YearSongFooter result={result} compact={false} squeeze={squeeze} />
    </div>
  );
}
