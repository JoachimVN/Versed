import React, { useEffect, useRef, useState } from 'react';
import { Flame } from 'lucide-react';
import LiquidGlass from '../../components/StableLiquidGlass';
import { socket } from '../../socket';
import { useAnimatedScore } from '../../hooks/useAnimatedScore';
import { BIG_POINTS_THRESHOLD, FinalRoundAnswerContent, NoOneGotItCardContent, GotItCardContent, PillButton } from '../../components/RevealShared';
import type { CardSqueeze } from '../../components/RevealShared';
import { YearTimelineContent } from '../../components/YearReveal';
import { computeYearCardHeight } from '../../components/yearCardSqueeze';
import type { RevealLayout } from '../../components/revealSqueeze';
import { useRevealLayout, computeCardHeight, computeCardWidth } from '../../components/revealSqueeze';
import { PartyRevealExtras, MYSTERY_LANDING_MS } from '../../components/RoundIntro';
import { LIQUID_CARD_PROPS } from '../../components/liquidGlassPresets';
import { useHostScaleValue } from '../../hooks/useHostScale';
import type { PlayerInfo, RoundResultEvent } from '../../types';
import type { HostState } from './useHostGame';
import { EndGameButton } from './dialogs';

// This screen (unlike the guessing screen) never has a keyboard to reserve
// room for — it's host-only, no text input — so the squeeze only has to
// react to raw window height (see useRevealLayout in revealSqueeze.ts). The
// host reveal card is centered inside a fixed-height box rather than sized
// to its own content (see the `.liquid-btn` wrapper below), so shrinking it
// without correspondingly shrinking every card's own font/image sizes would
// just leave it floating in dead space at best, or overlapping the roster
// below it at worst — hence computeCardHeight() tracking the exact same
// tiers passed to the card content components. A big roster (7+ players) not
// fitting even at normal on a tall phone is handled separately by capping the
// player list's own height (see computeListMaxHeight below) rather than by
// dragging the squeeze thresholds up near desktop heights, which would
// compact the desktop view too.

type GuessCorrectness = 'none' | 'correct' | 'exact';
type PlayerGuess = {
  guess: string | null;
  timeMs?: number | null;
  live?: boolean;
  artistGuess?: string | null;
  artistCorrect?: boolean;
};
type RevealRowProps = {
  player: PlayerInfo;
  delta: number;
  streak: number;
  displayScore: number;
  displayDelta: number;
  deltaFading: boolean;
  revealed: boolean;
  big: boolean;
  removePlayer: (name: string) => void;
  registerRow?: (el: HTMLButtonElement | null) => void;
};

// The artist guess can be right even when the title guess isn't — that combo
// scores no bonus, so it gets a muted green (visibly "correct") rather than
// the full "correct" green, which would wrongly imply it paid out.
function artistGuessClass(artistCorrect: boolean, titleCorrect: boolean): string {
  if (!artistCorrect) return 'text-white/40';
  return titleCorrect ? 'text-green-400' : 'text-green-400/50';
}

function deltaClass(delta: number, big: boolean): string {
  if (delta < 0) return 'text-xs text-red-400';
  if (big) return 'text-sm font-bold text-amber-300';
  return 'text-xs text-sky-400';
}

function deltaAnimation(delta: number, big: boolean): string | undefined {
  if (delta < 0) return 'stealHit 0.6s ease-out';
  if (big) return 'bigPointsPop 0.7s cubic-bezier(0.34, 1.56, 0.64, 1)';
  return undefined;
}

function deltaText(displayDelta: number, delta: number, pity: boolean, pityAmount: number): string {
  if (delta < 0) return `-${Math.abs(displayDelta).toLocaleString()}`;
  const pityText = pity ? ` (+${pityAmount.toLocaleString()} pity)` : '';
  const points = displayDelta > 0 ? displayDelta.toLocaleString() : '';
  return `+${points}${pityText}`;
}

function UnsubmittedPlayerRow({
  player, delta, streak, displayScore, displayDelta, deltaFading, revealed, big, pity, pityAmount, removePlayer, registerRow,
}: Readonly<RevealRowProps & { pity: boolean; pityAmount: number }>) {
  const rowDeltaClass = deltaClass(delta, big);
  const rowDeltaAnimation = deltaAnimation(delta, big);
  return (
    <button ref={registerRow} type="button" onClick={() => removePlayer(player.name)} aria-label={`Remove ${player.name}`} className="relative group w-full text-left py-1">
      <div className="flex justify-between items-center gap-2">
        <div className="flex items-center gap-1 min-w-0">
          {streak >= 2 && (
            <span className="flex items-center gap-0.5 text-orange-400 text-xs font-bold shrink-0">
              <Flame className="w-3 h-3" />{streak}
            </span>
          )}
          <span className="text-xs truncate text-white/45">{player.name}</span>
        </div>
        <div className="flex flex-col items-end shrink-0">
          {delta !== 0 && (
            <p
              className={`tabular-nums flex items-center gap-0.5 transition-opacity duration-500 ${(deltaFading || !revealed) ? 'opacity-0' : 'opacity-100'} ${rowDeltaClass}`}
              style={rowDeltaAnimation ? { animation: rowDeltaAnimation } : undefined}
            >
              {deltaText(displayDelta, delta, pity, pityAmount)}
            </p>
          )}
          <p className="text-white/60 text-xs tabular-nums">{displayScore.toLocaleString()}</p>
        </div>
      </div>
      <span className="absolute -inset-x-3 -inset-y-1 rounded-lg backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity" />
    </button>
  );
}

function SubmittedPlayerRow({
  player, entry, delta, pity, pityAmount, streak, displayScore, displayDelta, deltaFading, revealed, big, correct, removePlayer, registerRow,
}: Readonly<RevealRowProps & { entry: PlayerGuess; pity: boolean; pityAmount: number; correct: GuessCorrectness }>) {
  const skipped = entry.guess === null;
  const liveGuessSuffix = entry.live ? '…' : '';
  const guessText = skipped ? 'skipped' : `"${entry.guess}${liveGuessSuffix}"`;
  const correctCls = correct === 'exact' ? 'text-amber-400' : 'text-green-400';
  const guessCls = (!skipped && correct !== 'none') ? `${correctCls} text-xs break-words min-w-0` : 'text-white/28 italic text-xs break-words min-w-0';
  const rowDeltaClass = deltaClass(delta, big);
  const rowDeltaAnimation = deltaAnimation(delta, big);
  const rowDeltaText = deltaText(displayDelta, delta, pity, pityAmount);

  return (
    <button ref={registerRow} type="button" onClick={() => removePlayer(player.name)} aria-label={`Remove ${player.name}`} className="relative group w-full text-left py-1">
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
        {delta !== 0 && (
          <p
            className={`tabular-nums shrink-0 flex items-center gap-0.5 transition-opacity duration-500 ${(deltaFading || !revealed) ? 'opacity-0' : 'opacity-100'} ${rowDeltaClass}`}
            style={rowDeltaAnimation ? { animation: rowDeltaAnimation } : undefined}
          >
            {rowDeltaText}
          </p>
        )}
      </div>
      {/* Row 2: guess | total score */}
      <div className="flex flex-col gap-0.5">
        <div className="flex justify-between items-start gap-2">
          <p className={guessCls}>
            {guessText}
            {correct !== 'none' && entry.timeMs != null && (
              <span className="ml-1 text-white/45 text-xs">{(entry.timeMs / 1000).toFixed(1)}s</span>
            )}
          </p>
          <p
            // Remounts once when deltaFading flips true (the count-up landing
            // on its final value), replaying the one-shot flash below —
            // otherwise a huge round's total just quietly stops climbing.
            key={big && deltaFading ? 'landed' : 'counting'}
            className="text-white/60 text-xs tabular-nums shrink-0"
            style={big && deltaFading ? { animation: 'scoreLandFlash 0.7s ease-out' } : undefined}
          >
            {displayScore.toLocaleString()}
          </p>
        </div>
        {entry.artistGuess && (
          <p className={`text-xs break-words ${artistGuessClass(!!entry.artistCorrect, correct !== 'none')}`} style={{ overflowWrap: 'anywhere' }}>
            "{entry.artistGuess}"
          </p>
        )}
      </div>
      <span className="absolute -inset-x-3 -inset-y-1 rounded-lg backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity" />
    </button>
  );
}

function RevealPlayerRow({
  player, entry, delta, pity, pityAmount, delay, correct, instant, holdReveal, removePlayer, registerRow,
}: Readonly<{
  player: PlayerInfo;
  entry?: PlayerGuess;
  delta: number;
  pity: boolean;
  pityAmount: number;
  delay: number;
  correct: GuessCorrectness;
  instant: boolean;
  holdReveal: boolean;
  removePlayer: (name: string) => void;
  registerRow?: (el: HTMLButtonElement | null) => void;
}>) {
  const { displayScore, displayDelta, deltaFading, revealed } = useAnimatedScore(player.score ?? 0, delta, delay, instant, holdReveal);
  const streak = player.streak ?? 0;
  const big = Math.abs(delta) >= BIG_POINTS_THRESHOLD;
  const rowProps = { player, delta, streak, displayScore, displayDelta, deltaFading, revealed, big, removePlayer, registerRow };
  return entry
    ? <SubmittedPlayerRow {...rowProps} entry={entry} pity={pity} pityAmount={pityAmount} correct={correct} />
    : <UnsubmittedPlayerRow {...rowProps} pity={pity} pityAmount={pityAmount} />;
}

// Host-only: floats a "-N" badge from the steal victim's row to the thief's
// the instant a steal resolves, using their live DOM positions (rowRefs) —
// selling the amount as points physically changing hands rather than two
// rows updating independently. Skipped entirely for reduced-motion, same as
// the mystery reel.
function StealFlightOverlay({ stealResult, rowRefs }: Readonly<{
  stealResult: { thief: string; victim: string; amount: number; skipped?: boolean } | null;
  rowRefs: React.MutableRefObject<Record<string, HTMLButtonElement | null>>;
}>) {
  const [flight, setFlight] = useState<{ key: string; left: number; top: number; dx: number; dy: number; amount: number } | null>(null);
  const firedForRef = useRef<string | null>(null);
  // getBoundingClientRect() returns real, already-zoomed screen coordinates.
  // This overlay renders inside the same host-scale-shell it measures, so
  // writing those numbers straight back as inline px (below) would let
  // `zoom` multiply them a second time, launching the badge from/to the
  // wrong spot. Dividing by the live scale here cancels that out.
  const hostScale = useHostScaleValue();

  useEffect(() => {
    if (!stealResult || stealResult.skipped) return;
    const token = `${stealResult.thief}|${stealResult.victim}|${stealResult.amount}`;
    if (firedForRef.current === token) return;
    firedForRef.current = token;
    if (globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const victimEl = rowRefs.current[stealResult.victim];
    const thiefEl = rowRefs.current[stealResult.thief];
    if (!victimEl || !thiefEl) return;
    const vRect = victimEl.getBoundingClientRect();
    const tRect = thiefEl.getBoundingClientRect();
    const from = { x: vRect.left + vRect.width / 2, y: vRect.top + vRect.height / 2 };
    const to = { x: tRect.left + tRect.width / 2, y: tRect.top + tRect.height / 2 };
    setFlight({
      key: token,
      left: from.x / hostScale,
      top: from.y / hostScale,
      dx: (to.x - from.x) / hostScale,
      dy: (to.y - from.y) / hostScale,
      amount: stealResult.amount,
    });
    const t = setTimeout(() => setFlight(null), 950);
    return () => clearTimeout(t);
  }, [stealResult, rowRefs, hostScale]);

  if (!flight) return null;
  return (
    <span
      key={flight.key}
      aria-hidden="true"
      style={{
        position: 'fixed', left: `${flight.left}px`, top: `${flight.top}px`, zIndex: 55, pointerEvents: 'none',
        padding: '4px 12px', borderRadius: '100px', whiteSpace: 'nowrap',
        background: 'rgba(248,113,113,0.95)', color: '#fff', fontWeight: 800, fontSize: '0.78rem',
        boxShadow: '0 6px 20px rgba(248,113,113,0.55)',
        ['--steal-dx' as string]: `${flight.dx}px`,
        ['--steal-dy' as string]: `${flight.dy}px`,
        animation: 'stealFlight 0.9s cubic-bezier(0.32, 0.72, 0.35, 1) forwards',
      } as React.CSSProperties}
    >
      -{flight.amount.toLocaleString()}
    </span>
  );
}

function RevealShell({
  game, result, instant, cardHeight, cardContent, isCorrectFor, wide = false, squeeze,
}: Readonly<{
  game: HostState;
  result: RoundResultEvent;
  instant: boolean;
  cardHeight: number;
  cardContent: React.ReactNode;
  isCorrectFor: (player: PlayerInfo) => GuessCorrectness;
  wide?: boolean;
  squeeze: RevealLayout;
}>) {
  const { compact, ultraCompact, windowHeight } = squeeze;
  const { roundIndex, totalRounds, players, roundDeltas, roundPity, roundPityAmount, removePlayer, endGame, stealResult, party } = game;
  // Every sub-round of the finale duel reports finale:true — the host can't
  // tell from roundIndex/totalRounds alone whether clicking "next" advances
  // to another duel game or actually ends the match, so it gets a neutral
  // label instead of prematurely promising "Final Results".
  let nextLabel = 'Next Round';
  const revealParty = result.party ?? party;
  // A mystery round's true (multiplied) score shouldn't visibly count up
  // until the slot reel has actually landed on the multiplier — otherwise
  // the score climbing gives away that a bonus is coming before the reel
  // says what it is. useAnimatedScore bakes in its own 1s buffer on top of
  // this delay, so subtract that back out once the reel's landing time
  // covers it, plus a short beat so the number lands before the score moves.
  const isMystery = revealParty?.event === 'mystery';
  const baseScoreDelay = isMystery ? Math.max(400, MYSTERY_LANDING_MS - 1000 + 250) : 400;
  const finaleResolved = revealParty?.duelProgress?.wins.some(w => w.count >= 2) ?? false;
  if (revealParty?.finale && !finaleResolved) nextLabel = 'Continue';
  else if (roundIndex + 1 >= totalRounds) nextLabel = 'Final Results';
  const isFinalReveal = roundIndex + 1 >= totalRounds && (!revealParty?.finale || finaleResolved);

  // A steal round's flight animation needs the victim/thief rows to hold
  // still between "steal_result" landing and the flight finishing — but
  // score_update resorts the list live, the instant the steal's score change
  // arrives, which would yank both rows out from under the animation. So for
  // steal rounds only, freeze the row order as of this reveal's first render
  // (i.e. before anyone's points for this round, let alone the steal, have
  // landed) instead of re-sorting live like every other round type does.
  const isStealRound = revealParty?.event === 'steal';
  const frozenOrderRef = useRef<string[] | null>(null);
  if (!isStealRound) frozenOrderRef.current = null;
  else if (!frozenOrderRef.current) frozenOrderRef.current = players.slice().sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).map(p => p.name);
  const sortedPlayers = isStealRound && frozenOrderRef.current
    ? frozenOrderRef.current.map(name => players.find(p => p.name === name)).filter((p): p is PlayerInfo => !!p)
    : players.slice().sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const rowRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const gapClass = ultraCompact ? 'gap-2' : compact ? 'gap-3' : 'gap-5';
  const paddingClass = wide ? (ultraCompact ? 'px-2 py-3' : compact ? 'px-2 py-4' : 'px-2 py-6') : (ultraCompact ? 'p-3' : compact ? 'p-4' : 'p-6');
  // Caps the roster to roughly 5 rows visible at once (Kahoot-style) rather
  // than growing the page with every player — Next Round/End game sit right
  // after this box in normal flow, so a big roster only costs this box a
  // small internal scroll instead of pushing them further down the page.
  // Small rosters never hit the cap, so this is a no-op for them. Sized off
  // the tier's own actual leftover room (windowHeight minus everything else
  // the tier renders), not just a flat per-tier number: a 7-player roster on
  // a tall phone (844px) still lands in the "normal" tier — full-size card,
  // gaps, button — where a flat 260px cap alone would overflow the button
  // below the fold, but shrinking every device's cap down to fit that one
  // case would needlessly cramp a real desktop window with the same tier.
  const gapPx = ultraCompact ? 8 : compact ? 12 : 20;
  const buttonPx = ultraCompact ? 44 : compact ? 54 : 64;
  const paddingPx = ultraCompact ? 24 : compact ? 32 : 48;
  const listTierCap = ultraCompact ? 130 : compact ? 200 : 260;
  // 4 gaps across up to 5 flex children (card, party-extras, list, button,
  // end-game); ~20px covers end-game's own text + its gap when rendered.
  const chromeHeight = cardHeight + gapPx * 4 + buttonPx + 20 + paddingPx;
  const listMaxHeight = `${Math.max(90, Math.min(listTierCap, windowHeight - chromeHeight))}px`;
  return (
    <div className="page-enter relative min-h-screen reveal-screen-height" style={{ overflowY: 'auto', overscrollBehavior: 'contain' }}>
      <div className={`screen-center-safe relative flex min-h-full flex-col items-center ${gapClass} ${paddingClass}`} style={{ minHeight: '100%' }}>
        <img
          src={`${import.meta.env.BASE_URL}backgrounds/background3-2.png`}
          alt=""
          aria-hidden="true"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 0, transform: 'rotate(180deg)' }}
        />
        <div style={{ position: 'absolute', inset: 0, zIndex: 1, background: 'rgba(5,5,14,0.56)', backdropFilter: 'blur(32px)' }} />
        {/* Absolutely positioned rather than a flex row of its own: it's the
            only thing in the header, so giving it a dedicated row just to
            hold one small label wastes a full gap's worth of height on every
            tier — a real cost on a short screen. */}
        <p className="text-white/45 text-xs" style={{ position: 'absolute', top: '10px', left: '14px', zIndex: 3 }}>{roundIndex + 1} / {totalRounds}</p>

        <div className="liquid-btn relative" style={{ width: computeCardWidth(squeeze, wide), height: `${cardHeight}px`, zIndex: 2 }}>
          <LiquidGlass
            style={{ position: 'absolute', top: '50%', left: '50%' }}
            {...LIQUID_CARD_PROPS}
            padding={wide ? '18px 18px' : (ultraCompact ? '16px 16px' : compact ? '20px 20px' : '24px 24px')}
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
          <div style={{ position: 'relative', zIndex: 2, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', padding: '8px 12px', width: '310px', maxWidth: '92vw', maxHeight: listMaxHeight, overflowY: 'auto', overscrollBehavior: 'contain' }} className="divide-y divide-white/[0.07]">
            {sortedPlayers.map((p, i) => (
              <RevealPlayerRow
                key={p.name}
                player={p}
                entry={result.playerGuesses?.find(g => g.name === p.name)}
                delta={roundDeltas[p.name] ?? 0}
                pity={roundPity[p.name] ?? false}
                pityAmount={roundPityAmount[p.name] ?? 0}
                delay={baseScoreDelay + i * 80}
                correct={isCorrectFor(p)}
                instant={instant}
                holdReveal={isMystery}
                removePlayer={removePlayer}
                registerRow={isStealRound ? (el => { rowRefs.current[p.name] = el; }) : undefined}
              />
            ))}
          </div>
        )}

        {isStealRound && <StealFlightOverlay stealResult={stealResult} rowRefs={rowRefs} />}

        <PillButton
          onClick={() => socket.emit('next_round')}
          label={nextLabel}
          zIndex={2}
          squeeze={squeeze}
        />

        {roundIndex + 1 < totalRounds && (
          <div style={{ position: 'relative', zIndex: 2 }}>
            <EndGameButton endGame={endGame} />
          </div>
        )}
      </div>
    </div>
  );
}

export function RevealView({ game, result, instant = false }: Readonly<{ game: HostState; result: RoundResultEvent; instant?: boolean }>) {
  const isRace = result.mode === 'race';
  const finaleResolved = result.party?.duelProgress?.wins.some(w => w.count >= 2) ?? false;
  const isFinalReveal = game.roundIndex + 1 >= game.totalRounds && (!result.party?.finale || finaleResolved);
  const squeeze = useRevealLayout(useHostScaleValue());

  if (isFinalReveal) {
    const isYearReveal = result.party?.format === 'year' || result.yearOnly;
    const finalCardHeight = isYearReveal
      ? computeYearCardHeight(!!result.coverUrl, null, squeeze)
      : computeCardHeight(!!result.coverUrl, squeeze);

    return (
      <RevealShell
        game={game}
        result={result}
        instant={instant}
        cardHeight={finalCardHeight}
        cardContent={<FinalRoundAnswerContent result={result} label="Final answer" squeeze={squeeze} />}
        isCorrectFor={() => 'none'}
        squeeze={squeeze}
      />
    );
  }

  // "Guess the year" rounds (party or the game-wide toggle) have a numeric answer.
  if (result.party?.format === 'year' || result.yearOnly) {
    return (
      <RevealShell
        game={game}
        result={result}
        instant={instant}
        cardHeight={computeYearCardHeight(!!result.coverUrl, result, squeeze)}
        cardContent={<YearTimelineContent result={result} squeeze={squeeze} />}
        wide
        isCorrectFor={(p) => {
          const bestDiff = result.yearResults?.find(r => r.diff !== null)?.diff ?? null;
          const diff = result.yearResults?.find(r => r.name === p.name)?.diff ?? null;
          if (diff === null || bestDiff === null || diff !== bestDiff) return 'none';
          return diff === 0 ? 'exact' : 'correct';
        }}
        squeeze={squeeze}
      />
    );
  }

  if (!result.correct) {
    return (
      <RevealShell
        game={game}
        result={result}
        instant={instant}
        cardHeight={computeCardHeight(!!result.coverUrl, squeeze)}
        cardContent={<NoOneGotItCardContent result={result} squeeze={squeeze} />}
        isCorrectFor={() => 'none'}
        squeeze={squeeze}
      />
    );
  }

  return (
    <RevealShell
      game={game}
      result={result}
      instant={instant}
      cardHeight={computeCardHeight(!!result.coverUrl, squeeze)}
      cardContent={<GotItCardContent result={result} squeeze={squeeze} />}
      squeeze={squeeze}
      isCorrectFor={(p) => {
        const correct = isRace ? !!result.correctGuessers?.includes(p.name) : (p.name === result.guesserName);
        return correct ? 'correct' : 'none';
      }}
    />
  );
}
