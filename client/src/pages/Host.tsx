import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Music, Check, Loader2, Copy, ArrowLeft, Settings, Flame, X } from 'lucide-react';
import QRCode from 'react-qr-code';
import { socket } from '../socket';
import { useSpotify } from '../hooks/useSpotify';
import { RankBadge } from '../components/RankBadge';
import { RevealStatusHeader, RevealSongCard } from '../components/RevealShared';
import { APP_NAME, BACKEND_URL, RACE_TIME } from '../config';
import type { Hint, LeaderboardEntry, PlayerInfo, RoundResultEvent } from '../types';

type Phase = 'connect' | 'lobby' | 'betting' | 'playing' | 'guessing' | 'reveal' | 'leaderboard' | 'finished';
interface SongInfo { title: string; artist: string; trackId: string }

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

type Spotify = ReturnType<typeof useSpotify>;

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
  bidCount: number;
  countdown: number | null;
  guesserNames: string[];
  lowestBid: number;
  playerBids: { name: string; bid: number }[];
  result: RoundResultEvent | null;
  roundDeltas: Record<string, number>;
  leaderboard: LeaderboardEntry[];
  copied: boolean;
  playProgress: number;
  inviteUrl: string;
  settingsOpen: boolean;
  bettingTimeSetting: number;
  guessingTimeSetting: number;
  roundsSetting: number;
  mode: 'classic' | 'race';
  raceTimeSetting: number;
  raceWinnerOnly: boolean;
  artistOnly: boolean;
  answeredCount: number;
  reconnecting: boolean;
  reconnectingCount: number;
  gameExpired: boolean;
  toggleSettings: () => void;
  setBettingTimeSetting: (v: number) => void;
  setGuessingTimeSetting: (v: number) => void;
  setRoundsSetting: (v: number) => void;
  setMode: (m: 'classic' | 'race') => void;
  setRaceTimeSetting: (v: number) => void;
  setRaceWinnerOnly: (v: boolean) => void;
  setArtistOnly: (v: boolean) => void;
  createGame: () => void;
  startGame: () => void;
  skipTurn: () => void;
  copyInvite: () => void;
  newGame: () => void;
  removePlayer: (name: string) => void;
}

function useHostGame(): HostState {
  const spotify = useSpotify();
  const [phase, setPhase] = useState<Phase>('connect');
  const [pin, setPin] = useState('');
  const pinRef = useRef('');
  const [players, setPlayers] = useState<PlayerInfo[]>([]);
  const playersRef = useRef<PlayerInfo[]>([]);
  const [roundIndex, setRoundIndex] = useState(0);
  const [totalRounds, setTotalRounds] = useState(10);
  const [hints, setHints] = useState<Hint[]>([]);
  const [bettingTime, setBettingTime] = useState(15);
  const [timeLeft, setTimeLeft] = useState(0);
  const [bidCount, setBidCount] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [guesserNames, setGuesserNames] = useState<string[]>([]);
  const [lowestBid, setLowestBid] = useState(0);
  const [playerBids, setPlayerBids] = useState<{ name: string; bid: number }[]>([]);
  const [result, setResult] = useState<RoundResultEvent | null>(null);
  const [roundDeltas, setRoundDeltas] = useState<Record<string, number>>({});
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [copied, setCopied] = useState(false);
  const [playProgress, setPlayProgress] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bettingTimeSetting, setBettingTimeSetting] = useState(15);
  const [guessingTimeSetting, setGuessingTimeSetting] = useState(15);
  const [roundsSetting, setRoundsSetting] = useState(10);
  const [mode, setMode] = useState<'classic' | 'race'>('classic');
  const [raceTimeSetting, setRaceTimeSetting] = useState(RACE_TIME);
  const [raceWinnerOnly, setRaceWinnerOnly] = useState(false);
  const [artistOnly, setArtistOnly] = useState(false);
  const [answeredCount, setAnsweredCount] = useState(0);
  const [reconnecting, setReconnecting] = useState(false);
  const [reconnectingNames, setReconnectingNames] = useState<Set<string>>(new Set());
  const [gameExpired, setGameExpired] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playRafRef = useRef<number | null>(null);

  useEffect(() => {
    if (spotify.isConnected && phase === 'connect') setPhase('lobby');
  }, [spotify.isConnected, phase]);

  function startCountdown(seconds: number) {
    stopCountdown();
    setTimeLeft(Math.ceil(seconds));
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
        socket.emit('rejoin_host', { pin: pinRef.current }, (res: { players: PlayerInfo[] } | { error: string }) => {
          if ('error' in res) {
            setGameExpired(true);
          } else if (res.players) setPlayers(res.players);
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
    }) => {
      setRoundIndex(data.roundIndex);
      setTotalRounds(data.total);
      setHints(data.hints);
      setBidCount(0);
      setGuesserNames([]);
      setPlayerBids([]);
      setResult(null);
      setAnsweredCount(0);
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
      setPhase('playing');
    });

    socket.on('play_song', async (data: { trackId: string; durationMs: number; countdownMs?: number }) => {
      // Start buffering immediately, then run the countdown while it loads so
      // the reveal is instant and the X-second timer matches the audible start.
      stopPlaybackBar(); // keep the bar empty through the countdown/buffer
      const prepared = spotify.prepareTrack(data.trackId);
      const ticks = Math.ceil((data.countdownMs ?? 3000) / 1000);
      for (let n = ticks; n > 0; n--) {
        setCountdown(n);
        await wait(1000);
      }
      setCountdown(null);
      await prepared;
      // Resolves at the real audible start; sync the timer and server to it.
      // Returns false if a round_result/guessing_start arrived and cancelled
      // playback mid-countdown — in that case skip song_started so the server
      // doesn't start a guessing timer for a round that's already over.
      const started = await spotify.startPrepared(data.durationMs);
      if (!started) return;
      socket.emit('song_started');
      startCountdown(data.durationMs / 1000);
      startPlaybackBar(data.durationMs);
    });

    socket.on('guessing_start', (data: { guesserNames: string[]; timeLimit: number }) => {
      spotify.pauseTrack();
      stopCountdown();
      stopPlaybackBar();
      setGuesserNames(data.guesserNames);
      startCountdown(data.timeLimit);
      setPhase('guessing');
    });

    socket.on('round_result', (data: RoundResultEvent) => {
      stopCountdown();
      stopPlaybackBar();
      spotify.pauseTrack();
      setResult(data);
      setPhase('reveal');
    });

    socket.on('score_update', ({ players: p }: { players: PlayerInfo[] }) => {
      const deltas: Record<string, number> = {};
      for (const updated of p) {
        const prev = playersRef.current.find(x => x.name === updated.name);
        deltas[updated.name] = (updated.score ?? 0) - (prev?.score ?? 0);
      }
      playersRef.current = p;
      setRoundDeltas(deltas);
      setPlayers(p);
    });

    socket.on('leaderboard', ({ leaderboard: lb }: { leaderboard: LeaderboardEntry[] }) => {
      setLeaderboard(lb);
      setPhase('leaderboard');
    });

    socket.on('game_over', ({ leaderboard: lb }: { leaderboard: LeaderboardEntry[] }) => {
      setLeaderboard(lb);
      setPhase('finished');
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
      socket.off('answer_received');
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
    });
  };

  const startGame = () => {
    spotify.activatePlayer();
    socket.emit('start_game', {
      settings: {
        bettingTime: bettingTimeSetting, guessingTime: guessingTimeSetting,
        totalRounds: roundsSetting, mode, raceTime: raceTimeSetting, raceWinnerOnly, artistOnly,
      },
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
      stopCountdown();
      stopPlaybackBar();
      setPhase('lobby');
    });
  };

  return {
    spotify, phase, pin, players, roundIndex, totalRounds, hints,
    bettingTime, timeLeft, bidCount, countdown, guesserNames, lowestBid, playerBids,
    result, roundDeltas, leaderboard, copied, playProgress, inviteUrl,
    settingsOpen, bettingTimeSetting, guessingTimeSetting, roundsSetting,
    mode, raceTimeSetting, raceWinnerOnly, artistOnly, answeredCount,
    reconnecting, reconnectingCount: reconnectingNames.size, gameExpired,
    toggleSettings: () => setSettingsOpen(o => !o),
    setBettingTimeSetting, setGuessingTimeSetting, setRoundsSetting,
    setMode, setRaceTimeSetting, setRaceWinnerOnly, setArtistOnly,
    createGame, startGame, copyInvite, newGame,
    skipTurn: () => socket.emit('host_skip_turn'),
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
            className={`absolute text-xs -translate-x-1/2 ${group.bid === lowestBid ? 'text-purple-400' : 'text-white/30'}`}
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

function SettingsPanel({ game }: Readonly<{ game: HostState }>) {
  const {
    mode, bettingTimeSetting, guessingTimeSetting, roundsSetting, raceTimeSetting, raceWinnerOnly, artistOnly,
    setBettingTimeSetting, setGuessingTimeSetting, setRoundsSetting, setRaceTimeSetting, setRaceWinnerOnly, setArtistOnly,
  } = game;
  return (
    <div className="absolute top-16 right-5 z-20 bg-[#1a1a2e] border border-white/10 rounded-2xl p-4 space-y-4 w-64 shadow-xl">
      {mode === 'classic' ? (
        <>
          <SettingRow label="Bet time" value={bettingTimeSetting} unit="s"
            onDec={() => setBettingTimeSetting(Math.max(5, bettingTimeSetting - 5))}
            onInc={() => setBettingTimeSetting(Math.min(60, bettingTimeSetting + 5))} />
          <SettingRow label="Guess time" value={guessingTimeSetting} unit="s"
            onDec={() => setGuessingTimeSetting(Math.max(5, guessingTimeSetting - 5))}
            onInc={() => setGuessingTimeSetting(Math.min(60, guessingTimeSetting + 5))} />
        </>
      ) : (
        <SettingRow label="Round time" value={raceTimeSetting} unit="s"
          onDec={() => setRaceTimeSetting(Math.max(10, raceTimeSetting - 5))}
          onInc={() => setRaceTimeSetting(Math.min(60, raceTimeSetting + 5))} />
      )}
      <SettingRow label="Rounds" value={roundsSetting} unit=""
        onDec={() => setRoundsSetting(Math.max(1, roundsSetting - 1))}
        onInc={() => setRoundsSetting(Math.min(30, roundsSetting + 1))} />
      {mode === 'race' && (
        <div className="flex items-center justify-between">
          <span className="text-white/60 text-sm">Winner only</span>
          <button
            onClick={() => setRaceWinnerOnly(!raceWinnerOnly)}
            className={`w-11 h-6 rounded-full transition-colors relative overflow-hidden ${raceWinnerOnly ? 'bg-purple-600' : 'bg-white/20'}`}
          >
            <span className={`absolute top-1 left-0 w-4 h-4 rounded-full bg-white transition-transform ${raceWinnerOnly ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>
      )}
      <div className="flex items-center justify-between">
        <span className="text-white/60 text-sm">Artist only</span>
        <button
          onClick={() => setArtistOnly(!artistOnly)}
          className={`w-11 h-6 rounded-full transition-colors relative overflow-hidden ${artistOnly ? 'bg-purple-600' : 'bg-white/20'}`}
        >
          <span className={`absolute top-1 left-0 w-4 h-4 rounded-full bg-white transition-transform ${artistOnly ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
      </div>
    </div>
  );
}

function JoinCard({ pin, copied, copyInvite }: Readonly<{ pin: string; copied: boolean; copyInvite: () => void }>) {
  return (
    <div className="w-full max-w-md bg-white/5 rounded-2xl p-5">
      <div className="flex items-center gap-5">
        <div className="flex-1 min-w-0 flex flex-col gap-3">
          <div>
            <p className="text-white/40 text-xs uppercase tracking-widest mb-0.5">Join at</p>
            <p className="text-white font-semibold text-base">
              {`${globalThis.location.origin}${import.meta.env.BASE_URL}`.replace(/\/$/, '')}
            </p>
          </div>
          <div>
            <p className="text-white/40 text-xs uppercase tracking-widest mb-0.5">PIN</p>
            <p className="text-6xl font-black text-white tracking-widest leading-none select-text">{pin}</p>
          </div>
          <button
            onClick={copyInvite}
            className="flex items-center gap-2 text-white/40 text-xs hover:text-white/70 transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copied!' : 'Copy invite link'}
          </button>
        </div>
        <div className="p-2 bg-white rounded-xl shrink-0">
          <QRCode value={`${globalThis.location.origin}${import.meta.env.BASE_URL}play/${pin}`} size={148} />
        </div>
      </div>
    </div>
  );
}

// ─── Settings row ─────────────────────────────────────────────────────────────

function SettingRow({ label, value, unit, onDec, onInc }: Readonly<{
  label: string; value: number; unit: string; onDec: () => void; onInc: () => void;
}>) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-white/60 text-sm">{label}</span>
      <div className="flex items-center gap-3">
        <button onClick={onDec} className="w-8 h-8 rounded-full bg-white/10 text-white text-lg flex items-center justify-center hover:bg-white/20 active:scale-95 transition-all">−</button>
        <span className="text-white font-bold w-12 text-center">{value}{unit}</span>
        <button onClick={onInc} className="w-8 h-8 rounded-full bg-white/10 text-white text-lg flex items-center justify-center hover:bg-white/20 active:scale-95 transition-all">+</button>
      </div>
    </div>
  );
}

// ─── Phase views ─────────────────────────────────────────────────────────────

function ConnectView({ game }: Readonly<{ game: HostState }>) {
  const { spotify } = game;
  const navigate = useNavigate();
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-6 p-6">
      <button onClick={() => navigate('/')} className="absolute top-5 left-5 p-2 rounded-xl bg-white/10 text-white/60 hover:bg-white/20 hover:text-white transition-colors">
        <ArrowLeft className="w-5 h-5" />
      </button>
      <img src={`${import.meta.env.BASE_URL}logo.svg`} alt={APP_NAME} className="h-16 w-auto" />
      {spotify.isConnected && !spotify.playerReady ? (
        <p className="text-white/50">Connecting to Spotify...</p>
      ) : (
        <a
          href={`${BACKEND_URL}/api/auth/spotify`}
          className="px-8 py-4 rounded-2xl bg-[#1DB954] text-white font-bold text-xl hover:bg-[#1ed760] transition-colors"
        >
          Connect Spotify
        </a>
      )}
      <p className="text-white/30 text-sm">Requires Spotify Premium</p>
    </div>
  );
}

function LobbyView({ game }: Readonly<{ game: HostState }>) {
  const { spotify, pin, players, createGame, startGame, mode, settingsOpen, toggleSettings, setMode, removePlayer } = game;
  const navigate = useNavigate();
  const [lobbyVisible, setLobbyVisible] = useState(false);

  useEffect(() => {
    if (!pin) { setLobbyVisible(false); return; }
    const t = setTimeout(() => setLobbyVisible(true), 10);
    return () => clearTimeout(t);
  }, [pin]);

  useEffect(() => {
    if (spotify.playerReady && !pin) createGame();
  }, [spotify.playerReady, pin]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-h-screen relative flex flex-col overflow-hidden">
      <button onClick={() => navigate('/')} className="absolute top-5 left-5 p-2 rounded-xl bg-white/10 text-white/60 hover:bg-white/20 hover:text-white transition-colors z-10">
        <ArrowLeft className="w-5 h-5" />
      </button>
      <button onClick={toggleSettings} className="absolute top-5 right-5 p-2 rounded-xl bg-white/10 text-white/60 hover:bg-white/20 hover:text-white transition-colors z-10">
        <Settings className="w-5 h-5" />
      </button>

      {settingsOpen && <SettingsPanel game={game} />}

      <div
        className="flex flex-col items-center gap-6 p-6 transition-transform duration-500 ease-out"
        style={{ transform: pin ? 'translateY(0)' : 'translateY(30vh)' }}
      >
        <img src={`${import.meta.env.BASE_URL}logo.svg`} alt={APP_NAME} className="h-16 w-auto" />
        <span className="text-white/40 text-sm flex items-center gap-2">
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

          <div className="w-full max-w-md flex rounded-xl bg-white/5 p-1 gap-1">
            <button
              onClick={() => setMode('classic')}
              className={`flex-1 py-2 rounded-lg text-sm font-bold transition-colors ${mode === 'classic' ? 'bg-purple-600 text-white' : 'text-white/40 hover:text-white/70'}`}
            >
              Classic
            </button>
            <button
              onClick={() => setMode('race')}
              className={`flex-1 py-2 rounded-lg text-sm font-bold transition-colors ${mode === 'race' ? 'bg-purple-600 text-white' : 'text-white/40 hover:text-white/70'}`}
            >
              Race
            </button>
          </div>

          <div className="w-full max-w-md">
            <p className="text-white/40 text-sm mb-2">{players.length} player{players.length === 1 ? '' : 's'}</p>
            <div className="flex flex-wrap gap-2">
              {players.map(p => (
                <button
                  key={p.name}
                  onClick={() => removePlayer(p.name)}
                  className="relative group px-3 py-1.5 rounded-full bg-white/10 text-white text-sm font-semibold"
                  aria-label={`Remove ${p.name}`}
                >
                  {p.name}
                  <span className="absolute inset-0 rounded-full backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={startGame}
            disabled={players.length === 0}
            className="mt-auto w-full max-w-md py-4 rounded-2xl bg-purple-600 text-white font-bold text-xl disabled:opacity-30 hover:bg-purple-500 transition-colors"
          >
            {mode === 'race' ? 'Start Race Game' : 'Start Classic Game'}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function HintCards({ hints }: Readonly<{ hints: readonly Hint[] }>) {
  const imageHint = hints.find(h => h.imageUrl);
  const textHints = hints.filter(h => !h.imageUrl);
  return (
    <div className="flex flex-col items-center gap-8 w-full">
      {imageHint?.imageUrl && (
        <img
          src={imageHint.imageUrl}
          alt="Album art"
          className="w-52 h-52 rounded-3xl object-cover shadow-2xl blur-sm"
        />
      )}
      {textHints.length > 0 && (
        <div className="flex flex-wrap justify-center gap-10">
          {textHints.map(h => (
            <div key={h.label} className="flex flex-col items-center gap-1">
              <span className="text-white/30 text-xs uppercase tracking-[0.2em]">{h.label}</span>
              <span className="text-white font-black text-4xl">{h.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BettingView({ game }: Readonly<{ game: HostState }>) {
  const { roundIndex, totalRounds, timeLeft, bettingTime, hints, bidCount, players, pin } = game;
  return (
    <div className="min-h-screen flex flex-col p-6 gap-5">
      <div className="flex justify-between items-center">
        <p className="text-white/50 font-semibold">Round {roundIndex + 1}/{totalRounds}</p>
        <p className="text-white font-black text-2xl">{timeLeft}s</p>
        <p className="text-white/50 font-semibold">PIN: {pin}</p>
      </div>
      <div className="w-full bg-white/10 rounded-full h-1.5">
        <div className="bg-purple-500 h-1.5 rounded-full transition-all duration-1000"
          style={{ width: `${(timeLeft / bettingTime) * 100}%` }} />
      </div>

      <div className="flex-1 flex flex-col items-center justify-center gap-8">
        <HintCards hints={hints} />
        <div className="text-center">
          <p className="text-5xl font-black text-white">{bidCount}</p>
          <p className="text-white/40">of {players.length} have bid</p>
        </div>
      </div>
    </div>
  );
}

export function PlayingView({ game }: Readonly<{ game: HostState }>) {
  const { roundIndex, totalRounds, countdown, guesserNames, lowestBid, playerBids, playProgress, timeLeft, mode, answeredCount, players, skipTurn } = game;
  const isRace = mode === 'race';
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 gap-6 text-center">
      <p className="text-white/50">Round {roundIndex + 1}/{totalRounds}</p>
      {countdown === null ? (
        <>
          <Music className="w-16 h-16 text-white animate-pulse" />
          {isRace ? (
            <p className="text-white/50">{answeredCount} / {players.length} answered</p>
          ) : (
            <p className="text-white/50">{guesserNames.join(' & ')} will guess</p>
          )}
          <div className="w-full max-w-sm bg-white/10 rounded-full h-2 overflow-hidden">
            <div className="bg-purple-500 h-2 rounded-full" style={{ width: `${playProgress * 100}%` }} />
          </div>
          <p className="text-white font-black text-2xl">{timeLeft}s</p>
          {!isRace && (
            <div className="w-full max-w-sm">
              <BidTimeline bids={playerBids} lowestBid={lowestBid} />
            </div>
          )}
        </>
      ) : (
        <>
          <p className="text-white/40 text-sm uppercase tracking-widest">Get ready</p>
          <div className="text-8xl font-black text-white animate-pulse">{countdown}</div>
          {isRace ? (
            <p className="text-white/50">Everyone will guess</p>
          ) : (
            <>
              <p className="text-white/50">{guesserNames.join(' & ')} will guess</p>
              <div className="w-full max-w-sm">
                <BidTimeline bids={playerBids} lowestBid={lowestBid} />
              </div>
            </>
          )}
        </>
      )}
      {countdown === null && (
        <button onClick={skipTurn} className="text-white/20 text-xs hover:text-white/50 transition-colors mt-2">
          Skip round
        </button>
      )}
    </div>
  );
}

function GuessingView({ game }: Readonly<{ game: HostState }>) {
  const { roundIndex, totalRounds, guesserNames, lowestBid, playerBids, timeLeft, skipTurn } = game;
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 gap-6 text-center">
      <p className="text-white/50">Round {roundIndex + 1}/{totalRounds}</p>
      <div>
        <p className="text-white/50 text-sm mb-1">Guessing</p>
        <p className="text-white font-black text-2xl">{guesserNames.join(' & ')}</p>
      </div>
      <p className="text-white font-black text-5xl">{timeLeft}s</p>
      <div className="w-full max-w-sm">
        <BidTimeline bids={playerBids} lowestBid={lowestBid} />
      </div>
      <p className="text-white/30 text-sm">Other players are waiting...</p>
      <button onClick={skipTurn} className="text-white/20 text-xs hover:text-white/50 transition-colors mt-2">
        Skip turn
      </button>
    </div>
  );
}

export function RevealView({ game, result }: Readonly<{ game: HostState; result: RoundResultEvent }>) {
  const { roundIndex, totalRounds, players, roundDeltas } = game;
  const isRace = result.mode === 'race';
  return (
    <div className="min-h-screen flex flex-col items-center p-6 gap-6 text-center">
      <p className="text-white/50 text-sm">{roundIndex + 1} / {totalRounds}</p>
      <RevealStatusHeader result={result} />
      <RevealSongCard result={result} />
      <div className="bg-white/5 rounded-2xl p-4 w-full space-y-1.5">
        {players
          .slice()
          .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
          .map(p => {
            const entry = result.playerGuesses?.find(g => g.name === p.name);
            const delta = roundDeltas[p.name] ?? 0;
            const streak = p.streak ?? 0;
            const correct = isRace
              ? !!result.correctGuessers?.includes(p.name)
              : (result.correct && p.name === result.guesserName);
            return (
              <div key={p.name} className="flex justify-between items-center gap-4">
                <div className="text-left">
                  <div className="flex items-center gap-1.5">
                    {streak >= 2 && (
                      <span className="flex items-center gap-0.5 text-orange-400 text-xs font-bold">
                        <Flame className="w-3 h-3" />{streak}
                      </span>
                    )}
                    <span className="text-white/50 text-sm">{p.name}</span>
                  </div>
                  {entry && (() => {
                    const skipped = entry.guess === null;
                    let cls = 'text-white/40 text-xs';
                    if (skipped) cls = 'text-white/25 italic text-xs';
                    else if (correct) cls = 'text-green-400 text-xs';
                    return (
                      <p className={cls}>
                        {skipped ? 'skipped' : `"${entry.guess}"`}
                        {correct && entry.timeMs != null && (
                          <span className="ml-1.5 text-white/30">{(entry.timeMs / 1000).toFixed(1)}s</span>
                        )}
                      </p>
                    );
                  })()}
                </div>
                <div className="text-right shrink-0">
                  {delta > 0 && <p className="text-green-400 text-xs font-semibold">+{delta.toLocaleString()}</p>}
                  <span className="text-white/60 text-sm">{(p.score ?? 0).toLocaleString()}</span>
                </div>
              </div>
            );
          })}
      </div>
      <button
        onClick={() => socket.emit('next_round')}
        className="w-full py-4 rounded-2xl bg-purple-600 text-white font-bold text-xl hover:bg-purple-500 transition-colors"
      >
        {roundIndex + 1 >= totalRounds ? 'Final Results' : 'Next Round'}
      </button>
    </div>
  );
}

function LeaderboardView({ game }: Readonly<{ game: HostState }>) {
  const { phase, leaderboard } = game;
  return (
    <div className="min-h-screen flex flex-col p-6 gap-4">
      <h2 className="text-3xl font-black text-white text-center">
        {phase === 'finished' ? 'Final Scores' : 'Leaderboard'}
      </h2>
      <div className="flex-1 space-y-3">
        {leaderboard.map(e => (
          <div key={e.name} className={`flex items-center gap-4 px-4 py-3 rounded-xl ${e.rank <= 3 ? 'bg-white/10' : 'bg-white/5'}`}>
            <span className="w-8 flex justify-center">
              <RankBadge rank={e.rank} />
            </span>
            <span className="text-white font-bold flex-1">{e.name}</span>
            <span className="text-white/60 font-semibold">{e.score.toLocaleString()}</span>
          </div>
        ))}
      </div>
      {phase === 'finished' && (
        <button onClick={game.newGame}
          className="w-full py-4 rounded-2xl bg-purple-600 text-white font-bold text-xl hover:bg-purple-500 transition-colors">
          New Game
        </button>
      )}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Host() {
  const game = useHostGame();
  const navigate = useNavigate();
  const { phase, result, reconnecting, reconnectingCount, gameExpired } = game;

  return (
    <div className="relative">
      {phase === 'connect' && <ConnectView game={game} />}
      {phase === 'lobby' && <LobbyView game={game} />}
      {phase === 'betting' && <BettingView game={game} />}
      {phase === 'playing' && <PlayingView game={game} />}
      {phase === 'guessing' && <GuessingView game={game} />}
      {phase === 'reveal' && result && <RevealView game={game} result={result} />}
      {(phase === 'leaderboard' || phase === 'finished') && <LeaderboardView game={game} />}

      {reconnecting && !gameExpired && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex flex-col items-center justify-center z-50 gap-3">
          <div className="w-10 h-10 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          <p className="text-white/70 text-sm font-medium">Reconnecting...</p>
          <p className="text-white/30 text-xs">Game is still running</p>
        </div>
      )}
      {gameExpired && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-sm flex flex-col items-center justify-center z-50 gap-4">
          <p className="text-white font-bold text-xl">Game expired</p>
          <p className="text-white/40 text-sm text-center">You were away too long and the game was closed.</p>
          <button
            onClick={() => navigate('/')}
            className="mt-2 px-6 py-2 bg-purple-600 hover:bg-purple-500 text-white font-semibold rounded-xl transition-colors"
          >
            Go home
          </button>
        </div>
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
