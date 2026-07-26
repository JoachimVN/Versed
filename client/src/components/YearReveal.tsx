import { useEffect, useState } from 'react';
import type { RoundResultEvent } from '../types';

// The "guess the year" reveal: a slot-reel that lands on the real year, and
// the timeline that then builds in underneath it showing where everyone's
// guesses fell. Used by both the host and player reveal screens, and by
// RevealShared's final-round card.

// Step durations for the year's slot-reel build-up — shorter than the
// mystery multiplier's (RoundIntro.tsx) since it's paired with a timeline
// that also needs to animate in afterward, but the same front-loaded-then-
// decelerating shape so it reads as "landing" rather than "the label changed".
const YEAR_SPIN_STEPS_MS = [50, 60, 75, 90, 115, 145, 180];

// Total time (ms) from mount until the year lands — YearTimelineContent
// times its marker entrances to start after this, so the timeline builds in
// as a second beat once the year itself has landed, not simultaneously.
export const YEAR_LAND_MS = YEAR_SPIN_STEPS_MS.reduce((a, b) => a + b, 0);

// Always noticeably wrong (4-53 years off) so no decoy could be mistaken for
// the real answer mid-flicker.
function pickYearCandidate(real: number): number {
  const r = new Uint32Array(2);
  crypto.getRandomValues(r);
  const jitter = 4 + (r[0] % 50);
  return r[1] % 2 === 0 ? real + jitter : real - jitter;
}

// Slot-reel reveal for the year: flickers through a handful of decoy years
// before settling on the real one, mirroring the mystery multiplier chip's
// reel (RoundIntro.tsx) so both "hidden number" reveals feel like one system.
// Skipped for the '-'/'–' placeholder shown when there's no year data.
function YearNumber({ year, compact }: Readonly<{ year: number | string; compact: boolean }>) {
  const isNumber = typeof year === 'number';
  const [display, setDisplay] = useState<number | string>(year);
  const [tick, setTick] = useState(0);
  const [landed, setLanded] = useState(!isNumber);

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
    let i = 0;
    const step = () => {
      if (cancelled) return;
      if (i >= YEAR_SPIN_STEPS_MS.length) {
        setDisplay(year);
        setLanded(true);
        return;
      }
      setDisplay(pickYearCandidate(year));
      setTick(t => t + 1);
      timer = setTimeout(step, YEAR_SPIN_STEPS_MS[i]);
      i++;
    };
    step();
    // React Strict Mode intentionally cleans up and restarts effects in
    // development. Let the restarted effect own a fresh timer: suppressing
    // it after the first pass leaves the randomly chosen decoy on screen,
    // blurred forever, and makes every device show a different "answer".
    return () => { cancelled = true; clearTimeout(timer); };
  }, [year, isNumber]);

  return (
    <span
      // A fresh key per flicker tick (and a distinct one on landing) forces
      // the animation to restart on every value change, same trick as the
      // mystery chip — a plain style-string diff wouldn't retrigger it.
      key={landed ? `landed-${year}` : `spin-${tick}`}
      style={{
        fontSize: compact ? '2.6rem' : '2.2rem', fontWeight: 900, lineHeight: 1,
        background: 'linear-gradient(to bottom left, rgba(0,238,232,0.5) 0%, transparent 55%), linear-gradient(to top right, rgba(158,18,204,0.5) 0%, transparent 55%), #fff',
        WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
        marginBottom: compact ? '8px' : '22px', display: 'inline-block', minWidth: compact ? '160px' : '140px',
        animation: !isNumber ? undefined : (landed
          ? 'slotLand 0.6s cubic-bezier(0.34, 1.56, 0.64, 1), slotFlash 0.7s ease-out'
          : 'slotSpinTick 0.14s ease-out'),
        // A decoy tick at full clarity is indistinguishable from the real
        // answer if someone glances at exactly the wrong instant — a factual
        // "the year was" card reads as authoritative, so unlike the mystery
        // chip's playful spin, this needs to be unmistakably unsettled while
        // it's still resolving.
        filter: isNumber && !landed ? 'blur(3px)' : undefined,
      }}
    >
      {display}
    </span>
  );
}

// The "year was" label + big gradient number: shared by the compact
// no-timeline fallback card and the full timeline card, which only differ
// in sizing.
export function YearHeading({ year, compact }: Readonly<{ year: number | string; compact: boolean }>) {
  return (
    <>
      <span style={{
        color: 'rgba(255,255,255,0.45)', fontSize: '0.6rem', letterSpacing: '0.18em', textTransform: 'uppercase',
        marginBottom: compact ? '6px' : '4px', display: 'inline-block',
      }}>
        The year was
      </span>
      <YearNumber year={year} compact={compact} />
    </>
  );
}

// Cover art + title + artist footer shared by the same two year cards.
export function YearSongFooter({ result, compact }: Readonly<{ result: RoundResultEvent; compact: boolean }>) {
  return (
    <>
      {result.coverUrl && (
        <img
          src={result.coverUrl} alt="Album art"
          style={{
            width: compact ? '170px' : '140px', height: compact ? '170px' : '140px',
            borderRadius: compact ? '16px' : '12px', objectFit: 'cover', marginBottom: '12px',
            boxShadow: '0 10px 36px rgba(0,0,0,0.65)',
          }}
        />
      )}
      <span style={{ color: 'white', fontWeight: 900, fontSize: compact ? '1.05rem' : '0.95rem', lineHeight: 1.3, display: 'inline-block', minWidth: '220px' }}>
        {result.songTitle}
      </span>
      <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: compact ? '0.85rem' : '0.8rem', marginTop: '3px', display: 'inline-block', minWidth: '220px' }}>
        {result.artist}
      </span>
    </>
  );
}

// Party "guess the year" rounds: the answer is a number, so the card leads
// with the year and the closest player instead of a got-it/no-one-got-it state.
export function YearCardContent({ result }: Readonly<{ result: RoundResultEvent }>) {
  const winner = result.yearResults?.find(r => r.diff !== null);
  const pluralS = winner?.diff === 1 ? '' : 's';
  const winnerDetail = winner && (winner.diff === 0 ? ' · exact!' : ` (${winner.diff} year${pluralS} off)`);
  return (
    <div style={{ width: '262px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
      <YearHeading year={result.year ? Math.floor(result.year) : '–'} compact />
      {winner && (
        <span style={{
          color: 'rgba(255,255,255,0.5)', fontSize: '0.82rem', marginBottom: '12px', display: 'inline-block', minWidth: '200px',
          // Waits for the year number to finish its own reveal (YearNumber
          // above) so "who won" reads as the payoff of that reveal, not a
          // simultaneous, unrelated line of text.
          animation: `fadeIn 0.4s ease-out ${(YEAR_LAND_MS + 150) / 1000}s both`,
        }}>
          {winner.name} was closest{winnerDetail}
        </span>
      )}
      <div style={{ width: '100%', height: '1px', background: 'rgba(255,255,255,0.08)', marginBottom: '12px' }} />
      <YearSongFooter result={result} compact />
    </div>
  );
}

export function YearTimelineContent({ result, showGuessValues = true }: Readonly<{ result: RoundResultEvent; showGuessValues?: boolean }>) {
  if (!result.yearResults) return null;

  const year = result.year ? Math.floor(result.year) : null;
  const guesses = result.yearResults.filter(r => r.guess !== null);
  if (!year || guesses.length === 0) return <YearCardContent result={result} />;

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
  const TIMELINE_PX = 300; // approximate rendered width, just for spacing math
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
  const nameLanes = packLanes(groups.map(g => ({ xPct: pos(g.guess), label: g.entries.map(e => e.name).join(', '), fontPx: 9.9 })));
  const nonExactGroups = groups.filter(g => g.guess !== year);
  const yearLaneByGuess = new Map<number, number>();
  packLanes(nonExactGroups.map(g => ({ xPct: pos(g.guess), label: String(g.guess), fontPx: 9.6 }))).forEach((lane, i) => {
    yearLaneByGuess.set(nonExactGroups[i].guess, lane);
  });
  const maxNameLane = Math.max(0, ...nameLanes);
  const maxYearLane = Math.max(0, ...yearLaneByGuess.values());
  const timelineHeight = 96 + maxNameLane * 13 + maxYearLane * 12;

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
  const bestGroupIndex = groups.findIndex(g => bestDiff !== null && g.entries[0].diff === bestDiff);
  const otherGroups = groups.filter((_, i) => i !== bestGroupIndex);
  const bestGroup = bestGroupIndex >= 0 ? groups[bestGroupIndex] : null;
  const nameLaneByGuess = new Map(groups.map((g, i) => [g.guess, nameLanes[i]]));

  // Non-winning guesses cascade in first; the winner then lands last with a
  // bigger pop, regardless of its x-position in that cascade — a deliberate
  // "and the winner is…" beat rather than a plain leftmost-to-rightmost reveal.
  function renderMarker(group: typeof groups[number], delayS: number, isBest: boolean) {
    const isExact = group.guess === year;
    const names = group.entries.map(e => e.name).join(', ');
    const nameOffset = 13 + (nameLaneByGuess.get(group.guess) ?? 0) * 13;
    const yearOffset = 13 + (yearLaneByGuess.get(group.guess) ?? 0) * 12;
    return (
      <div
        key={group.guess}
        style={{
          position: 'absolute', left: `${pos(group.guess)}%`, top: '43px',
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
          fontSize: '0.62rem', whiteSpace: 'nowrap',
          color: isBest ? winnerColor : 'rgba(255,255,255,0.55)',
          fontWeight: isBest ? 800 : 600,
        }}>
          {names}
        </span>
        <div style={{
          width: isBest ? '10px' : '6px', height: isBest ? '10px' : '6px', borderRadius: '50%',
          background: isBest ? winnerColor : 'rgba(255,255,255,0.5)',
          border: isBest ? '2px solid rgba(255,255,255,0.5)' : 'none',
          animation: isBest ? `${winnerGlowAnim} 1.8s ease-in-out ${delayS + 0.65}s infinite` : 'none',
        }} />
        {showGuessValues && !isExact && (
          <span style={{
            position: 'absolute', left: '50%', transform: 'translateX(-50%)',
            top: `${yearOffset}px`,
            fontSize: '0.6rem', whiteSpace: 'nowrap',
            color: isBest ? winnerColorSoft : 'rgba(255,255,255,0.45)',
            fontWeight: isBest ? 700 : 500,
          }}>
            {group.guess}
          </span>
        )}
      </div>
    );
  }

  return (
    <div style={{ width: 'min(84vw, 330px)', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
      <YearHeading year={year} compact={false} />

      {/* Timeline */}
      <div style={{ position: 'relative', width: '100%', height: `${timelineHeight}px`, marginBottom: '8px' }}>
        <div style={{ position: 'absolute', left: 0, right: 0, top: '43px', height: '3px', background: 'rgba(255,255,255,0.08)', borderRadius: '2px' }} />

        {/* Actual-year tick — fades in once the year number above has landed */}
        <div style={{
          position: 'absolute', left: `${pos(year)}%`, top: '28px', transform: 'translateX(-50%)',
          width: '2px', height: '30px', borderRadius: '1px',
          background: exactMatch ? 'rgba(251,191,36,0.7)' : 'rgba(0,238,232,0.5)',
          animation: `fadeIn 0.4s ease-out ${timelineRevealS}s both`,
        }} />
        <div style={{
          position: 'absolute', left: `${pos(year)}%`, top: `${66 + maxYearLane * 12}px`, transform: 'translateX(-50%)',
          fontSize: '0.6rem', fontWeight: 700, whiteSpace: 'nowrap',
          color: exactMatch ? '#fbbf24' : 'rgba(94,234,212,0.9)',
          animation: `fadeIn 0.4s ease-out ${timelineRevealS}s both`,
        }}>
          {year}
        </div>

        {otherGroups.map((group, i) => renderMarker(group, timelineRevealS + i * 0.09, false))}
        {bestGroup && renderMarker(bestGroup, timelineRevealS + otherGroups.length * 0.09 + 0.25, true)}
      </div>

      {passCount > 0 && (
        <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.68rem', marginBottom: '4px' }}>
          {passCount} didn't guess
        </span>
      )}

      <div style={{ width: '100%', height: '1px', background: 'rgba(255,255,255,0.08)', marginTop: '8px', marginBottom: '12px' }} />
      <YearSongFooter result={result} compact={false} />
    </div>
  );
}
