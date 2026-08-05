import { useEffect, useRef, useState } from 'react';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import LiquidGlass from '../../components/StableLiquidGlass';
import { LIQUID_CARD_PROPS } from '../../components/liquidGlassPresets';
import type { HostState } from './useHostGame';
import { ChaosLevelRow, DifficultyRow, SettingRow, SongSourceRow, ToggleRow } from './settings/rows';
import { EventChipGrid, RoundTypeChipGrid } from './settings/chipGrids';
import { PlaylistList } from './settings/PlaylistList';

export function SettingsPanel({ game, open }: Readonly<{ game: HostState; open: boolean }>) {
  const {
    mode, bettingTimeSetting, guessingTimeSetting, roundsSetting, raceTimeSetting, raceWinnerOnly, artistOnly, yearOnly, multipleChoice, difficulty,
    enabledEvents, enabledRoundTypes, chaosLevel, finaleEnabled,
    songSource, customPlaylists,
    setBettingTimeSetting, setGuessingTimeSetting, setRoundsSetting, setRaceTimeSetting, setRaceWinnerOnly, setArtistOnly, setYearOnly, setMultipleChoice, setDifficulty,
    toggleEvent, setEnabledEvents, toggleRoundType, setEnabledRoundTypes, setChaosLevel, setFinaleEnabled,
    setSongSource, openPlaylistPicker, removePlaylist,
    toggleSettings,
  } = game;
  const panelRef = useRef<HTMLDialogElement>(null);
  useEscapeKey(toggleSettings, open);
  useFocusTrap(panelRef, open);

  // The library always centers its glass box around the wrapper's own
  // (top:50%,left:50%) point via a fixed translate(-50%,-50%) — every other
  // LiquidGlass in this codebase gives that wrapper a fixed height so
  // "centered within it" lands exactly at the top. This panel's height is
  // content-driven instead (sections come and go with mode/song source), so
  // there's no fixed number to hardcode; mirror the real content height onto
  // the wrapper instead, so centering-within-its-own-exact-size is
  // indistinguishable from being pinned at the top.
  //
  // This MUST observe the plain content div below (contentRef), not the
  // glass's own rendered node: StableLiquidGlass's own ResizeObserver
  // dispatches a *global* `window.resize` event whenever this wrapper's box
  // changes size, which every LiquidGlass instance on the page (including
  // ones with nothing to do with this panel, e.g. the volume slider)
  // re-measures itself against. Observing the glass's own node fed a loop
  // back into itself through that global event — visible as every glass
  // control on the page continuously re-rendering/repainting ("blurring")
  // without settling, worst on the big height swing into/out of party mode.
  // The content div's size is driven purely by which rows are visible, never
  // by anything the glass does, so watching it can't close that loop. For
  // the same reason, no manual `window.dispatchEvent(new Event('resize'))`
  // is needed here either (unlike PlaylistPickerDialog, which isn't nested
  // inside other glass) — changing this wrapper's height already makes
  // StableLiquidGlass's own resize-dispatch fire on its own; adding a second,
  // independent dispatch on top of it was very likely what turned one
  // resolving cascade into a sustained one on party mode's bigger jump.
  const wrapperRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [glassHeight, setGlassHeight] = useState<number>();
  useEffect(() => {
    const contentEl = contentRef.current;
    if (!contentEl) return;
    const observer = new ResizeObserver(([entry]) => setGlassHeight(entry.contentRect.height));
    observer.observe(contentEl);
    return () => observer.disconnect();
  }, []);

  return (
    <dialog
      ref={panelRef}
      open
      aria-modal="true"
      aria-label="Game settings"
      className="absolute right-5 z-20"
      style={{
        top: '68px',
        left: 'auto',
        bottom: 'auto',
        margin: 0,
        border: 'none',
        padding: 0,
        background: 'transparent',
        color: 'inherit',
        opacity: open ? 1 : 0,
        transform: open ? 'translateY(0) scale(1)' : 'translateY(-10px) scale(0.96)',
        pointerEvents: open ? 'auto' : 'none',
        transition: 'opacity 0.2s ease, transform 0.22s ease',
        transformOrigin: 'top right',
      }}
    >
      <div
        ref={wrapperRef}
        className="liquid-btn glass-tint-purple settings-panel-glass relative w-72"
        style={{ height: glassHeight ? `${glassHeight}px` : undefined }}
      >
        {/* globalMousePos/mouseOffset pinned static (rather than left undefined)
            short-circuits the library's own internal mousemove listener —
            see its handleMouseMove effect, which only attaches when both are
            unset. Every other LiquidGlass on this page tracks the cursor to
            drive its elastic tilt/sheen, cheap at pill size; this glass
            covers the whole scrollable panel, so the same per-pixel
            recompute + backdrop-filter repaint was visibly janky ("blurs")
            while dragging sliders or mousing around inside it. A settings
            backdrop doesn't need to feel the cursor anyway. */}
        <LiquidGlass
          style={{ position: 'absolute', top: '50%', left: '50%' }}
          {...LIQUID_CARD_PROPS}
          elasticity={0}
          globalMousePos={{ x: 0, y: 0 }}
          mouseOffset={{ x: 0, y: 0 }}
          padding="0"
        >
          <div
            ref={contentRef}
            className="w-72 rounded-2xl overflow-x-hidden overflow-y-auto"
            style={{ maxHeight: 'calc(100dvh - 88px)', overscrollBehavior: 'contain' }}
          >
            <div className="px-5 py-3.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
              <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.6rem', letterSpacing: '0.22em', textTransform: 'uppercase' }}>
                Game Settings
              </p>
            </div>

            <div className="px-5 py-4 space-y-4">
              <div style={{ paddingBottom: '12px', marginBottom: '12px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                <SongSourceRow value={songSource} onChange={setSongSource} />
                {songSource === 'playlist' && (
                  <div className="mt-3 space-y-2">
                    <PlaylistList customPlaylists={customPlaylists} onOpen={openPlaylistPicker} onRemove={removePlaylist} />
                    <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.75rem' }}>All songs play at equal difficulty</p>
                  </div>
                )}
              </div>
              {/* Party mixes classic and race rounds, so it needs all three timers.
                  Classic's "Guess the year" still runs the normal bid/tier flow
                  (bet time picks the clip, guess time is the per-tier window), so
                  it always uses Bet/Guess time, never Round time. */}
              {mode !== 'race' && (
                <>
                  <SettingRow label="Bet time" value={bettingTimeSetting} unit="s" min={5}
                    onDec={() => setBettingTimeSetting(Math.max(5, bettingTimeSetting - 5))}
                    onInc={() => setBettingTimeSetting(Math.min(999, bettingTimeSetting + 5))}
                    onChange={setBettingTimeSetting} />
                  <SettingRow label="Guess time" value={guessingTimeSetting} unit="s" min={5}
                    onDec={() => setGuessingTimeSetting(Math.max(5, guessingTimeSetting - 5))}
                    onInc={() => setGuessingTimeSetting(Math.min(999, guessingTimeSetting + 5))}
                    onChange={setGuessingTimeSetting} />
                </>
              )}
              {mode !== 'classic' && (
                <SettingRow label={mode === 'party' ? 'Race time' : 'Round time'} value={raceTimeSetting} unit="s" min={10}
                  onDec={() => setRaceTimeSetting(Math.max(10, raceTimeSetting - 5))}
                  onInc={() => setRaceTimeSetting(Math.min(999, raceTimeSetting + 5))}
                  onChange={setRaceTimeSetting} />
              )}
              <SettingRow label="Rounds" value={roundsSetting} unit=""
                onDec={() => setRoundsSetting(Math.max(1, roundsSetting - 1))}
                onInc={() => setRoundsSetting(Math.min(999, roundsSetting + 1))}
                onChange={setRoundsSetting} />
              {songSource === 'library' && <DifficultyRow value={difficulty} onChange={setDifficulty} />}
            </div>

            {/* Party picks guess targets per round, so the game-wide toggles only
                apply to classic and race. */}
            {mode !== 'party' && (
              <div className="px-5 pb-4 space-y-4" style={{ borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: '16px' }}>
                {mode === 'race' && (
                  <ToggleRow label="Winner only" value={raceWinnerOnly} onToggle={() => setRaceWinnerOnly(!raceWinnerOnly)} />
                )}
                {/* Both can now be on at once — each round then independently
                    rolls artist or year as its target, rather than asking one
                    fixed target for the whole game. */}
                <ToggleRow label="Artist only" value={artistOnly} onToggle={() => setArtistOnly(!artistOnly)} />
                <ToggleRow label="Guess the year" value={yearOnly} onToggle={() => setYearOnly(!yearOnly)} />
                <ToggleRow label="Multiple Choice" value={multipleChoice} onToggle={() => setMultipleChoice(!multipleChoice)} />
              </div>
            )}

            {mode === 'party' && (
              <div className="px-5 pb-4 space-y-4" style={{ borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: '16px' }}>
                <ChaosLevelRow value={chaosLevel} onChange={setChaosLevel} disabled={enabledEvents.length === 0} />
                <EventChipGrid enabledEvents={enabledEvents} onToggle={toggleEvent} onSetAll={setEnabledEvents} />
                <RoundTypeChipGrid
                  enabledRoundTypes={enabledRoundTypes} onToggle={toggleRoundType} onSetAll={setEnabledRoundTypes}
                  finaleEnabled={finaleEnabled} onToggleFinale={() => setFinaleEnabled(!finaleEnabled)}
                />
              </div>
            )}
          </div>
        </LiquidGlass>
      </div>
    </dialog>
  );
}
