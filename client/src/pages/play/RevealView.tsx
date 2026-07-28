import { Flame } from 'lucide-react';
import LiquidGlass from '../../components/StableLiquidGlass';
import { useAnimatedScore } from '../../hooks/useAnimatedScore';
import { BIG_POINTS_THRESHOLD, FinalRoundAnswerContent, NoOneGotItCardContent, GotItCardContent, PointsBreakdownList, breakdownCompact } from '../../components/RevealShared';
import { YearTimelineContent } from '../../components/YearReveal';
import { PartyRevealExtras, MYSTERY_LANDING_MS } from '../../components/RoundIntro';
import { LIQUID_CARD_PROPS } from '../../components/liquidGlassPresets';
import type { RoundResultEvent } from '../../types';
import type { PlayState } from './usePlayGame';

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

// Reveal for "guess the year" rounds: the year card plus everyone's distances.
// Shared shell for the three reveal-screen variants (year / no-one-got-it /
// got-it): page background, liquid card, party extras, a guesses list, and
// the player's score box. Only the card content, guesses list, and an
// optional extra line under the score differ between them.
function PlayRevealShell({
  game, result, cardHeight, cardContent, guessesList, scoreExtra, wide = false,
}: Readonly<{
  game: PlayState;
  result: RoundResultEvent;
  cardHeight: number;
  cardContent: React.ReactNode;
  guessesList: React.ReactNode;
  scoreExtra?: React.ReactNode;
  wide?: boolean;
}>) {
  const { myScore, myScoreDelta, myBreakdown, myStreak, stealResult } = game;
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
  return (
    <div className="page-enter relative min-h-screen" style={{ overflowY: 'auto', overscrollBehavior: 'contain' }}>
      <div className={`screen-center-safe relative flex min-h-full flex-col items-center gap-5 ${wide ? 'px-2 py-6' : 'p-6'}`} style={{ minHeight: '100%' }}>
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
        <div className="relative flex flex-col items-center gap-5 w-full" style={{ zIndex: 2 }}>
        <div className="liquid-btn relative" style={{ width: wide ? 'min(88vw, 366px)' : '310px', height: `${cardHeight}px` }}>
          <LiquidGlass
            style={{ position: 'absolute', top: '50%', left: '50%' }}
            {...LIQUID_CARD_PROPS}
            padding={wide ? '18px 18px' : '24px 24px'}
          >
            {cardContent}
          </LiquidGlass>
        </div>

        {!isFinalReveal && <PartyRevealExtras result={result} stealResult={stealResult} hints={game.hints} hideMysteryChip />}

        {guessesList}

        <div style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', padding: '16px 32px', textAlign: 'center' }}>
          {myScoreDelta !== 0 && revealed && (
            <p
              className={`font-bold tabular-nums flex items-center justify-center gap-1 ${scoreDeltaClass(myScoreDelta)}`}
              style={scoreDeltaAnimation(myScoreDelta)}
            >
              {myScoreDelta < 0 ? `-${Math.abs(myScoreDelta).toLocaleString()} pts` : `+${myScoreDelta.toLocaleString()} pts`}
            </p>
          )}
          {myScoreDelta > 0 && revealed && myBreakdown && <PointsBreakdownList breakdown={myBreakdown} hideMultiplier={isMystery} />}
          <p
            // Remounts once when deltaFading flips true (the count-up landing
            // on its final value), replaying the one-shot flash below — the
            // moment a huge round's total actually arrives gets its own
            // payoff instead of just quietly stopping.
            key={Math.abs(myScoreDelta) >= BIG_POINTS_THRESHOLD && deltaFading ? 'landed' : 'counting'}
            className="text-3xl font-black text-white mt-1"
            style={Math.abs(myScoreDelta) >= BIG_POINTS_THRESHOLD && deltaFading ? { animation: 'scoreLandFlash 0.7s ease-out' } : undefined}
          >
            {displayScore.toLocaleString()}
          </p>
          <p className="text-white/45 text-sm">your score</p>
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
  const finaleResolved = result.party?.duelProgress?.wins.some(w => w.count >= 2) ?? false;
  const isFinalReveal = game.roundIndex + 1 >= game.totalRounds && (!result.party?.finale || finaleResolved);
  const finalLabel = game.myScoreDelta > 0 ? 'You scored' : 'Not quite';
  if (isFinalReveal) {
    return (
      <PlayRevealShell
        game={game}
        result={result}
        wide
        cardHeight={result.coverUrl ? 500 : 320}
        cardContent={<FinalRoundAnswerContent result={result} label={finalLabel} muted />}
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
      wide
      cardHeight={result.coverUrl ? 500 : 380}
      cardContent={<YearTimelineContent result={result} muted />}
      guessesList={guessesList}
    />
  );
}

export function RevealView({ game, result }: Readonly<{ game: PlayState; result: RoundResultEvent }>) {
  const { myName, myRaceTimeMs } = game;
  const isRace = result.mode === 'race';
  const iGotItInRace = isRace && !!result.correctGuessers?.includes(myName);
  const finaleResolved = result.party?.duelProgress?.wins.some(w => w.count >= 2) ?? false;
  const isFinalReveal = game.roundIndex + 1 >= game.totalRounds && (!result.party?.finale || finaleResolved);
  const finalLabel = game.myScoreDelta > 0 ? 'You scored' : 'Not quite';

  if (isFinalReveal) {
    return (
      <PlayRevealShell
        game={game}
        result={result}
        cardHeight={result.coverUrl ? 480 : 240}
        cardContent={<FinalRoundAnswerContent result={result} label={finalLabel} muted />}
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
        {result.playerGuesses.map(g => {
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
        cardHeight={result.coverUrl ? 480 : 240}
        cardContent={<NoOneGotItCardContent result={result} />}
        guessesList={guessesList}
      />
    );
  }

  const guessesList = result.playerGuesses && result.playerGuesses.length > 0 && (
    <div style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', padding: '8px 12px', width: '310px', maxWidth: '92vw' }} className="space-y-1">
      {result.playerGuesses.map(g => {
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
      cardHeight={result.coverUrl ? 480 : 240}
      cardContent={<GotItCardContent result={result} myName={myName} />}
      guessesList={guessesList}
      scoreExtra={iGotItInRace && myRaceTimeMs != null && (
        <p className="text-green-400 text-xs font-semibold mt-1">
          You got it in {(myRaceTimeMs / 1000).toFixed(1)}s
        </p>
      )}
    />
  );
}
