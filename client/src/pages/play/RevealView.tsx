import { Flame } from 'lucide-react';
import LiquidGlass from 'liquid-glass-react';
import { useAnimatedScore } from '../../hooks/useAnimatedScore';
import { FinalRoundAnswerContent, NoOneGotItCardContent, GotItCardContent, YearTimelineContent } from '../../components/RevealShared';
import { PartyRevealExtras } from '../../components/RoundIntro';
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
  const { myScore, myScoreDelta, myPity, myPityAmount, myStreak, stealResult } = game;
  const revealParty = result.party ?? game.party;
  const finaleResolved = revealParty?.duelProgress?.wins.some(w => w.count >= 2) ?? false;
  const isFinalReveal = game.roundIndex + 1 >= game.totalRounds && (!revealParty?.finale || finaleResolved);
  // Ties the score bump to the shared reveal moment — for a mystery round
  // this is the first time the true (multiplied) total is visible, so it
  // should count up rather than just appear.
  const { displayScore, displayDelta, deltaFading } = useAnimatedScore(myScore, myScoreDelta, 300);
  return (
    <div className={`page-enter relative min-h-screen flex flex-col items-center justify-center gap-5 overflow-hidden ${wide ? 'px-2 py-6' : 'p-6'}`}>
      <img
        src={`${import.meta.env.BASE_URL}background3.svg`}
        alt=""
        aria-hidden="true"
        style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 0 }}
      />
      <div style={{ position: 'fixed', inset: 0, zIndex: 1, background: 'rgba(5,5,14,0.82)', backdropFilter: 'blur(28px)' }} />
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

        {!isFinalReveal && <PartyRevealExtras result={result} stealResult={stealResult} hints={game.hints} />}

        {guessesList}

        <div style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', padding: '16px 32px', textAlign: 'center' }}>
          {myScoreDelta > 0 && (
            <p className={`text-sky-400 text-sm font-bold tabular-nums transition-opacity duration-500 ${deltaFading ? 'opacity-0' : 'opacity-100'}`}>
              +{displayDelta > 0 ? displayDelta.toLocaleString() : ''} pts{myPity && ` (+${myPityAmount.toLocaleString()} pity)`}
            </p>
          )}
          <p className="text-3xl font-black text-white">{displayScore.toLocaleString()}</p>
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
        cardContent={<FinalRoundAnswerContent result={result} label={finalLabel} />}
        guessesList={null}
      />
    );
  }

  // The timeline card already shows every player's guess and distance —
  // this strip only adds what it doesn't: points earned this round.
  const scorers = (result.yearResults ?? []).filter(r => r.points > 0).sort((a, b) => b.points - a.points);
  const guessesList = scorers.length > 0 && (
    <div style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', padding: '8px 12px', width: '310px', maxWidth: '92vw' }} className="space-y-1">
      {scorers.map(r => (
        <div key={r.name} className="flex justify-between items-center gap-2">
          <span className={`text-xs min-w-0 truncate ${r.name === myName ? 'text-white font-semibold' : 'text-white/45'}`}>{r.name}</span>
          <span className="ml-1.5 text-xs text-sky-400 font-semibold tabular-nums shrink-0">+{r.points.toLocaleString()}{r.pity && ` (+${(r.pityAmount ?? 0).toLocaleString()} pity)`}</span>
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
      cardContent={<YearTimelineContent result={result} />}
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
        cardContent={<FinalRoundAnswerContent result={result} label={finalLabel} />}
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
