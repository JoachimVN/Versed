import { useRef } from 'react';
import { Flame } from 'lucide-react';
import LiquidGlass from '../../components/StableLiquidGlass';
import { useAnimatedScore } from '../../hooks/useAnimatedScore';
import { BIG_POINTS_THRESHOLD, FinalRoundAnswerContent, NoOneGotItCardContent, GotItCardContent, PointsBreakdownList, breakdownCompact, breakdownLines } from '../../components/RevealShared';
import { YearTimelineContent } from '../../components/YearReveal';
import { computeYearCardHeight } from '../../components/yearCardSqueeze';
import type { RevealLayout } from '../../components/revealSqueeze';
import { useRevealLayout, computeCardHeight, computeCardWidth, squeezeValue } from '../../components/revealSqueeze';
import { usePlayerScaleValue } from '../../hooks/usePlayerScale';
import { PartyRevealExtras, MYSTERY_LANDING_MS } from '../../components/RoundIntro';
import { LIQUID_CARD_PROPS } from '../../components/liquidGlassPresets';
import type { LeaderboardEntry, RoundResultEvent } from '../../types';
import type { PlayState } from './usePlayGame';

type PlayerGuess = NonNullable<RoundResultEvent['playerGuesses']>[number];

// Mirrors host RevealView's sortedPlayers: highest total score first, so the
// crowd list reads as the same leaderboard order the host shows instead of
// whatever order players happened to join in.
function sortGuessesByScore(guesses: PlayerGuess[], leaderboard: LeaderboardEntry[]): PlayerGuess[] {
  const scoreOf = (name: string) => leaderboard.find(e => e.name === name)?.score ?? 0;
  return guesses.slice().sort((a, b) => scoreOf(b.name) - scoreOf(a.name));
}

function guessTextClass(guess: string | null, correct: boolean): string {
  if (guess === null) return 'text-white/28 italic';
  return correct ? 'text-green-400' : 'text-white/28 italic';
}

// The artist guess can be right even when the title guess isn't — that combo
// scores no bonus, so it gets a muted green (visibly "correct") rather than
// the full "correct" green, which would wrongly imply it paid out.
function artistGuessClass(artistCorrect: boolean, titleCorrect: boolean): string {
  if (!artistCorrect) return 'text-white/28 italic';
  return titleCorrect ? 'text-green-400' : 'text-green-400/50 italic';
}

function scoreDeltaClass(scoreDelta: number): string {
  if (scoreDelta < 0) return 'text-sm text-red-400';
  if (scoreDelta >= BIG_POINTS_THRESHOLD) return 'text-xl text-amber-300';
  return 'text-sm text-sky-400';
}

function scoreDeltaAnimation(scoreDelta: number): React.CSSProperties | undefined {
  if (scoreDelta < 0) return { animation: 'stealHit 0.6s ease-out' };
  if (scoreDelta >= BIG_POINTS_THRESHOLD) return { animation: 'bigPointsPop 0.7s cubic-bezier(0.34, 1.56, 0.64, 1)' };
  return undefined;
}

// Player-side counterpart of host RevealView.tsx's chromeHeight/listMaxHeight
// budget: this screen has no roster to cap, but the guesses list below the
// card is the one element with genuinely unbounded height (up to 7+ players,
// some with a second artist-guess line — see PlayRevealViewCrowd fixture),
// while the score box beneath it is the whole point of this screen and can't
// be allowed to scroll off the bottom to make room. So the guesses list gets
// capped off the tier's real leftover room instead, leaving the score box
// its natural size.
//
// SCORE_BOX_BASE_PX + breakdownLineCount*BREAKDOWN_LINE_PX replaced a single
// flat SCORE_BOX_PX estimate that under-budgeted whenever a round's
// breakdown grew past ~3 lines (mystery multiplier + artist bonus + pity all
// stacking — see PlayRevealViewCrowd's fixture) — on compact/normal tiers
// that panel renders one stacked line per breakdownLines() entry, so the
// budget has to scale with it instead of assuming a fixed height. ultraCompact
// folds the whole breakdown into one breakdownCompact() line (see below) that
// widens instead of wrapping, so its base already covers that regardless of
// entry count. PARTY_EXTRAS_PX is only charged (and only one extra gap
// reserved) when PartyRevealExtras will actually render something — mirror
// its own render gate here rather than always paying for a row that's null
// most rounds. LIST_MIN_PX is tiered (unlike the rest of this file's tier
// dictionaries it used to be a single flat number) because it's charged on
// top of a budget that's already near its tightest at ultraCompact — the
// same floor that shows a comfortable handful of rows at normal squeeze
// would eat disproportionately more of a landscape phone's scarce height.
// STREAK_LINE_PX plugs a gap the budget used to miss entirely: the "N in a
// row" line only renders when myStreak >= 2, so a fixture without a streak
// never exposed that the score box's real rendered height ran past
// SCORE_BOX_BASE_PX whenever it did render — invisible at the old LIST_MIN_PX
// of 24 (the overflow was a sliver), but raising the list's floor to
// actually show multiple rows made that pre-existing gap large enough to
// push the streak line below the fold. Charged unconditionally by tier
// (myStreak's own >= 2 gate below decides whether it's paid at all) since
// the line's markup doesn't change shape across tiers.
//
// SCORE_BOX_BASE_PX used to assume the "+N pts" delta line was basically
// always there, which measured fine on the fixtures that motivated it (all
// delta > 0) but over-budgeted a "no one got it" reveal (delta === 0, no
// delta line, no breakdown at all) by ~60px at ultraCompact — stealing that
// much room from the guesses list below and cutting off however many rows
// didn't fit in what was left, on a screen with real space to spare. Base
// now measures the delta === 0 floor (padding + score number + your-score
// line) and DELTA_LINE_PX/ULTRA_DELTA_BLOCK_PX are charged only when a delta
// line will actually render, mirroring the streak line's own gate.
// ultraCompact folds delta + breakdown into one combined block because
// breakdownCompact's single line only ever renders alongside the delta line
// there (both gated on the same myScoreDelta > 0), so measuring them
// separately would just be two numbers that always travel together.
const LIST_TIER_CAP = { normal: 260, compact: 200, ultraCompact: 130 } as const;
const LIST_MIN_PX = { normal: 64, compact: 60, ultraCompact: 44 } as const;
const PARTY_EXTRAS_PX = { normal: 50, compact: 40, ultraCompact: 34 } as const;
const SCORE_BOX_BASE_PX = { normal: 155, compact: 132, ultraCompact: 74 } as const;
const BREAKDOWN_LINE_PX = 17;
const STREAK_LINE_PX = 20;
const DELTA_LINE_PX = 20;
const ULTRA_DELTA_BLOCK_PX = 34;

function tierKey(squeeze: RevealLayout): keyof typeof LIST_TIER_CAP {
  return squeezeValue(squeeze, 'ultraCompact', 'compact', 'normal');
}

function revealPadding(wide: boolean, squeeze: RevealLayout): string {
  if (wide) return squeezeValue(squeeze, 'px-2 py-3', 'px-2 py-4', 'px-2 py-6');
  return squeezeValue(squeeze, 'p-3', 'p-4', 'p-6');
}

function cardPadding(wide: boolean, squeeze: RevealLayout): string {
  if (wide) return '18px 18px';
  return squeezeValue(squeeze, '16px 16px', '20px 20px', '24px 24px');
}

// Reveal for "guess the year" rounds: the year card plus everyone's distances.
// Shared shell for the three reveal-screen variants (year / no-one-got-it /
// got-it): page background, liquid card, party extras, a guesses list, and
// the player's score box. Only the card content, guesses list, and an
// optional extra line under the score differ between them.
function PlayRevealShell({
  game, result, squeeze, cardHeight, cardContent, guessesList, scoreExtra, wide = false,
}: Readonly<{
  game: PlayState;
  result: RoundResultEvent;
  squeeze: RevealLayout;
  cardHeight: number;
  cardContent: React.ReactNode;
  guessesList: React.ReactNode;
  scoreExtra?: React.ReactNode;
  wide?: boolean;
}>) {
  const { myScore, myScoreDelta, myBreakdown, myStreak, myRank, stealResult } = game;
  const { ultraCompact, windowHeight } = squeeze;
  const tier = tierKey(squeeze);
  const revealParty = result.party ?? game.party;
  const finaleResolved = revealParty?.duelProgress?.wins.some(w => w.count >= 2) ?? false;
  const isFinalReveal = game.roundIndex + 1 >= game.totalRounds && (!revealParty?.finale || finaleResolved);
  // Ties the score bump to the shared reveal moment — for a mystery round
  // this is the first time the true (multiplied) total is visible, so it
  // should count up rather than just appear. The "+N pts" line and its
  // breakdown stay put (no fade-out) — how many points this round earned,
  // and why, shouldn't disappear a few seconds after the reveal.
  // For mystery rounds specifically, the count-up is held back until the
  // slot reel has actually landed (see MysteryMultiplierChip) — otherwise
  // the score climbing gives away that a bonus is coming before the reel
  // reveals what it is. useAnimatedScore adds its own 1s buffer on top of
  // this delay, so that's subtracted back out, plus a short beat so the
  // number lands before the score starts moving.
  const isMystery = revealParty?.event === 'mystery';
  const mysteryScoreDelay = isMystery ? Math.max(300, MYSTERY_LANDING_MS - 1000 + 250) : 300;
  // holdDelta hides the "+N pts" line and its breakdown (below) until this
  // same delay elapses — without it they render at mount, before the host's
  // reel has even landed, and give away the multiplier's size in advance.
  const { displayScore, deltaFading, revealed } = useAnimatedScore(myScore, myScoreDelta, mysteryScoreDelay, false, isMystery);
  const gapClass = squeezeValue(squeeze, 'gap-2', 'gap-3', 'gap-5');
  const paddingClass = revealPadding(wide, squeeze);
  const gapPx = squeezeValue(squeeze, 8, 12, 20);
  const paddingPx = squeezeValue(squeeze, 24, 32, 48);
  // Mirrors PartyRevealExtras' own render gate (mysteryMultiplier is always
  // null here — hideMysteryChip is passed below — so that half of its gate
  // never applies on the player screen) so the budget only reserves a row +
  // gap for it when it's actually going to render one.
  const willShowPartyExtras = !!(
    revealParty?.event === 'double'
    || (revealParty?.event === 'chaoshints' && result.chaosFakeIndex != null)
    || stealResult
    || (!stealResult && result.stealPending)
  );
  const breakdownLineCount = myScoreDelta > 0 && myBreakdown ? breakdownLines(myBreakdown, isMystery).length : 0;
  let scoreBoxPx = SCORE_BOX_BASE_PX[tier];
  if (ultraCompact) {
    if (myScoreDelta !== 0) scoreBoxPx += ULTRA_DELTA_BLOCK_PX;
  } else {
    if (myScoreDelta !== 0) scoreBoxPx += DELTA_LINE_PX;
    scoreBoxPx += breakdownLineCount * BREAKDOWN_LINE_PX;
  }
  if (myStreak >= 2) scoreBoxPx += STREAK_LINE_PX;
  const chromeHeight = cardHeight + gapPx * (willShowPartyExtras ? 3 : 2) + paddingPx
    + (willShowPartyExtras ? PARTY_EXTRAS_PX[tier] : 0) + scoreBoxPx;
  const listMaxHeight = `${Math.max(LIST_MIN_PX[tier], Math.min(LIST_TIER_CAP[tier], windowHeight - chromeHeight))}px`;
  const scoreBoxPadding = squeezeValue(squeeze, '10px 20px', '12px 24px', '16px 32px');
  const scoreTextClass = squeezeValue(squeeze, 'text-xl', 'text-2xl', 'text-3xl');
  return (
    <div className="page-enter relative min-h-screen reveal-screen-height" style={{ overflowY: 'auto', overscrollBehavior: 'contain' }}>
      <div className={`screen-center-safe relative flex min-h-full flex-col items-center ${gapClass} ${paddingClass}`} style={{ minHeight: '100%' }}>
        <img
          src={`${import.meta.env.BASE_URL}backgrounds/background3-2.png`}
          alt=""
          aria-hidden="true"
          // This layer belongs to the scroll content, rather than the
          // viewport, so the portrait artwork continues behind every reveal
          // card and score row on a phone.
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 0 }}
        />
        <div style={{ position: 'absolute', inset: 0, zIndex: 1, background: 'rgba(5,5,14,0.82)', backdropFilter: 'blur(28px)' }} />
        <div className={`relative flex flex-col items-center ${gapClass} w-full`} style={{ zIndex: 2 }}>
        <div className="liquid-btn relative" style={{ width: computeCardWidth(squeeze, wide), height: `${cardHeight}px` }}>
          <LiquidGlass
            style={{ position: 'absolute', top: '50%', left: '50%' }}
            {...LIQUID_CARD_PROPS}
            padding={cardPadding(wide, squeeze)}
          >
            {cardContent}
          </LiquidGlass>
        </div>

        {!isFinalReveal && <PartyRevealExtras result={result} stealResult={stealResult} hints={game.hints} hideMysteryChip />}

        {guessesList && (
          <div style={{ maxHeight: listMaxHeight, overflowY: 'auto', overscrollBehavior: 'contain', width: '100%', display: 'flex', justifyContent: 'center' }}>
            {guessesList}
          </div>
        )}

        <div style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', padding: scoreBoxPadding, textAlign: 'center' }}>
          {myScoreDelta !== 0 && revealed && (
            <p
              className={`font-bold tabular-nums flex items-center justify-center gap-1 ${scoreDeltaClass(myScoreDelta)}`}
              style={scoreDeltaAnimation(myScoreDelta)}
            >
              {myScoreDelta < 0 ? `-${Math.abs(myScoreDelta).toLocaleString()} pts` : `+${myScoreDelta.toLocaleString()} pts`}
            </p>
          )}
          {myScoreDelta > 0 && revealed && myBreakdown && (
            // ultraCompact swaps the stacked per-line breakdown for the same
            // "·"-joined single line the year-format guesses list already
            // uses (breakdownCompact) — at the tightest squeeze, 3-4 lines of
            // margin-bearing text costs more room than this screen can spare
            // (see PlayRevealView's landscape phone fixtures), and one line
            // still shows exactly where the points came from.
            ultraCompact
              ? <p className="text-white/40 text-[0.66rem] tabular-nums mt-0.5">{breakdownCompact(myBreakdown, isMystery)}</p>
              : <PointsBreakdownList breakdown={myBreakdown} hideMultiplier={isMystery} />
          )}
          <p
            // Remounts once when deltaFading flips true (the count-up landing
            // on its final value), replaying the one-shot flash below — the
            // moment a huge round's total actually arrives gets its own
            // payoff instead of just quietly stopping.
            key={Math.abs(myScoreDelta) >= BIG_POINTS_THRESHOLD && deltaFading ? 'landed' : 'counting'}
            className={`${scoreTextClass} font-black text-white mt-1`}
            style={Math.abs(myScoreDelta) >= BIG_POINTS_THRESHOLD && deltaFading ? { animation: 'scoreLandFlash 0.7s ease-out' } : undefined}
          >
            {displayScore.toLocaleString()}
          </p>
          {/* ultraCompact folds the rank into the same line as the "your
              score" label instead of its own line — one less line-height +
              margin at the squeeze that needs it most. */}
          {ultraCompact && myRank && myRank.total > 1 ? (
            <p className="text-white/45 text-xs">your score · #{myRank.rank} of {myRank.total}</p>
          ) : (
            <>
              <p className="text-white/45 text-sm">your score</p>
              {myRank && myRank.total > 1 && (
                <p className="text-white/35 text-xs font-semibold tabular-nums mt-0.5">#{myRank.rank} of {myRank.total}</p>
              )}
            </>
          )}
          {scoreExtra}
          {myStreak >= 2 && (
            <p className="flex items-center justify-center gap-1 text-orange-400 text-xs font-bold mt-1">
              <Flame className="w-3 h-3" />{myStreak} in a row
            </p>
          )}
        </div>
        </div>
      </div>
    </div>
  );
}

export function YearRevealView({ game, result }: Readonly<{ game: PlayState; result: RoundResultEvent }>) {
  const { myName } = game;
  const squeeze = useRevealLayout(usePlayerScaleValue());
  const finaleResolved = result.party?.duelProgress?.wins.some(w => w.count >= 2) ?? false;
  const isFinalReveal = game.roundIndex + 1 >= game.totalRounds && (!result.party?.finale || finaleResolved);
  const finalLabel = game.myScoreDelta > 0 ? 'You scored' : 'Not quite';
  if (isFinalReveal) {
    return (
      <PlayRevealShell
        game={game}
        result={result}
        squeeze={squeeze}
        wide
        cardHeight={computeYearCardHeight(!!result.coverUrl, null, squeeze)}
        cardContent={<FinalRoundAnswerContent result={result} label={finalLabel} muted squeeze={squeeze} />}
        guessesList={null}
      />
    );
  }

  // The timeline card already shows every player's guess and distance, and
  // the score box below already shows the current player's own points +
  // breakdown — this strip only adds what neither of those does: other
  // players' points earned this round.
  const scorers = (result.yearResults ?? []).filter(r => r.points > 0 && r.name !== myName).sort((a, b) => b.points - a.points);
  const guessesList = scorers.length > 0 && (
    <div style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', padding: '8px 12px', width: '310px', maxWidth: '92vw' }} className="space-y-1">
      {scorers.map(r => (
        <div key={r.name} className="flex flex-col gap-0">
          <div className="flex justify-between items-center gap-2">
            <span className={`text-xs min-w-0 truncate ${r.name === myName ? 'text-white font-semibold' : 'text-white/45'}`}>{r.name}</span>
            <span className="ml-1.5 text-xs text-sky-400 font-semibold tabular-nums shrink-0">+{r.points.toLocaleString()}</span>
          </div>
          {r.breakdown && (
            <p className="text-white/35 text-[0.62rem] text-right leading-tight break-words" style={{ overflowWrap: 'anywhere' }}>{breakdownCompact(r.breakdown, result.party?.event === 'mystery')}</p>
          )}
        </div>
      ))}
    </div>
  );
  return (
    <PlayRevealShell
      game={game}
      result={result}
      squeeze={squeeze}
      wide
      cardHeight={computeYearCardHeight(!!result.coverUrl, result, squeeze)}
      cardContent={<YearTimelineContent result={result} muted squeeze={squeeze} />}
      guessesList={guessesList}
    />
  );
}

export function RevealView({ game, result }: Readonly<{ game: PlayState; result: RoundResultEvent }>) {
  const { myName, myRaceTimeMs, leaderboard } = game;
  const squeeze = useRevealLayout(usePlayerScaleValue());
  const isRace = result.mode === 'race';
  const iGotItInRace = isRace && !!result.correctGuessers?.includes(myName);
  const finaleResolved = result.party?.duelProgress?.wins.some(w => w.count >= 2) ?? false;
  const isFinalReveal = game.roundIndex + 1 >= game.totalRounds && (!result.party?.finale || finaleResolved);
  const finalLabel = game.myScoreDelta > 0 ? 'You scored' : 'Not quite';
  const cardHeight = computeCardHeight(!!result.coverUrl, squeeze);

  // Mirrors host RevealView's frozenOrderRef: a steal round's flight
  // animation needs the rows to hold still through the reveal, so the crowd
  // list can't re-sort live off score_update the way every other round type
  // does — freeze it as of this round's first render instead.
  const revealParty = result.party ?? game.party;
  const isStealRound = revealParty?.event === 'steal';
  const frozenGuessOrderRef = useRef<string[] | null>(null);
  if (!isStealRound) frozenGuessOrderRef.current = null;
  else if (!frozenGuessOrderRef.current && result.playerGuesses) {
    frozenGuessOrderRef.current = sortGuessesByScore(result.playerGuesses, leaderboard).map(g => g.name);
  }
  function sortedGuesses(guesses: PlayerGuess[]): PlayerGuess[] {
    if (isStealRound && frozenGuessOrderRef.current) {
      const order = frozenGuessOrderRef.current;
      return order.map(name => guesses.find(g => g.name === name)).filter((g): g is PlayerGuess => !!g);
    }
    return sortGuessesByScore(guesses, leaderboard);
  }

  if (isFinalReveal) {
    return (
      <PlayRevealShell
        game={game}
        result={result}
        squeeze={squeeze}
        cardHeight={cardHeight}
        cardContent={<FinalRoundAnswerContent result={result} label={finalLabel} muted squeeze={squeeze} />}
        guessesList={null}
        scoreExtra={iGotItInRace && myRaceTimeMs != null && (
          <p className="text-green-400 text-xs font-semibold mt-1">
            You got it in {(myRaceTimeMs / 1000).toFixed(1)}s
          </p>
        )}
      />
    );
  }

  if (!result.correct) {
    const guessesList = result.playerGuesses && result.playerGuesses.length > 0 && (
      <div style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', padding: '8px 12px', width: '310px', maxWidth: '92vw' }} className="space-y-1">
        {sortedGuesses(result.playerGuesses).map(g => {
          const ellipsis = g.live ? '…' : '';
          return (
            <div key={g.name} className="flex flex-col gap-0.5">
              <div className="flex justify-between items-start gap-2">
                <span className="text-white/45 text-xs min-w-0 truncate">{g.name}</span>
                <span className="text-xs text-right min-w-0 break-words italic text-white/28" style={{ overflowWrap: 'anywhere' }}>
                  {g.guess === null ? 'skipped' : `"${g.guess}${ellipsis}"`}
                </span>
              </div>
              {g.artistGuess && (
                <p className={`text-xs italic text-right break-words ${artistGuessClass(!!g.artistCorrect, false)}`} style={{ overflowWrap: 'anywhere' }}>
                  "{g.artistGuess}"
                </p>
              )}
            </div>
          );
        })}
      </div>
    );
    return (
      <PlayRevealShell
        game={game}
        result={result}
        squeeze={squeeze}
        cardHeight={cardHeight}
        cardContent={<NoOneGotItCardContent result={result} squeeze={squeeze} />}
        guessesList={guessesList}
      />
    );
  }

  const guessesList = result.playerGuesses && result.playerGuesses.length > 0 && (
    <div style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', padding: '8px 12px', width: '310px', maxWidth: '92vw' }} className="space-y-1">
      {sortedGuesses(result.playerGuesses).map(g => {
        const correct = isRace ? !!result.correctGuessers?.includes(g.name) : (g.name === result.guesserName);
        const guessClass = guessTextClass(g.guess, correct);
        const ellipsis = g.live ? '…' : '';
        return (
          <div key={g.name} className="flex flex-col gap-0.5">
            <div className="flex justify-between items-start gap-2">
              <span className={`text-xs min-w-0 truncate ${correct ? 'text-white font-semibold' : 'text-white/45'}`}>{g.name}</span>
              <span className={`text-xs text-right min-w-0 break-words ${guessClass}`} style={{ overflowWrap: 'anywhere' }}>
                {g.guess === null ? 'skipped' : `"${g.guess}${ellipsis}"`}
                {correct && g.timeMs != null && (
                  <span className="ml-1 text-white/45 text-xs">{(g.timeMs / 1000).toFixed(1)}s</span>
                )}
              </span>
            </div>
            {g.artistGuess && (
              <p className={`text-xs italic text-right break-words ${artistGuessClass(!!g.artistCorrect, correct)}`} style={{ overflowWrap: 'anywhere' }}>
                "{g.artistGuess}"
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
  return (
    <PlayRevealShell
      game={game}
      result={result}
      squeeze={squeeze}
      cardHeight={cardHeight}
      cardContent={<GotItCardContent result={result} myName={myName} squeeze={squeeze} />}
      guessesList={guessesList}
      scoreExtra={iGotItInRace && myRaceTimeMs != null && (
        <p className="text-green-400 text-xs font-semibold mt-1">
          You got it in {(myRaceTimeMs / 1000).toFixed(1)}s
        </p>
      )}
    />
  );
}
