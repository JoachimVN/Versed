import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Disc3, Settings, Flame, Coins, PartyPopper, Volume2, VolumeX } from 'lucide-react';
import LiquidGlass from '../../components/StableLiquidGlass';
import { useLogoMorph } from '../../contexts/LogoMorph';
import { MIN_PLAYLIST_TRACKS } from '../../hooks/usePlaylistPicker';
import { BackButton } from '../../components/BackButton';
import { LIQUID_PILL_PROPS } from '../../components/liquidGlassPresets';
import { APP_NAME } from '../../config';
import type { PlayerInfo } from '../../types';
import { mergePlaylistTracks, type HostState, type Mode } from './useHostGame';
import { SettingsPanel } from './SettingsPanel';
import { PlaylistPickerDialog } from './PlaylistPickerDialog';
import { JoinCard } from './JoinCard';

function SettingsButton({ settingsOpen, toggleSettings }: Readonly<{ settingsOpen: boolean; toggleSettings: () => void }>) {
  const [hovered, setHovered] = useState(false);
  let bg = 'rgba(255,255,255,0.06)';
  if (settingsOpen) bg = 'rgba(168,11,219,0.28)';
  else if (hovered) bg = 'rgba(255,255,255,0.11)';
  let color = 'rgba(255,255,255,0.5)';
  if (settingsOpen) color = '#c084fc';
  else if (hovered) color = 'rgba(255,255,255,0.85)';
  return (
    <button
      onClick={toggleSettings}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      tabIndex={0}
      className="absolute top-5 right-5 flex items-center gap-2 rounded-full transition-all duration-200 z-10"
      style={{
        background: bg,
        border: settingsOpen ? '1px solid rgba(188,26,249,0.45)' : '1px solid rgba(255,255,255,0.10)',
        backdropFilter: 'blur(12px)',
        padding: '6px 14px 6px 10px',
        color,
        cursor: 'pointer',
      }}
    >
      <Settings
        className="w-3.5 h-3.5"
        style={{ transition: 'transform 0.35s ease', transform: settingsOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}
      />
      <span style={{ fontSize: '0.8rem', fontWeight: 500, letterSpacing: '0.01em' }}>Settings</span>
    </button>
  );
}

const MODE_STYLE: Record<Mode, { bg: string; border: string; text: string; icon: string }> = {
  classic: { bg: 'rgba(178,6,229,0.28)', border: '1px solid rgba(188,16,249,0.45)', text: 'white', icon: '#c084fc' },
  race: { bg: 'rgba(220, 80, 10, 0.2)', border: '1px solid rgba(234, 88, 12, 0.4)', text: '#fed7aa', icon: '#fb923c' },
  party: { bg: 'rgba(0,198,192,0.2)', border: '1px solid rgba(0,238,232,0.4)', text: '#99f6e4', icon: '#2dd4bf' },
};

function ModeToggle({ mode, setMode }: Readonly<{ mode: Mode; setMode: (m: Mode) => void }>) {
  const modes: { key: Mode; label: string; Icon: typeof Coins }[] = [
    { key: 'classic', label: 'Classic', Icon: Coins },
    { key: 'race', label: 'Race', Icon: Flame },
    { key: 'party', label: 'Party', Icon: PartyPopper },
  ];
  const index = modes.findIndex(m => m.key === mode);
  const active = MODE_STYLE[mode];
  return (
    <div
      className="w-full max-w-md relative flex rounded-2xl"
      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', padding: '4px' }}
    >
      <div
        className="absolute rounded-xl"
        style={{
          top: '4px', bottom: '4px', left: '4px',
          width: 'calc((100% - 8px) / 3)',
          background: active.bg,
          border: active.border,
          transform: `translateX(${index * 100}%)`,
          transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), background 0.25s ease, border-color 0.25s ease',
          pointerEvents: 'none',
        }}
      />
      {modes.map(({ key, label, Icon }) => (
        <button
          key={key}
          onClick={() => setMode(key)}
          tabIndex={0}
          className="relative flex-1 py-2.5 rounded-xl text-sm font-semibold z-10 transition-colors duration-200 flex items-center justify-center gap-1.5"
          style={{ color: mode === key ? MODE_STYLE[key].text : 'rgba(255,255,255,0.45)', background: 'transparent', border: 'none', cursor: 'pointer' }}
        >
          <Icon className="w-3.5 h-3.5 transition-colors duration-200" style={{ color: mode === key ? MODE_STYLE[key].icon : 'rgba(255,255,255,0.45)' }} />
          {label}
        </button>
      ))}
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
      className={`liquid-btn ${tintClass} relative cursor-pointer border-0 bg-transparent p-0 mt-auto`}
      style={{
        width: '310px', height: '64px', borderRadius: '100px',
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
      >
        <div style={{ position: 'relative' }}>
          <div style={{
            position: 'absolute', inset: '-18px -36px', borderRadius: '100px', pointerEvents: 'none',
            background: { classic: 'rgba(158,18,204,0.12)', race: 'rgba(220,80,10,0.12)', party: 'rgba(0,238,232,0.1)' }[mode],
            transition: 'background 0.25s ease',
          }} />
          <span className="text-white font-bold text-xl" style={{ whiteSpace: 'nowrap', position: 'relative', display: 'inline-block', minWidth: '210px', textAlign: 'center' }}>
            {{ classic: 'Start Classic Game', race: 'Start Race Game', party: 'Start Party Game' }[mode]}
          </span>
        </div>
      </LiquidGlass>
    </button>
  );
}

// Kicked off the moment this module loads — i.e. as soon as the /host route
// renders ConnectView, well before the Spotify OAuth round trip (several
// seconds of redirect + login) completes and LobbyView mounts. That gives the
// fetch a head start so the bytes are already local by the time they're
// needed; decodeAudioData is called fresh each time since it neuters
// (transfers) the ArrayBuffer it's given, so the cached bytes are sliced
// before each decode to stay reusable.
let themeArrayBufferPromise: Promise<ArrayBuffer> | null = null;
function preloadThemeAudio(): Promise<ArrayBuffer> {
  themeArrayBufferPromise ??= fetch(`${import.meta.env.BASE_URL}theme.mp3`).then(res => res.arrayBuffer());
  return themeArrayBufferPromise;
}
// Routes aren't code-split, so every page (including /play joiners who never
// see the lobby) loads this module — gate on the real URL so only genuine
// /host visits pay for the download. /host is only ever reached via a full
// navigation (OAuth redirect callback, or a direct/bookmarked hit), never
// client-side `navigate()`, so location.pathname reflects the actual visit.
if (globalThis.location.pathname.includes('/host')) preloadThemeAudio();

// Waiting-room music: starts the instant LobbyView mounts (right after the
// Spotify OAuth redirect — deliberately not gated on `pin`, since that isn't
// set until the create_game round trip and Spotify device registration both
// finish, several seconds later) and fades out (rather than cutting) when the
// host leaves the lobby, by starting the game or backing out.
//
// Uses the Web Audio API instead of <audio loop>: Chromium doesn't honor an
// MP3's LAME gapless-encoding metadata when it restarts a looping <audio>
// element, leaving an audible click/gap at the loop boundary. decodeAudioData
// does honor it, and looping the decoded AudioBuffer via AudioBufferSourceNode
// is sample-accurate.
function useLobbyMusic(muffled: boolean) {
  const ctxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const filterRef = useRef<BiquadFilterNode | null>(null);
  const fadeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mutedRef = useRef(false);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const ctx = new AudioContext();
    ctxRef.current = ctx;

    (async () => {
      try {
        const arrayBuffer = (await preloadThemeAudio()).slice(0);
        const buffer = await ctx.decodeAudioData(arrayBuffer);
        if (cancelled) return;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 22050; // fully open — no audible filtering
        const gain = ctx.createGain();
        gain.gain.value = mutedRef.current ? 0 : 1;
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        source.connect(filter).connect(gain).connect(ctx.destination);
        source.start(0);
        sourceRef.current = source;
        gainRef.current = gain;
        filterRef.current = filter;
      } catch { /* fetch/decode failed; lobby just stays silent */ }
    })();

    // A fresh AudioContext starts suspended until a user gesture. Right after
    // the OAuth redirect there hasn't been one yet, so resume on the first
    // interaction (a harmless no-op once it's already running).
    const resume = () => { ctx.resume().catch(() => {}); };
    document.addEventListener('pointerdown', resume);
    document.addEventListener('keydown', resume);
    // Backgrounding the tab suspends the context; resume the instant it's
    // foregrounded again instead of silently waiting for a click on the page.
    const onVisibility = () => { if (document.visibilityState === 'visible') resume(); };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('pointerdown', resume);
      document.removeEventListener('keydown', resume);
      document.removeEventListener('visibilitychange', onVisibility);
      if (fadeIntervalRef.current) { clearInterval(fadeIntervalRef.current); fadeIntervalRef.current = null; }
      sourceRef.current?.stop();
      ctx.close().catch(() => {});
    };
  }, []);

  // Smoothly filters out the high end when the game-expired dialog pops up,
  // so the music reads as muffled behind the popup instead of playing on
  // as if nothing happened.
  useEffect(() => {
    const ctx = ctxRef.current;
    const filter = filterRef.current;
    if (!ctx || !filter) return;
    filter.frequency.cancelScheduledValues(ctx.currentTime);
    filter.frequency.setValueAtTime(filter.frequency.value, ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(muffled ? 400 : 22050, ctx.currentTime + 1.2);
  }, [muffled]);

  const rampGain = (target: number, durationMs: number) => new Promise<void>(resolve => {
    const gain = gainRef.current;
    if (!gain) { resolve(); return; }
    if (fadeIntervalRef.current) clearInterval(fadeIntervalRef.current);
    const steps = 20;
    const start = gain.gain.value;
    let i = 0;
    fadeIntervalRef.current = setInterval(() => {
      i++;
      gain.gain.value = start + (target - start) * (i / steps);
      if (i >= steps) {
        clearInterval(fadeIntervalRef.current!);
        fadeIntervalRef.current = null;
        gain.gain.value = target;
        resolve();
      }
    }, durationMs / steps);
  });

  // Fades out and stops playback entirely, so callers that navigate away can
  // wait for it first instead of cutting the music off mid-fade. Sweeps the
  // lowpass filter down in lockstep with the volume so the music seems to
  // recede into the distance rather than just going quiet in place.
  const fadeOut = async (durationMs = 800) => {
    const ctx = ctxRef.current;
    const filter = filterRef.current;
    if (ctx && filter) {
      filter.frequency.cancelScheduledValues(ctx.currentTime);
      filter.frequency.setValueAtTime(filter.frequency.value, ctx.currentTime);
      filter.frequency.exponentialRampToValueAtTime(120, ctx.currentTime + durationMs / 1000);
    }
    await rampGain(0, durationMs);
    sourceRef.current?.stop();
  };

  const toggleMute = () => {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    rampGain(next ? 0 : 1, 250);
  };

  return { fadeOut, muted, toggleMute };
}

function MuteButton({ muted, toggleMute }: Readonly<{ muted: boolean; toggleMute: () => void }>) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={toggleMute}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      tabIndex={0}
      aria-label={muted ? 'Unmute lobby music' : 'Mute lobby music'}
      aria-pressed={muted}
      className="absolute bottom-5 right-5 flex items-center justify-center rounded-full transition-all duration-200 z-10"
      style={{
        width: '38px', height: '38px',
        background: hovered ? 'rgba(255,255,255,0.11)' : 'rgba(255,255,255,0.06)',
        border: '1px solid rgba(255,255,255,0.10)',
        backdropFilter: 'blur(12px)',
        color: muted ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.7)',
        cursor: 'pointer',
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
  const { fadeOut, muted, toggleMute } = useLobbyMusic(gameExpired);
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
    <div className="min-h-screen relative flex flex-col overflow-hidden">
      <BackButton zIndex={10} beforeNavigate={beforeGoHome ?? fadeOut} />
      <SettingsButton settingsOpen={settingsOpen} toggleSettings={toggleSettings} />
      <MuteButton muted={muted} toggleMute={toggleMute} />

      <SettingsPanel game={game} open={settingsOpen} />
      {playlistPickerOpen && <PlaylistPickerDialog game={game} />}

      <div
        className="flex flex-col items-center gap-6 p-6 transition-transform duration-500 ease-out"
        style={{ transform: pin ? 'translateY(0)' : 'translateY(30vh)' }}
      >
        <img
          ref={logoRef}
          src={`${import.meta.env.BASE_URL}logo.png`}
          alt={APP_NAME}
          width={2560}
          height={1000}
          className="w-auto"
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
        <div className={`flex-1 flex flex-col items-center gap-5 px-6 pb-6 transition-all duration-500 ${lobbyVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
          <JoinCard pin={game.pin} copied={game.copied} copyInvite={game.copyInvite} />
          <ModeToggle mode={mode} setMode={setMode} />
          <div className="w-full max-w-md">
            <p className="text-white/45 text-sm mb-2">{players.length} player{players.length === 1 ? '' : 's'}</p>
            <div className="flex flex-wrap gap-2">
              {players.map(p => (
                <button
                  key={p.name}
                  onClick={() => removePlayer(p.name)}
                  tabIndex={0}
                  className="relative group px-3 py-1.5 rounded-full bg-white/10 text-white text-sm font-semibold"
                  aria-label={`Remove ${p.name}`}
                >
                  {p.name}
                  <span className="absolute inset-0 rounded-full backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              ))}
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
