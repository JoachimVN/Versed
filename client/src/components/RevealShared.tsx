import { Check, Trophy, X } from 'lucide-react';
import LiquidGlass from 'liquid-glass-react';
import type { RoundResultEvent } from '../types';
import { LIQUID_PILL_PROPS } from './liquidGlassPresets';

export function PillButton({ onClick, label, zIndex }: Readonly<{ onClick: () => void; label: string; zIndex?: number }>) {
  return (
    <button
      type="button"
      className="liquid-btn relative cursor-pointer border-0 bg-transparent p-0"
      style={{ width: '310px', height: '64px', borderRadius: '100px', background: 'rgba(0,0,0,0.001)', zIndex }}
      onClick={onClick}
    >
      <LiquidGlass style={{ position: 'absolute', top: '50%', left: '50%' }} {...LIQUID_PILL_PROPS}>
        <div style={{ position: 'relative' }}>
          <div style={{ position: 'absolute', inset: '-18px -36px', borderRadius: '100px', pointerEvents: 'none', background: 'rgba(110,32,155,0.12)' }} />
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
        <X style={{ width: '22px', height: '22px', color: 'rgba(255,255,255,0.25)' }} />
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
        color: 'rgba(255,255,255,0.28)', fontSize: '0.6rem', letterSpacing: '0.18em', textTransform: 'uppercase',
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
            {result.featuredArtists && <span style={{ color: 'rgba(255,255,255,0.38)', fontWeight: 400, fontSize: '0.875rem' }}> feat. {result.featuredArtists}</span>}
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
            {result.artist}{result.featuredArtists ? <span style={{ color: 'rgba(255,255,255,0.22)' }}> feat. {result.featuredArtists}</span> : null}
          </span>
        </>
      )}
      {result.year && (
        <span style={{ color: 'rgba(255,255,255,0.22)', fontSize: '0.75rem', marginTop: '4px', display: 'inline-block' }}>
          {result.year}
        </span>
      )}
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
      <span style={{
        color: 'rgba(255,255,255,0.28)', fontSize: '0.6rem', letterSpacing: '0.18em', textTransform: 'uppercase',
        marginBottom: '6px', display: 'inline-block',
      }}>
        The year was
      </span>
      <span style={{
        fontSize: '2.6rem', fontWeight: 900, lineHeight: 1,
        background: 'linear-gradient(to bottom left, rgba(0,200,195,0.5) 0%, transparent 55%), linear-gradient(to top right, rgba(150,17,193,0.5) 0%, transparent 55%), #fff',
        WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
        marginBottom: '8px', display: 'inline-block', minWidth: '160px',
      }}>
        {result.year ? Math.floor(result.year) : '–'}
      </span>
      {winner && (
        <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.82rem', marginBottom: '12px', display: 'inline-block', minWidth: '200px' }}>
          {winner.name} was closest{winnerDetail}
        </span>
      )}
      <div style={{ width: '100%', height: '1px', background: 'rgba(255,255,255,0.08)', marginBottom: '12px' }} />
      {result.coverUrl && (
        <img
          src={result.coverUrl} alt="Album art"
          style={{ width: '170px', height: '170px', borderRadius: '16px', objectFit: 'cover', marginBottom: '12px', boxShadow: '0 10px 36px rgba(0,0,0,0.65)' }}
        />
      )}
      <span style={{ color: 'white', fontWeight: 900, fontSize: '1.05rem', lineHeight: 1.3, display: 'inline-block', minWidth: '220px' }}>
        {result.songTitle}
      </span>
      <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.85rem', marginTop: '3px', display: 'inline-block', minWidth: '220px' }}>
        {result.artist}
      </span>
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
  const range = max === min ? 1 : max - min;
  const pos = (y: number) => 11 + ((y - min) / range) * 78;

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

  const passCount = result.yearResults.length - guesses.length;

  return (
    <div style={{ width: 'min(84vw, 330px)', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
      <span style={{
        color: 'rgba(255,255,255,0.28)', fontSize: '0.6rem', letterSpacing: '0.18em', textTransform: 'uppercase',
        marginBottom: '4px', display: 'inline-block',
      }}>
        The year was
      </span>
      <span style={{
        fontSize: '2.2rem', fontWeight: 900, lineHeight: 1,
        background: 'linear-gradient(to bottom left, rgba(0,200,195,0.5) 0%, transparent 55%), linear-gradient(to top right, rgba(150,17,193,0.5) 0%, transparent 55%), #fff',
        WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
        marginBottom: '22px', display: 'inline-block', minWidth: '140px',
      }}>
        {year}
      </span>

      {/* Timeline */}
      <div style={{ position: 'relative', width: '100%', height: `${timelineHeight}px`, marginBottom: '8px' }}>
        <div style={{ position: 'absolute', left: 0, right: 0, top: '43px', height: '3px', background: 'rgba(255,255,255,0.08)', borderRadius: '2px' }} />

        {/* Actual-year tick */}
        <div style={{
          position: 'absolute', left: `${pos(year)}%`, top: '28px', transform: 'translateX(-50%)',
          width: '2px', height: '30px', borderRadius: '1px',
          background: exactMatch ? 'rgba(251,191,36,0.7)' : 'rgba(0,200,195,0.5)',
        }} />
        <div style={{
          position: 'absolute', left: `${pos(year)}%`, top: `${66 + maxYearLane * 12}px`, transform: 'translateX(-50%)',
          fontSize: '0.6rem', fontWeight: 700, whiteSpace: 'nowrap',
          color: exactMatch ? '#fbbf24' : 'rgba(94,234,212,0.9)',
        }}>
          {year}
        </div>

        {groups.map((group, i) => {
          const isBest = bestDiff !== null && group.entries[0].diff === bestDiff;
          // An exact guess shares the actual-year tick's x position — skip its
          // own "below" year label since the actual-year label already sits there.
          const isExact = group.guess === year;
          const names = group.entries.map(e => e.name).join(', ');
          const nameOffset = 13 + nameLanes[i] * 13;
          const yearOffset = 13 + (yearLaneByGuess.get(group.guess) ?? 0) * 12;
          return (
            <div
              key={group.guess}
              style={{
                position: 'absolute', left: `${pos(group.guess)}%`, top: '43px',
                transform: 'translate(-50%, -50%)',
                animation: 'markerCelebrate 0.5s ease-out both',
                animationDelay: `${0.1 + i * 0.09}s`,
              }}
            >
              <span style={{
                position: 'absolute', left: '50%', transform: 'translateX(-50%)',
                bottom: `${nameOffset}px`,
                fontSize: '0.62rem', whiteSpace: 'nowrap',
                color: isBest ? '#fbbf24' : 'rgba(255,255,255,0.55)',
                fontWeight: isBest ? 800 : 600,
              }}>
                {names}
              </span>
              <div style={{
                width: isBest ? '10px' : '6px', height: isBest ? '10px' : '6px', borderRadius: '50%',
                background: isBest ? '#fbbf24' : 'rgba(255,255,255,0.5)',
                border: isBest ? '2px solid rgba(255,255,255,0.5)' : 'none',
                animation: isBest ? 'markerGlowPulse 1.8s ease-in-out infinite' : 'none',
              }} />
              {showGuessValues && !isExact && (
                <span style={{
                  position: 'absolute', left: '50%', transform: 'translateX(-50%)',
                  top: `${yearOffset}px`,
                  fontSize: '0.6rem', whiteSpace: 'nowrap',
                  color: isBest ? 'rgba(251,191,36,0.85)' : 'rgba(255,255,255,0.35)',
                  fontWeight: isBest ? 700 : 500,
                }}>
                  {group.guess}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {passCount > 0 && (
        <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: '0.68rem', marginBottom: '4px' }}>
          {passCount} didn't guess
        </span>
      )}

      <div style={{ width: '100%', height: '1px', background: 'rgba(255,255,255,0.08)', marginTop: '8px', marginBottom: '12px' }} />
      {result.coverUrl && (
        <img
          src={result.coverUrl} alt="Album art"
          style={{ width: '140px', height: '140px', borderRadius: '12px', objectFit: 'cover', marginBottom: '12px', boxShadow: '0 10px 36px rgba(0,0,0,0.65)' }}
        />
      )}
      <span style={{ color: 'white', fontWeight: 900, fontSize: '0.95rem', lineHeight: 1.3, display: 'inline-block', minWidth: '220px' }}>
        {result.songTitle}
      </span>
      <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.8rem', marginTop: '3px', display: 'inline-block', minWidth: '220px' }}>
        {result.artist}
      </span>
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
    labelGradient = 'linear-gradient(to bottom left, rgba(110,32,155,0.4) 0%, transparent 52%), linear-gradient(to top right, rgba(0,200,195,0.3) 0%, transparent 52%), #fff';
  } else {
    const initial = result.guesserName?.[0]?.toUpperCase() ?? '?';
    iconNode = <span style={{ fontSize: '1.25rem', fontWeight: 900, color: 'rgba(255,255,255,0.7)' }}>{initial}</span>;
    iconBg = 'rgba(255,255,255,0.07)';
    iconBorder = 'rgba(255,255,255,0.12)';
    labelText = `${result.guesserName} got it`;
    labelGradient = 'linear-gradient(to bottom left, rgba(110,32,155,0.4) 0%, transparent 52%), linear-gradient(to top right, rgba(0,200,195,0.3) 0%, transparent 52%), #fff';
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
        color: 'rgba(255,255,255,0.28)', fontSize: '0.6rem', letterSpacing: '0.18em', textTransform: 'uppercase',
        marginBottom: '10px', display: 'inline-block',
      }}>
        {artistOnly ? 'The artist was' : 'The song was'}
      </span>
      <SongInfo result={result} />
    </div>
  );
}
