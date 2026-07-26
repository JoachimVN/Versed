import { useEffect, useRef, useState } from 'react';
import { Check, Trophy, X, Zap, Timer, TrendingUp, Swords } from 'lucide-react';
import LiquidGlass from './StableLiquidGlass';
import type { Award, PointsBreakdown, RoundResultEvent } from '../types';
import { LIQUID_PILL_PROPS } from './liquidGlassPresets';

// A round delta this large only happens with a multiplier event, a big
// steal, or several bonuses stacking — comfortably above classic's ordinary
// per-round ceiling (500 base + 1000 bid + 500 difficulty = 2000) and race's
// (1000 base + 500 difficulty), so it only lights up for genuinely
// exceptional rounds rather than an everyday good guess.
export const BIG_POINTS_THRESHOLD = 2500;

// One line per non-zero component of a payout, in earn order: named parts,
// then the multiplier's own contribution, then pity last (it's added after
// the multiplier, not scaled by it). Omits the multiplier/pity lines
// entirely on a plain round where neither applied — everyone still sees
// where their base/bid/difficulty points came from either way.
export function breakdownLines(b: PointsBreakdown): string[] {
  const lines = b.parts.filter(p => p.amount !== 0).map(p => `${p.label} +${p.amount.toLocaleString()}`);
  if (b.multiplier !== 1) lines.push(`×${b.multiplier} multiplier +${b.multiplierBonus.toLocaleString()}`);
  if (b.pity > 0) lines.push(`Pity +${b.pity.toLocaleString()}`);
  return lines;
}

export function breakdownCompact(b: PointsBreakdown): string {
  return breakdownLines(b).join(' · ');
}

// Stacked itemization shown under a player's own score pill — every round,
// not just ones with a bonus, so "where did my points come from" always has
// an answer instead of only showing up when something unusual happened.
export function PointsBreakdownList({ breakdown }: Readonly<{ breakdown: PointsBreakdown }>) {
  const lines = breakdownLines(breakdown);
  if (lines.length === 0) return null;
  return (
    <div className="flex flex-col items-center gap-0.5" style={{ marginTop: '2px' }}>
      {lines.map(l => (
        <p key={l} className="text-white/40 text-[0.66rem] tabular-nums leading-tight">{l}</p>
      ))}
    </div>
  );
}

// 'fastestGuess' (race-flow timing) and 'fastestClassicGuess' (classic
// bid/tier timing) are separate awards, not merged into one — the two flows
// measure elapsed time on different scales (shared clip start vs per-tier
// start), so a single "fastest" ranking across both would be misleading.
const AWARD_LABELS: Record<Award['key'], string> = {
  mostCorrect: 'Most Correct',
  fastestGuess: 'Fastest Race Guess',
  fastestClassicGuess: 'Fastest Classic Guess',
  biggestSwing: 'Biggest Swing',
  finaleWinner: 'Finale Winner',
};

// Typed against Award['key'] so a future award key fails type-check here
// instead of silently rendering a badge with no icon.
const AWARD_ICONS: Record<Award['key'], typeof Trophy> = {
  mostCorrect: Trophy,
  fastestGuess: Zap,
  fastestClassicGuess: Timer,
  biggestSwing: TrendingUp,
  finaleWinner: Swords,
};

// Each award gets a color already used elsewhere on this same screen, rather
// than one flat accent for all five: gold matches the 1st-place podium medal,
// cyan matches the existing "YOU" highlight, amber matches the 3rd-place
// medal (fitting for a comeback climbing out of last), violet is the brand
// accent used on the podium's CTA button, and indigo keeps the classic-mode
// timing award visually distinct from race's cyan.
const AWARD_COLORS: Record<Award['key'], string> = {
  mostCorrect: '#fbbf24',
  fastestGuess: '#5eead4',
  fastestClassicGuess: '#818cf8',
  biggestSwing: '#d97706',
  finaleWinner: '#c65fe8',
};

// Final-screen superlatives — shared by Host and Play so both screens read
// identically. Ties list every qualifying name rather than picking one.
export function AwardsStrip({ awards }: Readonly<{ awards: Award[] }>) {
  if (awards.length === 0) return null;
  return (
    <div className="relative z-10 flex flex-col" style={{ width: '100%', maxWidth: '420px', margin: '0 auto' }}>
      {awards.map((a, i) => {
        const Icon = AWARD_ICONS[a.key];
        const color = AWARD_COLORS[a.key];
        return (
          <div
            key={a.key}
            className="flex items-start gap-3 py-3"
            style={i < awards.length - 1 ? { borderBottom: '1px solid rgba(255,255,255,0.08)' } : undefined}
          >
            <Icon style={{ width: '16px', height: '16px', color, flexShrink: 0, marginTop: '2px' }} />
            <div className="flex flex-col min-w-0">
              <span>
                <span style={{ color, fontSize: '0.62rem', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                  {AWARD_LABELS[a.key]}
                </span>
                <span className="text-white font-bold text-sm" style={{ marginLeft: '7px' }}>{a.playerNames.join(' & ')}</span>
              </span>
              <span className="text-white/40 text-[0.68rem]" style={{ marginTop: '2px' }}>{a.detail}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function PillButton({ onClick, label, zIndex }: Readonly<{ onClick: () => void; label: string; zIndex?: number }>) {
  return (
    <button
      type="button"
      className="liquid-btn glass-tint-purple relative cursor-pointer border-0 bg-transparent p-0"
      style={{ width: '310px', height: '64px', borderRadius: '100px', background: 'rgba(0,0,0,0.001)', zIndex }}
      onClick={onClick}
    >
      <LiquidGlass style={{ position: 'absolute', top: '50%', left: '50%' }} {...LIQUID_PILL_PROPS}>
        <div style={{ position: 'relative' }}>
          <div style={{ position: 'absolute', inset: '-18px -36px', borderRadius: '100px', pointerEvents: 'none', background: 'rgba(158,18,204,0.12)' }} />
          <span className="text-white font-bold text-xl" style={{ whiteSpace: 'nowrap', position: 'relative', display: 'inline-block', minWidth: '210px', textAlign: 'center' }}>
            {label}
          </span>
        </div>
      </LiquidGlass>
    </button>
  );
}

export function NoOneGotItCardContent({ result }: Readonly<{ result: RoundResultEvent }>) {
  const artistOnly = result.artistOnly;
  return (
    <div style={{ width: '262px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
      <div style={{
        width: '52px', height: '52px', borderRadius: '50%',
        background: 'rgba(255,255,255,0.05)',
        border: '1px solid rgba(255,255,255,0.09)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: '10px',
      }}>
        <X style={{ width: '22px', height: '22px', color: 'rgba(255,255,255,0.45)' }} />
      </div>
      <span style={{
        fontSize: '1.4rem', fontWeight: 900, letterSpacing: '0.01em',
        background: 'linear-gradient(to bottom left, rgba(210,70,50,0.4) 0%, transparent 52%), linear-gradient(to top right, rgba(255,165,70,0.28) 0%, transparent 52%), #fff',
        WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
        marginBottom: '14px', display: 'inline-block', minWidth: '200px',
      }}>
        No one got it
      </span>
      <div style={{ width: '100%', height: '1px', background: 'rgba(255,255,255,0.08)', marginBottom: '14px' }} />
      <span style={{
        color: 'rgba(255,255,255,0.45)', fontSize: '0.6rem', letterSpacing: '0.18em', textTransform: 'uppercase',
        marginBottom: '10px', display: 'inline-block',
      }}>
        {artistOnly ? 'The artist was' : 'The song was'}
      </span>
      <SongInfo result={result} />
    </div>
  );
}

function SongInfo({ result }: Readonly<{ result: RoundResultEvent }>) {
  const artistOnly = result.artistOnly;
  return (
    <>
      {result.coverUrl && (
        <img
          src={result.coverUrl} alt="Album art"
          style={{ width: '200px', height: '200px', borderRadius: '16px', objectFit: 'cover', marginBottom: '12px', boxShadow: '0 10px 36px rgba(0,0,0,0.65)' }}
        />
      )}
      {artistOnly ? (
        <>
          <span style={{ color: 'white', fontWeight: 900, fontSize: '1.1rem', lineHeight: 1.3, display: 'inline-block', minWidth: '220px' }}>
            {result.artist}
            {result.featuredArtists && <span style={{ color: 'rgba(255,255,255,0.45)', fontWeight: 400, fontSize: '0.875rem' }}> feat. {result.featuredArtists}</span>}
          </span>
          <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.875rem', marginTop: '3px', display: 'inline-block', minWidth: '220px' }}>
            {result.songTitle}
          </span>
        </>
      ) : (
        <>
          <span style={{ color: 'white', fontWeight: 900, fontSize: '1.1rem', lineHeight: 1.3, display: 'inline-block', minWidth: '220px' }}>
            {result.songTitle}
          </span>
          <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.875rem', marginTop: '3px', display: 'inline-block', minWidth: '220px' }}>
            {result.artist}{result.featuredArtists ? <span style={{ color: 'rgba(255,255,255,0.45)' }}> feat. {result.featuredArtists}</span> : null}
          </span>
        </>
      )}
      {result.year && (
        <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.75rem', marginTop: '4px', display: 'inline-block' }}>
          {result.year}
        </span>
      )}
    </>
  );
}

export function FinalRoundAnswerContent({ result, label }: Readonly<{ result: RoundResultEvent; label: string }>) {
  const artistOnly = result.artistOnly;
  const yearOnly = result.yearOnly || result.party?.format === 'year';
  let answerTypeLabel = 'The song was';
  if (yearOnly) {
    answerTypeLabel = 'The year was';
  } else if (artistOnly) {
    answerTypeLabel = 'The artist was';
  }

  return (
    <div style={{ width: '262px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
      <span style={{
        color: 'rgba(255,255,255,0.45)', fontSize: '0.62rem', fontWeight: 800,
        letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: '10px', display: 'inline-block',
      }}>
        Final round
      </span>
      <span style={{
        fontSize: '1.35rem', fontWeight: 900, letterSpacing: '0.01em',
        background: 'linear-gradient(to bottom left, rgba(158,18,204,0.45) 0%, transparent 52%), linear-gradient(to top right, rgba(0,238,232,0.34) 0%, transparent 52%), #fff',
        WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
        marginBottom: '14px', display: 'inline-block', minWidth: '200px',
      }}>
        {label}
      </span>
      <div style={{ width: '100%', height: '1px', background: 'rgba(255,255,255,0.08)', marginBottom: '14px' }} />
      {yearOnly ? (
        <>
          <YearHeading year={result.year ? Math.floor(result.year) : '-'} compact />
          <YearSongFooter result={result} compact />
        </>
      ) : (
        <>
          <span style={{
            color: 'rgba(255,255,255,0.45)', fontSize: '0.6rem', letterSpacing: '0.18em', textTransform: 'uppercase',
            marginBottom: '10px', display: 'inline-block',
          }}>
            {answerTypeLabel}
          </span>
          <SongInfo result={result} />
        </>
      )}
    </div>
  );
}

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
  const spunFor = useRef<number | string | null>(null);

  useEffect(() => {
    if (!isNumber) { setDisplay(year); setLanded(true); return; }
    if (spunFor.current === year) return;
    spunFor.current = year;
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
      }}
    >
      {display}
    </span>
  );
}

// The "year was" label + big gradient number: shared by the compact
// no-timeline fallback card and the full timeline card, which only differ
// in sizing.
function YearHeading({ year, compact }: Readonly<{ year: number | string; compact: boolean }>) {
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
function YearSongFooter({ result, compact }: Readonly<{ result: RoundResultEvent; compact: boolean }>) {
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
  // bigger pop and a trophy, regardless of its x-position in that cascade —
  // a deliberate "and the winner is…" beat rather than a plain leftmost-to-
  // rightmost reveal.
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
        {isBest && (
          <Trophy
            style={{
              position: 'absolute', left: '50%', bottom: `${nameOffset + 12}px`, transform: 'translateX(-50%)',
              width: '13px', height: '13px', color: winnerColor,
              animation: `chipReveal 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) ${delayS + 0.35}s both`,
            }}
          />
        )}
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

export function GotItCardContent({ result, myName }: Readonly<{ result: RoundResultEvent; myName?: string }>) {
  const artistOnly = result.artistOnly;
  const isRace = result.mode === 'race';
  const iWon = isRace
    ? (myName != null && !!result.correctGuessers?.includes(myName))
    : (result.correct && myName != null && result.guesserName === myName);

  let iconNode: React.ReactNode;
  let iconBg: string;
  let iconBorder: string;
  let labelText: string;
  let labelGradient: string;

  if (iWon) {
    iconNode = <Trophy style={{ width: '24px', height: '24px', color: '#fbbf24' }} />;
    iconBg = 'rgba(245,158,11,0.16)';
    iconBorder = 'rgba(245,158,11,0.32)';
    labelText = 'You got it!';
    labelGradient = 'linear-gradient(to bottom left, rgba(30,200,90,0.5) 0%, transparent 52%), linear-gradient(to top right, rgba(250,185,40,0.4) 0%, transparent 52%), #fff';
  } else if (isRace) {
    const count = result.correctGuessers?.length ?? 0;
    iconNode = <Check style={{ width: '24px', height: '24px', color: 'rgba(255,255,255,0.5)' }} />;
    iconBg = 'rgba(255,255,255,0.07)';
    iconBorder = 'rgba(255,255,255,0.12)';
    labelText = count === 1 ? `${result.correctGuessers![0]} got it` : `${count} players got it`;
    labelGradient = 'linear-gradient(to bottom left, rgba(158,18,204,0.4) 0%, transparent 52%), linear-gradient(to top right, rgba(0,238,232,0.3) 0%, transparent 52%), #fff';
  } else {
    // String indexing grabs a single UTF-16 code unit, which mangles emoji
    // (most are surrogate pairs) — iterate by code point instead so a name
    // like "🐈maka" gets the full cat, not half of one.
    const initial = Array.from(result.guesserName ?? '')[0]?.toUpperCase() ?? '?';
    iconNode = <span style={{ fontSize: '1.25rem', fontWeight: 900, color: 'rgba(255,255,255,0.7)' }}>{initial}</span>;
    iconBg = 'rgba(255,255,255,0.07)';
    iconBorder = 'rgba(255,255,255,0.12)';
    labelText = `${result.guesserName} got it`;
    labelGradient = 'linear-gradient(to bottom left, rgba(158,18,204,0.4) 0%, transparent 52%), linear-gradient(to top right, rgba(0,238,232,0.3) 0%, transparent 52%), #fff';
  }

  return (
    <div style={{ width: '262px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
      <div style={{
        width: '52px', height: '52px', borderRadius: '50%',
        background: iconBg, border: `1px solid ${iconBorder}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: '10px',
      }}>
        {iconNode}
      </div>
      <span style={{
        fontSize: '1.4rem', fontWeight: 900, letterSpacing: '0.01em',
        background: labelGradient,
        WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
        marginBottom: '14px', display: 'inline-block', minWidth: '200px',
      }}>
        {labelText}
      </span>
      <div style={{ width: '100%', height: '1px', background: 'rgba(255,255,255,0.08)', marginBottom: '14px' }} />
      <span style={{
        color: 'rgba(255,255,255,0.45)', fontSize: '0.6rem', letterSpacing: '0.18em', textTransform: 'uppercase',
        marginBottom: '10px', display: 'inline-block',
      }}>
        {artistOnly ? 'The artist was' : 'The song was'}
      </span>
      <SongInfo result={result} />
    </div>
  );
}
