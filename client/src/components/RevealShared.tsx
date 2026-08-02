import { Check, Target, Trophy, X, Zap, Timer, TrendingUp, Swords } from 'lucide-react';
import LiquidGlass from './StableLiquidGlass';
import type { Award, PointsBreakdown, RoundResultEvent } from '../types';
import { LIQUID_PILL_PROPS } from './liquidGlassPresets';
import { YearHeading, YearSongFooter } from './YearReveal';

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

export function PillButton({ onClick, label, zIndex }: Readonly<{ onClick: () => void; label: string; zIndex?: number }>) {
  return (
    <button
      type="button"
      className="liquid-btn glass-tint-purple relative cursor-pointer border-0 bg-transparent p-0"
      style={{ width: 'min(92vw, 310px)', height: '64px', borderRadius: '100px', background: 'rgba(0,0,0,0.001)', zIndex }}
      onClick={onClick}
    >
      <LiquidGlass style={{ position: 'absolute', top: '50%', left: '50%' }} {...LIQUID_PILL_PROPS}>
        <div style={{ position: 'relative' }}>
          <div style={{ position: 'absolute', inset: '-18px -36px', borderRadius: '100px', pointerEvents: 'none', background: 'rgba(158,18,204,0.12)' }} />
          <span className="text-white font-bold text-xl" style={{ whiteSpace: 'nowrap', position: 'relative', display: 'inline-block', minWidth: 'min(210px, calc(100vw - 120px))', textAlign: 'center' }}>
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
    <div style={{ width: 'min(262px, calc(100vw - 96px))', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
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
            {result.featuredArtists && <span style={{ color: 'rgba(255,255,255,0.45)', fontWeight: 400, fontSize: '0.875rem' }}> feat. {formatFeaturedArtists(result.featuredArtists)}</span>}
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
            {result.artist}{result.featuredArtists ? <span style={{ color: 'rgba(255,255,255,0.45)' }}> feat. {formatFeaturedArtists(result.featuredArtists)}</span> : null}
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

export function FinalRoundAnswerContent({ result, label, muted = false }: Readonly<{ result: RoundResultEvent; label: string; muted?: boolean }>) {
  const artistOnly = result.artistOnly;
  const yearOnly = result.yearOnly || result.party?.format === 'year';
  let answerTypeLabel = 'The song was';
  if (yearOnly) {
    answerTypeLabel = 'The year was';
  } else if (artistOnly) {
    answerTypeLabel = 'The artist was';
  }

  return (
    <div style={{ width: 'min(262px, calc(100vw - 96px))', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
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
          <YearHeading year={result.year ? Math.floor(result.year) : '-'} compact muted={muted} />
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
    <div style={{ width: 'min(262px, calc(100vw - 96px))', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
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
