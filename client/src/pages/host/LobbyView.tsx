import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Disc3, Settings, Flame, Coins, PartyPopper, Volume2, VolumeX } from 'lucide-react';
import { BRAND_LOGO_SRC, showBrandLogoFallback } from '../../branding';
import LiquidGlass from '../../components/StableLiquidGlass';
import { useLogoMorph } from '../../contexts/LogoMorph';
import { MIN_PLAYLIST_TRACKS } from '../../hooks/usePlaylistPicker';
import { useLobbyMusic } from '../../hooks/useLobbyMusic';
import { BackButton } from '../../components/BackButton';
import { LIQUID_CARD_PROPS, LIQUID_CONTROL_PROPS, LIQUID_PILL_PROPS } from '../../components/liquidGlassPresets';
import { APP_NAME } from '../../config';
import type { PlayerInfo } from '../../types';
import { mergePlaylistTracks, type HostState, type Mode } from './useHostGame';
import { SettingsPanel } from './SettingsPanel';
import { PlaylistPickerDialog } from './PlaylistPickerDialog';
import { JoinCard } from './JoinCard';

function SettingsButton({ settingsOpen, toggleSettings }: Readonly<{ settingsOpen: boolean; toggleSettings: () => void }>) {
  const [hovered, setHovered] = useState(false);
  return (
    // Same glass-pill treatment as the volume control below it: a fixed-size
    // box (LiquidGlass centres itself on this and needs an explicit box to
    // measure) holding the glass, with a tint overlay div and content row
    // inside mirroring that component's structure.
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="liquid-btn glass-tint-purple settings-control-glass absolute top-5 right-5 z-10"
      style={{ width: '112px', height: '36px' }}
    >
      <LiquidGlass
        style={{
          position: 'absolute', top: '50%', left: '50%',
          filter: hovered ? 'drop-shadow(0 0 10px rgba(192,132,252,0.4))' : 'drop-shadow(0 0 0px rgba(192,132,252,0))',
          transition: 'filter 0.25s ease',
        }}
        {...LIQUID_CONTROL_PROPS}
        padding="4px 16px 4px 12px"
      >
        <div style={{ position: 'relative' }}>
          <div style={{
            position: 'absolute', inset: '-8px -16px -8px -12px', borderRadius: '100px', pointerEvents: 'none',
            background: settingsOpen ? 'rgba(158,18,204,0.16)' : 'rgba(158,18,204,0.05)',
            transition: 'background 0.2s ease',
          }} />
          <button
            type="button"
            onClick={toggleSettings}
            tabIndex={0}
            className="relative flex items-center gap-2"
            style={{
              background: 'transparent',
              border: 'none',
              padding: 0,
              height: '28px',
              color: settingsOpen ? '#c084fc' : 'rgba(255,255,255,0.75)',
              cursor: 'pointer',
              transition: 'color 0.2s ease',
            }}
          >
            <Settings
              className="w-4 h-4"
              style={{ transition: 'transform 0.35s ease', transform: settingsOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}
            />
            <span style={{ fontSize: '0.8rem', fontWeight: 500, letterSpacing: '0.01em' }}>Settings</span>
          </button>
        </div>
      </LiquidGlass>
    </div>
  );
}

// The old flat translucent fill + hard border read fine on a plain rgba
// panel, but competed with the glass's own refraction once ModeToggle moved
// onto LiquidGlass. A colored glow (first pass here) fixed legibility but
// read as neon/busy — a crisp white inset ring plus a colorless ambient
// shadow (same language as a solid capsule button, not a lit-up chip) is the
// cleaner, calmer "selected" cue; the color still carries entirely through
// the fill itself.
const MODE_STYLE: Record<Mode, { bg: string; tint: string; text: string; icon: string }> = {
  classic: { bg: 'rgba(191,29,235,0.34)', tint: 'rgba(158,18,204,0.07)', text: 'white', icon: '#c084fc' },
  race: { bg: 'rgba(234,88,12,0.3)', tint: 'rgba(234,88,12,0.07)', text: '#fed7aa', icon: '#fb923c' },
  party: { bg: 'rgba(0,210,203,0.26)', tint: 'rgba(0,196,190,0.07)', text: '#99f6e4', icon: '#2dd4bf' },
};

function ModeToggle({ mode, setMode }: Readonly<{ mode: Mode; setMode: (m: Mode) => void }>) {
  const modes: { key: Mode; label: string; Icon: typeof Coins }[] = [
    { key: 'classic', label: 'Classic', Icon: Coins },
    { key: 'race', label: 'Race', Icon: Flame },
    { key: 'party', label: 'Party', Icon: PartyPopper },
  ];
  const index = modes.findIndex(m => m.key === mode);
  const active = MODE_STYLE[mode];
  // Swapping the accent class (rather than pinning glass-tint-purple like
  // the other three lobby glass surfaces) lets the ring itself track the
  // selected mode too — .liquid-glass-stabilizer .glass::after carries its
  // own box-shadow transition, so this cross-fades same as the wash below
  // instead of snapping between classes.
  const tintClass = { classic: 'glass-tint-purple', race: 'glass-tint-orange', party: 'glass-tint-cyan' }[mode];
  return (
    // Same glass-card pattern as JoinCard below it: outer box keeps the
    // existing width classes/breakpoint overrides (landscape still pins it
    // to 250px via the existing .lobby-mode-player-row .lobby-mode-toggle
    // rule), height set explicitly per breakpoint in index.css since the
    // glass content is absolutely positioned and can't contribute to flow
    // height. The active-mode pill no longer needs its own inset math (old
    // 4px/-8px accounting for the flat panel's own padding) since the track
    // div below is already the padded-in content box.
    <div className={`liquid-btn ${tintClass} lobby-mode-toggle relative w-full max-w-md`}>
      <LiquidGlass
        style={{ position: 'absolute', top: '50%', left: '50%' }}
        {...LIQUID_CARD_PROPS}
        cornerRadius={100}
        padding="4px"
      >
        <div style={{ position: 'relative' }}>
          {/* Glass-wide wash behind the track, tinted to the selected mode's
              accent and cross-fading on change — same overlay pattern as the
              volume/settings pills, but dynamic instead of fixed purple. The
              ring itself (see tintClass above) recolors the same way. */}
          <div
            className="absolute rounded-full"
            style={{ inset: '-4px', background: active.tint, transition: 'background 0.3s ease', pointerEvents: 'none' }}
          />
          <div
            className="mode-toggle-track relative flex rounded-full"
            style={{ width: 'calc(min(calc(100vw - 3rem), 448px) - 8px)' }}
          >
            <div
              className="absolute rounded-full"
              style={{
                top: 0, bottom: 0, left: 0,
                width: 'calc(100% / 3)',
                background: active.bg,
                boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.2), 0 2px 10px rgba(0,0,0,0.22)',
                transform: `translateX(${index * 100}%)`,
                transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), background 0.25s ease',
                pointerEvents: 'none',
              }}
            />
            {modes.map(({ key, label, Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => setMode(key)}
                tabIndex={0}
                className="lobby-mode-option relative flex-1 py-3.5 rounded-full text-sm font-medium z-10 transition-colors duration-200 flex items-center justify-center gap-1.5"
                style={{
                  color: mode === key ? MODE_STYLE[key].text : 'rgba(255,255,255,0.45)',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  letterSpacing: '0.01em',
                }}
              >
                <Icon className="w-3.5 h-3.5 transition-colors duration-200" style={{ color: mode === key ? MODE_STYLE[key].icon : 'rgba(255,255,255,0.45)' }} />
                {label}
              </button>
            ))}
          </div>
        </div>
      </LiquidGlass>
    </div>
  );
}

function StartButton({ players, mode, startGame, disabled: extraDisabled }: Readonly<{
  players: PlayerInfo[]; mode: Mode; startGame: () => void; disabled?: boolean;
}>) {
  const [hovered, setHovered] = useState(false);
  const disabled = players.length === 0 || !!extraDisabled;
  const hoverShadow = {
    classic: 'drop-shadow(0 0 12px rgba(158,18,204,0.7))',
    race: 'drop-shadow(0 0 12px rgba(220, 80, 10, 0.7))',
    party: 'drop-shadow(0 0 12px rgba(0,238,232,0.6))',
  }[mode];
  const tintClass = { classic: 'glass-tint-purple', race: 'glass-tint-orange', party: 'glass-tint-cyan' }[mode];
  return (
    <button
      type="button"
      tabIndex={0}
      className={`lobby-start-button liquid-btn ${tintClass} relative cursor-pointer border-0 bg-transparent p-0`}
      style={{
        width: 'min(310px, 100%)', height: '64px', borderRadius: '100px',
        background: 'rgba(0,0,0,0.001)',
        opacity: disabled ? 0.3 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'opacity 0.25s ease',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => !disabled && startGame()}
    >
        <LiquidGlass
          style={{
            position: 'absolute', top: '50%', left: '50%',
            filter: hovered && !disabled ? hoverShadow : 'drop-shadow(0 0 0px rgba(0,0,0,0))',
            transition: 'filter 0.25s ease',
          }}
          {...LIQUID_PILL_PROPS}
          padding="18px min(36px, 7vw)"
      >
        <div style={{ position: 'relative' }}>
          <div style={{
            position: 'absolute', inset: '-18px -36px', borderRadius: '100px', pointerEvents: 'none',
            background: { classic: 'rgba(158,18,204,0.12)', race: 'rgba(220,80,10,0.12)', party: 'rgba(0,238,232,0.1)' }[mode],
            transition: 'background 0.25s ease',
          }} />
          <span
            key={mode}
            className="lobby-start-label text-white font-bold text-xl"
            style={{ whiteSpace: 'nowrap', position: 'relative', display: 'inline-block', textAlign: 'center', animation: 'startLabelIn 0.25s ease' }}
          >
            {{ classic: 'Start Classic Game', race: 'Start Race Game', party: 'Start Party Game' }[mode]}
          </span>
        </div>
      </LiquidGlass>
    </button>
  );
}

function VolumeControl({ volume, setVolume, toggleMute }: Readonly<{
  volume: number; setVolume: (v: number) => void; toggleMute: () => void;
}>) {
  const muted = volume === 0;
  const [hovered, setHovered] = useState(false);
  const pct = Math.round(volume * 100);
  return (
    // Sized to the glass rather than the other way round: LiquidGlass centres
    // itself on this box, so its width/height must be the content (28px icon +
    // 8px gap + 80px track) plus LIQUID_CONTROL_PROPS' padding.
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="liquid-btn glass-tint-purple volume-control-glass absolute bottom-5 right-5 z-10"
      style={{ width: '148px', height: '44px' }}
    >
      <LiquidGlass
        style={{
          position: 'absolute', top: '50%', left: '50%',
          // Matches how the CTA pills announce hover — a glow around the glass
          // itself — instead of the flat panel tint this control used to have.
          filter: hovered ? 'drop-shadow(0 0 10px rgba(192,132,252,0.4))' : 'drop-shadow(0 0 0px rgba(192,132,252,0))',
          transition: 'filter 0.25s ease',
          }}
          {...LIQUID_CONTROL_PROPS}
          padding="8px 8px"
        >
        <div style={{ position: 'relative' }}>
          {/* Tint overlay, same as every other glass control: negative insets
              matching the local padding stretch it back over the
              full pill, since it's a child of the padded content box. */}
          <div style={{
            position: 'absolute', inset: '-8px', borderRadius: '100px', pointerEvents: 'none',
            background: 'rgba(158,18,204,0.05)',
          }} />
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '8px', height: '28px' }}>
            <button
              type="button"
              onClick={toggleMute}
              tabIndex={0}
              aria-label={muted ? 'Unmute lobby music' : 'Mute lobby music'}
              aria-pressed={muted}
              className="flex items-center justify-center rounded-full flex-shrink-0"
              style={{
                width: '28px', height: '28px',
                background: 'transparent',
                border: 'none',
                color: muted ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.75)',
                cursor: 'pointer',
                transition: 'color 0.2s ease',
              }}
            >
              <span style={{ position: 'relative', width: '16px', height: '16px', display: 'inline-block' }}>
                <Volume2
                  className="w-4 h-4"
                  style={{
                    position: 'absolute', inset: 0,
                    opacity: muted ? 0 : 1,
                    transform: muted ? 'scale(0.6) rotate(-15deg)' : 'scale(1) rotate(0deg)',
                    transition: 'opacity 0.25s ease, transform 0.25s ease',
                  }}
                />
                <VolumeX
                  className="w-4 h-4"
                  style={{
                    position: 'absolute', inset: 0,
                    opacity: muted ? 1 : 0,
                    transform: muted ? 'scale(1) rotate(0deg)' : 'scale(0.6) rotate(15deg)',
                    transition: 'opacity 0.25s ease, transform 0.25s ease',
                  }}
                />
              </span>
            </button>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={pct}
              onChange={e => setVolume(Number(e.target.value) / 100)}
              aria-label="Lobby music volume"
              aria-valuetext={`${pct} percent`}
              className="volume-slider"
              style={{ '--volume-pct': `${pct}%` } as React.CSSProperties}
            />
          </div>
        </div>
      </LiquidGlass>
    </div>
  );
}

export function LobbyView({
  game,
  beforeGoHome,
  homeTransitionRef,
}: Readonly<{
  game: HostState;
  beforeGoHome?: () => Promise<void>;
  homeTransitionRef?: React.RefObject<(() => Promise<void>) | null>;
}>) {
  const {
    spotify, pin, players, createGame, startGame, mode, settingsOpen, toggleSettings, setMode, removePlayer,
    gameExpired, playlistPickerOpen, songSource, customPlaylists, startError,
  } = game;
  const playlistTrackCount = mergePlaylistTracks(customPlaylists).length;
  const playlistEmpty = songSource === 'playlist' && playlistTrackCount === 0;
  const playlistLow = songSource === 'playlist' && playlistTrackCount > 0 && playlistTrackCount < MIN_PLAYLIST_TRACKS;
  const [lobbyVisible, setLobbyVisible] = useState(false);
  const { fadeOut, volume, setVolume, toggleMute } = useLobbyMusic(gameExpired);
  const { beginMorph, morphing, reducedMotion } = useLogoMorph();
  const logoRef = useRef<HTMLImageElement>(null);
  const startingRef = useRef(false);

  const prepareHomeTransition = useCallback(async () => {
    if (!reducedMotion && logoRef.current) {
      const rect = logoRef.current.getBoundingClientRect();
      beginMorph({ top: rect.top, left: rect.left, width: rect.width, height: rect.height });
    }
    await fadeOut(500);
  }, [beginMorph, fadeOut, reducedMotion]);

  // Host owns navigation so Back, Escape, and the expired-game action all
  // share one transition and navigate exactly once.
  useEffect(() => {
    if (!homeTransitionRef) return;
    homeTransitionRef.current = prepareHomeTransition;
    return () => { homeTransitionRef.current = null; };
  }, [homeTransitionRef, prepareHomeTransition]);

  useEffect(() => {
    if (!pin) { setLobbyVisible(false); return; }
    const t = setTimeout(() => setLobbyVisible(true), 10);
    return () => clearTimeout(t);
  }, [pin]);

  useEffect(() => {
    if (spotify.playerReady && !pin) createGame();
  }, [spotify.playerReady, pin]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleStart = async () => {
    if (startingRef.current) return;
    startingRef.current = true;
    // Activate the Spotify player synchronously in this click handler (some
    // browsers require playback to be unlocked within the same gesture),
    // then let the music fade all the way out before the view switches away
    // and cuts it off mid-fade.
    spotify.activatePlayer();
    await fadeOut();
    startGame();
  };
  let spotifyStatus: React.ReactNode;
  if (spotify.playbackError) {
    spotifyStatus = <><span className="w-2 h-2 rounded-full bg-red-400" />Spotify playback error</>;
  } else if (spotify.playerReady) {
    spotifyStatus = <><span className="w-2 h-2 rounded-full bg-green-500" />Spotify ready</>;
  } else {
    spotifyStatus = <><Disc3 className="w-3.5 h-3.5 animate-spin" strokeWidth={1.5} />Spotify loading...</>;
  }

  return (
    <div className="lobby-view min-h-screen relative flex flex-col overflow-hidden">
      <BackButton zIndex={10} beforeNavigate={beforeGoHome ?? fadeOut} />
      <SettingsButton settingsOpen={settingsOpen} toggleSettings={toggleSettings} />
      <VolumeControl volume={volume} setVolume={setVolume} toggleMute={toggleMute} />

      <SettingsPanel game={game} open={settingsOpen} />
      {playlistPickerOpen && <PlaylistPickerDialog game={game} />}

      <div
        className="lobby-header flex shrink-0 flex-col items-center gap-6 p-6 transition-transform duration-500 ease-out"
        style={{ transform: pin ? 'translateY(0)' : 'translateY(30vh)' }}
      >
        <img
          ref={logoRef}
          src={BRAND_LOGO_SRC}
          alt={APP_NAME}
          onError={showBrandLogoFallback}
          width={2560}
          height={1000}
          className="versed-logo lobby-logo w-auto drop-shadow-[0_18px_22px_rgba(0,0,0,0.55)]"
          style={{ maxHeight: '192px', maxWidth: '100%', opacity: morphing ? 0 : 1, willChange: 'opacity' }}
        />
        <span className="text-white/45 text-sm flex items-center gap-2">
          {spotifyStatus}
        </span>
        {spotify.playbackError && (
          <p className="max-w-sm text-center text-red-300 text-sm" aria-live="assertive">
            {spotify.playbackError} Try reconnecting Spotify, or use Chrome/Edge if Safari keeps blocking playback.
          </p>
        )}
      </div>

      {pin ? (
        <div className={`lobby-content flex flex-1 min-h-0 flex-col items-center gap-5 px-6 pb-6 transition-all duration-500 ${lobbyVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
          <JoinCard pin={game.pin} copied={game.copied} copyInvite={game.copyInvite} />
          <div className="lobby-mode-player-row flex flex-col gap-5 w-full max-w-md">
            <ModeToggle mode={mode} setMode={setMode} />
            <div className="lobby-player-list w-full">
              <p className="lobby-player-count text-white/45 text-sm mb-2">{players.length} player{players.length === 1 ? '' : 's'}</p>
              <div className="lobby-player-chips flex flex-wrap gap-2">
                {players.map(p => (
                  <button
                    key={p.name}
                    type="button"
                    onClick={() => removePlayer(p.name)}
                    tabIndex={0}
                    className="lobby-player-chip relative group px-3 py-1.5 rounded-full bg-white/10 text-white text-sm font-semibold"
                    aria-label={`Remove ${p.name}`}
                  >
                    {p.name}
                    <span className="absolute inset-0 rounded-full backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                ))}
              </div>
            </div>
          </div>
          <StartButton players={players} mode={mode} startGame={handleStart} disabled={playlistEmpty} />
          {playlistLow && (
            <p style={{ color: '#fcd34d', fontSize: '0.8125rem' }}>
              Only {playlistTrackCount} track{playlistTrackCount === 1 ? '' : 's'} total across your selected playlists. Songs may repeat.
            </p>
          )}
          {startError && <p style={{ color: '#fca5a5', fontSize: '0.8125rem' }}>{startError}</p>}
        </div>
      ) : null}
    </div>
  );
}
