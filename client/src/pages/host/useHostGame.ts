import { useState, useEffect, useRef, useMemo } from 'react';
import { socket } from '../../socket';
import { useSpotify } from '../../hooks/useSpotify';
import { usePlaylistPicker } from '../../hooks/usePlaylistPicker';
import { useSoundEffect } from '../../hooks/useSoundEffect';
import { RACE_TIME } from '../../config';
import type { Award, Hint, LeaderboardEntry, PartyEvent, PartyInfo, PartyRoundType, PlayerInfo, PlaylistTrackInput, RoundResultEvent, SongSource } from '../../types';

export type Phase = 'connect' | 'lobby' | 'betting' | 'playing' | 'guessing' | 'reveal' | 'leaderboard' | 'finished';
export type Mode = 'classic' | 'race' | 'party';
export type Difficulty = 'easy' | 'medium' | 'hard';
interface SongInfo { title: string; artist: string; trackId: string; tempo?: number | null }
export interface CustomPlaylist { id: string; name: string; imageUrl: string | null; tracks: PlaylistTrackInput[] }

// Combined-pool cap across all selected playlists — mirrors
// usePlaylistPicker's MAX_PLAYLIST_TRACKS (the per-playlist import cap) so
// stacking several large playlists can't quietly build a pool bigger than a
// single playlist import would ever have been allowed to be on its own.
export const MAX_POOL_TRACKS = 5000;

// Dedupes by Spotify track ID across all selected playlists — first
// occurrence wins, so a song present in two playlists is only counted once.
// Uncapped: used to detect (and message) when the combined pool exceeds
// MAX_POOL_TRACKS, separately from the capped tracks actually sent to the
// server (mergePlaylistTracks below).
export function mergeUniqueTracks(playlists: CustomPlaylist[]): PlaylistTrackInput[] {
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
export function mergePlaylistTracks(playlists: CustomPlaylist[]): PlaylistTrackInput[] {
  return mergeUniqueTracks(playlists).slice(0, MAX_POOL_TRACKS);
}

export const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export type Spotify = ReturnType<typeof useSpotify>;
type PlaylistPicker = ReturnType<typeof usePlaylistPicker>;

// Remembers the host's last-used lobby settings across page reloads and new
// games (New Game already leaves these untouched within a session — this
// just survives a full reload/revisit too). Never blocks game creation on a
// bad/missing value, so a corrupt or stale entry just falls back to defaults.
interface SavedHostSettings {
  bettingTime: number; guessingTime: number; rounds: number; mode: Mode;
  raceTime: number; raceWinnerOnly: boolean; artistOnly: boolean; yearOnly: boolean; multipleChoice: boolean; difficulty: Difficulty;
  enabledEvents: PartyEvent[]; chaosLevel: number; finaleEnabled: boolean;
  // Snapshot of ALL_PARTY_EVENTS as of the last save — lets a future load
  // tell "event didn't exist yet when this was saved" (auto-enable) apart
  // from "the host explicitly turned this off" (stay off). Without this, a
  // newly-added event silently never reaches a returning host, because
  // `enabledEvents` alone can't distinguish the two cases.
  knownPartyEvents: PartyEvent[];
  enabledRoundTypes: PartyRoundType[];
  // Same "newly-added vs. explicitly-disabled" backfill as knownPartyEvents,
  // tracked independently since round types and events are separate pools.
  knownPartyRoundTypes: PartyRoundType[];
}
const HOST_SETTINGS_KEY = 'versed_host_settings';
const MODES: Set<Mode> = new Set(['classic', 'race', 'party']);
const DIFFICULTIES: Set<Difficulty> = new Set(['easy', 'medium', 'hard']);
export const ALL_PARTY_EVENTS: PartyEvent[] = ['double', 'mystery', 'steal', 'snippet', 'fullhints', 'blind', 'outro', 'underdog', 'chaoshints'];
const PARTY_EVENT_SET: Set<string> = new Set(ALL_PARTY_EVENTS);
export const ALL_PARTY_ROUND_TYPES: PartyRoundType[] = ['classic', 'race', 'choice', 'artist', 'both', 'year', 'winnerOnly'];
const PARTY_ROUND_TYPE_SET: Set<string> = new Set(ALL_PARTY_ROUND_TYPES);
const LEGACY_CHAOS_LEVELS: Record<string, number> = { chill: 0, balanced: 50, chaotic: 100 };

function clampFiniteNumber(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(min, Math.min(max, value));
}

function sanitizeHostSettings(settings: Partial<SavedHostSettings>): Partial<SavedHostSettings> {
  return {
    bettingTime: clampFiniteNumber(settings.bettingTime, 5, 999),
    guessingTime: clampFiniteNumber(settings.guessingTime, 5, 999),
    rounds: clampFiniteNumber(settings.rounds, 1, 999),
    mode: MODES.has(settings.mode as Mode) ? settings.mode : undefined,
    raceTime: clampFiniteNumber(settings.raceTime, 10, 999),
    raceWinnerOnly: typeof settings.raceWinnerOnly === 'boolean' ? settings.raceWinnerOnly : undefined,
    artistOnly: typeof settings.artistOnly === 'boolean' ? settings.artistOnly : undefined,
    yearOnly: typeof settings.yearOnly === 'boolean' ? settings.yearOnly : undefined,
    multipleChoice: typeof settings.multipleChoice === 'boolean' ? settings.multipleChoice : undefined,
    difficulty: DIFFICULTIES.has(settings.difficulty as Difficulty) ? settings.difficulty : undefined,
    enabledEvents: Array.isArray(settings.enabledEvents)
      ? settings.enabledEvents.filter((e: unknown): e is PartyEvent => PARTY_EVENT_SET.has(e as string))
      : undefined,
    chaosLevel: clampFiniteNumber(settings.chaosLevel, 0, 100),
    finaleEnabled: typeof settings.finaleEnabled === 'boolean' ? settings.finaleEnabled : undefined,
    knownPartyEvents: Array.isArray(settings.knownPartyEvents)
      ? settings.knownPartyEvents.filter((e: unknown): e is PartyEvent => PARTY_EVENT_SET.has(e as string))
      : undefined,
    enabledRoundTypes: Array.isArray(settings.enabledRoundTypes)
      ? settings.enabledRoundTypes.filter((t: unknown): t is PartyRoundType => PARTY_ROUND_TYPE_SET.has(t as string))
      : undefined,
    knownPartyRoundTypes: Array.isArray(settings.knownPartyRoundTypes)
      ? settings.knownPartyRoundTypes.filter((t: unknown): t is PartyRoundType => PARTY_ROUND_TYPE_SET.has(t as string))
      : undefined,
  };
}

function loadSavedHostSettings(): Partial<SavedHostSettings> {
  try {
    const raw = JSON.parse(localStorage.getItem(HOST_SETTINGS_KEY) ?? '{}');
    const settings = sanitizeHostSettings({
      ...raw,
      chaosLevel: typeof raw.chaosLevel === 'string' ? LEGACY_CHAOS_LEVELS[raw.chaosLevel] : raw.chaosLevel,
    });
    // Legacy saves do not have enough history to tell whether an absent event
    // (or round type) was new or explicitly disabled, so preserve the saved
    // enabled set as-is when there's no "known" snapshot to diff against.
    // enabledEvents/knownPartyEvents and enabledRoundTypes/knownPartyRoundTypes
    // backfill independently — one pool's history doesn't gate the other's.
    if (settings.enabledEvents !== undefined && settings.knownPartyEvents !== undefined) {
      const known = new Set(settings.knownPartyEvents);
      const enabledEvents = settings.enabledEvents;
      const newlyAdded = ALL_PARTY_EVENTS.filter(e => !known.has(e) && !enabledEvents.includes(e));
      if (newlyAdded.length > 0) settings.enabledEvents = [...settings.enabledEvents, ...newlyAdded];
    }
    if (settings.enabledRoundTypes !== undefined && settings.knownPartyRoundTypes !== undefined) {
      const known = new Set(settings.knownPartyRoundTypes);
      const enabledRoundTypes = settings.enabledRoundTypes;
      const newlyAdded = ALL_PARTY_ROUND_TYPES.filter(t => !known.has(t) && !enabledRoundTypes.includes(t));
      if (newlyAdded.length > 0) settings.enabledRoundTypes = [...settings.enabledRoundTypes, ...newlyAdded];
    }
    return settings;
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
  roundPityAmount: Record<string, number>;
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
  multipleChoice: boolean;
  difficulty: Difficulty;
  enabledEvents: PartyEvent[];
  enabledRoundTypes: PartyRoundType[];
  chaosLevel: number;
  finaleEnabled: boolean;
  songSource: SongSource;
  customPlaylists: CustomPlaylist[];
  playlistPicker: PlaylistPicker;
  playlistPickerOpen: boolean;
  startError: string | null;
  party: PartyInfo | null;
  // The current round's actually-resolved target/options, from host_round_start
  // — distinct from the artistOnly/yearOnly/multipleChoice settings-panel
  // drafts above, which only reflect what the host currently has selected for
  // the *next* game, not what this round already rolled (they can differ once
  // a round's target is randomized rather than static for the whole game).
  roundArtistOnly: boolean;
  roundYearOnly: boolean;
  roundChoiceOptions: string[];
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
  setMultipleChoice: (v: boolean) => void;
  setDifficulty: (v: Difficulty) => void;
  toggleEvent: (e: PartyEvent) => void;
  setEnabledEvents: (events: PartyEvent[]) => void;
  toggleRoundType: (t: PartyRoundType) => void;
  setEnabledRoundTypes: (types: PartyRoundType[]) => void;
  setChaosLevel: (v: number) => void;
  setFinaleEnabled: (v: boolean) => void;
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

export function useHostGame(): HostState {
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
  const [roundPityAmount, setRoundPityAmount] = useState<Record<string, number>>({});
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
  const [multipleChoice, setMultipleChoice] = useState(savedSettings.multipleChoice ?? false);
  const [difficulty, setDifficulty] = useState<Difficulty>(savedSettings.difficulty ?? 'hard');
  const [enabledEvents, setEnabledEvents] = useState<PartyEvent[]>(savedSettings.enabledEvents ?? ALL_PARTY_EVENTS);
  const [enabledRoundTypes, setEnabledRoundTypes] = useState<PartyRoundType[]>(savedSettings.enabledRoundTypes ?? ALL_PARTY_ROUND_TYPES);
  const [chaosLevel, setChaosLevel] = useState<number>(savedSettings.chaosLevel ?? 50);
  const [finaleEnabled, setFinaleEnabled] = useState(savedSettings.finaleEnabled ?? false);
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
      raceTime: raceTimeSetting, raceWinnerOnly, artistOnly, yearOnly, multipleChoice, difficulty,
      enabledEvents, chaosLevel, finaleEnabled,
      // Snapshot of every event/round type this build knows about, so a
      // future load can tell newly-added ones (auto-enable) apart from ones
      // the host deliberately turned off (stay off) — see loadSavedHostSettings.
      knownPartyEvents: ALL_PARTY_EVENTS,
      enabledRoundTypes,
      knownPartyRoundTypes: ALL_PARTY_ROUND_TYPES,
    };
    localStorage.setItem(HOST_SETTINGS_KEY, JSON.stringify(sanitizeHostSettings(toSave)));
  }, [bettingTimeSetting, guessingTimeSetting, roundsSetting, mode, raceTimeSetting, raceWinnerOnly, artistOnly, yearOnly, multipleChoice, difficulty, enabledEvents, enabledRoundTypes, chaosLevel, finaleEnabled]);

  const toggleEvent = (e: PartyEvent) => {
    setEnabledEvents(prev => (prev.includes(e) ? prev.filter(x => x !== e) : [...prev, e]));
  };
  const toggleRoundType = (t: PartyRoundType) => {
    setEnabledRoundTypes(prev => (prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]));
  };
  const [party, setParty] = useState<PartyInfo | null>(null);
  const [roundArtistOnly, setRoundArtistOnly] = useState(false);
  const [roundYearOnly, setRoundYearOnly] = useState(false);
  const [roundChoiceOptions, setRoundChoiceOptions] = useState<string[]>([]);
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
      party?: PartyInfo; artistOnly?: boolean; yearOnly?: boolean; choiceOptions?: string[];
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
      // Round-scoped, not the settings-panel draft — reset every round so a
      // fallen-back-to-free-text round doesn't keep a stale previous round's
      // choice buttons (see roundArtistOnly/roundYearOnly/roundChoiceOptions).
      setRoundArtistOnly(data.artistOnly === true);
      setRoundYearOnly(data.yearOnly === true);
      setRoundChoiceOptions(data.choiceOptions ?? []);
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
      const pityAmount: Record<string, number> = {};
      for (const updated of p) {
        const prev = playersRef.current.find(x => x.name === updated.name);
        deltas[updated.name] = (updated.score ?? 0) - (prev?.score ?? 0);
        pity[updated.name] = updated.pity ?? false;
        pityAmount[updated.name] = updated.pityAmount ?? 0;
      }
      playersRef.current = p;
      setRoundDeltas(deltas);
      setRoundPity(pity);
      setRoundPityAmount(pityAmount);
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
        totalRounds: roundsSetting, mode, raceTime: raceTimeSetting, raceWinnerOnly, artistOnly, yearOnly, multipleChoice,
        difficulty, songSource, enabledEvents, enabledRoundTypes, chaosLevel, finaleEnabled,
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
    result, roundDeltas, roundPity, roundPityAmount, leaderboard, awards, copied, playProgress, inviteUrl,
    settingsOpen, bettingTimeSetting, guessingTimeSetting, roundsSetting,
    mode, raceTimeSetting, raceWinnerOnly, artistOnly, yearOnly, multipleChoice, difficulty,
    enabledEvents, enabledRoundTypes, chaosLevel, finaleEnabled,
    songSource, customPlaylists, playlistPicker, playlistPickerOpen, startError,
    party, roundArtistOnly, roundYearOnly, roundChoiceOptions, stealResult, answeredCount,
    reconnecting, reconnectingCount: reconnectingNames.size, gameExpired, songPlaying, songTempo,
    toggleSettings: () => setSettingsOpen(o => !o),
    setBettingTimeSetting, setGuessingTimeSetting, setRoundsSetting,
    setMode, setRaceTimeSetting, setRaceWinnerOnly, setArtistOnly, setYearOnly, setMultipleChoice, setDifficulty,
    toggleEvent, setEnabledEvents, toggleRoundType, setEnabledRoundTypes, setChaosLevel, setFinaleEnabled,
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
