import { useEffect, useState } from 'react';
import type { RoundResultEvent } from '../types';
import { REEL_STEPS_MS, REEL_LAND_MS, useRevealReelSound } from '../hooks/useRevealReelSound';
import type { RevealHitTier } from '../hooks/useRevealReelSound';
import { runWhenVisible } from '../hooks/runWhenVisible';
import type { CardSqueeze } from './revealSqueeze';
import { cardContentWidth } from './revealSqueeze';

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
        marginBottom: ultra ? '6px' : mid ? '12px' : compact ? '8px' : '22px',
        animation: containerAnimation,
      }}
    >
      <span style={{
        color: 'rgba(94,234,212,0.9)', fontSize: ultra ? '0.56rem' : '0.62rem', fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase',
      }}>
        The year was
      </span>
      <span style={{
        fontSize: ultra ? (compact ? '1.9rem' : '1.6rem') : mid ? (compact ? '2.3rem' : '2rem') : compact ? '2.6rem' : '2.2rem',
        fontWeight: 900, lineHeight: 1, textAlign: 'center',
        background: 'linear-gradient(to bottom left, rgba(0,238,232,0.5) 0%, transparent 55%), linear-gradient(to top right, rgba(158,18,204,0.5) 0%, transparent 55%), #fff',
        WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
        display: 'inline-block', minWidth: ultra ? '110px' : mid ? '130px' : compact ? '160px' : '140px',
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
  const coverSize = ultra ? 64 : mid ? (compact ? 130 : 110) : compact ? 170 : 140;
  const titleFontSize = ultra ? '0.85rem' : mid ? (compact ? '0.98rem' : '0.9rem') : compact ? '1.05rem' : '0.95rem';
  const artistFontSize = ultra ? '0.7rem' : mid ? (compact ? '0.8rem' : '0.76rem') : compact ? '0.85rem' : '0.8rem';

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
            borderRadius: mid || ultra ? '12px' : compact ? '16px' : '12px', objectFit: 'cover', marginBottom: ultra ? '6px' : '12px',
            boxShadow: '0 10px 36px rgba(0,0,0,0.65)',
          }}
        />
      )}
      {textBlock}
    </>
  );
}

// Party "guess the year" rounds: the answer is a number, so the card leads
// with the year and the closest player instead of a got-it/no-one-got-it state.
export function YearCardContent({ result, muted = false, squeeze }: Readonly<{ result: RoundResultEvent; muted?: boolean; squeeze?: CardSqueeze }>) {
  const { ultraCompact: ultra = false } = squeeze ?? {};
  const winner = result.yearResults?.find(r => r.diff !== null);
  const bestDiff = winner?.diff ?? null;
  const winnerNames = bestDiff === null ? [] : (result.yearResults ?? []).filter(r => r.diff === bestDiff).map(r => r.name);
  const pluralS = bestDiff === 1 ? '' : 's';
  const winnerDetail = winner && (bestDiff === 0 ? ' · exact!' : ` (${bestDiff} year${pluralS} off)`);
  return (
    <div style={{ width: cardContentWidth(squeeze), display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
      <YearHeading year={result.year ? Math.floor(result.year) : '–'} compact muted={muted} hitTier={pickYearHitTier(result)} squeeze={squeeze} />
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

  const minGuess = Math.min(...guesses.map(g => g.guess!));
  const maxGuess = Math.max(...guesses.map(g => g.guess!));
  const min = Math.min(year, minGuess);
  const max = Math.max(year, maxGuess);
  const pos = (y: number) => (max === min ? 50 : 11 + ((y - min) / (max - min)) * 78);

  const groups: { guess: number; entries: typeof guesses }[] = [];
  for (const r of guesses) {
    const existing = groups.find(g => g.guess === r.guess);
    if (existing) existing.entries.push(r);
    else groups.push({ guess: r.guess!, entries: [r] });
  }
  groups.sort((a, b) => a.guess - b.guess);

  const timelinePx = ultra && landscape ? 380 : ultra ? 260 : 300;
  const nameFontPx = ultra ? 8.6 : 9.9;
  const yearFontPx = ultra ? 8.3 : 9.6;
  const estimateWidth = (text: string, fontPx: number) => text.length * fontPx * 0.58 + 4;
  function packLanes(items: { xPct: number; label: string; fontPx: number }[]): number[] {
    const laneEnds: number[] = [];
    return items.map(({ xPct, label, fontPx }) => {
      const xPx = (xPct / 100) * timelinePx;
      const halfWidth = estimateWidth(label, fontPx) / 2;
      const left = xPx - halfWidth;
      const right = xPx + halfWidth;
      let lane = 0;
      while (lane < laneEnds.length && left < laneEnds[lane] + 6) lane++;
      laneEnds[lane] = right;
      return lane;
    });
  }
  const nameLanes = packLanes(groups.map(g => ({ xPct: pos(g.guess), label: g.entries.map(e => e.name).join(', '), fontPx: nameFontPx })));
  const nonExactGroups = groups.filter(g => g.guess !== year);
  const yearLanes = packLanes(nonExactGroups.map(g => ({ xPct: pos(g.guess), label: String(g.guess), fontPx: yearFontPx })));
  return { nameLanes: Math.max(0, ...nameLanes), yearLanes: Math.max(0, ...yearLanes) };
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
  if (!year || guesses.length === 0 || (ultra && landscape)) return <YearCardContent result={result} muted={muted} squeeze={squeeze} />;

  const minGuess = Math.min(...guesses.map(g => g.guess!));
  const maxGuess = Math.max(...guesses.map(g => g.guess!));
  const min = Math.min(year, minGuess);
  const max = Math.max(year, maxGuess);
  // Everyone (including the actual year) landed on the same value — nothing
  // to spread across the line, so just center the single marker.
  const pos = (y: number) => (max === min ? 50 : 11 + ((y - min) / (max - min)) * 78);

  // Server presorts yearResults by diff ascending, so the first non-null diff is the best.
  const bestDiff = result.yearResults.find(r => r.diff !== null)?.diff ?? null;

  // Group by identical guess so ties share one marker instead of overlapping dots.
  const groups: { guess: number; entries: typeof guesses }[] = [];
  for (const r of guesses) {
    const existing = groups.find(g => g.guess === r.guess);
    if (existing) existing.entries.push(r);
    else groups.push({ guess: r.guess!, entries: [r] });
  }
  groups.sort((a, b) => a.guess - b.guess);

  // Two guesses close but not identical (e.g. 1983 vs 1984) can still crowd
  // each other's labels even though their dots are distinct. Pack each row
  // (names above, years below) into the fewest vertical lanes needed so no
  // two labels in the same row overlap horizontally — a classic greedy
  // interval-scheduling sweep over items already sorted by x position.
  // Approximate rendered width, just for spacing math — matches the width
  // this content div actually renders at each squeeze tier (see the `width`
  // style on the returned div below).
  const TIMELINE_PX = ultra && landscape ? 380 : ultra ? 260 : 300;
  const nameFontPx = ultra ? 8.6 : 9.9;
  const yearFontPx = ultra ? 8.3 : 9.6;
  const estimateWidth = (text: string, fontPx: number) => text.length * fontPx * 0.58 + 4;
  function packLanes(items: { xPct: number; label: string; fontPx: number }[]): number[] {
    const laneEnds: number[] = [];
    return items.map(({ xPct, label, fontPx }) => {
      const xPx = (xPct / 100) * TIMELINE_PX;
      const halfWidth = estimateWidth(label, fontPx) / 2;
      const left = xPx - halfWidth;
      const right = xPx + halfWidth;
      let lane = 0;
      while (lane < laneEnds.length && left < laneEnds[lane] + 6) lane++;
      laneEnds[lane] = right;
      return lane;
    });
  }
  const nameLanes = packLanes(groups.map(g => ({ xPct: pos(g.guess), label: g.entries.map(e => e.name).join(', '), fontPx: nameFontPx })));
  const nonExactGroups = groups.filter(g => g.guess !== year);
  const yearLaneByGuess = new Map<number, number>();
  packLanes(nonExactGroups.map(g => ({ xPct: pos(g.guess), label: String(g.guess), fontPx: yearFontPx }))).forEach((lane, i) => {
    yearLaneByGuess.set(nonExactGroups[i].guess, lane);
  });
  const maxNameLane = Math.max(0, ...nameLanes);
  const maxYearLane = Math.max(0, ...yearLaneByGuess.values());
  const laneNameH = ultra ? 11 : 13;
  const laneYearH = ultra ? 10 : 12;
  // trackTop below is the same tier-driven value used for the track/tick/
  // marker positions — this baseline (96 vs 70) is what fits everything
  // (name labels above, tick + year label below) around that shorter track.
  const timelineHeight = (ultra ? 70 : 96) + maxNameLane * laneNameH + maxYearLane * laneYearH;

  // Someone nailed the year exactly — the actual-year tick and its label
  // pick up the same gold as the winning dot, instead of staying teal.
  const exactMatch = bestDiff === 0;
  // The winner's marker is gold only for a spot-on guess; otherwise "just
  // won" (closest, not exact) reads as the same green as a correct guess.
  const winnerColor = exactMatch ? '#fbbf24' : '#4ade80';
  const winnerColorSoft = exactMatch ? 'rgba(251,191,36,0.85)' : 'rgba(74,222,128,0.85)';
  const winnerGlowAnim = exactMatch ? 'markerGlowPulse' : 'markerGlowPulseGreen';

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
  const nameLaneByGuess = new Map(groups.map((g, i) => [g.guess, nameLanes[i]]));

  // Non-winning guesses cascade in first; the winner then lands last with a
  // bigger pop, regardless of its x-position in that cascade — a deliberate
  // "and the winner is…" beat rather than a plain leftmost-to-rightmost reveal.
  const trackTop = ultra ? 32 : 43;
  const tickHeight = ultra ? 22 : 30;
  const nameLaneStep = ultra ? 11 : 13;
  const yearLaneStep = ultra ? 10 : 12;
  const dotSize = ultra ? { best: 8, normal: 5 } : { best: 10, normal: 6 };
  const markerFontSize = ultra ? '0.54rem' : '0.62rem';
  const markerYearFontSize = ultra ? '0.52rem' : '0.6rem';

  function renderMarker(group: typeof groups[number], delayS: number, isBest: boolean) {
    const isExact = group.guess === year;
    const names = group.entries.map(e => e.name).join(', ');
    const nameOffset = (ultra ? 10 : 13) + (nameLaneByGuess.get(group.guess) ?? 0) * nameLaneStep;
    const yearOffset = (ultra ? 10 : 13) + (yearLaneByGuess.get(group.guess) ?? 0) * yearLaneStep;
    const dot = isBest ? dotSize.best : dotSize.normal;
    return (
      <div
        key={group.guess}
        style={{
          position: 'absolute', left: `${pos(group.guess)}%`, top: `${trackTop}px`,
          transform: 'translate(-50%, -50%)',
          animationName: isBest ? 'winnerMarkerLand' : 'markerCelebrate',
          animationDuration: isBest ? '0.65s' : '0.5s',
          animationTimingFunction: 'ease-out',
          animationFillMode: 'both',
          animationDelay: `${delayS}s`,
        }}
      >
        <span style={{
          position: 'absolute', left: '50%', transform: 'translateX(-50%)',
          bottom: `${nameOffset}px`,
          fontSize: markerFontSize, whiteSpace: 'nowrap',
          color: isBest ? winnerColor : 'rgba(255,255,255,0.55)',
          fontWeight: isBest ? 800 : 600,
        }}>
          {names}
        </span>
        <div style={{
          width: `${dot}px`, height: `${dot}px`, borderRadius: '50%',
          background: isBest ? winnerColor : 'rgba(255,255,255,0.5)',
          border: isBest ? '2px solid rgba(255,255,255,0.5)' : 'none',
          animation: isBest ? `${winnerGlowAnim} 1.8s ease-in-out ${delayS + 0.65}s infinite` : 'none',
        }} />
        {showGuessValues && !isExact && (
          <span style={{
            position: 'absolute', left: '50%', transform: 'translateX(-50%)',
            top: `${yearOffset}px`,
            fontSize: markerYearFontSize, whiteSpace: 'nowrap',
            color: isBest ? winnerColorSoft : 'rgba(255,255,255,0.45)',
            fontWeight: isBest ? 700 : 500,
          }}>
            {group.guess}
          </span>
        )}
      </div>
    );
  }

  const timelineWidth = ultra && landscape ? 'min(90vw, 420px)' : ultra ? 'min(88vw, 300px)' : 'min(84vw, 330px)';

  return (
    <div style={{ width: timelineWidth, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
      <YearHeading year={year} compact={false} muted={muted} hitTier={pickYearHitTier(result)} squeeze={squeeze} />

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

        {otherGroups.map((group, i) => renderMarker(group, timelineRevealS + i * 0.09, false))}
        {bestGroups.map((group, i) => renderMarker(group, timelineRevealS + otherGroups.length * 0.09 + 0.25 + i * 0.09, true))}
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
