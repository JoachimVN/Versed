import { useState, useEffect, useRef } from 'react';
import LiquidGlass from '../../components/StableLiquidGlass';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { PartyBadge } from '../../components/RoundIntro';
import { CircularTimer } from '../../components/CircularTimer';
import { AudioBars } from '../../components/AudioBars';
import { LIQUID_CARD_PROPS, LIQUID_PILL_PROPS } from '../../components/liquidGlassPresets';
import type { Hint } from '../../types';
import type { PlayState } from './usePlayGame';
import { resolveTarget } from './guessTarget';

// Handles both the "listening" sub-phase (watching, imGuessing) and the active
// guessing phase. Keeping a single component across both states means the input
// element is never unmounted — focus and text survive the transition, which
// prevents the mobile keyboard from dismissing mid-song.
function ListeningHeader({ songPlaying, songTempo, isYear }: Readonly<{ songPlaying: boolean; songTempo: number | null; isYear: boolean }>) {
  const accent = isYear ? 'year' : 'classic';
  return (
    <div className="flex flex-col items-center gap-2.5 pt-10 pb-4">
      <AudioBars playing={songPlaying} accent={accent} height={28} bpm={songTempo} />
      <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.72rem', letterSpacing: '0.08em' }}>
        {songPlaying ? 'Your song is playing…' : 'Get ready…'}
      </span>
    </div>
  );
}

// Race mode plays the song throughout the guessing window, so it keeps the
// waveform going here too; classic has already stopped the song by the time
// a tier's turn starts, so it stays timer-only.
function ActiveHeader({ timeLeft, timerTotal, myScore, isRace, isYear, songPlaying, songTempo }: Readonly<{ timeLeft: number; timerTotal: number; myScore: number; isRace: boolean; isYear: boolean; songPlaying: boolean; songTempo: number | null }>) {
  const accent = isYear ? 'year' : 'race';
  return (
    <div className="flex flex-col items-center gap-2 pt-4 pb-3">
      <div className="flex items-center justify-between w-full px-5">
        <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.85rem', fontWeight: 600 }}>Your turn</span>
        <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.8rem', fontWeight: 500 }}>
          {myScore.toLocaleString()} pts
        </span>
      </div>
      <CircularTimer timeLeft={timeLeft} total={timerTotal} size={80} />
      {(isRace || isYear) && (
        <AudioBars playing={songPlaying} accent={accent} height={20} bpm={songTempo} />
      )}
    </div>
  );
}

const SKIP_IDLE = { border: 'rgba(255,255,255,0.16)', background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.6)' };
const SKIP_HOVER = { border: 'rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.85)' };

function applySkipStyle(el: HTMLElement, s: typeof SKIP_IDLE) {
  el.style.borderColor = s.border;
  el.style.background = s.background;
  el.style.color = s.color;
}

function guessInputBoxStyle(isListening: boolean, focused: boolean): { border: string; background: string; boxShadow: string } {
  if (isListening) {
    return { border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.03)', boxShadow: 'none' };
  }
  if (focused) {
    return { border: '1px solid rgba(158,18,204,0.7)', background: 'rgba(158,18,204,0.1)', boxShadow: '0 0 28px rgba(0,238,232,0.18), 0 0 20px rgba(158,18,204,0.22)' };
  }
  return { border: '1px solid rgba(158,18,204,0.4)', background: 'rgba(158,18,204,0.08)', boxShadow: '0 0 24px rgba(158,18,204,0.1)' };
}

// Multiple Choice's 4 tappable title options — a tap submits immediately
// (see submitChoice), so there's no separate Submit button for this format.
function ChoiceButtons({ options, onPick, disabled }: Readonly<{ options: string[]; onPick: (option: string) => void; disabled?: boolean }>) {
  const style = guessInputBoxStyle(false, false);
  return (
    <div className="w-full grid grid-cols-2 gap-3" style={{ flexShrink: 0 }}>
      {options.map(option => (
        <button
          key={option}
          type="button"
          disabled={disabled}
          onClick={() => onPick(option)}
          style={{
            borderRadius: '16px',
            border: style.border, background: style.background, boxShadow: style.boxShadow,
            color: 'white', fontSize: '0.98rem', fontWeight: 700, textAlign: 'center',
            padding: '16px 12px', minHeight: '104px', overflowWrap: 'anywhere',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
            opacity: disabled ? 0.5 : 1, transition: 'opacity 0.2s ease',
          }}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

// Chaos Hints' tap-the-fake-hint cards — one per hint, tap = submit
// immediately, same "no separate submit button" shape as ChoiceButtons.
function ChaosHintButtons({ hints, onPick, disabled }: Readonly<{ hints: Hint[]; onPick: (index: number) => void; disabled?: boolean }>) {
  const style = guessInputBoxStyle(false, false);
  return (
    <div className="w-full grid grid-cols-2 gap-2.5" style={{ flexShrink: 0 }}>
      {hints.map((h, i) => (
        <button
          key={h.label}
          type="button"
          disabled={disabled}
          onClick={() => onPick(i)}
          style={{
            borderRadius: '16px',
            border: style.border, background: style.background, boxShadow: style.boxShadow,
            padding: '14px 10px', cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
            opacity: disabled ? 0.5 : 1, transition: 'opacity 0.2s ease',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px',
          }}
        >
          <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.14em' }}>
            {h.label}
          </span>
          <span style={{ color: 'white', fontWeight: 800, fontSize: '1rem' }}>{h.value}</span>
        </button>
      ))}
    </div>
  );
}

// 4-box OTP-style display for year guesses. A single transparent input
// underneath keeps the real focus/keyboard target (so the mobile keyboard
// never dismisses), while these boxes render its current characters.
function YearDigitBox({ digit, active }: Readonly<{ digit: string; active: boolean }>) {
  return (
    <div
      style={{
        width: '48px', height: '58px', borderRadius: '12px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '1.5rem', fontWeight: 800, color: 'white',
        border: active ? '1px solid rgba(158,18,204,0.8)' : '1px solid rgba(255,255,255,0.12)',
        background: active ? 'rgba(158,18,204,0.12)' : 'rgba(255,255,255,0.04)',
        boxShadow: active ? '0 0 16px rgba(158,18,204,0.35)' : 'none',
        transition: 'border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease',
      }}
    >
      {digit}
    </div>
  );
}

// A year guess is always exactly 4 digits — a fixed set of positional
// slots, not a reorderable list, so each box is written out rather than
// mapped over an index.
function YearDigitBoxes({ value, focused }: Readonly<{ value: string; focused: boolean }>) {
  const activeIndex = Math.min(value.length, 3);
  return (
    <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', pointerEvents: 'none' }}>
      <YearDigitBox digit={value[0] ?? ''} active={focused && activeIndex === 0} />
      <YearDigitBox digit={value[1] ?? ''} active={focused && activeIndex === 1} />
      <YearDigitBox digit={value[2] ?? ''} active={focused && activeIndex === 2} />
      <YearDigitBox digit={value[3] ?? ''} active={focused && activeIndex === 3} />
    </div>
  );
}

export function GuessingView({ game }: Readonly<{ game: PlayState }>) {
  const { phase, timeLeft, timerTotal, myScore, guessText, guessInputRef, setGuessText, submitGuess, submitChoice, submitChaosTap, skipGuess, artistOnly, yearOnly, choiceOptions: gameChoiceOptions, songPlaying, songTempo, mode, party, hints, artistGuessText, setArtistGuessText } = game;
  const isListening = phase === 'watching';
  // Covers both Party's 'choice' format (party.choiceOptions) and the
  // Classic/Race Multiple Choice toggle (game.choiceOptions) — an empty/
  // undefined array either way means this round fell back to free text.
  const options = party?.choiceOptions ?? gameChoiceOptions ?? [];
  const isChoice = options.length > 0;
  const isChaosHints = party?.event === 'chaoshints';
  const target = resolveTarget(party, artistOnly, yearOnly);
  const isYear = target === 'year';
  const canSubmit = isYear ? guessText.trim().length === 4 : guessText.trim().length > 0;
  const [inputFocused, setInputFocused] = useState(false);
  const inputBoxStyle = guessInputBoxStyle(isListening, inputFocused);
  let label = {
    title: 'Name the song',
    artist: 'Name the artist',
    both: 'Name the song · artist = bonus',
    year: 'Guess the release year',
  }[target];
  if (isChoice) {
    label = {
      title: 'Tap the right title',
      artist: 'Tap the right artist',
      both: 'Tap the right title',
      year: 'Tap the right year',
    }[target];
  } else if (isChaosHints) label = 'One of these is a lie';
  const placeholder = {
    title: 'Type song title…',
    artist: 'Type artist name…',
    both: 'Type song title…',
    year: 'e.g. 1994',
  }[target];

  let guessControl: React.ReactNode;
  if (isChaosHints) {
    guessControl = <ChaosHintButtons hints={hints} onPick={submitChaosTap} />;
  } else if (isChoice) {
    guessControl = <ChoiceButtons options={options} onPick={submitChoice} />;
  } else if (isYear) {
    guessControl = (
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <YearDigitBoxes value={guessText} focused={inputFocused} />
        <input
          ref={guessInputRef}
          type="text"
          inputMode="numeric"
          value={guessText}
          onChange={e => setGuessText(e.target.value.replace(/\D/g, '').slice(0, 4))}
          onKeyDown={e => e.key === 'Enter' && canSubmit && submitGuess()}
          onFocus={() => setInputFocused(true)}
          onBlur={() => setInputFocused(false)}
          autoComplete="off" autoCorrect="off" spellCheck={false}
          style={{
            position: 'absolute', inset: 0, width: '100%', height: '100%',
            background: 'transparent', border: 'none', outline: 'none',
            color: 'transparent', caretColor: 'transparent', fontSize: '1.5rem',
          }}
        />
      </div>
    );
  } else {
    guessControl = (
      <div style={{
        width: '100%', borderRadius: '16px', overflow: 'hidden', flexShrink: 0,
        border: inputBoxStyle.border,
        background: inputBoxStyle.background,
        boxShadow: inputBoxStyle.boxShadow,
        transition: 'border-color 0.5s ease, background 0.5s ease, box-shadow 0.5s ease',
      }}>
        <input
          ref={guessInputRef}
          type="text"
          placeholder={placeholder}
          value={guessText}
          onChange={e => setGuessText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && canSubmit && submitGuess()}
          onFocus={() => setInputFocused(true)}
          onBlur={() => setInputFocused(false)}
          autoComplete="off" autoCorrect="off" spellCheck={false}
          style={{
            display: 'block', width: '100%', background: 'transparent', border: 'none',
            color: 'white', fontSize: '1.3rem', fontWeight: 700, textAlign: 'center',
            padding: '20px 16px', outline: 'none', fontFamily: 'inherit',
          }}
          className="placeholder-white/20"
        />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen flex flex-col overflow-hidden" style={{ background: '#080812' }}>
      {/* absolute, not fixed: iOS Safari clips fixed elements to the shrunk
          visual viewport while the keyboard is open, cutting the background
          off at the keyboard's edge instead of extending behind it (see
          App.tsx). absolute against this relative, min-h-screen wrapper
          covers the same area without the clipping. */}
      <img src={`${import.meta.env.BASE_URL}backgrounds/background4.svg`} alt="" aria-hidden="true" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 0, transform: 'rotate(180deg)' }} />
      <div style={{ position: 'absolute', inset: 0, zIndex: 1, background: 'rgba(5,5,14,0.82)', backdropFilter: 'blur(36px)' }} />

      {/* Reserving the keyboard's height at the bottom is what keeps Submit and
          Skip tappable: the screen itself never resizes, the column just gets
          shorter, so the header stays put and the input area in the middle
          takes the squeeze (and scrolls if it runs out of room). */}
      <div className="relative flex flex-col flex-1 keyboard-shift" style={{ zIndex: 2, minHeight: 0, paddingBottom: 'var(--keyboard-inset, 0px)' }}>

      {/* Header: waveform while listening, timer + score when active */}
      {isListening
        ? <ListeningHeader songPlaying={songPlaying} songTempo={songTempo} isYear={isYear} />
        : <ActiveHeader timeLeft={timeLeft} timerTotal={timerTotal} myScore={myScore} isRace={mode === 'race'} isYear={isYear} songPlaying={songPlaying} songTempo={songTempo} />}

      {/* Input area. min-h-0 lets it actually shrink when the keyboard takes
          the bottom of the column, and scrolling is the escape hatch for the
          tightest case (a "both" round on a short phone, where the title and
          artist fields together outgrow what's left). overscroll-behavior
          keeps a drag that reaches the end of it from chaining outwards into
          an iOS visual-viewport pan, which would slide the whole screen off
          the bottom of the background. */}
      <div className="flex-1 flex flex-col items-center justify-center gap-5 px-5 overflow-y-auto" style={{ minHeight: 0, overscrollBehavior: 'contain' }}>
        {party && <PartyBadge party={party} />}
        <p style={{
          color: isListening ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.6)',
          fontSize: '0.9rem', fontWeight: 600, letterSpacing: '0.03em',
          transition: 'color 0.5s ease',
        }}>
          {label}
        </p>

        {guessControl}

        {target === 'both' && (
          <div style={{
            width: '100%', borderRadius: '14px', overflow: 'hidden', flexShrink: 0,
            border: '1px solid rgba(0,238,232,0.25)',
            background: 'rgba(0,238,232,0.05)',
          }}>
            <input
              type="text"
              placeholder="Artist (bonus points)…"
              value={artistGuessText}
              onChange={e => setArtistGuessText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && canSubmit && submitGuess()}
              autoComplete="off" autoCorrect="off" spellCheck={false}
              style={{
                display: 'block', width: '100%', background: 'transparent', border: 'none',
                color: 'white', fontSize: '1.05rem', fontWeight: 600, textAlign: 'center',
                padding: '14px 16px', outline: 'none', fontFamily: 'inherit',
              }}
              className="placeholder-white/20"
            />
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="px-5 pb-8 flex flex-col items-center gap-4">
        {!isChoice && !isChaosHints && (
          <button
            type="button"
            className="liquid-btn glass-tint-purple relative cursor-pointer border-0 bg-transparent p-0"
            style={{
              width: '310px', height: '64px', borderRadius: '100px',
              background: 'rgba(0,0,0,0.001)',
              opacity: canSubmit ? 1 : 0.28,
              cursor: canSubmit ? 'pointer' : 'not-allowed',
              transition: 'opacity 0.25s ease',
            }}
            // Don't let the press pull focus off the guess field: the keyboard
            // would start closing mid-tap and the layout would grow back under
            // the finger. submitGuess() blurs it deliberately afterwards.
            onMouseDown={e => e.preventDefault()}
            onClick={() => canSubmit && submitGuess()}
          >
            <LiquidGlass
              style={{ position: 'absolute', top: '50%', left: '50%' }}
              {...LIQUID_PILL_PROPS}
            >
              <div style={{ position: 'relative' }}>
                <div style={{ position: 'absolute', inset: '-18px -36px', borderRadius: '100px', pointerEvents: 'none', background: 'rgba(158,18,204,0.15)' }} />
                <span className="text-white font-bold text-xl" style={{ whiteSpace: 'nowrap', position: 'relative', display: 'inline-block', minWidth: '238px', textAlign: 'center' }}>
                  Submit
                </span>
              </div>
            </LiquidGlass>
          </button>
        )}

        {/* Outlined pill rather than the bare text link this used to be: it
            reads as something you can press, while staying clearly secondary
            to the filled glass Submit above it. On the tap-to-answer formats
            (multiple choice, chaos hints) there is no Submit at all, so this
            is the only button on the screen and has to look like one. */}
        <button
          type="button"
          onMouseDown={e => e.preventDefault()}
          onClick={skipGuess}
          style={{
            padding: '13px 34px', borderRadius: '100px', fontFamily: 'inherit',
            border: `1px solid ${SKIP_IDLE.border}`, background: SKIP_IDLE.background, color: SKIP_IDLE.color,
            fontSize: '0.92rem', fontWeight: 700, cursor: 'pointer',
            transition: 'background 0.2s ease, border-color 0.2s ease, color 0.2s ease',
          }}
          onMouseEnter={e => applySkipStyle(e.currentTarget, SKIP_HOVER)}
          onMouseLeave={e => applySkipStyle(e.currentTarget, SKIP_IDLE)}
        >
          Skip, I don't know
        </button>
      </div>

      </div>{/* end zIndex wrapper */}
    </div>
  );
}

export function PassedView() {
  const [visible, setVisible] = useState(false);
  useEffect(() => { const t = setTimeout(() => setVisible(true), 30); return () => clearTimeout(t); }, []);
  // Correctness is deliberately not surfaced here — every guesser sees the
  // same "waiting" state, and results reveal simultaneously for everyone via
  // RevealView once round_result arrives.
  const cardHeight = '150px';

  return (
    <div className="relative min-h-screen overflow-hidden">
      <img
        src={`${import.meta.env.BASE_URL}backgrounds/background3-2.png`}
        alt=""
        aria-hidden="true"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 0 }}
      />
      <div style={{ position: 'absolute', inset: 0, zIndex: 1, background: 'rgba(5,5,14,0.82)', backdropFilter: 'blur(28px)' }} />

      <div
        className="relative flex flex-col items-center justify-center min-h-screen p-6"
        style={{
          zIndex: 2,
          transition: 'opacity 0.4s ease, transform 0.4s ease',
          opacity: visible ? 1 : 0,
          transform: visible ? 'translateY(0)' : 'translateY(14px)',
        }}
      >
        <div className="liquid-btn relative" style={{ width: '310px', height: cardHeight }}>
          <LiquidGlass
            style={{ position: 'absolute', top: '50%', left: '50%' }}
            {...LIQUID_CARD_PROPS}
            padding="28px 28px"
          >
            <div style={{ width: '254px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px' }}>
              <div style={{ display: 'flex', gap: '6px' }}>
                {[0, 1, 2].map(i => (
                  <div key={i} style={{
                    width: '6px', height: '6px', borderRadius: '50%',
                    background: 'rgba(0,166,163,0.8)',
                    animationName: 'dotBounce', animationDuration: '1.4s', animationTimingFunction: 'ease-in-out', animationIterationCount: 'infinite',
                    animationDelay: `${i * 0.18}s`,
                  }} />
                ))}
              </div>
              <span style={{ display: 'inline-block', minWidth: '180px', color: 'rgba(255,255,255,0.45)', fontSize: '0.9rem', textAlign: 'center' }}>
                Waiting for others…
              </span>
            </div>
          </LiquidGlass>
        </div>
      </div>
    </div>
  );
}

// Full-screen victim picker for the steal-round winner.
export function StealPicker({ victims, onPick, onSkip }: Readonly<{
  victims: { name: string; score: number }[];
  onPick: (name: string) => void;
  onSkip: () => void;
}>) {
  const pickerRef = useRef<HTMLDialogElement>(null);
  useEscapeKey(onSkip, true);
  useFocusTrap(pickerRef, true);
  return (
    <dialog
      ref={pickerRef}
      open
      aria-modal="true"
      aria-label="Pick a steal victim"
      className="fixed inset-0 flex flex-col items-center justify-center gap-6 p-6"
      style={{ zIndex: 70, margin: 0, border: 'none', color: 'inherit', width: '100%', height: '100%', background: 'rgba(5,5,14,0.93)', backdropFilter: 'blur(24px)' }}
    >
      <div style={{ textAlign: 'center' }}>
        <p style={{
          fontSize: '1.7rem', fontWeight: 900, marginBottom: '8px',
          background: 'linear-gradient(to bottom left, rgba(248,113,113,0.55) 0%, transparent 55%), linear-gradient(to top right, rgba(250,185,40,0.4) 0%, transparent 55%), #fff',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
        }}>
          You won the steal!
        </p>
        <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.85rem' }}>
          Pick a victim: you take 25% of their score (min 400)
        </p>
      </div>
      <div className="flex flex-col gap-2.5 w-full" style={{ maxWidth: '310px', maxHeight: '50vh', overflowY: 'auto' }}>
        {victims.map(v => (
          <button
            key={v.name}
            type="button"
            onClick={() => onPick(v.name)}
            className="flex items-center justify-between px-5 py-3.5 rounded-2xl"
            style={{
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
              cursor: 'pointer', transition: 'background 0.15s ease, border-color 0.15s ease',
            }}
            onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = 'rgba(248,113,113,0.12)'; el.style.borderColor = 'rgba(248,113,113,0.4)'; }}
            onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = 'rgba(255,255,255,0.06)'; el.style.borderColor = 'rgba(255,255,255,0.12)'; }}
          >
            <span className="text-white font-bold">{v.name}</span>
            <span className="text-white/45 text-sm tabular-nums">{v.score.toLocaleString()} pts</span>
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onSkip}
        style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.28)', fontSize: '0.82rem', cursor: 'pointer', transition: 'color 0.2s ease' }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.5)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.28)'; }}
      >
        Skip, don't steal
      </button>
    </dialog>
  );
}
