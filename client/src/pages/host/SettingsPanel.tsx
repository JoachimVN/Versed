import { useRef } from 'react';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { useFocusTrap } from '../../hooks/useFocusTrap';
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
      {/* Plain CSS transparency + an emulated glass ring rather than real
          LiquidGlass — this is the one glass surface in the app with a
          scrollable descendant (Party mode's extra rows push it past
          maxHeight), and Safari's backdrop-filter/SVG-filtered glass goes
          permanently stale the moment a scrollable overflow container
          appears inside it; no repaint nudge (resize dispatch, forced
          reflow, even a real requestAnimationFrame-yielded repaint) reliably
          clears it, only leaving the scrollable state again does. A flat
          `backdrop-filter: blur()` has no such staleness — the browser
          recomputes it every paint like any other CSS property.
          settings-panel-ring (index.css) reproduces the library's own
          `.glass::after` ring technique — a diagonal light-streak gradient
          masked down to just the border, plus the same purple inset tint
          glass-tint-purple gives every other purple glass control — on a
          plain div instead of a real filtered one. It has to live on this
          outer, non-scrolling wrapper rather than the scrollable div below:
          a ::after inside an overflow:auto box scrolls away with the
          content instead of staying pinned to the panel's edge. Nested
          pills/steppers/toggles stay real LiquidGlass; they're fixed-size
          and never become scroll containers, so they don't hit any of
          this. */}
      <div
        className="settings-panel-ring relative w-72 rounded-2xl"
        style={{
          background: 'rgba(24, 10, 40, 0.28)',
          backdropFilter: 'blur(28px) saturate(150%)',
          WebkitBackdropFilter: 'blur(28px) saturate(150%)',
          boxShadow: '0 0 20px rgba(158,18,204,0.14), 0 24px 48px rgba(0,0,0,0.4)',
        }}
      >
        <div
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
      </div>
    </dialog>
  );
}
