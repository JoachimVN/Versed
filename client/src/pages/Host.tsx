import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Loader2, Copy, Settings, Flame, Coins, Clock, PartyPopper, Volume2, VolumeX, ShieldAlert } from 'lucide-react';
import LiquidGlass from 'liquid-glass-react';
import QRCodeLib from 'react-qr-code';
const QRCode = QRCodeLib as unknown as React.FC<{ value: string; size?: number }>;
import { socket } from '../socket';
import { useSpotify } from '../hooks/useSpotify';
import { usePlaylistPicker, resolvePlaylistInput, PlaylistFetchError, PlaylistSummary, MIN_PLAYLIST_TRACKS, MAX_PLAYLIST_TRACKS } from '../hooks/usePlaylistPicker';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useSoundEffect } from '../hooks/useSoundEffect';
import { RankBadge } from '../components/RankBadge';
import { useAnimatedScore } from '../hooks/useAnimatedScore';
import { ConfettiBackground } from '../components/ConfettiBackground';
import { NoOneGotItCardContent, GotItCardContent, YearTimelineContent, PillButton, AwardsStrip } from '../components/RevealShared';
import { RoundIntro, PartyBadge, PartyRevealExtras } from '../components/RoundIntro';
import { BackButton } from '../components/BackButton';
import { CircularTimer } from '../components/CircularTimer';
import { AudioBars } from '../components/AudioBars';
import { LIQUID_CARD_PROPS, LIQUID_PILL_PROPS } from '../components/liquidGlassPresets';
import { APP_NAME, BACKEND_URL, RACE_TIME } from '../config';
import { commonPhaseAnnouncement } from '../utils/phaseAnnouncement';
import type { Award, ChaosLevel, Hint, LeaderboardEntry, PartyEvent, PartyInfo, PlayerInfo, PlaylistTrackInput, RoundResultEvent, SongSource } from '../types';

type Phase = 'connect' | 'lobby' | 'betting' | 'playing' | 'guessing' | 'reveal' | 'leaderboard' | 'finished';
type Mode = 'classic' | 'race' | 'party';
type Difficulty = 'easy' | 'medium' | 'hard';
interface SongInfo { title: string; artist: string; trackId: string; tempo?: number | null }
interface CustomPlaylist { id: string; name: string; imageUrl: string | null; tracks: PlaylistTrackInput[] }

// Combined-pool cap across all selected playlists — mirrors
// usePlaylistPicker's MAX_PLAYLIST_TRACKS (the per-playlist import cap) so
// stacking several large playlists can't quietly build a pool bigger than a
// single playlist import would ever have been allowed to be on its own.
const MAX_POOL_TRACKS = 5000;

// Dedupes by Spotify track ID across all selected playlists — first
// occurrence wins, so a song present in two playlists is only counted once.
// Uncapped: used to detect (and message) when the combined pool exceeds
// MAX_POOL_TRACKS, separately from the capped tracks actually sent to the
// server (mergePlaylistTracks below).
function mergeUniqueTracks(playlists: CustomPlaylist[]): PlaylistTrackInput[] {
  const seen = new Set<string>();
  const merged: PlaylistTrackInput[] = [];
  for (const p of playlists) {
    for (const t of p.tracks) {
      if (seen.has(t.spotifyTrackId)) continue;
      seen.add(t.spotifyTrackId);
      merged.push(t);
    }
  }
  return merged;
}

// What actually gets sent to the server — earlier-added playlists fill the
// pool first, so if the cap is hit it's always the most recently added
// playlist(s) that get trimmed, matching what PlaylistList's notice tells
// the host.
function mergePlaylistTracks(playlists: CustomPlaylist[]): PlaylistTrackInput[] {
  return mergeUniqueTracks(playlists).slice(0, MAX_POOL_TRACKS);
}

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

type Spotify = ReturnType<typeof useSpotify>;
type PlaylistPicker = ReturnType<typeof usePlaylistPicker>;

// Remembers the host's last-used lobby settings across page reloads and new
// games (New Game already leaves these untouched within a session — this
// just survives a full reload/revisit too). Never blocks game creation on a
// bad/missing value, so a corrupt or stale entry just falls back to defaults.
interface SavedHostSettings {
  bettingTime: number; guessingTime: number; rounds: number; mode: Mode;
  raceTime: number; raceWinnerOnly: boolean; artistOnly: boolean; yearOnly: boolean; difficulty: Difficulty;
  enabledEvents: PartyEvent[]; chaosLevel: ChaosLevel;
}
const HOST_SETTINGS_KEY = 'versed_host_settings';
const MODES: Set<Mode> = new Set(['classic', 'race', 'party']);
const DIFFICULTIES: Set<Difficulty> = new Set(['easy', 'medium', 'hard']);
export const ALL_PARTY_EVENTS: PartyEvent[] = ['double', 'mystery', 'steal', 'snippet', 'fullhints', 'blind', 'outro', 'underdog', 'chaoshints'];
const PARTY_EVENT_SET: Set<string> = new Set(ALL_PARTY_EVENTS);
const CHAOS_LEVELS: Set<ChaosLevel> = new Set(['chill', 'balanced', 'chaotic']);

function loadSavedHostSettings(): Partial<SavedHostSettings> {
  try {
    const raw = JSON.parse(localStorage.getItem(HOST_SETTINGS_KEY) ?? '{}');
    return {
      bettingTime: typeof raw.bettingTime === 'number' ? raw.bettingTime : undefined,
      guessingTime: typeof raw.guessingTime === 'number' ? raw.guessingTime : undefined,
      rounds: typeof raw.rounds === 'number' ? raw.rounds : undefined,
      mode: MODES.has(raw.mode) ? raw.mode : undefined,
      raceTime: typeof raw.raceTime === 'number' ? raw.raceTime : undefined,
      raceWinnerOnly: typeof raw.raceWinnerOnly === 'boolean' ? raw.raceWinnerOnly : undefined,
      artistOnly: typeof raw.artistOnly === 'boolean' ? raw.artistOnly : undefined,
      yearOnly: typeof raw.yearOnly === 'boolean' ? raw.yearOnly : undefined,
      difficulty: DIFFICULTIES.has(raw.difficulty) ? raw.difficulty : undefined,
      enabledEvents: Array.isArray(raw.enabledEvents)
        ? raw.enabledEvents.filter((e: unknown): e is PartyEvent => PARTY_EVENT_SET.has(e as string))
        : undefined,
      chaosLevel: CHAOS_LEVELS.has(raw.chaosLevel) ? raw.chaosLevel : undefined,
    };
  } catch { return {}; }
}

export interface HostState {
  spotify: Spotify;
  phase: Phase;
  pin: string;
  players: PlayerInfo[];
  roundIndex: number;
  totalRounds: number;
  hints: Hint[];
  bettingTime: number;
  timeLeft: number;
  timerTotal: number;
  bidCount: number;
  countdown: number | null;
  guesserNames: string[];
  lowestBid: number;
  playerBids: { name: string; bid: number }[];
  result: RoundResultEvent | null;
  roundDeltas: Record<string, number>;
  roundPity: Record<string, boolean>;
  leaderboard: LeaderboardEntry[];
  awards: Award[];
  copied: boolean;
  playProgress: number;
  inviteUrl: string;
  settingsOpen: boolean;
  bettingTimeSetting: number;
  guessingTimeSetting: number;
  roundsSetting: number;
  mode: Mode;
  raceTimeSetting: number;
  raceWinnerOnly: boolean;
  artistOnly: boolean;
  yearOnly: boolean;
  difficulty: Difficulty;
  enabledEvents: PartyEvent[];
  chaosLevel: ChaosLevel;
  songSource: SongSource;
  customPlaylists: CustomPlaylist[];
  playlistPicker: PlaylistPicker;
  playlistPickerOpen: boolean;
  startError: string | null;
  party: PartyInfo | null;
  stealResult: { thief: string; victim: string; amount: number; skipped?: boolean } | null;
  answeredCount: number;
  reconnecting: boolean;
  reconnectingCount: number;
  gameExpired: boolean;
  songPlaying: boolean;
  songTempo: number | null;
  toggleSettings: () => void;
  setBettingTimeSetting: (v: number) => void;
  setGuessingTimeSetting: (v: number) => void;
  setRoundsSetting: (v: number) => void;
  setMode: (m: Mode) => void;
  setRaceTimeSetting: (v: number) => void;
  setRaceWinnerOnly: (v: boolean) => void;
  setArtistOnly: (v: boolean) => void;
  setYearOnly: (v: boolean) => void;
  setDifficulty: (v: Difficulty) => void;
  toggleEvent: (e: PartyEvent) => void;
  setChaosLevel: (v: ChaosLevel) => void;
  setSongSource: (v: SongSource) => void;
  addPlaylist: (p: CustomPlaylist) => void;
  removePlaylist: (id: string) => void;
  openPlaylistPicker: () => void;
  closePlaylistPicker: () => void;
  createGame: () => void;
  startGame: () => void;
  skipTurn: () => void;
  endGame: () => void;
  copyInvite: () => void;
  newGame: () => void;
  removePlayer: (name: string) => void;
}

function useHostGame(): HostState {
  const spotify = useSpotify();
  const playBeat = useSoundEffect(`${import.meta.env.BASE_URL}timer_beat.wav`);
  const savedSettings = useMemo(loadSavedHostSettings, []);
  const [phase, setPhase] = useState<Phase>('connect');
  // The PIN survives page reloads via sessionStorage so an accidental reload
  // doesn't orphan a running game. freshLoadRef marks that this pin came from
  // storage (not a live session): the rejoin then needs a full state snapshot,
  // and a failed rejoin just means the stored pin is stale — start clean.
  const [pin, setPin] = useState(() => sessionStorage.getItem('versed_host_pin') ?? '');
  const pinRef = useRef(sessionStorage.getItem('versed_host_pin') ?? '');
  const freshLoadRef = useRef(!!pinRef.current);
  const [players, setPlayers] = useState<PlayerInfo[]>([]);
  const playersRef = useRef<PlayerInfo[]>([]);
  const [roundIndex, setRoundIndex] = useState(0);
  const [totalRounds, setTotalRounds] = useState(10);
  const [hints, setHints] = useState<Hint[]>([]);
  const [bettingTime, setBettingTime] = useState(15);
  const [timeLeft, setTimeLeft] = useState(0);
  const [timerTotal, setTimerTotal] = useState(0);
  const [bidCount, setBidCount] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [guesserNames, setGuesserNames] = useState<string[]>([]);
  const [lowestBid, setLowestBid] = useState(0);
  const [playerBids, setPlayerBids] = useState<{ name: string; bid: number }[]>([]);
  const [result, setResult] = useState<RoundResultEvent | null>(null);
  const [roundDeltas, setRoundDeltas] = useState<Record<string, number>>({});
  const [roundPity, setRoundPity] = useState<Record<string, boolean>>({});
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [awards, setAwards] = useState<Award[]>([]);
  const [copied, setCopied] = useState(false);
  const [playProgress, setPlayProgress] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bettingTimeSetting, setBettingTimeSetting] = useState(savedSettings.bettingTime ?? 15);
  const [guessingTimeSetting, setGuessingTimeSetting] = useState(savedSettings.guessingTime ?? 15);
  const [roundsSetting, setRoundsSetting] = useState(savedSettings.rounds ?? 10);
  const [mode, setMode] = useState<Mode>(savedSettings.mode ?? 'classic');
  const [raceTimeSetting, setRaceTimeSetting] = useState(savedSettings.raceTime ?? RACE_TIME);
  const [raceWinnerOnly, setRaceWinnerOnly] = useState(savedSettings.raceWinnerOnly ?? false);
  const [artistOnly, setArtistOnly] = useState(savedSettings.artistOnly ?? false);
  const [yearOnly, setYearOnly] = useState(savedSettings.yearOnly ?? false);
  const [difficulty, setDifficulty] = useState<Difficulty>(savedSettings.difficulty ?? 'hard');
  const [enabledEvents, setEnabledEvents] = useState<PartyEvent[]>(savedSettings.enabledEvents ?? ALL_PARTY_EVENTS);
  const [chaosLevel, setChaosLevel] = useState<ChaosLevel>(savedSettings.chaosLevel ?? 'balanced');
  // Not persisted in SavedHostSettings, deliberately: a reload can't restore
  // the actual fetched track data, so a restored 'playlist' flag with no
  // tracks would leave the host in a confusing half-configured state.
  const [songSource, setSongSource] = useState<SongSource>('library');
  const [customPlaylists, setCustomPlaylists] = useState<CustomPlaylist[]>([]);
  const [playlistPickerOpen, setPlaylistPickerOpen] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const playlistPicker = usePlaylistPicker(spotify.accessToken);

  useEffect(() => {
    const toSave: SavedHostSettings = {
      bettingTime: bettingTimeSetting, guessingTime: guessingTimeSetting, rounds: roundsSetting, mode,
      raceTime: raceTimeSetting, raceWinnerOnly, artistOnly, yearOnly, difficulty,
      enabledEvents, chaosLevel,
    };
    localStorage.setItem(HOST_SETTINGS_KEY, JSON.stringify(toSave));
  }, [bettingTimeSetting, guessingTimeSetting, roundsSetting, mode, raceTimeSetting, raceWinnerOnly, artistOnly, yearOnly, difficulty, enabledEvents, chaosLevel]);

  const toggleEvent = (e: PartyEvent) => {
    setEnabledEvents(prev => (prev.includes(e) ? prev.filter(x => x !== e) : [...prev, e]));
  };
  const [party, setParty] = useState<PartyInfo | null>(null);
  const [stealResult, setStealResult] = useState<{ thief: string; victim: string; amount: number; skipped?: boolean } | null>(null);
  const [answeredCount, setAnsweredCount] = useState(0);
  const [reconnecting, setReconnecting] = useState(false);
  const [reconnectingNames, setReconnectingNames] = useState<Set<string>>(new Set());
  const [gameExpired, setGameExpired] = useState(false);
  const [songPlaying, setSongPlaying] = useState(false);
  const [songTempo, setSongTempo] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playRafRef = useRef<number | null>(null);
  const playGenRef = useRef(0);
  // Set by betting_closed while the last bid dot's fill animation plays out;
  // play_song awaits it so the 3-2-1 countdown doesn't start ticking (invisibly,
  // under the still-showing betting screen) before the phase actually flips.
  const dotFillDelayRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    if (spotify.isConnected && !spotify.unauthorized && phase === 'connect') setPhase('lobby');
  }, [spotify.isConnected, spotify.unauthorized, phase]);

  function startCountdown(seconds: number) {
    stopCountdown();
    setTimeLeft(Math.ceil(seconds));
    setTimerTotal(Math.ceil(seconds));
    timerRef.current = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) { stopCountdown(); return 0; }
        return t - 1;
      });
    }, 1000);
  }

  function stopCountdown() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }

  // Drive a smooth playback bar over the clip's duration. rAF (rather than the
  // 1s countdown) keeps even sub-second clips visibly animating.
  function startPlaybackBar(durationMs: number) {
    stopPlaybackBar();
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / durationMs);
      setPlayProgress(p);
      if (p < 1) playRafRef.current = requestAnimationFrame(tick);
    };
    playRafRef.current = requestAnimationFrame(tick);
  }

  function stopPlaybackBar() {
    if (playRafRef.current) { cancelAnimationFrame(playRafRef.current); playRafRef.current = null; }
    setPlayProgress(0);
  }

  useEffect(() => {
    socket.connect();

    socket.on('connect', () => {
      if (pinRef.current) {
        const fresh = freshLoadRef.current;
        freshLoadRef.current = false;
        socket.emit('rejoin_host', { pin: pinRef.current, fresh }, (res: {
          players: PlayerInfo[]; phase: string; roundIndex: number; totalRounds: number;
          leaderboard: LeaderboardEntry[]; awards: Award[];
        } | { error: string }) => {
          if ('error' in res) {
            if (fresh) {
              // Stale pin from an earlier session — drop it and let the lobby
              // create a brand-new game instead of showing "expired".
              sessionStorage.removeItem('versed_host_pin');
              pinRef.current = '';
              setPin('');
            } else {
              setGameExpired(true);
            }
          } else {
            setPlayers(res.players);
            if (fresh) {
              // Reload recovery: the server parked any in-flight round on the
              // leaderboard; jump straight there so the game can continue.
              setRoundIndex(res.roundIndex);
              setTotalRounds(res.totalRounds);
              if (res.phase === 'leaderboard' || res.phase === 'finished') {
                setLeaderboard(res.leaderboard);
                setAwards(res.awards);
                setPhase(res.phase);
              }
            }
          }
          setReconnecting(false);
          setReconnectingNames(new Set());
        });
      } else {
        setReconnecting(false);
      }
    });

    socket.on('disconnect', (reason: string) => {
      if (reason !== 'io client disconnect') setReconnecting(true);
    });

    socket.on('player_joined', ({ players: p }: { players: PlayerInfo[] }) => setPlayers(p));
    socket.on('player_left', ({ players: p }: { players: PlayerInfo[] }) => {
      setPlayers(p);
      const remaining = new Set(p.map(pl => pl.name));
      setReconnectingNames(prev => { const s = new Set(prev); for (const n of s) { if (!remaining.has(n)) s.delete(n); } return s; });
      const stillInGame = (e: { name: string }) => remaining.has(e.name);
      setLeaderboard(prev => prev.filter(stillInGame));
    });
    socket.on('player_reconnecting', ({ name }: { name: string }) => {
      setReconnectingNames(prev => new Set(prev).add(name));
    });
    socket.on('player_reconnected', ({ name, score, streak }: { name: string; score?: number; streak?: number }) => {
      setReconnectingNames(prev => { const s = new Set(prev); s.delete(name); return s; });
      if (score !== undefined) {
        playersRef.current = playersRef.current.map(p =>
          p.name === name ? { ...p, score, streak: streak ?? p.streak } : p
        );
      }
    });

    socket.on('host_round_start', (data: {
      roundIndex: number; total: number; hints: Hint[];
      bettingTime?: number; song: SongInfo; mode?: 'classic' | 'race'; raceTime?: number;
      party?: PartyInfo;
    }) => {
      setRoundIndex(data.roundIndex);
      setTotalRounds(data.total);
      setHints(data.hints);
      setBidCount(0);
      setGuesserNames([]);
      setPlayerBids([]);
      setResult(null);
      setAnsweredCount(0);
      setParty(data.party ?? null);
      setStealResult(null);
      setSongTempo(data.song.tempo ?? null);
      if (data.mode === 'race') {
        setPhase('playing');
      } else {
        setBettingTime(data.bettingTime ?? 15);
        startCountdown(data.bettingTime ?? 15);
        setPhase('betting');
      }
    });

    socket.on('answer_received', ({ answered }: { answered: number }) => {
      setAnsweredCount(answered);
    });

    socket.on('bid_received', ({ bidCount: bc }: { bidCount: number }) => setBidCount(bc));

    socket.on('betting_closed', (data: { lowestBid: number; guesserNames: string[]; playerBids: { name: string; bid: number }[] }) => {
      setLowestBid(data.lowestBid);
      setGuesserNames(data.guesserNames);
      setPlayerBids(data.playerBids ?? []);
      stopCountdown();
      setSongPlaying(false);
      // Brief pause so the last dot's fill animation is visible before transitioning.
      // play_song awaits this same promise so its 3-2-1 countdown can't start
      // ticking underneath the still-showing betting screen.
      dotFillDelayRef.current = wait(600).then(() => setPhase('playing'));
    });

    socket.on('play_song', async (data: { trackId: string; durationMs: number; countdownMs?: number; positionMs?: number }) => {
      // Bump generation so any previously-running countdown loop exits early.
      const myGen = ++playGenRef.current;
      stopPlaybackBar(); // keep the bar empty through the countdown/buffer
      const prepared = spotify.prepareTrack(data.trackId, data.positionMs ?? 0);
      if (dotFillDelayRef.current) {
        await dotFillDelayRef.current;
        dotFillDelayRef.current = null;
        if (playGenRef.current !== myGen) return;
      }
      const ticks = Math.ceil((data.countdownMs ?? 3000) / 1000);
      for (let n = ticks; n > 0; n--) {
        if (playGenRef.current !== myGen) return;
        setCountdown(n);
        playBeat();
        await wait(1000);
      }
      if (playGenRef.current !== myGen) return;
      setCountdown(null);
      const prepareOk = await prepared;
      if (playGenRef.current !== myGen) return;
      // Prepare failed (device gone, API error): don't call startPrepared —
      // it would resume the previous round's track. The server's fallback
      // timer moves the round along instead.
      if (!prepareOk) return;
      // Resolves at the real audible start; sync the timer and server to it.
      // Returns false if a round_result/guessing_start arrived and cancelled
      // playback mid-countdown — in that case skip song_started so the server
      // doesn't start a guessing timer for a round that's already over.
      const started = await spotify.startPrepared(data.durationMs);
      if (!started) return;
      setSongPlaying(true);
      socket.emit('song_started');
      startCountdown(data.durationMs / 1000);
      startPlaybackBar(data.durationMs);
    });

    socket.on('guessing_start', (data: { guesserNames: string[]; timeLimit: number }) => {
      ++playGenRef.current;
      spotify.pauseTrack();
      setSongPlaying(false);
      stopCountdown();
      stopPlaybackBar();
      setGuesserNames(data.guesserNames);
      startCountdown(data.timeLimit);
      setPhase('guessing');
    });

    socket.on('round_result', (data: RoundResultEvent) => {
      ++playGenRef.current;
      stopCountdown();
      stopPlaybackBar();
      spotify.pauseTrack();
      setSongPlaying(false);
      setResult(data);
      setPhase('reveal');
    });

    socket.on('score_update', ({ players: p }: { players: PlayerInfo[] }) => {
      const deltas: Record<string, number> = {};
      const pity: Record<string, boolean> = {};
      for (const updated of p) {
        const prev = playersRef.current.find(x => x.name === updated.name);
        deltas[updated.name] = (updated.score ?? 0) - (prev?.score ?? 0);
        pity[updated.name] = updated.pity ?? false;
      }
      playersRef.current = p;
      setRoundDeltas(deltas);
      setRoundPity(pity);
      setPlayers(p);
    });

    socket.on('leaderboard', ({ leaderboard: lb }: { leaderboard: LeaderboardEntry[] }) => {
      setLeaderboard(lb);
      setPhase('leaderboard');
    });

    socket.on('game_over', ({ leaderboard: lb, awards: aw }: { leaderboard: LeaderboardEntry[]; awards?: Award[] }) => {
      // The game can end mid-song now (host's "End game"), so stop playback
      // and timers the same way round_result does.
      ++playGenRef.current;
      stopCountdown();
      stopPlaybackBar();
      spotify.pauseTrack();
      setSongPlaying(false);
      setLeaderboard(lb);
      setAwards(aw ?? []);
      setPhase('finished');
    });

    socket.on('steal_result', (r: { thief: string; victim: string; amount: number; skipped?: boolean }) => {
      setStealResult(r);
    });

    return () => {
      stopCountdown();
      stopPlaybackBar();
      socket.off('connect'); socket.off('disconnect');
      socket.off('player_joined'); socket.off('player_left');
      socket.off('player_reconnecting'); socket.off('player_reconnected');
      socket.off('host_round_start'); socket.off('bid_received');
      socket.off('betting_closed'); socket.off('play_song');
      socket.off('guessing_start'); socket.off('round_result');
      socket.off('score_update'); socket.off('leaderboard'); socket.off('game_over');
      socket.off('answer_received'); socket.off('steal_result');
      socket.disconnect();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Deep link that pre-fills the PIN on the join screen (Play reads /play/:pin).
  const inviteUrl = `${globalThis.location.origin}${import.meta.env.BASE_URL}play/${pin}`;

  const createGame = () => {
    socket.emit('create_game', ({ pin: p, error: e }: { pin?: string; error?: string }) => {
      if (e || !p) return;
      pinRef.current = p;
      setPin(p);
      sessionStorage.setItem('versed_host_pin', p);
      freshLoadRef.current = false;
    });
  };

  const startGame = () => {
    setStartError(null);
    spotify.activatePlayer();
    socket.emit('start_game', {
      settings: {
        bettingTime: bettingTimeSetting, guessingTime: guessingTimeSetting,
        totalRounds: roundsSetting, mode, raceTime: raceTimeSetting, raceWinnerOnly, artistOnly, yearOnly,
        difficulty, songSource, enabledEvents, chaosLevel,
        customPlaylist: songSource === 'playlist' && customPlaylists.length > 0
          ? {
            id: customPlaylists.map(p => p.id).join(','),
            name: customPlaylists.map(p => p.name).join(', '),
            tracks: mergePlaylistTracks(customPlaylists),
          }
          : undefined,
      },
    }, (ack?: { error?: string }) => {
      if (ack?.error) setStartError(ack.error);
    });
  };

  const copyInvite = () => {
    navigator.clipboard?.writeText(inviteUrl)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => { /* clipboard unavailable; user can still read the link */ });
  };

  const newGame = () => {
    socket.emit('new_game', ({ pin: p, error: e }: { pin?: string; error?: string }) => {
      if (e || !p) return;
      pinRef.current = p;
      setPin(p);
      sessionStorage.setItem('versed_host_pin', p);
      setPlayers([]);
      setLeaderboard([]);
      setResult(null);
      setRoundIndex(0);
      setHints([]);
      setBidCount(0);
      setGuesserNames([]);
      setPlayerBids([]);
      setLowestBid(0);
      setReconnectingNames(new Set());
      // Stale party data (e.g. a finale) must not survive into the new game —
      // roundIndex resets to 0 here too, and RoundIntro re-fires its overlay
      // on any roundIndex change while party is set, flashing the old round's
      // announcement over the fresh lobby.
      setParty(null);
      setStealResult(null);
      stopCountdown();
      stopPlaybackBar();
      setPhase('lobby');
    });
  };

  return {
    spotify, phase, pin, players, roundIndex, totalRounds, hints,
    bettingTime, timeLeft, timerTotal, bidCount, countdown, guesserNames, lowestBid, playerBids,
    result, roundDeltas, roundPity, leaderboard, awards, copied, playProgress, inviteUrl,
    settingsOpen, bettingTimeSetting, guessingTimeSetting, roundsSetting,
    mode, raceTimeSetting, raceWinnerOnly, artistOnly, yearOnly, difficulty,
    enabledEvents, chaosLevel,
    songSource, customPlaylists, playlistPicker, playlistPickerOpen, startError,
    party, stealResult, answeredCount,
    reconnecting, reconnectingCount: reconnectingNames.size, gameExpired, songPlaying, songTempo,
    toggleSettings: () => setSettingsOpen(o => !o),
    setBettingTimeSetting, setGuessingTimeSetting, setRoundsSetting,
    setMode, setRaceTimeSetting, setRaceWinnerOnly, setArtistOnly, setYearOnly, setDifficulty,
    toggleEvent, setChaosLevel,
    setSongSource,
    addPlaylist: (p: CustomPlaylist) => setCustomPlaylists(list => list.some(x => x.id === p.id) ? list : [...list, p]),
    removePlaylist: (id: string) => setCustomPlaylists(list => list.filter(p => p.id !== id)),
    openPlaylistPicker: () => setPlaylistPickerOpen(true),
    closePlaylistPicker: () => setPlaylistPickerOpen(false),
    createGame, startGame, copyInvite, newGame,
    skipTurn: () => socket.emit('host_skip_turn'),
    endGame: () => socket.emit('end_game'),
    removePlayer: (name: string) => socket.emit('kick_player', { name }),
  };
}

// ─── Bid timeline ────────────────────────────────────────────────────────────

function BidTimeline({ bids, lowestBid }: Readonly<{ bids: { name: string; bid: number }[]; lowestBid: number }>) {
  if (bids.length === 0) return null;
  const sorted = [...bids].sort((a, b) => a.bid - b.bid);
  const min = sorted[0].bid;
  const max = sorted.at(-1)!.bid;
  const span = max === min ? 0 : max - min;
  const pos = (bid: number) => span === 0 ? 50 : 8 + ((bid - min) / span) * 84;

  // Group players by bid so ties share one position instead of stacking on top of each other.
  const groups: { bid: number; names: string[] }[] = [];
  for (const { name, bid } of sorted) {
    const last = groups.at(-1);
    if (last?.bid === bid) last.names.push(name);
    else groups.push({ bid, names: [name] });
  }

  const MAX_NAMES = 3;
  const maxLines = groups.reduce((m, g) => Math.max(m, Math.min(g.names.length, MAX_NAMES) + (g.names.length > MAX_NAMES ? 1 : 0)), 0);
  const nameAreaHeight = 22 + maxLines * 16 + 8;

  return (
    <div className="w-full">
      {/* Name labels — alternate above/below to reduce overlap on close bids */}
      <div className="relative" style={{ height: nameAreaHeight }}>
        {groups.map((group, i) => (
          <div
            key={group.bid}
            className={`absolute -translate-x-1/2 flex flex-col items-center gap-0.5 ${group.bid === lowestBid ? 'text-purple-300' : 'text-white/50'}`}
            style={{ left: `${pos(group.bid)}%`, top: i % 2 === 0 ? 2 : 22 }}
          >
            {group.names.slice(0, MAX_NAMES).map(name => (
              <span key={name} className="text-xs font-semibold whitespace-nowrap">{name}</span>
            ))}
            {group.names.length > MAX_NAMES && (
              <span className="text-xs whitespace-nowrap opacity-60">+{group.names.length - MAX_NAMES} more</span>
            )}
          </div>
        ))}
      </div>

      {/* Bar + dots */}
      <div className="relative h-px bg-white/20">
        {groups.map(group => (
          <div
            key={group.bid}
            className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full ${group.bid === lowestBid ? 'w-3 h-3 bg-purple-400' : 'w-2 h-2 bg-white/40'}`}
            style={{ left: `${pos(group.bid)}%` }}
          />
        ))}
      </div>

      {/* Bid value labels */}
      <div className="relative h-5 mt-1">
        {groups.map(group => (
          <span
            key={group.bid}
            className={`absolute text-xs -translate-x-1/2 ${group.bid === lowestBid ? 'text-purple-400' : 'text-white/45'}`}
            style={{ left: `${pos(group.bid)}%` }}
          >
            {group.bid}s
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Lobby sub-components ─────────────────────────────────────────────────────

function SettingsPanel({ game, open }: Readonly<{ game: HostState; open: boolean }>) {
  const {
    mode, bettingTimeSetting, guessingTimeSetting, roundsSetting, raceTimeSetting, raceWinnerOnly, artistOnly, yearOnly, difficulty,
    enabledEvents, chaosLevel,
    songSource, customPlaylists,
    setBettingTimeSetting, setGuessingTimeSetting, setRoundsSetting, setRaceTimeSetting, setRaceWinnerOnly, setArtistOnly, setYearOnly, setDifficulty,
    toggleEvent, setChaosLevel,
    setSongSource, openPlaylistPicker, removePlaylist,
    toggleSettings,
  } = game;
  const panelRef = useRef<HTMLDialogElement>(null);
  useEscapeKey(toggleSettings, open);
  useFocusTrap(panelRef, open);
  // "Guess the year" has no single title/artist answer, so it can't run
  // alongside "Artist only" — picking it clears that. It can still run
  // alongside "Winner only" in Race mode (that just restricts year scoring
  // to the closest guess).
  const toggleYearOnly = () => {
    const next = !yearOnly;
    setYearOnly(next);
    if (next) setArtistOnly(false);
  };
  const toggleArtistOnly = () => {
    const next = !artistOnly;
    setArtistOnly(next);
    if (next) setYearOnly(false);
  };
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
        className="w-72 rounded-2xl overflow-hidden"
        style={{
          background: 'rgba(10, 6, 26, 0.65)',
          backdropFilter: 'blur(32px)',
          border: '1px solid rgba(255,255,255,0.09)',
          boxShadow: '0 24px 48px rgba(0,0,0,0.4), inset 0 0 0 1px rgba(255,255,255,0.04)',
        }}
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
            {/* "Winner only" (Race) works fine alongside "Guess the year" —
                it just restricts scoring to the closest guess. "Artist only"
                is a genuine conflict (year isn't a title/artist target), so
                it's kept visible-but-disabled rather than hidden/cleared. */}
            {mode === 'race' && (
              <ToggleRow label="Winner only" value={raceWinnerOnly} onToggle={() => setRaceWinnerOnly(!raceWinnerOnly)} />
            )}
            <ToggleRow label="Artist only" value={artistOnly} disabled={yearOnly} onToggle={toggleArtistOnly} />
            <ToggleRow label="Guess the year" value={yearOnly} onToggle={toggleYearOnly} />
          </div>
        )}

        {mode === 'party' && (
          <div className="px-5 pb-4 space-y-4" style={{ borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: '16px' }}>
            <ChaosLevelRow value={chaosLevel} onChange={setChaosLevel} />
            <div className="space-y-2">
              <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.875rem' }}>Events</span>
              <div className="space-y-2">
                {ALL_PARTY_EVENTS.map(e => (
                  <ToggleRow key={e} label={EVENT_LABELS[e]} value={enabledEvents.includes(e)} onToggle={() => toggleEvent(e)} />
                ))}
              </div>
              {enabledEvents.length === 0 && (
                <p style={{ color: 'rgba(251,191,36,0.85)', fontSize: '0.7rem' }}>
                  At least one event should stay on, or rounds will always play plain.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </dialog>
  );
}

function JoinCard({ pin, copied, copyInvite }: Readonly<{ pin: string; copied: boolean; copyInvite: () => void }>) {
  const searchParams = new URLSearchParams(globalThis.location.search);
  const isScreenshot = searchParams.has('v');
  const baseUrl = isScreenshot ? 'https://joavn.dev/versed' : `${globalThis.location.origin}${import.meta.env.BASE_URL}`.replace(/\/$/, '');
  const qrUrl = isScreenshot ? `https://joavn.dev/versed/play/${pin}` : `${globalThis.location.origin}${import.meta.env.BASE_URL}play/${pin}`;

  return (
    <div className="w-full max-w-md bg-white/5 rounded-2xl p-5">
      <div className="flex items-center gap-5">
        <div className="flex-1 min-w-0 flex flex-col gap-3">
          <div>
            <p className="text-white/45 text-xs uppercase tracking-widest mb-0.5">Join at</p>
            <p className="text-white font-semibold text-base">
              {baseUrl}
            </p>
          </div>
          <div>
            <p className="text-white/45 text-xs uppercase tracking-widest mb-0.5">PIN</p>
            <p className="text-6xl font-black text-white tracking-widest leading-none select-text">{pin}</p>
          </div>
          <button
            onClick={copyInvite}
            className="flex items-center gap-2 text-white/45 text-xs hover:text-white/70 transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copied!' : 'Copy invite link'}
          </button>
        </div>
        <div className="p-2 bg-white rounded-xl shrink-0">
          <QRCode value={qrUrl} size={148} />
        </div>
      </div>
    </div>
  );
}

// ─── Settings row / toggle ────────────────────────────────────────────────────

const STEPPER_BTN_BG = 'rgba(255,255,255,0.07)';
const STEPPER_BTN_BORDER = 'rgba(255,255,255,0.09)';
const STEPPER_BTN_COLOR = 'rgba(255,255,255,0.55)';
const STEPPER_BTN_BG_HOVER = 'rgba(255,255,255,0.14)';
const STEPPER_BTN_BORDER_HOVER = 'rgba(255,255,255,0.2)';
const STEPPER_BTN_COLOR_HOVER = 'rgba(255,255,255,0.85)';

// Plain inline `style` always wins over a stylesheet `:hover` rule (even one
// from a Tailwind class), so hover here has to be applied via JS instead of
// a `hover:` className — same pattern as the other inline-styled hover
// buttons in this file (e.g. the mode/difficulty pills below).
function SettingStepperButton({ symbol, label, onClick, disabled }: Readonly<{
  symbol: string; label: string; onClick: () => void; disabled?: boolean;
}>) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      aria-label={label}
      className="flex items-center justify-center active:scale-90 transition-transform"
      style={{
        width: '28px', height: '28px', borderRadius: '50%',
        background: STEPPER_BTN_BG,
        border: `1px solid ${STEPPER_BTN_BORDER}`,
        color: STEPPER_BTN_COLOR,
        fontSize: '1.1rem', lineHeight: 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        transition: 'background 0.15s, border-color 0.15s, color 0.15s',
      }}
      onMouseEnter={e => {
        if (disabled) return;
        const el = e.currentTarget;
        el.style.background = STEPPER_BTN_BG_HOVER;
        el.style.borderColor = STEPPER_BTN_BORDER_HOVER;
        el.style.color = STEPPER_BTN_COLOR_HOVER;
      }}
      onMouseLeave={e => {
        const el = e.currentTarget;
        el.style.background = STEPPER_BTN_BG;
        el.style.borderColor = STEPPER_BTN_BORDER;
        el.style.color = STEPPER_BTN_COLOR;
      }}
    >{symbol}</button>
  );
}

function SettingRow({ label, value, unit, onDec, onInc, onChange, min = 1, max = 999, disabled }: Readonly<{
  label: string; value: number; unit: string; onDec: () => void; onInc: () => void;
  onChange?: (v: number) => void; min?: number; max?: number; disabled?: boolean;
}>) {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);

  const commit = () => {
    const n = Number.parseInt(text, 10);
    if (onChange && !Number.isNaN(n)) onChange(Math.min(max, Math.max(min, n)));
    else setText(String(value));
  };

  return (
    <div className="flex items-center justify-between">
      <span style={{ color: disabled ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.5)', fontSize: '0.875rem' }}>
        {label}
      </span>
      <div className="flex items-center gap-2.5">
        <SettingStepperButton symbol="−" label={`Decrease ${label}`} onClick={onDec} disabled={disabled} />
        {onChange ? (
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            aria-label={label}
            value={text}
            disabled={disabled}
            onChange={e => { if (/^\d*$/.test(e.target.value)) setText(e.target.value); }}
            onBlur={commit}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            style={{
              color: disabled ? 'rgba(255,255,255,0.45)' : 'white',
              fontWeight: 700, width: '42px', textAlign: 'center', fontSize: '0.9375rem',
              background: 'transparent', border: 'none', outline: 'none', padding: 0,
            }}
          />
        ) : (
          <span style={{
            color: disabled ? 'rgba(255,255,255,0.45)' : 'white',
            fontWeight: 700, minWidth: '42px', textAlign: 'center', fontSize: '0.9375rem',
          }}>
            {value}{unit}
          </span>
        )}
        <SettingStepperButton symbol="+" label={`Increase ${label}`} onClick={onInc} disabled={disabled} />
      </div>
    </div>
  );
}

const DIFFICULTY_OPTIONS: { key: Difficulty; label: string }[] = [
  { key: 'easy', label: 'Easy' },
  { key: 'medium', label: 'Medium' },
  { key: 'hard', label: 'Hard' },
];

const DIFFICULTY_STYLE: Record<Difficulty, { bg: string; border: string; text: string }> = {
  easy: { bg: 'rgba(16, 185, 129, 0.25)', border: '1px solid rgba(52, 211, 153, 0.45)', text: '#6ee7b7' },
  medium: { bg: 'rgba(217, 119, 6, 0.25)', border: '1px solid rgba(251, 191, 36, 0.45)', text: '#fcd34d' },
  hard: { bg: 'rgba(220, 38, 38, 0.25)', border: '1px solid rgba(248, 113, 113, 0.45)', text: '#fca5a5' },
};

// Restricts the song pool to the most well-known top 20%/50%/100% of tracks —
// see DIFFICULTY_PCT server-side. Sliding highlight mirrors ModeToggle above.
function DifficultyRow({ value, onChange }: Readonly<{ value: Difficulty; onChange: (v: Difficulty) => void }>) {
  const index = DIFFICULTY_OPTIONS.findIndex(d => d.key === value);
  const active = DIFFICULTY_STYLE[value];
  return (
    <div className="space-y-2">
      <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.875rem' }}>Difficulty</span>
      <div
        className="relative flex rounded-xl"
        style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', padding: '3px' }}
      >
        <div
          className="absolute rounded-lg"
          style={{
            top: '3px', bottom: '3px', left: '3px',
            width: 'calc((100% - 6px) / 3)',
            background: active.bg,
            border: active.border,
            transform: `translateX(${index * 100}%)`,
            transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), background 0.25s ease, border-color 0.25s ease',
            pointerEvents: 'none',
          }}
        />
        {DIFFICULTY_OPTIONS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => onChange(key)}
            className="relative flex-1 py-1.5 rounded-lg text-xs font-semibold z-10 transition-colors duration-200"
            style={{
              color: value === key ? DIFFICULTY_STYLE[key].text : 'rgba(255,255,255,0.45)',
              background: 'transparent', border: 'none', cursor: 'pointer',
            }}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

const SONG_SOURCE_OPTIONS: { key: SongSource; label: string }[] = [
  { key: 'library', label: 'Versed Library' },
  { key: 'playlist', label: 'My Playlist' },
];

const SONG_SOURCE_STYLE: Record<SongSource, { bg: string; border: string; text: string }> = {
  library: { bg: 'rgba(178,16,224,0.25)', border: '1px solid rgba(208,46,249,0.45)', text: '#d8b4fe' },
  playlist: { bg: 'rgba(29, 185, 84, 0.25)', border: '1px solid rgba(29, 185, 84, 0.45)', text: '#6ee7a0' },
};

// Same sliding-pill pattern as DifficultyRow, two options instead of three.
function SongSourceRow({ value, onChange }: Readonly<{ value: SongSource; onChange: (v: SongSource) => void }>) {
  const index = SONG_SOURCE_OPTIONS.findIndex(o => o.key === value);
  const active = SONG_SOURCE_STYLE[value];
  return (
    <div className="space-y-2">
      <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.875rem' }}>Song Source</span>
      <div
        className="relative flex rounded-xl"
        style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', padding: '3px' }}
      >
        <div
          className="absolute rounded-lg"
          style={{
            top: '3px', bottom: '3px', left: '3px',
            width: 'calc((100% - 6px) / 2)',
            background: active.bg,
            border: active.border,
            transform: `translateX(${index * 100}%)`,
            transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), background 0.25s ease, border-color 0.25s ease',
            pointerEvents: 'none',
          }}
        />
        {SONG_SOURCE_OPTIONS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => onChange(key)}
            className="relative flex-1 py-1.5 rounded-lg text-xs font-semibold z-10 transition-colors duration-200"
            style={{
              color: value === key ? SONG_SOURCE_STYLE[key].text : 'rgba(255,255,255,0.45)',
              background: 'transparent', border: 'none', cursor: 'pointer',
            }}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

const CHAOS_OPTIONS: { key: ChaosLevel; label: string }[] = [
  { key: 'chill', label: 'Chill' },
  { key: 'balanced', label: 'Balanced' },
  { key: 'chaotic', label: 'Chaotic' },
];

const CHAOS_STYLE: Record<ChaosLevel, { bg: string; border: string; text: string }> = {
  chill: { bg: 'rgba(14, 165, 233, 0.25)', border: '1px solid rgba(56, 189, 248, 0.45)', text: '#7dd3fc' },
  balanced: { bg: 'rgba(178,16,224,0.25)', border: '1px solid rgba(208,46,249,0.45)', text: '#d8b4fe' },
  chaotic: { bg: 'rgba(220, 38, 38, 0.25)', border: '1px solid rgba(248, 113, 113, 0.45)', text: '#fca5a5' },
};

// Controls how often party events fire and how wild mystery's multiplier
// spread gets (see NO_EVENT_CHANCE/MYSTERY_MULTIPLIERS_BY_CHAOS server-side).
// Same sliding-pill pattern as DifficultyRow.
function ChaosLevelRow({ value, onChange }: Readonly<{ value: ChaosLevel; onChange: (v: ChaosLevel) => void }>) {
  const index = CHAOS_OPTIONS.findIndex(o => o.key === value);
  const active = CHAOS_STYLE[value];
  return (
    <div className="space-y-2">
      <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.875rem' }}>Chaos level</span>
      <div
        className="relative flex rounded-xl"
        style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', padding: '3px' }}
      >
        <div
          className="absolute rounded-lg"
          style={{
            top: '3px', bottom: '3px', left: '3px',
            width: 'calc((100% - 6px) / 3)',
            background: active.bg,
            border: active.border,
            transform: `translateX(${index * 100}%)`,
            transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), background 0.25s ease, border-color 0.25s ease',
            pointerEvents: 'none',
          }}
        />
        {CHAOS_OPTIONS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => onChange(key)}
            className="relative flex-1 py-1.5 rounded-lg text-xs font-semibold z-10 transition-colors duration-200"
            style={{
              color: value === key ? CHAOS_STYLE[key].text : 'rgba(255,255,255,0.45)',
              background: 'transparent', border: 'none', cursor: 'pointer',
            }}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

// Human labels for the per-event on/off checklist — kept separate from
// RoundIntro.tsx's EVENT_BITS/server's eventIntros since those live in a
// different module and are styled for in-round display, not a settings list.
const EVENT_LABELS: Record<PartyEvent, string> = {
  double: 'Double Points',
  mystery: 'Mystery Multiplier',
  steal: 'Steal Round',
  snippet: 'Snippet Roulette',
  fullhints: 'Open Book',
  blind: 'Blind Bet',
  outro: 'Down to the Wire',
  underdog: 'Underdog Boost',
  chaoshints: 'Chaos Hints',
};

function PlaylistList({ customPlaylists, onOpen, onRemove }: Readonly<{
  customPlaylists: CustomPlaylist[]; onOpen: () => void; onRemove: (id: string) => void;
}>) {
  const uncappedTotal = mergeUniqueTracks(customPlaylists).length;
  const totalTracks = Math.min(uncappedTotal, MAX_POOL_TRACKS);
  const overCap = uncappedTotal > MAX_POOL_TRACKS;
  return (
    <div className="space-y-2">
      {customPlaylists.map(p => (
        <div
          key={p.id}
          className="w-full flex items-center gap-2.5 rounded-xl"
          style={{ padding: '8px 10px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          {p.imageUrl ? (
            <img src={p.imageUrl} alt="" className="w-8 h-8 rounded-md object-cover shrink-0" />
          ) : (
            <div className="w-8 h-8 rounded-md shrink-0" style={{ background: 'rgba(255,255,255,0.08)' }} />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate" style={{ color: 'white', fontWeight: 600, fontSize: '0.8125rem' }}>{p.name}</p>
            <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.6875rem' }}>{p.tracks.length} tracks</p>
          </div>
          <button
            onClick={() => onRemove(p.id)}
            aria-label={`Remove ${p.name}`}
            className="text-white/35 hover:text-white/80 transition-colors"
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', lineHeight: 1, padding: '4px' }}
          >
            ×
          </button>
        </div>
      ))}
      <button
        onClick={onOpen}
        className="w-full flex items-center gap-2.5 rounded-xl text-left"
        style={{ padding: '8px 10px', background: 'rgba(255,255,255,0.05)', border: '1px dashed rgba(255,255,255,0.15)', cursor: 'pointer', transition: 'background 0.15s, border-color 0.15s' }}
        onMouseEnter={e => { const el = e.currentTarget; el.style.background = 'rgba(255,255,255,0.09)'; el.style.borderColor = 'rgba(255,255,255,0.3)'; }}
        onMouseLeave={e => { const el = e.currentTarget; el.style.background = 'rgba(255,255,255,0.05)'; el.style.borderColor = 'rgba(255,255,255,0.15)'; }}
      >
        <div className="min-w-0 flex-1">
          <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.8125rem' }}>
            {customPlaylists.length === 0 ? 'Choose playlists' : '+ Add another playlist'}
          </p>
          {customPlaylists.length > 1 && (
            <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.6875rem' }}>{totalTracks} unique tracks total</p>
          )}
        </div>
        <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.75rem' }}>→</span>
      </button>
      {overCap && (
        <p style={{ color: '#fcd34d', fontSize: '0.6875rem' }}>
          Combined pool capped at {MAX_POOL_TRACKS.toLocaleString()} tracks — {(uncappedTotal - MAX_POOL_TRACKS).toLocaleString()} track{uncappedTotal - MAX_POOL_TRACKS === 1 ? '' : 's'} from the most recently added playlist(s) won't be included.
        </p>
      )}
    </div>
  );
}

function ToggleRow({ label, value, onToggle, disabled }: Readonly<{
  label: string; value: boolean; onToggle: () => void; disabled?: boolean;
}>) {
  return (
    <div className="flex items-center justify-between">
      <span style={{ color: disabled ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.5)', fontSize: '0.875rem' }}>
        {label}
      </span>
      <button
        onClick={disabled ? undefined : onToggle}
        disabled={disabled}
        className="relative shrink-0"
        style={{
          width: '40px', height: '22px', borderRadius: '100px',
          background: value ? 'rgba(178,16,224,0.7)' : 'rgba(255,255,255,0.10)',
          border: value ? '1px solid rgba(198,36,249,0.6)' : '1px solid rgba(255,255,255,0.08)',
          transition: 'background 0.2s ease, border-color 0.2s ease, opacity 0.2s ease',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.4 : 1,
        }}
      >
        <span
          className="absolute"
          style={{
            top: '3px', left: '3px',
            width: '14px', height: '14px',
            borderRadius: '50%',
            background: 'white',
            boxShadow: '0 1px 3px rgba(0,0,0,0.35)',
            transition: 'transform 0.2s ease',
            transform: value ? 'translateX(18px)' : 'translateX(0)',
          }}
        />
      </button>
    </div>
  );
}

// Discreet "End game" control with a two-tap confirm so a stray click can't
// nuke a running game. Jumps everyone to final scores.
function EndGameButton({ endGame }: Readonly<{ endGame: () => void }>) {
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 3000);
    return () => clearTimeout(t);
  }, [confirming]);
  return (
    <button
      onClick={() => { if (confirming) endGame(); else setConfirming(true); }}
      className="text-xs transition-colors"
      style={{
        background: 'none', border: 'none', cursor: 'pointer',
        color: confirming ? 'rgba(248,113,113,0.9)' : 'rgba(255,255,255,0.28)',
      }}
      onMouseEnter={e => { if (!confirming) (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.4)'; }}
      onMouseLeave={e => { if (!confirming) (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.28)'; }}
    >
      {confirming ? 'Tap again to end the game' : 'End game'}
    </button>
  );
}

// Shared full-screen modal shell (opaque backdrop + radial glow) used by
// every dialog-style overlay — "Game expired," "Spotify account not
// authorized," etc. Callers supply just the card content.
function FullScreenDialog({ ariaLabel, dialogRef, children }: Readonly<{
  ariaLabel: string;
  dialogRef?: React.RefObject<HTMLDialogElement | null>;
  children: React.ReactNode;
}>) {
  return (
    <dialog
      ref={dialogRef}
      open
      aria-modal="true"
      aria-label={ariaLabel}
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{
        width: '100%',
        height: '100%',
        margin: 0,
        border: 'none',
        padding: 0,
        color: 'inherit',
        background: 'rgba(8,8,18,0.92)',
        backdropFilter: 'blur(12px)',
      }}
    >
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: 'radial-gradient(ellipse 60% 40% at 50% 50%, rgba(134,6,189,0.22) 0%, transparent 65%)' }} />
      {children}
    </dialog>
  );
}

// Shared verbatim between the blocked-playlist-card hint and the paste-a-link
// error, so the two surfaces never drift into different wording for the same
// Spotify restriction.
const PLAYLIST_ACCESS_WORKAROUND =
  "You can't import playlists you don't own or collaborate on due to Spotify API restrictions.\n\n"
  + 'To work around this:\n'
  + '1. Open the playlist\n'
  + '2. Tap ⋯\n'
  + '3. "Add to other playlist"\n'
  + '4. "New playlist" to copy it into your own library.\n\n'
  + 'You may need to refresh the page for it to show up here.';

function playlistErrorMessage(error: PlaylistFetchError): string {
  switch (error) {
    case 'unauthorized': return 'Reconnect Spotify to allow playlist access.';
    case 'forbidden': return PLAYLIST_ACCESS_WORKAROUND;
    case 'not_found': return "Couldn't find that playlist. Check the link and try again.";
    case 'empty': return 'That playlist has no playable tracks.';
    default: return "Couldn't load that playlist. Try again.";
  }
}

function ReconnectBanner() {
  return (
    <div style={{ padding: '12px', borderRadius: '10px', background: 'rgba(220,38,38,0.12)', border: '1px solid rgba(248,113,113,0.3)' }}>
      <p style={{ color: '#fca5a5', fontSize: '0.8125rem', marginBottom: '8px' }}>
        Reconnect Spotify to allow playlist access.
      </p>
      <a
        href={`${BACKEND_URL}/api/auth/spotify`}
        style={{ color: 'white', fontWeight: 600, fontSize: '0.8125rem', textDecoration: 'underline' }}
      >
        Reconnect Spotify
      </a>
    </div>
  );
}

// The playlist picker's main panel has four mutually-exclusive states; kept
// as its own component (rather than a nested ternary) so each is a plain,
// independently-readable branch.
function PlaylistsPanel({ playlistsError, loadingPlaylists, playlists, resolving, selectedIds, onChoose }: Readonly<{
  playlistsError: PlaylistFetchError | null;
  loadingPlaylists: boolean;
  playlists: PlaylistSummary[];
  resolving: boolean;
  selectedIds: Set<string>;
  onChoose: (id: string, imageUrl: string | null) => void;
}>) {
  const [openBlockedId, setOpenBlockedId] = useState<string | null>(null);
  if (playlistsError === 'unauthorized') return <ReconnectBanner />;
  if (loadingPlaylists) {
    return <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.8125rem' }}>Loading your playlists…</p>;
  }
  if (playlistsError) {
    return <p style={{ color: '#fca5a5', fontSize: '0.8125rem' }}>{playlistErrorMessage(playlistsError)}</p>;
  }
  return (
    <div className="overflow-y-auto" style={{ maxHeight: '48vh' }}>
      <div className="grid grid-cols-3 gap-2.5">
        {playlists.map(p => {
          const selected = selectedIds.has(p.id);
          const blocked = !p.importable;
          const guideOpen = openBlockedId === p.id;
          return (
            <div key={p.id} className="relative">
              <button
                type="button"
                onClick={() => { if (!blocked) onChoose(p.id, p.imageUrl); }}
                disabled={resolving}
                aria-pressed={selected}
                className="relative flex flex-col w-full rounded-xl text-left"
                style={{
                  padding: '8px',
                  background: selected ? 'rgba(29, 185, 84, 0.12)' : 'rgba(255,255,255,0.04)',
                  border: selected ? '1px solid rgba(29, 185, 84, 0.45)' : '1px solid rgba(255,255,255,0.07)',
                  cursor: resolving || blocked ? 'not-allowed' : 'pointer',
                }}
              >
                {/* Dimmed independently of the guide overlay below, which needs
                    full opacity of its own regardless of the tile's blocked look. */}
                <div className="flex flex-col items-start gap-1.5 w-full" style={{ opacity: blocked ? 0.35 : 1 }}>
                  <div className="relative w-full">
                    {p.imageUrl ? (
                      <img src={p.imageUrl} alt="" className="w-full aspect-square rounded-lg object-cover" />
                    ) : (
                      <div className="w-full aspect-square rounded-lg" style={{ background: 'rgba(255,255,255,0.06)' }} />
                    )}
                    {selected && (
                      <div
                        className="absolute top-1 right-1 flex items-center justify-center rounded-full"
                        style={{ width: '20px', height: '20px', background: '#1DB954' }}
                      >
                        <Check style={{ width: '13px', height: '13px', color: 'white' }} strokeWidth={3} />
                      </div>
                    )}
                  </div>
                  <p className="truncate w-full" style={{ color: 'white', fontWeight: 600, fontSize: '0.75rem' }}>{p.name}</p>
                  <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.6875rem' }}>{p.trackCount} tracks</p>
                </div>
              </button>
              {blocked && (
                <button
                  type="button"
                  aria-label="Why is this playlist blocked?"
                  onClick={() => setOpenBlockedId(guideOpen ? null : p.id)}
                  className="absolute top-1 left-1 flex items-center justify-center rounded-full"
                  style={{ width: '18px', height: '18px', background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.3)', cursor: 'pointer' }}
                >
                  <span style={{ color: 'white', fontSize: '0.6875rem', fontWeight: 700, lineHeight: 1 }}>?</span>
                </button>
              )}
              {blocked && (
                <button
                  type="button"
                  aria-label="Close blocked-playlist guide"
                  onClick={() => setOpenBlockedId(null)}
                  onKeyDown={(e) => { if (e.key === 'Escape') setOpenBlockedId(null); }}
                  tabIndex={guideOpen ? 0 : -1}
                  className="absolute inset-0 overflow-y-auto rounded-xl text-left"
                  style={{
                    padding: '8px',
                    paddingTop: '26px',
                    background: 'rgba(10,10,14,0.95)',
                    opacity: guideOpen ? 1 : 0,
                    pointerEvents: guideOpen ? 'auto' : 'none',
                    transition: 'opacity 200ms ease',
                  }}
                >
                  <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: '0.5625rem', lineHeight: 1.4, whiteSpace: 'pre-line' }}>
                    {PLAYLIST_ACCESS_WORKAROUND}
                  </p>
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Full-screen playlist browser + paste-a-link fallback. Kept out of the
// small settings popover entirely — this is the "heavy" UI (grid, loading/
// error states) that the popover's chip just launches.
function PlaylistPickerDialog({ game }: Readonly<{ game: HostState }>) {
  const { playlistPicker, closePlaylistPicker, customPlaylists, addPlaylist, removePlaylist } = game;
  const { playlists, loadingPlaylists, playlistsError, fetchPlaylists, fetchPlaylistTracks } = playlistPicker;
  const [linkInput, setLinkInput] = useState('');
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [resolvedCount, setResolvedCount] = useState(0);
  const [truncationNotice, setTruncationNotice] = useState<string | null>(null);
  const [loadHovered, setLoadHovered] = useState(false);
  const [doneHovered, setDoneHovered] = useState(false);
  const selectedIds = new Set(customPlaylists.map(p => p.id));

  useEffect(() => { fetchPlaylists(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // LiquidGlass only measures its own size once on mount (and on window
  // resize) — it has no ResizeObserver, so it never notices the card growing
  // as content changes (spinner -> grid, or an error/loading line appearing
  // below it). Re-firing its resize listener (rather than remounting the
  // component) lets it re-measure in place and transition smoothly to the
  // new size — remounting instead snaps it back to its 270x69 default first,
  // which is what caused the visible "rescaling" on every state change.
  const glassContentShape = [
    loadingPlaylists ? 'loading' : 'idle',
    playlistsError ?? 'none',
    playlists.length > 0 ? 'has-playlists' : 'no-playlists',
    resolving ? 'resolving' : 'idle',
    resolveError ? 'resolve-error' : 'ok',
    truncationNotice ? 'truncated' : 'ok',
  ].join('|');
  useEffect(() => {
    globalThis.dispatchEvent(new Event('resize'));
  }, [glassContentShape]);

  const choosePlaylist = async (id: string, fallbackImageUrl: string | null = null) => {
    // Clicking an already-added playlist again toggles it off — no need to
    // refetch tracks just to remove something already in hand.
    if (selectedIds.has(id)) { removePlaylist(id); setTruncationNotice(null); return; }
    setResolving(true);
    setResolveError(null);
    setTruncationNotice(null);
    setResolvedCount(0);
    const result = await fetchPlaylistTracks(id, setResolvedCount);
    setResolving(false);
    if (!result.ok) {
      setResolveError(playlistErrorMessage(result.error));
      return;
    }
    const imageUrl = fallbackImageUrl ?? result.tracks[0]?.albumArtUrl ?? null;
    addPlaylist({ id, name: result.name, imageUrl, tracks: result.tracks });
    setLinkInput('');
    if (result.truncated) {
      setTruncationNotice(`That playlist has more than ${MAX_PLAYLIST_TRACKS.toLocaleString()} tracks — only the first ${MAX_PLAYLIST_TRACKS.toLocaleString()} were imported.`);
    }
  };

  const submitLink = () => {
    const id = resolvePlaylistInput(linkInput);
    if (!id) { setResolveError("That doesn't look like a Spotify playlist link."); return; }
    choosePlaylist(id);
  };

  return (
    <FullScreenDialog ariaLabel="Choose a playlist">
      <div className="liquid-btn relative" style={{ width: 'min(560px, 92vw)' }}>
        <LiquidGlass style={{ position: 'absolute', top: '50%', left: '50%' }} {...LIQUID_CARD_PROPS} elasticity={0.04} padding="28px 24px">
          <div style={{ width: 'min(512px, 84vw)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="flex items-center justify-between">
              <p style={{ color: 'white', fontWeight: 800, fontSize: '1.1rem' }}>Choose a playlist</p>
              <button
                onClick={closePlaylistPicker}
                aria-label="Close"
                style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.45)', cursor: 'pointer', fontSize: '1.25rem', lineHeight: 1 }}
              >
                ×
              </button>
            </div>

            <div className="flex items-center gap-2">
              <input
                value={linkInput}
                onChange={e => setLinkInput(e.target.value)}
                placeholder="Or paste a playlist link"
                style={{ flex: 1, padding: '9px 12px', borderRadius: '10px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'white', fontSize: '0.8125rem' }}
              />
              <button
                onClick={submitLink}
                disabled={resolving || !linkInput.trim()}
                className="transition-all duration-150"
                style={{
                  padding: '9px 14px', borderRadius: '10px',
                  background: (() => {
                    if (resolving || !linkInput.trim()) return 'rgba(178,16,224,0.15)';
                    return loadHovered ? 'rgba(178,16,224,0.55)' : 'rgba(178,16,224,0.4)';
                  })(),
                  border: `1px solid ${(() => {
                    if (resolving || !linkInput.trim()) return 'rgba(208,46,249,0.2)';
                    return loadHovered ? 'rgba(208,46,249,0.8)' : 'rgba(208,46,249,0.5)';
                  })()}`,
                  color: 'white', fontWeight: 600, fontSize: '0.8125rem',
                  cursor: resolving || !linkInput.trim() ? 'not-allowed' : 'pointer',
                  boxShadow: loadHovered && !resolving && linkInput.trim() ? '0 0 16px rgba(178,16,224,0.35)' : 'none',
                  opacity: linkInput.trim() ? 1 : 0.3,
                }}
                onMouseEnter={() => !resolving && linkInput.trim() && setLoadHovered(true)}
                onMouseLeave={() => setLoadHovered(false)}
              >
                {resolving ? <Loader2 className="w-3.5 h-3.5 animate-spin inline mr-1.5" /> : null}
                Load
              </button>
            </div>
            <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.7rem', marginTop: '-8px' }}>
              Works for playlists you own or collaborate on. Spotify blocks API access to others' playlists.
            </p>

            <PlaylistsPanel
              playlistsError={playlistsError}
              loadingPlaylists={loadingPlaylists}
              playlists={playlists}
              resolving={resolving}
              selectedIds={selectedIds}
              onChoose={choosePlaylist}
            />

            {resolveError && <p style={{ color: '#fca5a5', fontSize: '0.75rem', whiteSpace: 'pre-line' }}>{resolveError}</p>}
            {truncationNotice && <p style={{ color: '#fcd34d', fontSize: '0.75rem' }}>{truncationNotice}</p>}
            {resolving && (
              <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.8125rem' }}>
                {resolvedCount > 0 ? `Loading tracks… ${resolvedCount} so far` : 'Loading tracks…'}
              </p>
            )}

            {(() => {
              const pluralS = selectedIds.size === 1 ? '' : 's';
              const trackCount = Math.min(mergeUniqueTracks(customPlaylists).length, MAX_POOL_TRACKS);
              const trackPluralS = trackCount === 1 ? '' : 's';
              const trackSuffix = trackCount > 0 ? ` (${trackCount.toLocaleString()} song${trackPluralS})` : '';
              return (
                <div className="flex items-center justify-between">
                  <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.75rem' }}>
                    {selectedIds.size === 0 ? 'Nothing selected yet' : `${selectedIds.size} playlist${pluralS} selected${trackSuffix}`}
                  </p>
                  <button
                    onClick={closePlaylistPicker}
                    className="transition-all duration-150"
                    style={{
                      padding: '9px 16px', borderRadius: '10px',
                      background: doneHovered ? 'rgba(29, 185, 84, 0.45)' : 'rgba(29, 185, 84, 0.35)',
                      border: `1px solid ${doneHovered ? 'rgba(29, 185, 84, 0.75)' : 'rgba(29, 185, 84, 0.6)'}`,
                      color: 'white', fontWeight: 600, fontSize: '0.8125rem', cursor: 'pointer',
                      boxShadow: doneHovered ? '0 0 16px rgba(29, 185, 84, 0.3)' : 'none',
                    }}
                    onMouseEnter={() => setDoneHovered(true)}
                    onMouseLeave={() => setDoneHovered(false)}
                  >
                    Done
                  </button>
                </div>
              );
            })()}
          </div>
        </LiquidGlass>
      </div>
    </FullScreenDialog>
  );
}

// ─── Phase views ─────────────────────────────────────────────────────────────

function ConnectView({ game }: Readonly<{ game: HostState }>) {
  const { spotify } = game;
  const searchParams = new URLSearchParams(globalThis.location.search);
  const error = searchParams.get('error');

  const errorMessages: Record<string, string> = {
    'access_denied': 'You denied authorization.',
    'user_denied_authorization': 'You denied authorization.',
    'cancelled': 'Authorization was cancelled.',
  };
  const errorMsg = error ? (errorMessages[error] ?? 'Authorization failed.') : null;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-6 p-6">
      <BackButton />
      <img src={`${import.meta.env.BASE_URL}logo.png`} alt={APP_NAME} className="w-auto" style={{ maxHeight: '192px', maxWidth: '100%' }} />
      {spotify.isConnected && !spotify.playerReady ? (
        <p className="text-white/50">Connecting to Spotify...</p>
      ) : (
        <>
          <a
            href={`${BACKEND_URL}/api/auth/spotify`}
            className="px-8 py-4 rounded-2xl bg-[#1DB954] text-white font-bold text-xl hover:bg-[#1ed760] transition-colors"
          >
            Connect Spotify
          </a>
          {errorMsg && (
            <p className="text-red-400 text-sm text-center" aria-live="assertive">{errorMsg} <a href={globalThis.location.pathname} className="underline">Try again</a></p>
          )}
        </>
      )}
      <p className="text-white/45 text-sm">Requires Spotify Premium</p>
      {spotify.unauthorized && (
        <FullScreenDialog ariaLabel="Spotify account not authorized">
          <div className="liquid-btn relative" style={{ width: '320px', height: '260px' }}>
            <LiquidGlass
              style={{ position: 'absolute', top: '50%', left: '50%' }}
              {...LIQUID_CARD_PROPS}
              padding="32px 28px"
            >
              <div style={{ width: '264px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                <ShieldAlert style={{ width: '30px', height: '30px', color: 'rgba(255,255,255,0.45)' }} strokeWidth={1.5} />
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                  <p style={{ color: 'white', fontWeight: 800, fontSize: '1.2rem', letterSpacing: '-0.01em', textAlign: 'center' }}>Account not authorized</p>
                  <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.8rem', textAlign: 'center', lineHeight: 1.5 }}>
                    Versed is in limited testing. Only a few Spotify accounts can host. Ask Joachim to add yours, then try again.
                  </p>
                </div>
                <button
                  onClick={() => spotify.disconnect()}
                  style={{ marginTop: '6px', width: '100%', padding: '10px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.12)', cursor: 'pointer', background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.72)', fontWeight: 600, fontSize: '0.875rem', transition: 'background 0.2s ease, border-color 0.2s ease, color 0.2s ease' }}
                  onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = 'rgba(255,255,255,0.13)'; el.style.borderColor = 'rgba(255,255,255,0.22)'; el.style.color = 'white'; }}
                  onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = 'rgba(255,255,255,0.07)'; el.style.borderColor = 'rgba(255,255,255,0.12)'; el.style.color = 'rgba(255,255,255,0.72)'; }}
                >
                  Try a different account
                </button>
              </div>
            </LiquidGlass>
          </div>
        </FullScreenDialog>
      )}
    </div>
  );
}

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
  const fadeOut = async () => {
    const ctx = ctxRef.current;
    const filter = filterRef.current;
    if (ctx && filter) {
      filter.frequency.cancelScheduledValues(ctx.currentTime);
      filter.frequency.setValueAtTime(filter.frequency.value, ctx.currentTime);
      filter.frequency.exponentialRampToValueAtTime(120, ctx.currentTime + 0.8);
    }
    await rampGain(0, 800);
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

export function LobbyView({ game, fadeOutRef }: Readonly<{ game: HostState; fadeOutRef?: React.RefObject<(() => Promise<void>) | null> }>) {
  const {
    spotify, pin, players, createGame, startGame, mode, settingsOpen, toggleSettings, setMode, removePlayer,
    gameExpired, playlistPickerOpen, songSource, customPlaylists, startError,
  } = game;
  const playlistTrackCount = mergePlaylistTracks(customPlaylists).length;
  const playlistEmpty = songSource === 'playlist' && playlistTrackCount === 0;
  const playlistLow = songSource === 'playlist' && playlistTrackCount > 0 && playlistTrackCount < MIN_PLAYLIST_TRACKS;
  const [lobbyVisible, setLobbyVisible] = useState(false);
  const { fadeOut, muted, toggleMute } = useLobbyMusic(gameExpired);
  const startingRef = useRef(false);

  // Exposes fadeOut to the "Go home" button on the game-expired dialog, which
  // lives outside this component (it overlays every phase, not just lobby).
  useEffect(() => { if (fadeOutRef) fadeOutRef.current = fadeOut; });

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

  return (
    <div className="min-h-screen relative flex flex-col overflow-hidden">
      <BackButton zIndex={10} beforeNavigate={fadeOut} />
      <SettingsButton settingsOpen={settingsOpen} toggleSettings={toggleSettings} />
      <MuteButton muted={muted} toggleMute={toggleMute} />

      <SettingsPanel game={game} open={settingsOpen} />
      {playlistPickerOpen && <PlaylistPickerDialog game={game} />}

      <div
        className="flex flex-col items-center gap-6 p-6 transition-transform duration-500 ease-out"
        style={{ transform: pin ? 'translateY(0)' : 'translateY(30vh)' }}
      >
        <img src={`${import.meta.env.BASE_URL}logo.png`} alt={APP_NAME} className="w-auto" style={{ maxHeight: '192px', maxWidth: '100%' }} />
        <span className="text-white/45 text-sm flex items-center gap-2">
          {spotify.playerReady ? (
            <><span className="w-2 h-2 rounded-full bg-green-500" />Spotify ready</>
          ) : (
            <><Loader2 className="w-3.5 h-3.5 animate-spin" />Spotify loading...</>
          )}
        </span>
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

function BettingView({ game }: Readonly<{ game: HostState }>) {
  const { roundIndex, totalRounds, timeLeft, bettingTime, hints, bidCount, players, pin, skipTurn, endGame, party } = game;
  const imageHint = hints.find(h => h.imageUrl);
  const textHints = hints.filter(h => !h.imageUrl);

  return (
    <div className="relative min-h-screen flex flex-col overflow-hidden">

      {/* Background */}
      <img
        src={`${import.meta.env.BASE_URL}background2.svg`}
        alt=""
        aria-hidden="true"
        style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 0, transform: 'rotate(90deg)' }}
      />
      <div style={{ position: 'fixed', inset: 0, zIndex: 1, background: 'rgba(5,5,14,0.82)', backdropFilter: 'blur(28px)' }} />

      {/* Top bar */}
      <div className="relative flex items-center justify-between px-9 pt-7" style={{ zIndex: 2 }}>
        <span style={{ color: 'rgba(255,255,255,0.45)', fontWeight: 600, fontSize: '1rem' }}>
          Round{' '}
          <span style={{ color: 'rgba(255,255,255,0.72)', fontWeight: 800 }}>{roundIndex + 1}</span>
          <span style={{ color: 'rgba(255,255,255,0.45)' }}>/{totalRounds}</span>
        </span>
        <span style={{ color: 'rgba(255,255,255,0.45)', fontFamily: 'monospace', letterSpacing: '0.12em', fontSize: '0.9rem' }}>
          PIN {pin}
        </span>
      </div>

      {/* Main content */}
      <div className="flex-1 relative flex flex-col items-center justify-center gap-10 px-8 py-4" style={{ zIndex: 2 }}>

        {/* Blurred album art — centered, above timer */}
        {imageHint?.imageUrl && (
          <div style={{ width: 180, height: 180, borderRadius: 28, overflow: 'hidden', flexShrink: 0, boxShadow: '0 16px 40px rgba(0,0,0,0.7)', position: 'relative' }}>
            {/* Inner div extends 30px beyond all edges so blur has real pixels to sample at every boundary */}
            <div style={{ position: 'absolute', inset: -30, filter: 'blur(8px) brightness(0.6)' }}>
              <img
                src={imageHint.imageUrl} alt=""
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            </div>
          </div>
        )}

        <PartyBadge party={party} />

        {/* Circular timer */}
        <CircularTimer timeLeft={timeLeft} total={bettingTime} />

        {/* Text hints */}
        {textHints.length > 0 && (
          <div
            className="flex items-center justify-center w-full max-w-3xl rounded-3xl"
            style={{
              padding: '24px 52px',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              backdropFilter: 'blur(16px)',
            }}
          >
            {textHints.map((h, i) => (
              <React.Fragment key={h.label}>
                {i > 0 && (
                  <div style={{ width: 1, alignSelf: 'stretch', background: 'rgba(255,255,255,0.08)', margin: '0 40px' }} />
                )}
                <div className="flex flex-col items-center gap-2">
                  <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.2em' }}>
                    {h.label}
                  </span>
                  <span style={{ color: 'white', fontWeight: 900, fontSize: '2.75rem', lineHeight: 1, letterSpacing: '-0.02em' }}>
                    {h.value}
                  </span>
                </div>
              </React.Fragment>
            ))}
          </div>
        )}

        {/* Bid status dots */}
        <div className="flex flex-col items-center gap-3">
          <div className="flex gap-2.5 flex-wrap justify-center">
            {players.map((p, i) => (
              <div
                key={p.name}
                className="rounded-full transition-all duration-500"
                style={{
                  width: 12, height: 12,
                  background: i < bidCount ? 'rgba(158,18,204,0.9)' : 'rgba(255,255,255,0.12)',
                  boxShadow: i < bidCount ? '0 0 8px rgba(158,18,204,0.55)' : 'none',
                  transform: i < bidCount ? 'scale(1)' : 'scale(0.78)',
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Skip / end */}
      <div className="relative flex flex-col justify-center items-center gap-2 pb-7" style={{ zIndex: 2 }}>
        <button
          onClick={skipTurn}
          style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.28)', fontSize: '0.75rem', cursor: 'pointer', transition: 'color 0.2s ease' }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.4)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.28)'; }}
        >
          Skip round
        </button>
        <EndGameButton endGame={endGame} />
      </div>
    </div>
  );
}

// Which brand accent a round reads as: year rounds get teal (matching Play.tsx),
// race/non-classic party rounds get orange, classic stays purple.
function roundAccent(isRace: boolean, isYear: boolean): 'classic' | 'race' | 'year' {
  if (isYear) return 'year';
  return isRace ? 'race' : 'classic';
}

// Race-flow rounds are normally hint-free (the clip itself is the puzzle),
// but artist-only and year-only rounds ask for something the audio can't
// give away, so those are the only race rounds that ever carry hints here.
function RaceHintBar({ hints }: Readonly<{ hints: Hint[] }>) {
  const textHints = hints.filter(h => !h.imageUrl);
  if (textHints.length === 0) return null;
  return (
    <div
      className="flex items-center justify-center gap-6 rounded-2xl"
      style={{
        padding: '12px 26px',
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)',
        backdropFilter: 'blur(16px)',
      }}
    >
      {textHints.map((h, i) => (
        <React.Fragment key={h.label}>
          {i > 0 && (
            <div style={{ width: 1, alignSelf: 'stretch', background: 'rgba(255,255,255,0.08)' }} />
          )}
          <div className="flex flex-col items-center gap-1">
            <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.18em' }}>
              {h.label}
            </span>
            <span style={{ color: 'white', fontWeight: 800, fontSize: '1.2rem', lineHeight: 1 }}>
              {h.value}
            </span>
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}

// Multiple Choice's 4 options, shown on the host screen purely as a
// reference (the host never answers) — useful when the host screen is cast
// to a shared TV so the room can see the options too.
function ChoiceOptionsBar({ options }: Readonly<{ options?: string[] }>) {
  if (!options || options.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-2" style={{ maxWidth: '480px' }}>
      {options.map(option => (
        <div
          key={option}
          className="rounded-xl text-center"
          style={{
            padding: '10px 16px',
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            color: 'white', fontWeight: 700, fontSize: '0.95rem',
          }}
        >
          {option}
        </div>
      ))}
    </div>
  );
}

export function PlayingView({ game }: Readonly<{ game: HostState }>) {
  const { roundIndex, totalRounds, countdown, guesserNames, lowestBid, playerBids, timeLeft, timerTotal, mode, yearOnly, hints, answeredCount, players, skipTurn, endGame, party, songPlaying, songTempo } = game;
  // Party rounds that aren't classic-format arrive with an empty bid state and
  // behave exactly like race rounds on this screen. "Guess the year" rides
  // the race flow even in Classic mode — but only outside Party, which picks
  // its own per-round target and ignores this game-wide toggle.
  const isRace = mode === 'race' || (party === null && yearOnly) || (party !== null && party.format !== 'classic');
  const isYear = party ? party.format === 'year' : yearOnly;
  // Finale duelists or (for underdog rounds) the trailing player(s) — the
  // only ones actually guessing this round, if either applies.
  const restrictedNames = party?.finale ? party.duelists : (party?.event === 'underdog' ? party.restricted : null);
  const raceStatus = restrictedNames
    ? `${restrictedNames.join(party?.finale ? ' vs ' : ' & ')} - first correct wins`
    : `${answeredCount} / ${players.length} answered`;
  const accent = roundAccent(isRace, isYear);
  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center p-6 gap-5 text-center overflow-hidden">
      <img src={`${import.meta.env.BASE_URL}background4.svg`} alt="" aria-hidden="true" style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 0 }} />
      <div style={{ position: 'fixed', inset: 0, zIndex: 1, background: 'rgba(5,5,14,0.82)', backdropFilter: 'blur(28px)' }} />
      <div className="flex flex-col items-center gap-5 text-center w-full" style={{ position: 'relative', zIndex: 2 }}>
        <p className="text-white/45 text-sm">Round {roundIndex + 1}/{totalRounds}</p>
        <PartyBadge party={party} />
        <RaceHintBar hints={hints} />
        <ChoiceOptionsBar options={party?.choiceOptions} />

        <div className="liquid-btn relative" style={{ width: 'min(77vw, 527px)', height: countdown === null ? '340px' : '306px' }}>
          <LiquidGlass
            style={{ position: 'absolute', top: '50%', left: '50%' }}
            {...LIQUID_CARD_PROPS}
            padding="28px 28px"
          >
            <div style={{ width: 'min(71vw, 479px)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
              {countdown === null ? (
                <>
                  <AudioBars playing={songPlaying} accent={accent} height={36} bpm={songTempo} />
                  <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.9rem', display: 'inline-block', minWidth: '210px', textAlign: 'center' }}>
                    {isRace ? raceStatus : `${guesserNames.join(' & ')} will guess`}
                  </span>
                  <div style={{ width: '100%', height: '1px', background: 'rgba(255,255,255,0.07)' }} />
                  <CircularTimer timeLeft={timeLeft} total={timerTotal} size={90} />
                  {!isRace && (
                    <div className="w-full">
                      <BidTimeline bids={playerBids} lowestBid={lowestBid} />
                    </div>
                  )}
                </>
              ) : (
                <>
                  <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.6rem', letterSpacing: '0.2em', textTransform: 'uppercase' }}>
                    Get ready
                  </span>
                  <div className="text-8xl font-black text-white" style={{ animation: 'badgeBreathe 1s ease-in-out infinite' }}>{countdown}</div>
                  <div style={{ width: '100%', height: '1px', background: 'rgba(255,255,255,0.07)' }} />
                  {isRace ? (
                    <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.9rem', display: 'inline-block', minWidth: '210px', textAlign: 'center' }}>
                      {restrictedNames ? restrictedNames.join(party?.finale ? ' vs ' : ' & ') : 'Everyone will guess'}
                    </span>
                  ) : (
                    <>
                      <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.9rem', display: 'inline-block', minWidth: '210px', textAlign: 'center' }}>
                        {guesserNames.join(' & ')} will guess
                      </span>
                      <div className="w-full">
                        <BidTimeline bids={playerBids} lowestBid={lowestBid} />
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </LiquidGlass>
        </div>

        <div className="flex flex-col items-center gap-2 mt-2">
          <button onClick={skipTurn} className="text-white/28 text-xs hover:text-white/50 transition-colors">
            Skip round
          </button>
          <EndGameButton endGame={endGame} />
        </div>
      </div>
    </div>
  );
}

function GuessingView({ game }: Readonly<{ game: HostState }>) {
  const { roundIndex, totalRounds, guesserNames, lowestBid, playerBids, timeLeft, timerTotal, mode, yearOnly, hints, party, skipTurn, endGame } = game;
  const isRace = mode === 'race' || (party === null && yearOnly) || (party !== null && party.format !== 'classic');
  const isYear = party ? party.format === 'year' : yearOnly;
  const accent = roundAccent(isRace, isYear);
  // Bidders who placed a bid this round but aren't in the current tier —
  // if everyone bid the same (or there's only one player), there's no one
  // else left waiting on a later turn.
  const othersWaiting = playerBids.length > guesserNames.length;
  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center p-6 gap-5 text-center overflow-hidden">
      <img src={`${import.meta.env.BASE_URL}background4.svg`} alt="" aria-hidden="true" style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 0 }} />
      <div style={{ position: 'fixed', inset: 0, zIndex: 1, background: 'rgba(5,5,14,0.82)', backdropFilter: 'blur(28px)' }} />
      <div className="flex flex-col items-center gap-5 text-center w-full" style={{ position: 'relative', zIndex: 2 }}>
        <p className="text-white/45 text-sm">Round {roundIndex + 1}/{totalRounds}</p>
        <PartyBadge party={party} />
        <RaceHintBar hints={hints} />
        <ChoiceOptionsBar options={party?.choiceOptions} />

        <div className="liquid-btn relative" style={{ width: '310px', height: '420px' }}>
          <LiquidGlass
            style={{ position: 'absolute', top: '50%', left: '50%' }}
            {...LIQUID_CARD_PROPS}
            padding="28px 28px"
          >
            <div style={{ width: '254px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
              {/* Audio is always paused by the time this view mounts (guessing_start pauses it). */}
              <AudioBars playing={false} accent={accent} height={32} />
              <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.6rem', letterSpacing: '0.2em', textTransform: 'uppercase' }}>
                Guessing
              </span>
              <span style={{ color: 'white', fontWeight: 900, fontSize: '1.4rem', lineHeight: 1.3, display: 'inline-block', minWidth: '210px', textAlign: 'center' }}>
                {guesserNames.join(' & ')}
              </span>
              <div style={{ width: '100%', height: '1px', background: 'rgba(255,255,255,0.07)' }} />
              <CircularTimer timeLeft={timeLeft} total={timerTotal} size={90} />
              <div className="w-full">
                <BidTimeline bids={playerBids} lowestBid={lowestBid} />
              </div>
            </div>
          </LiquidGlass>
        </div>

        {othersWaiting && <p className="text-white/45 text-sm">Other players are waiting...</p>}
        <div className="flex flex-col items-center gap-2 mt-2">
          <button onClick={skipTurn} className="text-white/28 text-xs hover:text-white/50 transition-colors">
            Skip turn
          </button>
          <EndGameButton endGame={endGame} />
        </div>
      </div>
    </div>
  );
}

type GuessCorrectness = 'none' | 'correct' | 'exact';

function RevealPlayerRow({
  player, entry, delta, pity, delay, correct, instant, removePlayer,
}: Readonly<{
  player: PlayerInfo;
  entry?: { guess: string | null; timeMs?: number | null; live?: boolean };
  delta: number;
  pity: boolean;
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
  const guessCls = (!skipped && correct !== 'none') ? `${correctCls} text-xs truncate min-w-0` : 'text-white/28 italic text-xs truncate min-w-0';
  if (!entry) {
    return (
      <button onClick={() => removePlayer(player.name)} aria-label={`Remove ${player.name}`} className="relative group w-full text-left py-1">
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
    <button onClick={() => removePlayer(player.name)} aria-label={`Remove ${player.name}`} className="relative group w-full text-left py-1">
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
            +{displayDelta > 0 ? displayDelta.toLocaleString() : ''}{pity && ' (pity)'}
          </p>
        )}
      </div>
      {/* Row 2: guess | total score */}
      <div className="flex justify-between items-center gap-2">
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
  const { roundIndex, totalRounds, players, roundDeltas, roundPity, removePlayer, endGame, stealResult } = game;
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

      <div style={{ position: 'relative', zIndex: 2 }}>
        <PartyRevealExtras result={result} stealResult={stealResult} hints={game.hints} />
      </div>

      <div style={{ position: 'relative', zIndex: 2, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', padding: '8px 12px', width: '310px', maxWidth: '92vw' }} className="divide-y divide-white/[0.07]">
        {players.slice().sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).map((p, i) => (
          <RevealPlayerRow
            key={p.name}
            player={p}
            entry={result.playerGuesses?.find(g => g.name === p.name)}
            delta={roundDeltas[p.name] ?? 0}
            pity={roundPity[p.name] ?? false}
            delay={400 + i * 80}
            correct={isCorrectFor(p)}
            instant={instant}
            removePlayer={removePlayer}
          />
        ))}
      </div>

      <PillButton
        onClick={() => socket.emit('next_round')}
        label={roundIndex + 1 >= totalRounds ? 'Final Results' : 'Next Round'}
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

function LeaderboardRow({ entry, delay, highlight }: Readonly<{ entry: LeaderboardEntry; delay: number; highlight: boolean }>) {
  const { displayScore } = useAnimatedScore(entry.score, 0, delay);
  return (
    <div className={`flex items-center gap-4 px-4 py-3 rounded-xl ${highlight ? 'bg-white/10' : 'bg-white/5'}`}>
      <span className="w-8 flex justify-center">
        <RankBadge rank={entry.rank} />
      </span>
      <span className="text-white font-bold flex-1">{entry.name}</span>
      <p className="text-white/60 font-semibold tabular-nums min-w-[64px] text-right">{displayScore.toLocaleString()}</p>
    </div>
  );
}

function LeaderboardView({ game }: Readonly<{ game: HostState }>) {
  const { phase, leaderboard, awards, roundIndex, totalRounds } = game;
  const isFinished = phase === 'finished';

  return (
    <div className="relative min-h-screen flex flex-col p-6 gap-4">
      {!isFinished && <div style={{ background: '#080812', position: 'fixed', inset: 0, zIndex: 0 }} />}
      {isFinished && (
        <>
          <img
            src={`${import.meta.env.BASE_URL}background6.svg`}
            alt=""
            aria-hidden="true"
            style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 0 }}
          />
          <div
            className="fixed inset-0 pointer-events-none"
            style={{
              background: 'rgba(8,8,18,0.96)',
              backdropFilter: 'blur(48px)',
              zIndex: 1,
            }}
          />
          <div style={{ position: 'fixed', inset: 0, zIndex: 2, pointerEvents: 'none', filter: 'blur(10px)' }}>
            <ConfettiBackground burst persistAfterBurst speedMultiplier={3} />
          </div>
          <div
            className="fixed inset-0 pointer-events-none"
            style={{ background: 'rgba(8,8,18,0.45)', zIndex: 3 }}
          />
        </>
      )}

      <h2 className="text-3xl font-black text-white text-center relative z-10">
        {isFinished ? 'Final Scores' : 'Leaderboard'}
      </h2>

      <div className="flex-1 min-h-0 overflow-y-auto space-y-3 relative z-10">
        {leaderboard.map((e, i) => (
          <LeaderboardRow
            key={e.name}
            entry={e}
            delay={200 + i * 80}
            highlight={e.rank <= 3}
          />
        ))}
      </div>

      {isFinished && <AwardsStrip awards={awards} />}

      {/* Mid-game leaderboard is the resume point after a host page reload,
          so it needs its own way to continue the game. No "End game" here —
          ending it would just swap to this same view's finished state, and
          early-ending is already available from every in-round screen. */}
      {!isFinished && (
        <div className="relative z-10 flex justify-center pb-2">
          <PillButton
            onClick={() => socket.emit('next_round')}
            label={roundIndex + 1 >= totalRounds ? 'Final Results' : 'Next Round'}
          />
        </div>
      )}

      {isFinished && (
        <div className="relative z-10 flex flex-col items-center gap-3">
          <PillButton onClick={game.newGame} label="New Game" />
        </div>
      )}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

// Screen-reader narration of major phase changes — the screen itself swaps
// components wholesale on each transition, which gives sighted players a
// visual cue but nothing a screen reader announces on its own.
function phaseAnnouncement(phase: Phase, result: RoundResultEvent | null): string {
  const common = commonPhaseAnnouncement(phase, result);
  if (common !== null) return common;
  switch (phase) {
    case 'lobby': return 'Lobby ready. Players can join.';
    case 'betting': return 'Betting is open.';
    case 'playing': return 'Song is playing.';
    case 'guessing': return 'Guessing has started.';
    default: return '';
  }
}

export default function Host() {
  const game = useHostGame();
  const navigate = useNavigate();
  const { phase, result, reconnecting, reconnectingCount, gameExpired } = game;
  const gameExpiredRef = useRef<HTMLDialogElement>(null);
  const lobbyFadeOutRef = useRef<(() => Promise<void>) | null>(null);
  // Awaited so the fade actually finishes before navigate() unmounts the
  // lobby (and its AudioContext) out from under it.
  const goHome = async () => { await lobbyFadeOutRef.current?.(); navigate('/'); };
  useEscapeKey(goHome, gameExpired);
  useFocusTrap(gameExpiredRef, gameExpired);

  return (
    <div className="relative">
      <div aria-live="polite" className="sr-only">{phaseAnnouncement(phase, result)}</div>
      <RoundIntro party={game.party} roundKey={game.roundIndex} />
      {phase === 'connect' && <ConnectView game={game} />}
      {phase === 'lobby' && <LobbyView game={game} fadeOutRef={lobbyFadeOutRef} />}
      {phase === 'betting' && <BettingView game={game} />}
      {phase === 'playing' && <PlayingView game={game} />}
      {phase === 'guessing' && <GuessingView game={game} />}
      {phase === 'reveal' && result && <RevealView game={game} result={result} />}
      {(phase === 'leaderboard' || phase === 'finished') && <LeaderboardView game={game} />}

      {reconnecting && !gameExpired && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex flex-col items-center justify-center z-50 gap-3">
          <div className="w-10 h-10 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          <p className="text-white/70 text-sm font-medium">Reconnecting...</p>
          <p className="text-white/45 text-xs">Game is still running</p>
        </div>
      )}
      {gameExpired && (
        <FullScreenDialog ariaLabel="Game expired" dialogRef={gameExpiredRef}>
          <div className="liquid-btn relative" style={{ width: '310px', height: '230px' }}>
            <LiquidGlass
              style={{ position: 'absolute', top: '50%', left: '50%' }}
              {...LIQUID_CARD_PROPS}
              padding="32px 28px"
            >
              <div style={{ width: '254px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                <Clock style={{ width: '30px', height: '30px', color: 'rgba(255,255,255,0.45)' }} strokeWidth={1.5} />
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                  <p style={{ color: 'white', fontWeight: 800, fontSize: '1.2rem', letterSpacing: '-0.01em' }}>Game expired</p>
                  <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.8rem', textAlign: 'center', lineHeight: 1.5 }}>You were away too long and the game was closed.</p>
                </div>
                <button
                  onClick={goHome}
                  style={{ marginTop: '6px', width: '100%', padding: '10px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.12)', cursor: 'pointer', background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.72)', fontWeight: 600, fontSize: '0.875rem', transition: 'background 0.2s ease, border-color 0.2s ease, color 0.2s ease' }}
                  onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = 'rgba(255,255,255,0.13)'; el.style.borderColor = 'rgba(255,255,255,0.22)'; el.style.color = 'white'; }}
                  onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = 'rgba(255,255,255,0.07)'; el.style.borderColor = 'rgba(255,255,255,0.12)'; el.style.color = 'rgba(255,255,255,0.72)'; }}
                >
                  Go home
                </button>
              </div>
            </LiquidGlass>
          </div>
        </FullScreenDialog>
      )}
      {reconnectingCount > 0 && !reconnecting && (
        <div className="fixed bottom-5 right-5 flex items-center gap-2 bg-white/8 backdrop-blur-sm rounded-full px-3 py-1.5 z-40">
          <span className="w-1.5 h-1.5 rounded-full bg-white/50 animate-pulse" />
          <p className="text-white/50 text-xs">
            {reconnectingCount} player{reconnectingCount > 1 ? 's' : ''} reconnecting
          </p>
        </div>
      )}
    </div>
  );
}
