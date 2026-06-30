import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Music, Check, Loader2, Copy, ChevronLeft, Settings, Flame, Coins, Clock } from 'lucide-react';
import LiquidGlass from 'liquid-glass-react';
import QRCodeLib from 'react-qr-code';
const QRCode = QRCodeLib as unknown as React.FC<{ value: string; size?: number }>;
import { socket } from '../socket';
import { useSpotify } from '../hooks/useSpotify';
import { RankBadge } from '../components/RankBadge';
import { useAnimatedScore } from '../hooks/useAnimatedScore';
import { ConfettiBackground } from '../components/ConfettiBackground';
import { NoOneGotItCardContent, GotItCardContent } from '../components/RevealShared';
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
  const playGenRef = useRef(0);

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
      // Brief pause so the last dot's fill animation is visible before transitioning.
      setTimeout(() => setPhase('playing'), 600);
    });

    socket.on('play_song', async (data: { trackId: string; durationMs: number; countdownMs?: number }) => {
      // Bump generation so any previously-running countdown loop exits early.
      const myGen = ++playGenRef.current;
      stopPlaybackBar(); // keep the bar empty through the countdown/buffer
      const prepared = spotify.prepareTrack(data.trackId);
      const ticks = Math.ceil((data.countdownMs ?? 3000) / 1000);
      for (let n = ticks; n > 0; n--) {
        if (playGenRef.current !== myGen) return;
        setCountdown(n);
        await wait(1000);
      }
      if (playGenRef.current !== myGen) return;
      setCountdown(null);
      await prepared;
      if (playGenRef.current !== myGen) return;
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
      ++playGenRef.current;
      spotify.pauseTrack();
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

// ─── Circular countdown timer ─────────────────────────────────────────────────

function timerColor(pct: number): string {
  if (pct > 0.6) return 'rgba(52,211,153,0.9)';
  if (pct > 0.35) return 'rgba(251,191,36,0.9)';
  if (pct > 0.12) return 'rgba(249,115,22,0.9)';
  return 'rgba(239,68,68,0.9)';
}

function CircularTimer({ timeLeft, total }: Readonly<{ timeLeft: number; total: number }>) {
  const size = 128;
  const sw = 5;
  const r = (size - sw * 2) / 2;
  const circ = 2 * Math.PI * r;

  const endsAtRef = useRef(0);
  const [pct, setPct] = useState(total > 0 ? Math.max(0, Math.min(1, timeLeft / total)) : 0);

  useEffect(() => {
    if (total <= 0) return;
    if (timeLeft <= 0) {
      setPct(0);
      return;
    }
    endsAtRef.current = Date.now() + timeLeft * 1000;
    let rafId: number;
    const tick = () => {
      const remaining = endsAtRef.current - Date.now();
      const p = Math.max(0, Math.min(1, remaining / (total * 1000)));
      setPct(p);
      if (p > 0) rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [timeLeft, total]);

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="absolute inset-0" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={sw} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={timerColor(pct)}
          strokeWidth={sw}
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - pct)}
          strokeLinecap="round"
          style={{ transition: 'stroke 0.4s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-white font-black" style={{ fontSize: '1.9rem', lineHeight: 1 }}>{timeLeft}</span>
        <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.14em' }}>sec</span>
      </div>
    </div>
  );
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

function SettingsPanel({ game, open }: Readonly<{ game: HostState; open: boolean }>) {
  const {
    mode, bettingTimeSetting, guessingTimeSetting, roundsSetting, raceTimeSetting, raceWinnerOnly, artistOnly,
    setBettingTimeSetting, setGuessingTimeSetting, setRoundsSetting, setRaceTimeSetting, setRaceWinnerOnly, setArtistOnly,
  } = game;
  return (
    <div
      className="absolute right-5 z-20"
      style={{
        top: '68px',
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
        </div>

        <div className="px-5 pb-4 space-y-4" style={{ borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: '16px' }}>
          {mode === 'race' && (
            <ToggleRow label="Winner only" value={raceWinnerOnly} onToggle={() => setRaceWinnerOnly(!raceWinnerOnly)} />
          )}
          <ToggleRow label="Artist only" value={artistOnly} onToggle={() => setArtistOnly(!artistOnly)} />
        </div>
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

// ─── Settings row / toggle ────────────────────────────────────────────────────

function SettingRow({ label, value, unit, onDec, onInc }: Readonly<{
  label: string; value: number; unit: string; onDec: () => void; onInc: () => void;
}>) {
  return (
    <div className="flex items-center justify-between">
      <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.875rem' }}>{label}</span>
      <div className="flex items-center gap-2.5">
        <button
          onClick={onDec}
          className="flex items-center justify-center active:scale-90 transition-transform"
          style={{
            width: '28px', height: '28px', borderRadius: '50%',
            background: 'rgba(255,255,255,0.07)',
            border: '1px solid rgba(255,255,255,0.09)',
            color: 'rgba(255,255,255,0.55)',
            fontSize: '1.1rem', lineHeight: 1,
            cursor: 'pointer',
          }}
        >−</button>
        <span style={{ color: 'white', fontWeight: 700, minWidth: '42px', textAlign: 'center', fontSize: '0.9375rem' }}>
          {value}{unit}
        </span>
        <button
          onClick={onInc}
          className="flex items-center justify-center active:scale-90 transition-transform"
          style={{
            width: '28px', height: '28px', borderRadius: '50%',
            background: 'rgba(255,255,255,0.07)',
            border: '1px solid rgba(255,255,255,0.09)',
            color: 'rgba(255,255,255,0.55)',
            fontSize: '1.1rem', lineHeight: 1,
            cursor: 'pointer',
          }}
        >+</button>
      </div>
    </div>
  );
}

function ToggleRow({ label, value, onToggle }: Readonly<{ label: string; value: boolean; onToggle: () => void }>) {
  return (
    <div className="flex items-center justify-between">
      <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.875rem' }}>{label}</span>
      <button
        onClick={onToggle}
        className="relative shrink-0"
        style={{
          width: '40px', height: '22px', borderRadius: '100px',
          background: value ? 'rgba(130, 30, 175, 0.7)' : 'rgba(255,255,255,0.10)',
          border: value ? '1px solid rgba(150, 50, 200, 0.6)' : '1px solid rgba(255,255,255,0.08)',
          transition: 'background 0.2s ease, border-color 0.2s ease',
          cursor: 'pointer',
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

// ─── Phase views ─────────────────────────────────────────────────────────────

function ConnectView({ game }: Readonly<{ game: HostState }>) {
  const { spotify } = game;
  const navigate = useNavigate();
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-6 p-6">
      <button
        onClick={() => navigate('/')}
        className="absolute top-5 left-5 flex items-center gap-1.5 transition-all duration-200"
        style={{ background: 'none', border: 'none', padding: '6px 2px', zIndex: 2, color: 'rgba(255,255,255,0.6)' }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.95)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.6)'; }}
      >
        <ChevronLeft className="w-5 h-5" strokeWidth={1.5} />
        <span style={{ fontSize: '0.875rem', fontWeight: 400 }}>Back</span>
      </button>
      <img src={`${import.meta.env.BASE_URL}logo.png`} alt={APP_NAME} className="h-48 w-auto" />
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

function SettingsButton({ settingsOpen, toggleSettings }: Readonly<{ settingsOpen: boolean; toggleSettings: () => void }>) {
  const [hovered, setHovered] = useState(false);
  let bg = 'rgba(255,255,255,0.06)';
  if (settingsOpen) bg = 'rgba(120, 25, 170, 0.28)';
  else if (hovered) bg = 'rgba(255,255,255,0.11)';
  let color = 'rgba(255,255,255,0.5)';
  if (settingsOpen) color = '#c084fc';
  else if (hovered) color = 'rgba(255,255,255,0.85)';
  return (
    <button
      onClick={toggleSettings}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="absolute top-5 right-5 flex items-center gap-2 rounded-full transition-all duration-200 z-10"
      style={{
        background: bg,
        border: settingsOpen ? '1px solid rgba(140, 40, 200, 0.45)' : '1px solid rgba(255,255,255,0.10)',
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

function ModeToggle({ mode, setMode }: Readonly<{ mode: 'classic' | 'race'; setMode: (m: 'classic' | 'race') => void }>) {
  const isClassic = mode === 'classic';
  return (
    <div
      className="w-full max-w-md relative flex rounded-2xl"
      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', padding: '4px' }}
    >
      <div
        className="absolute rounded-xl"
        style={{
          top: '4px', bottom: '4px', left: '4px',
          width: 'calc(50% - 4px)',
          background: isClassic ? 'rgba(130, 20, 180, 0.28)' : 'rgba(220, 80, 10, 0.2)',
          border: isClassic ? '1px solid rgba(140, 30, 200, 0.45)' : '1px solid rgba(234, 88, 12, 0.4)',
          transform: isClassic ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), background 0.25s ease, border-color 0.25s ease',
          pointerEvents: 'none',
        }}
      />
      <button
        onClick={() => setMode('classic')}
        className="relative flex-1 py-2.5 rounded-xl text-sm font-semibold z-10 transition-colors duration-200 flex items-center justify-center gap-1.5"
        style={{ color: isClassic ? 'white' : 'rgba(255,255,255,0.38)', background: 'transparent', border: 'none', cursor: 'pointer' }}
      >
        <Coins className="w-3.5 h-3.5 transition-colors duration-200" style={{ color: isClassic ? '#c084fc' : 'rgba(255,255,255,0.38)' }} />
        Classic
      </button>
      <button
        onClick={() => setMode('race')}
        className="relative flex-1 py-2.5 rounded-xl text-sm font-semibold z-10 transition-colors duration-200 flex items-center justify-center gap-1.5"
        style={{ color: isClassic ? 'rgba(255,255,255,0.38)' : '#fed7aa', background: 'transparent', border: 'none', cursor: 'pointer' }}
      >
        <Flame className="w-3.5 h-3.5 transition-colors duration-200" style={{ color: isClassic ? 'rgba(255,255,255,0.38)' : '#fb923c' }} />
        Race
      </button>
    </div>
  );
}

function StartButton({ players, mode, startGame }: Readonly<{ players: PlayerInfo[]; mode: 'classic' | 'race'; startGame: () => void }>) {
  const [hovered, setHovered] = useState(false);
  const disabled = players.length === 0;
  const hoverShadow = mode === 'race'
    ? 'drop-shadow(0 0 12px rgba(220, 80, 10, 0.7))'
    : 'drop-shadow(0 0 12px rgba(110, 32, 155, 0.7))';
  return (
    <button
      type="button"
      className="liquid-btn relative cursor-pointer border-0 bg-transparent p-0 mt-auto"
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
        displacementScale={64}
        blurAmount={0.05}
        saturation={130}
        aberrationIntensity={2}
        elasticity={0.12}
        cornerRadius={100}
        padding="18px 36px"
      >
        <div style={{ position: 'relative' }}>
          <div style={{
            position: 'absolute', inset: '-18px -36px', borderRadius: '100px', pointerEvents: 'none',
            background: mode === 'race' ? 'rgba(220,80,10,0.12)' : 'rgba(110,32,155,0.12)',
            transition: 'background 0.25s ease',
          }} />
          <span className="text-white font-bold text-xl" style={{ whiteSpace: 'nowrap', position: 'relative', display: 'inline-block', minWidth: '210px', textAlign: 'center' }}>
            {mode === 'race' ? 'Start Race Game' : 'Start Classic Game'}
          </span>
        </div>
      </LiquidGlass>
    </button>
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
      <button
        onClick={() => navigate('/')}
        className="absolute top-5 left-5 flex items-center gap-1.5 transition-all duration-200"
        style={{ background: 'none', border: 'none', padding: '6px 2px', zIndex: 10, color: 'rgba(255,255,255,0.6)' }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.95)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.6)'; }}
      >
        <ChevronLeft className="w-5 h-5" strokeWidth={1.5} />
        <span style={{ fontSize: '0.875rem', fontWeight: 400 }}>Back</span>
      </button>
      <SettingsButton settingsOpen={settingsOpen} toggleSettings={toggleSettings} />

      <SettingsPanel game={game} open={settingsOpen} />

      <div
        className="flex flex-col items-center gap-6 p-6 transition-transform duration-500 ease-out"
        style={{ transform: pin ? 'translateY(0)' : 'translateY(30vh)' }}
      >
        <img src={`${import.meta.env.BASE_URL}logo.png`} alt={APP_NAME} className="h-48 w-auto" />
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
          <ModeToggle mode={mode} setMode={setMode} />
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
          <StartButton players={players} mode={mode} startGame={startGame} />
        </div>
      ) : null}
    </div>
  );
}

function BettingView({ game }: Readonly<{ game: HostState }>) {
  const { roundIndex, totalRounds, timeLeft, bettingTime, hints, bidCount, players, pin, skipTurn } = game;
  const imageHint = hints.find(h => h.imageUrl);
  const textHints = hints.filter(h => !h.imageUrl);

  return (
    <div className="relative min-h-screen flex flex-col overflow-hidden">

      {/* Background */}
      <img
        src={`${import.meta.env.BASE_URL}background2.svg`}
        aria-hidden="true"
        style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 0, transform: 'rotate(90deg)' }}
      />
      <div style={{ position: 'fixed', inset: 0, zIndex: 1, background: 'rgba(5,5,14,0.82)', backdropFilter: 'blur(28px)' }} />

      {/* Top bar */}
      <div className="relative flex items-center justify-between px-9 pt-7" style={{ zIndex: 2 }}>
        <span style={{ color: 'rgba(255,255,255,0.35)', fontWeight: 600, fontSize: '1rem' }}>
          Round{' '}
          <span style={{ color: 'rgba(255,255,255,0.72)', fontWeight: 800 }}>{roundIndex + 1}</span>
          <span style={{ color: 'rgba(255,255,255,0.18)' }}>/{totalRounds}</span>
        </span>
        <span style={{ color: 'rgba(255,255,255,0.2)', fontFamily: 'monospace', letterSpacing: '0.12em', fontSize: '0.9rem' }}>
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
                  <span style={{ color: 'rgba(255,255,255,0.32)', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.2em' }}>
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
            {players.map((_, i) => (
              <div
                key={i}
                className="rounded-full transition-all duration-500"
                style={{
                  width: 12, height: 12,
                  background: i < bidCount ? 'rgba(150,17,193,0.9)' : 'rgba(255,255,255,0.12)',
                  boxShadow: i < bidCount ? '0 0 8px rgba(150,17,193,0.55)' : 'none',
                  transform: i < bidCount ? 'scale(1)' : 'scale(0.78)',
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Skip */}
      <div className="relative flex justify-center pb-7" style={{ zIndex: 2 }}>
        <button
          onClick={skipTurn}
          style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.12)', fontSize: '0.75rem', cursor: 'pointer', transition: 'color 0.2s ease' }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.4)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.12)'; }}
        >
          Skip round
        </button>
      </div>
    </div>
  );
}

export function PlayingView({ game }: Readonly<{ game: HostState }>) {
  const { roundIndex, totalRounds, countdown, guesserNames, lowestBid, playerBids, playProgress, timeLeft, mode, answeredCount, players, skipTurn } = game;
  const isRace = mode === 'race';
  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center p-6 gap-6 text-center overflow-hidden">
      <img src={`${import.meta.env.BASE_URL}background4.svg`} aria-hidden="true" style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 0 }} />
      <div style={{ position: 'fixed', inset: 0, zIndex: 1, background: 'rgba(5,5,14,0.82)', backdropFilter: 'blur(28px)' }} />
      <div className="flex flex-col items-center gap-6 text-center w-full" style={{ position: 'relative', zIndex: 2 }}>
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
        <button onClick={skipTurn} className="text-white/20 text-xs hover:text-white/50 transition-colors mt-2">
          Skip round
        </button>
      </div>
    </div>
  );
}

function GuessingView({ game }: Readonly<{ game: HostState }>) {
  const { roundIndex, totalRounds, guesserNames, lowestBid, playerBids, timeLeft, skipTurn } = game;
  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center p-6 gap-6 text-center overflow-hidden">
      <img src={`${import.meta.env.BASE_URL}background4.svg`} aria-hidden="true" style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 0 }} />
      <div style={{ position: 'fixed', inset: 0, zIndex: 1, background: 'rgba(5,5,14,0.82)', backdropFilter: 'blur(28px)' }} />
      <div className="flex flex-col items-center gap-6 text-center w-full" style={{ position: 'relative', zIndex: 2 }}>
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
    </div>
  );
}

function RevealPlayerRow({
  player, entry, delta, delay, correct, instant, removePlayer,
}: Readonly<{
  player: PlayerInfo;
  entry?: { guess: string | null; timeMs?: number | null };
  delta: number;
  delay: number;
  correct: boolean;
  instant: boolean;
  removePlayer: (name: string) => void;
}>) {
  const { displayScore, displayDelta, deltaFading } = useAnimatedScore(player.score ?? 0, delta, delay, instant);
  const streak = player.streak ?? 0;
  const skipped = entry?.guess === null;
  let guessText: string | null = null;
  if (entry) {
    guessText = skipped ? 'skipped' : `"${entry.guess}"`;
  }
  const guessCls = (!skipped && correct) ? 'text-green-400 text-xs truncate min-w-0' : 'text-white/20 italic text-xs truncate min-w-0';
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
            <span className="text-xs truncate text-white/30">{player.name}</span>
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
          <span className={`text-xs truncate ${correct ? 'text-white font-semibold' : 'text-white/30'}`}>{player.name}</span>
        </div>
        {delta > 0 && (
          <p className={`text-sky-400 text-xs tabular-nums shrink-0 transition-opacity duration-500 ${deltaFading ? 'opacity-0' : 'opacity-100'}`}>
            +{displayDelta > 0 ? displayDelta.toLocaleString() : ''}
          </p>
        )}
      </div>
      {/* Row 2: guess | total score */}
      <div className="flex justify-between items-center gap-2">
        {guessText ? (
          <p className={guessCls}>
            {guessText}
            {correct && entry?.timeMs != null && (
              <span className="ml-1 text-white/25 text-xs">{(entry.timeMs / 1000).toFixed(1)}s</span>
            )}
          </p>
        ) : <span />}
        <p className="text-white/60 text-xs tabular-nums shrink-0">{displayScore.toLocaleString()}</p>
      </div>
      <span className="absolute -inset-x-3 -inset-y-1 rounded-lg backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity" />
    </button>
  );
}

export function RevealView({ game, result, instant = false }: Readonly<{ game: HostState; result: RoundResultEvent; instant?: boolean }>) {
  const { roundIndex, totalRounds, players, roundDeltas, removePlayer } = game;
  const isRace = result.mode === 'race';

  if (!result.correct) {
    const cardH = result.coverUrl ? 480 : 240;
    return (
      <div className="page-enter relative min-h-screen flex flex-col items-center p-6 gap-5 overflow-hidden">
        <img
          src={`${import.meta.env.BASE_URL}background3.svg`}
          aria-hidden="true"
          style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 0, transform: 'rotate(180deg)' }}
        />
        <div style={{ position: 'fixed', inset: 0, zIndex: 1, background: 'rgba(5,5,14,0.82)', backdropFilter: 'blur(28px)' }} />
        <p className="text-white/40 text-sm self-start" style={{ position: 'relative', zIndex: 2 }}>{roundIndex + 1} / {totalRounds}</p>

        <div className="liquid-btn relative" style={{ width: '310px', height: `${cardH}px`, zIndex: 2 }}>
          <LiquidGlass
            style={{ position: 'absolute', top: '50%', left: '50%' }}
            displacementScale={55}
            blurAmount={0.06}
            saturation={130}
            aberrationIntensity={1.5}
            elasticity={0.08}
            cornerRadius={20}
            padding="24px 24px"
          >
            <NoOneGotItCardContent result={result} />
          </LiquidGlass>
        </div>

        <div style={{ position: 'relative', zIndex: 2, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', padding: '8px 12px', width: '25%' }} className="divide-y divide-white/[0.07]">
          {players.slice().sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).map((p, i) => (
            <RevealPlayerRow
              key={p.name}
              player={p}
              entry={result.playerGuesses?.find(g => g.name === p.name)}
              delta={roundDeltas[p.name] ?? 0}
              delay={400 + i * 80}
              correct={false}
              instant={instant}
              removePlayer={removePlayer}
            />
          ))}
        </div>

        <button
          type="button"
          className="liquid-btn relative cursor-pointer border-0 bg-transparent p-0"
          style={{ width: '310px', height: '64px', borderRadius: '100px', background: 'rgba(0,0,0,0.001)', zIndex: 2 }}
          onClick={() => socket.emit('next_round')}
        >
          <LiquidGlass
            style={{ position: 'absolute', top: '50%', left: '50%' }}
            displacementScale={64}
            blurAmount={0.05}
            saturation={130}
            aberrationIntensity={2}
            elasticity={0.12}
            cornerRadius={100}
            padding="18px 36px"
          >
            <div style={{ position: 'relative' }}>
              <div style={{ position: 'absolute', inset: '-18px -36px', borderRadius: '100px', pointerEvents: 'none', background: 'rgba(110,32,155,0.12)' }} />
              <span className="text-white font-bold text-xl" style={{ whiteSpace: 'nowrap', position: 'relative', display: 'inline-block', minWidth: '210px', textAlign: 'center' }}>
                {roundIndex + 1 >= totalRounds ? 'Final Results' : 'Next Round'}
              </span>
            </div>
          </LiquidGlass>
        </button>
      </div>
    );
  }

  const cardH = result.coverUrl ? 440 : 240;
  return (
    <div className="page-enter relative min-h-screen flex flex-col items-center p-6 gap-5 overflow-hidden">
      <img
        src={`${import.meta.env.BASE_URL}background3.svg`}
        aria-hidden="true"
        style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 0, transform: 'rotate(180deg)' }}
      />
      <div style={{ position: 'fixed', inset: 0, zIndex: 1, background: 'rgba(5,5,14,0.82)', backdropFilter: 'blur(28px)' }} />

      <p className="text-white/40 text-sm self-start" style={{ position: 'relative', zIndex: 2 }}>{roundIndex + 1} / {totalRounds}</p>

      <div className="liquid-btn relative" style={{ width: '310px', height: `${cardH}px`, zIndex: 2 }}>
        <LiquidGlass
          style={{ position: 'absolute', top: '50%', left: '50%' }}
          displacementScale={55}
          blurAmount={0.06}
          saturation={130}
          aberrationIntensity={1.5}
          elasticity={0.08}
          cornerRadius={20}
          padding="24px 24px"
        >
          <GotItCardContent result={result} />
        </LiquidGlass>
      </div>

      <div style={{ position: 'relative', zIndex: 2, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', padding: '8px 12px', width: '25%' }} className="divide-y divide-white/[0.07]">
        {players.slice().sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).map((p, i) => {
          const correct = isRace ? !!result.correctGuessers?.includes(p.name) : (p.name === result.guesserName);
          return (
            <RevealPlayerRow
              key={p.name}
              player={p}
              entry={result.playerGuesses?.find(g => g.name === p.name)}
              delta={roundDeltas[p.name] ?? 0}
              delay={400 + i * 80}
              correct={correct}
              instant={instant}
              removePlayer={removePlayer}
            />
          );
        })}
      </div>

      <button
        type="button"
        className="liquid-btn relative cursor-pointer border-0 bg-transparent p-0"
        style={{ width: '310px', height: '64px', borderRadius: '100px', background: 'rgba(0,0,0,0.001)', zIndex: 2 }}
        onClick={() => socket.emit('next_round')}
      >
        <LiquidGlass
          style={{ position: 'absolute', top: '50%', left: '50%' }}
          displacementScale={64}
          blurAmount={0.05}
          saturation={130}
          aberrationIntensity={2}
          elasticity={0.12}
          cornerRadius={100}
          padding="18px 36px"
        >
          <div style={{ position: 'relative' }}>
            <div style={{ position: 'absolute', inset: '-18px -36px', borderRadius: '100px', pointerEvents: 'none', background: 'rgba(110,32,155,0.12)' }} />
            <span className="text-white font-bold text-xl" style={{ whiteSpace: 'nowrap', position: 'relative', display: 'inline-block', minWidth: '210px', textAlign: 'center' }}>
              {roundIndex + 1 >= totalRounds ? 'Final Results' : 'Next Round'}
            </span>
          </div>
        </LiquidGlass>
      </button>
    </div>
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
  const { phase, leaderboard } = game;
  const isFinished = phase === 'finished';

  return (
    <div className="relative min-h-screen flex flex-col p-6 gap-4">
      {!isFinished && <div style={{ background: '#080812', position: 'fixed', inset: 0, zIndex: 0 }} />}
      {isFinished && (
        <>
          <img
            src={`${import.meta.env.BASE_URL}background6.svg`}
            aria-hidden="true"
            style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 0 }}
          />
          <div
            className="fixed inset-0 pointer-events-none"
            style={{
              background: 'rgba(8,8,18,0.92)',
              backdropFilter: 'blur(48px)',
              zIndex: 1,
            }}
          />
          <div style={{ position: 'fixed', inset: 0, zIndex: 2, pointerEvents: 'none' }}>
            <ConfettiBackground burst persistAfterBurst />
          </div>
        </>
      )}

      <h2 className="text-3xl font-black text-white text-center relative z-10">
        {isFinished ? 'Final Scores' : 'Leaderboard'}
      </h2>

      <div className="flex-1 space-y-3 relative z-10">
        {leaderboard.map((e, i) => (
          <LeaderboardRow
            key={e.name}
            entry={e}
            delay={200 + i * 80}
            highlight={e.rank <= 3}
          />
        ))}
      </div>

      {isFinished && (
        <div className="relative z-10 flex flex-col items-center gap-3">
          <button
            type="button"
            className="liquid-btn relative cursor-pointer border-0 bg-transparent p-0"
            style={{ width: '310px', height: '64px', borderRadius: '100px', background: 'rgba(0,0,0,0.001)' }}
            onClick={game.newGame}
          >
            <LiquidGlass
              style={{ position: 'absolute', top: '50%', left: '50%' }}
              displacementScale={64}
              blurAmount={0.05}
              saturation={130}
              aberrationIntensity={2}
              elasticity={0.12}
              cornerRadius={100}
              padding="18px 36px"
            >
              <div style={{ position: 'relative' }}>
                <div style={{ position: 'absolute', inset: '-18px -36px', borderRadius: '100px', pointerEvents: 'none', background: 'rgba(110,32,155,0.12)' }} />
                <span className="text-white font-bold text-xl" style={{ whiteSpace: 'nowrap', position: 'relative', display: 'inline-block', minWidth: '210px', textAlign: 'center' }}>
                  New Game
                </span>
              </div>
            </LiquidGlass>
          </button>
        </div>
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
        <div className="fixed inset-0 flex items-center justify-center z-50" style={{ background: 'rgba(8,8,18,0.92)', backdropFilter: 'blur(12px)' }}>
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: 'radial-gradient(ellipse 60% 40% at 50% 50%, rgba(86,20,140,0.22) 0%, transparent 65%)' }} />
          <div className="liquid-btn relative" style={{ width: '310px', height: '230px' }}>
            <LiquidGlass
              style={{ position: 'absolute', top: '50%', left: '50%' }}
              displacementScale={55}
              blurAmount={0.06}
              saturation={130}
              aberrationIntensity={1.5}
              elasticity={0.08}
              cornerRadius={20}
              padding="32px 28px"
            >
              <div style={{ width: '254px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                <Clock style={{ width: '30px', height: '30px', color: 'rgba(255,255,255,0.22)' }} strokeWidth={1.5} />
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                  <p style={{ color: 'white', fontWeight: 800, fontSize: '1.2rem', letterSpacing: '-0.01em' }}>Game expired</p>
                  <p style={{ color: 'rgba(255,255,255,0.38)', fontSize: '0.8rem', textAlign: 'center', lineHeight: 1.5 }}>You were away too long and the game was closed.</p>
                </div>
                <button
                  onClick={() => navigate('/')}
                  style={{ marginTop: '6px', width: '100%', padding: '10px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.12)', cursor: 'pointer', background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.72)', fontWeight: 600, fontSize: '0.875rem', transition: 'background 0.2s ease, border-color 0.2s ease, color 0.2s ease' }}
                  onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = 'rgba(255,255,255,0.13)'; el.style.borderColor = 'rgba(255,255,255,0.22)'; el.style.color = 'white'; }}
                  onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = 'rgba(255,255,255,0.07)'; el.style.borderColor = 'rgba(255,255,255,0.12)'; el.style.color = 'rgba(255,255,255,0.72)'; }}
                >
                  Go home
                </button>
              </div>
            </LiquidGlass>
          </div>
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
