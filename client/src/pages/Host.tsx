import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Music, Check, X, Loader2, Copy, ArrowLeft, Settings } from 'lucide-react';
import QRCode from 'react-qr-code';
import { socket } from '../socket';
import { useSpotify } from '../hooks/useSpotify';
import { RankBadge } from '../components/RankBadge';
import { APP_NAME, BACKEND_URL } from '../config';
import type { Hint, LeaderboardEntry, PlayerInfo, RoundResultEvent } from '../types';

type Phase = 'connect' | 'lobby' | 'betting' | 'playing' | 'guessing' | 'reveal' | 'leaderboard' | 'finished';
interface SongInfo { title: string; artist: string; trackId: string }

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

type Spotify = ReturnType<typeof useSpotify>;

interface HostState {
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
  leaderboard: LeaderboardEntry[];
  copied: boolean;
  playProgress: number;
  inviteUrl: string;
  settingsOpen: boolean;
  bettingTimeSetting: number;
  guessingTimeSetting: number;
  roundsSetting: number;
  toggleSettings: () => void;
  setBettingTimeSetting: (v: number) => void;
  setGuessingTimeSetting: (v: number) => void;
  setRoundsSetting: (v: number) => void;
  createGame: () => void;
  startGame: () => void;
  copyInvite: () => void;
}

function useHostGame(): HostState {
  const spotify = useSpotify();
  const [phase, setPhase] = useState<Phase>('connect');
  const [pin, setPin] = useState('');
  const pinRef = useRef('');
  const [players, setPlayers] = useState<PlayerInfo[]>([]);
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
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [copied, setCopied] = useState(false);
  const [playProgress, setPlayProgress] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bettingTimeSetting, setBettingTimeSetting] = useState(15);
  const [guessingTimeSetting, setGuessingTimeSetting] = useState(15);
  const [roundsSetting, setRoundsSetting] = useState(10);
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
        socket.emit('rejoin_host', { pin: pinRef.current }, ({ players: p }: { players: PlayerInfo[] }) => {
          if (p) setPlayers(p);
        });
      }
    });

    socket.on('player_joined', ({ players: p }: { players: PlayerInfo[] }) => setPlayers(p));
    socket.on('player_left', ({ players: p }: { players: PlayerInfo[] }) => setPlayers(p));

    socket.on('host_round_start', (data: {
      roundIndex: number; total: number; hints: Hint[];
      bettingTime: number; song: SongInfo;
    }) => {
      setRoundIndex(data.roundIndex);
      setTotalRounds(data.total);
      setHints(data.hints);
      setBettingTime(data.bettingTime);
      setBidCount(0);
      setGuesserNames([]);
      setPlayerBids([]);
      setResult(null);
      startCountdown(data.bettingTime);
      setPhase('betting');
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
      await spotify.startPrepared(data.durationMs);
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

    socket.on('score_update', ({ players: p }: { players: PlayerInfo[] }) => setPlayers(p));

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
      socket.off('player_joined'); socket.off('player_left');
      socket.off('host_round_start'); socket.off('bid_received');
      socket.off('betting_closed'); socket.off('play_song');
      socket.off('guessing_start'); socket.off('round_result');
      socket.off('score_update'); socket.off('leaderboard'); socket.off('game_over');
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
      settings: { bettingTime: bettingTimeSetting, guessingTime: guessingTimeSetting, totalRounds: roundsSetting },
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

  return {
    spotify, phase, pin, players, roundIndex, totalRounds, hints,
    bettingTime, timeLeft, bidCount, countdown, guesserNames, lowestBid, playerBids,
    result, leaderboard, copied, playProgress, inviteUrl,
    settingsOpen, bettingTimeSetting, guessingTimeSetting, roundsSetting,
    toggleSettings: () => setSettingsOpen(o => !o),
    setBettingTimeSetting, setGuessingTimeSetting, setRoundsSetting,
    createGame, startGame, copyInvite,
  };
}

// ─── Bid timeline ────────────────────────────────────────────────────────────

function BidTimeline({ bids, lowestBid }: Readonly<{ bids: { name: string; bid: number }[]; lowestBid: number }>) {
  if (bids.length === 0) return null;
  const sorted = [...bids].sort((a, b) => a.bid - b.bid);
  const min = sorted[0].bid;
  const max = sorted[sorted.length - 1].bid;
  const span = max === min ? 0 : max - min;
  const pos = (bid: number) => span === 0 ? 50 : 8 + ((bid - min) / span) * 84;

  return (
    <div className="w-full">
      {/* Name labels — alternate above/below to reduce overlap on close bids */}
      <div className="relative h-12">
        {sorted.map((entry, i) => (
          <span
            key={entry.name}
            className={`absolute text-xs font-semibold whitespace-nowrap -translate-x-1/2 ${entry.bid === lowestBid ? 'text-purple-300' : 'text-white/50'}`}
            style={{ left: `${pos(entry.bid)}%`, top: i % 2 === 0 ? 2 : 22 }}
          >
            {entry.name}
          </span>
        ))}
      </div>

      {/* Bar + dots */}
      <div className="relative h-px bg-white/20">
        {sorted.map(entry => (
          <div
            key={entry.name}
            className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full ${entry.bid === lowestBid ? 'w-3 h-3 bg-purple-400' : 'w-2 h-2 bg-white/40'}`}
            style={{ left: `${pos(entry.bid)}%` }}
          />
        ))}
      </div>

      {/* Bid value labels */}
      <div className="relative h-5 mt-1">
        {sorted.map(entry => (
          <span
            key={entry.name}
            className={`absolute text-xs -translate-x-1/2 ${entry.bid === lowestBid ? 'text-purple-400' : 'text-white/30'}`}
            style={{ left: `${pos(entry.bid)}%` }}
          >
            {entry.bid}s
          </span>
        ))}
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
  const {
    spotify, pin, players, copied, createGame, startGame, copyInvite,
    settingsOpen, bettingTimeSetting, guessingTimeSetting, roundsSetting,
    toggleSettings, setBettingTimeSetting, setGuessingTimeSetting, setRoundsSetting,
  } = game;
  const navigate = useNavigate();
  const [lobbyVisible, setLobbyVisible] = useState(false);

  useEffect(() => {
    if (!pin) { setLobbyVisible(false); return; }
    const t = setTimeout(() => setLobbyVisible(true), 10);
    return () => clearTimeout(t);
  }, [pin]);

  return (
    <div className="min-h-screen relative flex flex-col overflow-hidden">
      <button onClick={() => navigate('/')} className="absolute top-5 left-5 p-2 rounded-xl bg-white/10 text-white/60 hover:bg-white/20 hover:text-white transition-colors z-10">
        <ArrowLeft className="w-5 h-5" />
      </button>
      <button onClick={toggleSettings} className="absolute top-5 right-5 p-2 rounded-xl bg-white/10 text-white/60 hover:bg-white/20 hover:text-white transition-colors z-10">
        <Settings className="w-5 h-5" />
      </button>

      {/* Settings panel — drops below the top bar when open */}
      {settingsOpen && (
        <div className="absolute top-16 right-5 z-20 bg-[#1a1a2e] border border-white/10 rounded-2xl p-4 space-y-4 w-64 shadow-xl">
          <SettingRow label="Bet time" value={bettingTimeSetting} unit="s"
            onDec={() => setBettingTimeSetting(Math.max(5, bettingTimeSetting - 5))}
            onInc={() => setBettingTimeSetting(Math.min(60, bettingTimeSetting + 5))} />
          <SettingRow label="Guess time" value={guessingTimeSetting} unit="s"
            onDec={() => setGuessingTimeSetting(Math.max(5, guessingTimeSetting - 5))}
            onInc={() => setGuessingTimeSetting(Math.min(60, guessingTimeSetting + 5))} />
          <SettingRow label="Rounds" value={roundsSetting} unit=""
            onDec={() => setRoundsSetting(Math.max(1, roundsSetting - 1))}
            onInc={() => setRoundsSetting(Math.min(30, roundsSetting + 1))} />
        </div>
      )}

      {/* Header slides up from center on game creation using translateY */}
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
          {/* Join card */}
          <div className="w-full max-w-md bg-white/5 rounded-2xl p-5">
            <div className="flex items-stretch gap-5">
              <div className="flex-1 min-w-0 flex flex-col justify-between">
                <div>
                  <p className="text-white/40 text-xs uppercase tracking-widest mb-0.5">Join at</p>
                  <p className="text-white font-semibold text-base">
                    {`${globalThis.location.origin}${import.meta.env.BASE_URL}`.replace(/\/+$/, '')}
                  </p>
                </div>
                <div>
                  <p className="text-white/40 text-xs uppercase tracking-widest mb-0.5">PIN</p>
                  <p className="text-6xl font-black text-white tracking-widest leading-none select-text">{pin}</p>
                </div>
              </div>
              <div className="p-2 bg-white rounded-xl shrink-0 flex items-center">
                <QRCode value={`${globalThis.location.origin}${import.meta.env.BASE_URL}play/${pin}`} size={128} />
              </div>
            </div>
            <button
              onClick={copyInvite}
              className="mt-4 flex items-center gap-2 text-white/40 text-xs hover:text-white/70 transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied!' : 'Copy invite link'}
            </button>
          </div>

          {/* Players */}
          <div className="w-full max-w-md">
            <p className="text-white/40 text-sm mb-2">{players.length} player{players.length === 1 ? '' : 's'}</p>
            <div className="flex flex-wrap gap-2">
              {players.map(p => (
                <span key={p.name} className="px-3 py-1.5 rounded-full bg-white/10 text-white text-sm font-semibold">{p.name}</span>
              ))}
            </div>
          </div>

          <button
            onClick={startGame}
            disabled={players.length === 0}
            className="mt-auto w-full max-w-md py-4 rounded-2xl bg-purple-600 text-white font-bold text-xl disabled:opacity-30 hover:bg-purple-500 transition-colors"
          >
            Start Game
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center px-6 pb-6" style={{ transform: 'translateY(30vh)' }}>
          <button
            onClick={createGame}
            disabled={!spotify.playerReady}
            className="px-8 py-4 rounded-2xl bg-purple-600 text-white font-bold text-xl disabled:opacity-30 hover:bg-purple-500 active:scale-95 transition-all"
          >
            Create Game
          </button>
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

      {hints.length > 0 ? (
        <div className="bg-white/5 rounded-2xl p-4 space-y-2">
          <p className="text-white/40 text-xs uppercase tracking-widest mb-3">Hints</p>
          {hints.map(h => (
            <div key={h.label} className="flex justify-between">
              <span className="text-white/50">{h.label}</span>
              <span className="text-white font-semibold">{h.value}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white/5 rounded-2xl p-4 text-center text-white/30">No hints this round</div>
      )}

      <div className="text-center py-6">
        <p className="text-5xl font-black text-white">{bidCount}</p>
        <p className="text-white/40">of {players.length} have bid</p>
      </div>
    </div>
  );
}

function PlayingView({ game }: Readonly<{ game: HostState }>) {
  const { roundIndex, totalRounds, countdown, guesserNames, lowestBid, playerBids, playProgress, timeLeft } = game;
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 gap-6 text-center">
      <p className="text-white/50">Round {roundIndex + 1}/{totalRounds}</p>
      {countdown === null ? (
        <>
          <Music className="w-16 h-16 text-white animate-pulse" />
          <p className="text-white/50">
            {guesserNames.join(' & ')} will guess
          </p>
          <div className="w-full max-w-sm bg-white/10 rounded-full h-2 overflow-hidden">
            <div className="bg-purple-500 h-2 rounded-full" style={{ width: `${playProgress * 100}%` }} />
          </div>
          <p className="text-white font-black text-2xl">{timeLeft}s</p>
          <div className="w-full max-w-sm">
            <BidTimeline bids={playerBids} lowestBid={lowestBid} />
          </div>
        </>
      ) : (
        <>
          <p className="text-white/40 text-sm uppercase tracking-widest">Get ready</p>
          <div className="text-8xl font-black text-white animate-pulse">{countdown}</div>
          <p className="text-white/50">{guesserNames.join(' & ')} will guess</p>
          <div className="w-full max-w-sm">
            <BidTimeline bids={playerBids} lowestBid={lowestBid} />
          </div>
        </>
      )}
    </div>
  );
}

function GuessingView({ game }: Readonly<{ game: HostState }>) {
  const { roundIndex, totalRounds, guesserNames, lowestBid, playerBids, timeLeft } = game;
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
    </div>
  );
}

function RevealView({ game, result }: Readonly<{ game: HostState; result: RoundResultEvent }>) {
  const { roundIndex, totalRounds, players } = game;
  return (
    <div className="min-h-screen flex flex-col p-6 gap-5">
      <p className="text-center text-white/50">Round {roundIndex + 1}/{totalRounds}</p>
      <div className={`rounded-2xl p-6 text-center ${result.correct ? 'bg-green-900/40 border border-green-700/40' : 'bg-white/5'}`}>
        <div className="flex justify-center mb-2">
          {result.correct
            ? <Check className="w-10 h-10 text-green-400" />
            : <X className="w-10 h-10 text-white/60" />}
        </div>
        {result.correct
          ? <p className="text-white font-bold text-lg">{result.guesserName} got it! <span className="text-green-400">+{result.points}</span></p>
          : <p className="text-white/60">Nobody got it</p>
        }
      </div>
      <div className="bg-white/5 rounded-2xl p-5 text-center">
        <p className="text-white/40 text-sm mb-1">The song was</p>
        <p className="text-white font-black text-2xl">{result.songTitle}</p>
        <p className="text-white/60">{result.artist}</p>
      </div>
      <div className="flex-1 space-y-2">
        {players
          .slice()
          .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
          .map(p => (
            <div key={p.name} className="flex justify-between px-4 py-2 bg-white/5 rounded-xl">
              <span className="text-white font-semibold">{p.name}</span>
              <span className="text-white/60">{(p.score ?? 0).toLocaleString()}</span>
            </div>
          ))}
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
        <button onClick={() => globalThis.location.reload()}
          className="w-full py-4 rounded-2xl bg-white/10 text-white font-bold text-xl hover:bg-white/20 transition-colors">
          New Game
        </button>
      )}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Host() {
  const game = useHostGame();
  const { phase, result } = game;

  if (phase === 'connect') return <ConnectView game={game} />;
  if (phase === 'lobby') return <LobbyView game={game} />;
  if (phase === 'betting') return <BettingView game={game} />;
  if (phase === 'playing') return <PlayingView game={game} />;
  if (phase === 'guessing') return <GuessingView game={game} />;
  if (phase === 'reveal' && result) return <RevealView game={game} result={result} />;
  if (phase === 'leaderboard' || phase === 'finished') return <LeaderboardView game={game} />;
  return null;
}
