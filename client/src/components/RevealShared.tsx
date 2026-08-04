import { Target, Trophy, Zap, Timer, TrendingUp, Swords } from 'lucide-react';
import LiquidGlass from './StableLiquidGlass';
import type { Award, PointsBreakdown, RoundResultEvent } from '../types';
import { LIQUID_PILL_PROPS } from './liquidGlassPresets';
import { YearHeading, YearSongFooter } from './YearReveal';
import type { CardSqueeze } from './revealSqueeze';
import { cardContentWidth } from './revealSqueeze';

export type { CardSqueeze } from './revealSqueeze';

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
// where their base/bid/difficulty points came from either way. hideMultiplier
// drops just that one line — used on player screens for a mystery round,
// where the multiplier's value is a host-screen-only reveal and shouldn't
// leak through the point breakdown text either.
// featuredArtists arrives ';'-joined (individual names can contain commas
// themselves, e.g. "Tyler, The Creator"), rendered here for humans.
function formatFeaturedArtists(featuredArtists: string): string {
  return featuredArtists.replaceAll(';', ', ');
}

export function breakdownLines(b: PointsBreakdown, hideMultiplier = false): string[] {
  const lines = b.parts.filter(p => p.amount !== 0).map(p => `${p.label} +${p.amount.toLocaleString()}`);
  if (!hideMultiplier && b.multiplier !== 1) lines.push(`×${b.multiplier} multiplier +${b.multiplierBonus.toLocaleString()}`);
  if (b.pity > 0) lines.push(`Pity +${b.pity.toLocaleString()}`);
  return lines;
}

export function breakdownCompact(b: PointsBreakdown, hideMultiplier = false): string {
  return breakdownLines(b, hideMultiplier).join(' · ');
}

// Stacked itemization shown under a player's own score pill — every round,
// not just ones with a bonus, so "where did my points come from" always has
// an answer instead of only showing up when something unusual happened.
export function PointsBreakdownList({ breakdown, hideMultiplier = false }: Readonly<{ breakdown: PointsBreakdown; hideMultiplier?: boolean }>) {
  const lines = breakdownLines(breakdown, hideMultiplier);
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
export const AWARD_LABELS: Record<Award['key'], string> = {
  mostCorrect: 'Most Correct',
  fastestGuess: 'Fastest Race Guess',
  fastestClassicGuess: 'Fastest Classic Guess',
  biggestSwing: 'Biggest Swing',
  finaleWinner: 'Finale Duel',
};

// Typed against Award['key'] so a future award key fails type-check here
// instead of silently rendering a badge with no icon.
const AWARD_ICONS: Record<Award['key'], typeof Trophy> = {
  mostCorrect: Target,
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
// timing award visually distinct from race's cyan. Desaturated to match the
// podium's own softened palette (RANK_STYLE in FinalResults.tsx) rather than
// the saturated stock Tailwind swatches these started from.
const AWARD_COLORS: Record<Award['key'], string> = {
  mostCorrect: '#e8c684',
  fastestGuess: '#8fe0d6',
  fastestClassicGuess: '#a8a5e0',
  biggestSwing: '#d6a878',
  finaleWinner: '#c2a0d9',
};

// Recap order: game-wide stats, the two distinct timing formats, then the
// optional finale champion. Missing formats simply drop out of the list; no
// empty row suggests a round type that was never played.
const AWARD_ORDER: Award['key'][] = ['mostCorrect', 'biggestSwing', 'fastestClassicGuess', 'fastestGuess', 'finaleWinner'];

// The server's own award.detail text already leads with the number that
// matters ("7 correct guesses", "+1,200 in one round", "1.2s") -- pulling
// that token out to stand alone as a scoreboard-style numeral means the row
// doesn't have to repeat it a second time in prose. Awards with no leading
// number (the finale duel has none) just fall through with no stat call-out.
function leadingStat(detail: string): string | null {
  const m = /^[+-]?\d[\d,.]*s?/.exec(detail);
  return m ? m[0] : null;
}

// One row per award, matching the standings rows' own plain, divided-list
// shape -- no icon badges, glow, or per-row color wash. The two timing
// awards get the real winning moment (the actual guess, song, and cover
// art) instead of decoration; the rest lean on a bold name and a single
// scoreboard-style number pulled from the award's own detail text. The
// quoted guess itself uses the same green used everywhere else a correct
// answer is confirmed.
// The finale duel has no leading stat and no highlight (the server names the
// opponent and final score) -- rather than an icon-less row that
// reads as an accidentally-broken version of the others, it gets its own
// upgraded card treatment (glow, gradient wash, bigger name) so the last
// award in the list reads as a deliberate capstone, not a downgrade.
function FinaleAwardRow({ award, delay }: Readonly<{ award: Award; delay: number }>) {
  const color = AWARD_COLORS[award.key];
  return (
    <div className="award-row-item award-row-finale" style={{ animationDelay: `${delay}ms` }}>
      <div className="award-row-text">
        <span className="award-row-label" style={{ color }}>{AWARD_LABELS[award.key]}</span>
        <span className="award-row-name award-row-name-finale">{award.playerNames.join(' & ')}</span>
        <span className="award-row-quote">{award.detail}</span>
      </div>
    </div>
  );
}

function AwardRow({ award, delay }: Readonly<{ award: Award; delay: number }>) {
  if (award.key === 'finaleWinner') return <FinaleAwardRow award={award} delay={delay} />;
  const Icon = AWARD_ICONS[award.key];
  const color = AWARD_COLORS[award.key];
  const highlight = award.highlights?.[0];
  const stat = leadingStat(award.detail);
  const hasArt = Boolean(highlight?.coverUrl);
  return (
    <div className={`award-row-item${hasArt ? '' : ' award-row-compact'}`} style={{ animationDelay: `${delay}ms` }}>
      {hasArt
        ? <img className="award-row-art" src={highlight!.coverUrl} alt="" />
        : <span className="award-row-mark" style={{ color }}><Icon style={{ width: '18px', height: '18px' }} /></span>}
      <div className="award-row-text">
        <span className="award-row-label" style={{ color }}>{AWARD_LABELS[award.key]}</span>
        <span className="award-row-name">{award.playerNames.join(' & ')}</span>
        {highlight && (
          <span className="award-row-quote">
            <span className="award-row-guess">“{highlight.guess}”</span> · {highlight.songTitle}
          </span>
        )}
        {!stat && !highlight && <span className="award-row-quote">{award.detail}</span>}
      </div>
      {stat && <span className="award-row-stat" style={{ color }}>{stat}</span>}
    </div>
  );
}

export function AwardsStrip({ awards }: Readonly<{ awards: Award[] }>) {
  if (awards.length === 0) return null;
  const ordered = AWARD_ORDER.map(key => awards.find(a => a.key === key)).filter((a): a is Award => Boolean(a));
  return (
    <section className="awards-list" aria-label="Game awards">
      {ordered.map((award, i) => <AwardRow key={award.key} award={award} delay={i * 70} />)}
    </section>
  );
}

export function PillButton({ onClick, label, zIndex, squeeze }: Readonly<{ onClick: () => void; label: string; zIndex?: number; squeeze?: CardSqueeze }>) {
  const { compact = false, ultraCompact = false } = squeeze ?? {};
  const height = ultraCompact ? '44px' : compact ? '54px' : '64px';
  return (
    <button
      type="button"
      className="liquid-btn glass-tint-purple relative cursor-pointer border-0 bg-transparent p-0"
      style={{ width: 'min(92vw, 310px)', height, borderRadius: '100px', background: 'rgba(0,0,0,0.001)', zIndex }}
      onClick={onClick}
    >
      <LiquidGlass style={{ position: 'absolute', top: '50%', left: '50%' }} {...LIQUID_PILL_PROPS} padding={ultraCompact ? '10px 28px' : compact ? '14px 32px' : LIQUID_PILL_PROPS.padding}>
        <div style={{ position: 'relative' }}>
          <div style={{ position: 'absolute', inset: '-18px -36px', borderRadius: '100px', pointerEvents: 'none', background: 'rgba(158,18,204,0.12)' }} />
          <span className={`text-white font-bold ${ultraCompact ? 'text-base' : compact ? 'text-lg' : 'text-xl'}`} style={{ whiteSpace: 'nowrap', position: 'relative', display: 'inline-block', minWidth: 'min(210px, calc(100vw - 120px))', textAlign: 'center' }}>
            {label}
          </span>
        </div>
      </LiquidGlass>
    </button>
  );
}

export function NoOneGotItCardContent({ result, squeeze }: Readonly<{ result: RoundResultEvent; squeeze?: CardSqueeze }>) {
  const { compact = false, ultraCompact = false } = squeeze ?? {};
  const artistOnly = result.artistOnly;
  return (
    <div style={{ width: cardContentWidth(squeeze), display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
      <span style={{
        fontSize: ultraCompact ? '1.05rem' : compact ? '1.2rem' : '1.4rem', fontWeight: 900, letterSpacing: '0.01em',
        background: 'linear-gradient(to bottom left, rgba(210,70,50,0.4) 0%, transparent 52%), linear-gradient(to top right, rgba(255,165,70,0.28) 0%, transparent 52%), #fff',
        WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
        marginBottom: ultraCompact ? '8px' : compact ? '10px' : '14px', display: 'inline-block', minWidth: '200px',
      }}>
        No one got it
      </span>
      <div style={{ width: '100%', height: '1px', background: 'rgba(255,255,255,0.08)', marginBottom: ultraCompact ? '8px' : compact ? '10px' : '14px' }} />
      <span style={{
        color: 'rgba(255,255,255,0.45)', fontSize: '0.6rem', letterSpacing: '0.18em', textTransform: 'uppercase',
        marginBottom: ultraCompact ? '6px' : compact ? '8px' : '10px', display: 'inline-block',
      }}>
        {artistOnly ? 'The artist was' : 'The song was'}
      </span>
      <SongInfo result={result} squeeze={squeeze} />
    </div>
  );
}

function SongInfo({ result, squeeze }: Readonly<{ result: RoundResultEvent; squeeze?: CardSqueeze }>) {
  const { compact = false, ultraCompact = false, landscape = false } = squeeze ?? {};
  const artistOnly = result.artistOnly;
  const coverSize = ultraCompact ? 110 : compact ? 150 : 200;
  const titleFontSize = ultraCompact ? '0.92rem' : compact ? '1.02rem' : '1.1rem';
  const artistFontSize = ultraCompact ? '0.72rem' : compact ? '0.8rem' : '0.875rem';
  const primary = artistOnly ? result.artist : result.songTitle;
  const secondary = artistOnly ? result.songTitle : result.artist;

  if (ultraCompact) {
    const combinedLineText = (
      <>
        <span style={{ color: 'white', fontWeight: 900, fontSize: titleFontSize }}>{primary}</span>
        <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: artistFontSize }}>
          {' · '}{secondary}
          {result.featuredArtists && <> feat. {formatFeaturedArtists(result.featuredArtists)}</>}
          {result.year && ` · ${result.year}`}
        </span>
      </>
    );
    // A landscape phone has width to spare even at this squeeze (unlike
    // portrait, where it's scarce on both axes) — putting the cover beside
    // the text instead of above it removes the cover's own height from the
    // vertical stack entirely, rather than just shrinking it further. The
    // text column gets `flex: 1, minWidth: 0` rather than portrait's fixed
    // minWidth: a fixed floor here doesn't leave enough of the row for the
    // cover once the two share width, and a flex row won't wrap a child
    // that's wider than its share — it just overflows past the card's edge.
    if (landscape && result.coverUrl) {
      return (
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '10px', width: '100%', textAlign: 'left' }}>
          <img
            src={result.coverUrl} alt="Album art"
            style={{ width: '64px', height: '64px', borderRadius: '12px', objectFit: 'cover', flexShrink: 0, boxShadow: '0 10px 36px rgba(0,0,0,0.65)' }}
          />
          <span style={{ flex: 1, minWidth: 0, lineHeight: 1.35 }}>{combinedLineText}</span>
        </div>
      );
    }
    // width: 100% rather than a fixed minWidth: a hardcoded floor doesn't
    // adapt to the card's narrowest real width (280px viewport, e.g. iOS's
    // "Zoomed" display setting), where it forced this span wider than its
    // container and bled text past the card's own border instead of
    // wrapping into it.
    const combinedLine = <span style={{ display: 'block', width: '100%', lineHeight: 1.35 }}>{combinedLineText}</span>;
    // Three stacked lines (title, artist, year) is the one layout that keeps
    // costing a fixed line-height no matter how far the font shrinks —
    // folding them into one line is worth more room at the tightest squeeze
    // than any further font reduction would be. Wraps rather than
    // truncates: this text is the answer to the round, so it can't just get
    // cut off.
    return (
      <>
        {result.coverUrl && (
          <img
            src={result.coverUrl} alt="Album art"
            style={{ width: `${coverSize}px`, height: `${coverSize}px`, borderRadius: '16px', objectFit: 'cover', marginBottom: '6px', boxShadow: '0 10px 36px rgba(0,0,0,0.65)' }}
          />
        )}
        {combinedLine}
      </>
    );
  }

  return (
    <>
      {result.coverUrl && (
        <img
          src={result.coverUrl} alt="Album art"
          style={{ width: `${coverSize}px`, height: `${coverSize}px`, borderRadius: '16px', objectFit: 'cover', marginBottom: compact ? '8px' : '12px', boxShadow: '0 10px 36px rgba(0,0,0,0.65)' }}
        />
      )}
      <span style={{ color: 'white', fontWeight: 900, fontSize: titleFontSize, lineHeight: 1.3, display: 'inline-block', minWidth: '220px' }}>
        {primary}
        {artistOnly && result.featuredArtists && <span style={{ color: 'rgba(255,255,255,0.45)', fontWeight: 400, fontSize: artistFontSize }}> feat. {formatFeaturedArtists(result.featuredArtists)}</span>}
      </span>
      <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: artistFontSize, marginTop: '3px', display: 'inline-block', minWidth: '220px' }}>
        {secondary}
        {!artistOnly && result.featuredArtists ? <span style={{ color: 'rgba(255,255,255,0.45)' }}> feat. {formatFeaturedArtists(result.featuredArtists)}</span> : null}
      </span>
      {result.year && (
        <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.75rem', marginTop: '4px', display: 'inline-block' }}>
          {result.year}
        </span>
      )}
    </>
  );
}

export function FinalRoundAnswerContent({ result, label, muted = false, squeeze }: Readonly<{ result: RoundResultEvent; label: string; muted?: boolean; squeeze?: CardSqueeze }>) {
  const { compact = false, ultraCompact = false } = squeeze ?? {};
  const artistOnly = result.artistOnly;
  const yearOnly = result.yearOnly || result.party?.format === 'year';
  let answerTypeLabel = 'The song was';
  if (yearOnly) {
    answerTypeLabel = 'The year was';
  } else if (artistOnly) {
    answerTypeLabel = 'The artist was';
  }

  return (
    <div style={{ width: cardContentWidth(squeeze), display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
      <span style={{
        color: 'rgba(255,255,255,0.45)', fontSize: '0.62rem', fontWeight: 800,
        letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: ultraCompact ? '6px' : compact ? '8px' : '10px', display: 'inline-block',
      }}>
        Final round
      </span>
      <span style={{
        fontSize: ultraCompact ? '1rem' : compact ? '1.15rem' : '1.35rem', fontWeight: 900, letterSpacing: '0.01em',
        background: 'linear-gradient(to bottom left, rgba(158,18,204,0.45) 0%, transparent 52%), linear-gradient(to top right, rgba(0,238,232,0.34) 0%, transparent 52%), #fff',
        WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
        marginBottom: ultraCompact ? '8px' : compact ? '10px' : '14px', display: 'inline-block', minWidth: '200px',
      }}>
        {label}
      </span>
      <div style={{ width: '100%', height: '1px', background: 'rgba(255,255,255,0.08)', marginBottom: ultraCompact ? '8px' : compact ? '10px' : '14px' }} />
      {yearOnly ? (
        <>
          <YearHeading year={result.year ? Math.floor(result.year) : '-'} compact muted={muted} squeeze={squeeze} />
          <YearSongFooter result={result} compact squeeze={squeeze} />
        </>
      ) : (
        <>
          <span style={{
            color: 'rgba(255,255,255,0.45)', fontSize: '0.6rem', letterSpacing: '0.18em', textTransform: 'uppercase',
            marginBottom: ultraCompact ? '6px' : compact ? '8px' : '10px', display: 'inline-block',
          }}>
            {answerTypeLabel}
          </span>
          <SongInfo result={result} squeeze={squeeze} />
        </>
      )}
    </div>
  );
}

export function GotItCardContent({ result, myName, squeeze }: Readonly<{ result: RoundResultEvent; myName?: string; squeeze?: CardSqueeze }>) {
  const { compact = false, ultraCompact = false } = squeeze ?? {};
  const artistOnly = result.artistOnly;
  const isRace = result.mode === 'race';
  const iWon = isRace
    ? (myName != null && !!result.correctGuessers?.includes(myName))
    : (result.correct && myName != null && result.guesserName === myName);

  let labelText: string;
  let labelGradient: string;

  if (iWon) {
    labelText = 'You got it!';
    labelGradient = 'linear-gradient(to bottom left, rgba(30,200,90,0.5) 0%, transparent 52%), linear-gradient(to top right, rgba(250,185,40,0.4) 0%, transparent 52%), #fff';
  } else if (isRace) {
    const count = result.correctGuessers?.length ?? 0;
    labelText = count === 1 ? `${result.correctGuessers![0]} got it` : `${count} players got it`;
    labelGradient = 'linear-gradient(to bottom left, rgba(158,18,204,0.4) 0%, transparent 52%), linear-gradient(to top right, rgba(0,238,232,0.3) 0%, transparent 52%), #fff';
  } else {
    labelText = `${result.guesserName} got it`;
    labelGradient = 'linear-gradient(to bottom left, rgba(158,18,204,0.4) 0%, transparent 52%), linear-gradient(to top right, rgba(0,238,232,0.3) 0%, transparent 52%), #fff';
  }

  return (
    <div style={{ width: cardContentWidth(squeeze), display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
      <span style={{
        fontSize: ultraCompact ? '1.05rem' : compact ? '1.2rem' : '1.4rem', fontWeight: 900, letterSpacing: '0.01em',
        background: labelGradient,
        WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
        marginBottom: ultraCompact ? '8px' : compact ? '10px' : '14px', display: 'inline-block', minWidth: '200px',
      }}>
        {labelText}
      </span>
      <div style={{ width: '100%', height: '1px', background: 'rgba(255,255,255,0.08)', marginBottom: ultraCompact ? '8px' : compact ? '10px' : '14px' }} />
      <span style={{
        color: 'rgba(255,255,255,0.45)', fontSize: '0.6rem', letterSpacing: '0.18em', textTransform: 'uppercase',
        marginBottom: ultraCompact ? '6px' : compact ? '8px' : '10px', display: 'inline-block',
      }}>
        {artistOnly ? 'The artist was' : 'The song was'}
      </span>
      <SongInfo result={result} squeeze={squeeze} />
    </div>
  );
}
