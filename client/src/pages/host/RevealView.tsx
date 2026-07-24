import React from 'react';
import { Flame } from 'lucide-react';
import LiquidGlass from '../../components/StableLiquidGlass';
import { socket } from '../../socket';
import { useAnimatedScore } from '../../hooks/useAnimatedScore';
import { FinalRoundAnswerContent, NoOneGotItCardContent, GotItCardContent, YearTimelineContent, PillButton } from '../../components/RevealShared';
import { PartyRevealExtras } from '../../components/RoundIntro';
import { LIQUID_CARD_PROPS } from '../../components/liquidGlassPresets';
import type { PlayerInfo, RoundResultEvent } from '../../types';
import type { HostState } from './useHostGame';
import { EndGameButton } from './dialogs';

type GuessCorrectness = 'none' | 'correct' | 'exact';

// The artist guess can be right even when the title guess isn't — that combo
// scores no bonus, so it gets a muted green (visibly "correct") rather than
// the full "correct" green, which would wrongly imply it paid out.
function artistGuessClass(artistCorrect: boolean, titleCorrect: boolean): string {
  if (!artistCorrect) return 'text-white/40';
  return titleCorrect ? 'text-green-400' : 'text-green-400/50';
}

function RevealPlayerRow({
  player, entry, delta, pity, pityAmount, delay, correct, instant, removePlayer,
}: Readonly<{
  player: PlayerInfo;
  entry?: { guess: string | null; timeMs?: number | null; live?: boolean; artistGuess?: string | null; artistCorrect?: boolean };
  delta: number;
  pity: boolean;
  pityAmount: number;
  delay: number;
  correct: GuessCorrectness;
  instant: boolean;
  removePlayer: (name: string) => void;
}>) {
  const { displayScore, displayDelta, deltaFading } = useAnimatedScore(player.score ?? 0, delta, delay, instant);
  const streak = player.streak ?? 0;
  const skipped = entry?.guess === null;
  let guessText: string | null = null;
  if (entry) {
    const ellipsis = entry.live ? '…' : '';
    guessText = skipped ? 'skipped' : `"${entry.guess}${ellipsis}"`;
  }
  const correctCls = correct === 'exact' ? 'text-amber-400' : 'text-green-400';
  const guessCls = (!skipped && correct !== 'none') ? `${correctCls} text-xs break-words min-w-0` : 'text-white/28 italic text-xs break-words min-w-0';
  if (!entry) {
    return (
      <button type="button" onClick={() => removePlayer(player.name)} aria-label={`Remove ${player.name}`} className="relative group w-full text-left py-1">
        <div className="flex justify-between items-center gap-2">
          <div className="flex items-center gap-1 min-w-0">
            {streak >= 2 && (
              <span className="flex items-center gap-0.5 text-orange-400 text-xs font-bold shrink-0">
                <Flame className="w-3 h-3" />{streak}
              </span>
            )}
            <span className="text-xs truncate text-white/45">{player.name}</span>
          </div>
          <p className="text-white/60 text-xs tabular-nums shrink-0">{displayScore.toLocaleString()}</p>
        </div>
        <span className="absolute -inset-x-3 -inset-y-1 rounded-lg backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity" />
      </button>
    );
  }

  return (
    <button type="button" onClick={() => removePlayer(player.name)} aria-label={`Remove ${player.name}`} className="relative group w-full text-left py-1">
      {/* Row 1: name + streak | delta */}
      <div className="flex justify-between items-center gap-2">
        <div className="flex items-center gap-1 min-w-0">
          {streak >= 2 && (
            <span className="flex items-center gap-0.5 text-orange-400 text-xs font-bold shrink-0">
              <Flame className="w-3 h-3" />{streak}
            </span>
          )}
          <span className={`text-xs truncate ${correct === 'none' ? 'text-white/45' : 'text-white font-semibold'}`}>{player.name}</span>
        </div>
        {delta > 0 && (
          <p className={`text-sky-400 text-xs tabular-nums shrink-0 transition-opacity duration-500 ${deltaFading ? 'opacity-0' : 'opacity-100'}`}>
            +{displayDelta > 0 ? displayDelta.toLocaleString() : ''}{pity && ` (+${pityAmount.toLocaleString()} pity)`}
          </p>
        )}
      </div>
      {/* Row 2: guess | total score */}
      <div className="flex flex-col gap-0.5">
        <div className="flex justify-between items-start gap-2">
          {guessText ? (
            <p className={guessCls}>
              {guessText}
              {correct !== 'none' && entry?.timeMs != null && (
                <span className="ml-1 text-white/45 text-xs">{(entry.timeMs / 1000).toFixed(1)}s</span>
              )}
            </p>
          ) : <span />}
          <p className="text-white/60 text-xs tabular-nums shrink-0">{displayScore.toLocaleString()}</p>
        </div>
        {entry?.artistGuess && (
          <p className={`text-xs break-words ${artistGuessClass(!!entry.artistCorrect, correct !== 'none')}`} style={{ overflowWrap: 'anywhere' }}>
            "{entry.artistGuess}"
          </p>
        )}
      </div>
      <span className="absolute -inset-x-3 -inset-y-1 rounded-lg backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity" />
    </button>
  );
}

function RevealShell({
  game, result, instant, cardHeight, cardContent, isCorrectFor, wide = false,
}: Readonly<{
  game: HostState;
  result: RoundResultEvent;
  instant: boolean;
  cardHeight: number;
  cardContent: React.ReactNode;
  isCorrectFor: (player: PlayerInfo) => GuessCorrectness;
  wide?: boolean;
}>) {
  const { roundIndex, totalRounds, players, roundDeltas, roundPity, roundPityAmount, removePlayer, endGame, stealResult, party } = game;
  // Every sub-round of the finale duel reports finale:true — the host can't
  // tell from roundIndex/totalRounds alone whether clicking "next" advances
  // to another duel game or actually ends the match, so it gets a neutral
  // label instead of prematurely promising "Final Results".
  let nextLabel = 'Next Round';
  const revealParty = result.party ?? party;
  const finaleResolved = revealParty?.duelProgress?.wins.some(w => w.count >= 2) ?? false;
  if (revealParty?.finale && !finaleResolved) nextLabel = 'Continue';
  else if (roundIndex + 1 >= totalRounds) nextLabel = 'Final Results';
  const isFinalReveal = roundIndex + 1 >= totalRounds && (!revealParty?.finale || finaleResolved);
  return (
    <div className={`page-enter relative min-h-screen flex flex-col items-center gap-5 overflow-hidden ${wide ? 'px-2 py-6' : 'p-6'}`}>
      <img
        src={`${import.meta.env.BASE_URL}background3.svg`}
        alt=""
        aria-hidden="true"
        style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 0, transform: 'rotate(180deg)' }}
      />
      <div style={{ position: 'fixed', inset: 0, zIndex: 1, background: 'rgba(5,5,14,0.82)', backdropFilter: 'blur(28px)' }} />
      <p className="text-white/45 text-sm self-start" style={{ position: 'relative', zIndex: 2 }}>{roundIndex + 1} / {totalRounds}</p>

      <div className="liquid-btn relative" style={{ width: wide ? 'min(88vw, 366px)' : '310px', height: `${cardHeight}px`, zIndex: 2 }}>
        <LiquidGlass
          style={{ position: 'absolute', top: '50%', left: '50%' }}
          {...LIQUID_CARD_PROPS}
          padding={wide ? '18px 18px' : '24px 24px'}
        >
          {cardContent}
        </LiquidGlass>
      </div>

      {!isFinalReveal && (
        <div style={{ position: 'relative', zIndex: 2 }}>
          <PartyRevealExtras result={result} stealResult={stealResult} hints={game.hints} />
        </div>
      )}

      {!isFinalReveal && (
        <div style={{ position: 'relative', zIndex: 2, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', padding: '8px 12px', width: '310px', maxWidth: '92vw' }} className="divide-y divide-white/[0.07]">
          {players.slice().sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).map((p, i) => (
            <RevealPlayerRow
              key={p.name}
              player={p}
              entry={result.playerGuesses?.find(g => g.name === p.name)}
              delta={roundDeltas[p.name] ?? 0}
              pity={roundPity[p.name] ?? false}
              pityAmount={roundPityAmount[p.name] ?? 0}
              delay={400 + i * 80}
              correct={isCorrectFor(p)}
              instant={instant}
              removePlayer={removePlayer}
            />
          ))}
        </div>
      )}

      <PillButton
        onClick={() => socket.emit('next_round')}
        label={nextLabel}
        zIndex={2}
      />

      {roundIndex + 1 < totalRounds && (
        <div style={{ position: 'relative', zIndex: 2 }}>
          <EndGameButton endGame={endGame} />
        </div>
      )}
    </div>
  );
}

export function RevealView({ game, result, instant = false }: Readonly<{ game: HostState; result: RoundResultEvent; instant?: boolean }>) {
  const isRace = result.mode === 'race';
  const finaleResolved = result.party?.duelProgress?.wins.some(w => w.count >= 2) ?? false;
  const isFinalReveal = game.roundIndex + 1 >= game.totalRounds && (!result.party?.finale || finaleResolved);

  if (isFinalReveal) {
    const isYearReveal = result.party?.format === 'year' || result.yearOnly;
    let cardHeight = 240;
    if (result.coverUrl) {
      cardHeight = 480;
    } else if (isYearReveal) {
      cardHeight = 320;
    }

    return (
      <RevealShell
        game={game}
        result={result}
        instant={instant}
        cardHeight={cardHeight}
        cardContent={<FinalRoundAnswerContent result={result} label="Final answer" />}
        isCorrectFor={() => 'none'}
      />
    );
  }

  // "Guess the year" rounds (party or the game-wide toggle) have a numeric
  // answer — dedicated card.
  if (result.party?.format === 'year' || result.yearOnly) {
    return (
      <RevealShell
        game={game}
        result={result}
        instant={instant}
        cardHeight={result.coverUrl ? 500 : 380}
        cardContent={<YearTimelineContent result={result} />}
        wide
        isCorrectFor={(p) => {
          const bestDiff = result.yearResults?.find(r => r.diff !== null)?.diff ?? null;
          const diff = result.yearResults?.find(r => r.name === p.name)?.diff ?? null;
          if (diff === null || bestDiff === null || diff !== bestDiff) return 'none';
          return diff === 0 ? 'exact' : 'correct';
        }}
      />
    );
  }

  if (!result.correct) {
    return (
      <RevealShell
        game={game}
        result={result}
        instant={instant}
        cardHeight={result.coverUrl ? 480 : 240}
        cardContent={<NoOneGotItCardContent result={result} />}
        isCorrectFor={() => 'none'}
      />
    );
  }

  return (
    <RevealShell
      game={game}
      result={result}
      instant={instant}
      cardHeight={result.coverUrl ? 480 : 240}
      cardContent={<GotItCardContent result={result} />}
      isCorrectFor={(p) => {
        const correct = isRace ? !!result.correctGuessers?.includes(p.name) : (p.name === result.guesserName);
        return correct ? 'correct' : 'none';
      }}
    />
  );
}
