import { useState, useEffect, useRef } from 'react';
import { Music, Check, X, Loader2, Copy } from 'lucide-react';
import { socket } from '../socket';
import { useSpotify } from '../hooks/useSpotify';
import { RankBadge } from '../components/RankBadge';
import { APP_NAME, BACKEND_URL } from '../config';
import type { Hint, LeaderboardEntry, PlayerInfo, RoundResultEvent } from '../types';

type Phase = 'connect' | 'lobby' | 'betting' | 'playing' | 'guessing' | 'reveal' | 'leaderboard' | 'finished';

interface SongInfo { title: string; artist: string; trackId: string }

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export default function Host() {
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
  const [result, setResult] = useState<RoundResultEvent | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (spotify.isConnected && phase === 'connect') setPhase('lobby');
  }, [spotify.isConnected, phase]);

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
      setResult(null);
      startCountdown(data.bettingTime);
      setPhase('betting');
    });

    socket.on('bid_received', ({ bidCount: bc }: { bidCount: number }) => setBidCount(bc));

    socket.on('betting_closed', (data: { lowestBid: number; guesserNames: string[] }) => {
      setLowestBid(data.lowestBid);
      setGuesserNames(data.guesserNames);
      stopCountdown();
      setPhase('playing');
    });

    socket.on('play_song', async (data: { trackId: string; durationMs: number; countdownMs?: number }) => {
      // Start buffering immediately, then run the countdown while it loads so
      // the reveal is instant and the X-second timer matches the audible start.
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
    });

    socket.on('guessing_start', (data: { guesserNames: string[]; timeLimit: number }) => {
      spotify.pauseTrack();
      stopCountdown();
      setGuesserNames(data.guesserNames);
      startCountdown(data.timeLimit);
      setPhase('guessing');
    });

    socket.on('round_result', (data: RoundResultEvent) => {
      stopCountdown();
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
      socket.off('player_joined'); socket.off('player_left');
      socket.off('host_round_start'); socket.off('bid_received');
      socket.off('betting_closed'); socket.off('play_song');
      socket.off('guessing_start'); socket.off('round_result');
      socket.off('score_update'); socket.off('leaderboard'); socket.off('game_over');
      socket.disconnect();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  const createGame = () => {
    socket.emit('create_game', ({ pin: p, error: e }: { pin?: string; error?: string }) => {
      if (e || !p) return;
      pinRef.current = p;
      setPin(p);
    });
  };

  // Deep link that pre-fills the PIN on the join screen (Play reads /play/:pin).
  const inviteUrl = `${window.location.origin}${import.meta.env.BASE_URL}play/${pin}`;

  const copyInvite = () => {
    navigator.clipboard?.writeText(inviteUrl)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => { /* clipboard unavailable; user can still read the link */ });
  };

  // ─── Views ────────────────────────────────────────────────────────────────

  if (phase === 'connect') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-6 p-6">
        <img src="/logo.svg" alt={APP_NAME} className="h-16 w-auto" />
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

  if (phase === 'lobby') {
    return (
      <div className="min-h-screen flex flex-col items-center p-6 gap-6">
        <img src="/logo.svg" alt={APP_NAME} className="h-16 w-auto" />
        <span className="text-white/40 text-sm flex items-center gap-2">
          {spotify.playerReady ? (
            <><span className="w-2 h-2 rounded-full bg-green-500" />Spotify ready</>
          ) : (
            <><Loader2 className="w-3.5 h-3.5 animate-spin" />Spotify loading...</>
          )}
        </span>

        {!pin ? (
          <button
            onClick={createGame}
            disabled={!spotify.playerReady}
            className="px-8 py-4 rounded-2xl bg-purple-600 text-white font-bold text-xl disabled:opacity-30 hover:bg-purple-500 transition-colors"
          >
            Create Game
          </button>
        ) : (
          <>
            <div className="text-center">
              <p className="text-white/40 text-sm uppercase tracking-widest mb-1">PIN</p>
              <p className="text-7xl font-black text-white tracking-widest select-text">{pin}</p>
              <button
                onClick={copyInvite}
                className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white/80 text-sm font-semibold transition-colors"
              >
                {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                {copied ? 'Copied!' : 'Copy invite link'}
              </button>
            </div>
            <div className="w-full max-w-sm">
              <p className="text-white/40 text-sm mb-2">{players.length} player{players.length !== 1 ? 's' : ''}</p>
              <div className="flex flex-wrap gap-2">
                {players.map(p => (
                  <span key={p.name} className="px-3 py-1.5 rounded-full bg-white/10 text-white text-sm font-semibold">{p.name}</span>
                ))}
              </div>
            </div>
            <button
              onClick={() => { spotify.activatePlayer(); socket.emit('start_game'); }}
              disabled={players.length === 0}
              className="mt-auto w-full max-w-sm py-4 rounded-2xl bg-purple-600 text-white font-bold text-xl disabled:opacity-30 hover:bg-purple-500 transition-colors"
            >
              Start Game
            </button>
          </>
        )}
      </div>
    );
  }

  if (phase === 'betting') {
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
            {hints.map((h, i) => (
              <div key={i} className="flex justify-between">
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

  if (phase === 'playing') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 gap-6 text-center">
        <p className="text-white/50">Round {roundIndex + 1}/{totalRounds}</p>
        {countdown !== null ? (
          <>
            <p className="text-white/40 text-sm uppercase tracking-widest">Get ready</p>
            <div className="text-8xl font-black text-white animate-pulse">{countdown}</div>
            <p className="text-white/50">{guesserNames.join(' & ')} will guess</p>
          </>
        ) : (
          <>
            <Music className="w-16 h-16 text-white animate-pulse" />
            <div>
              <p className="text-white/40 text-sm">Playing for</p>
              <p className="text-white font-black text-4xl">{lowestBid}s</p>
            </div>
            <p className="text-white/50">
              {guesserNames.join(' & ')} will guess
            </p>
            <p className="text-white font-black text-2xl">{timeLeft}s</p>
          </>
        )}
      </div>
    );
  }

  if (phase === 'guessing') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 gap-6 text-center">
        <p className="text-white/50">Round {roundIndex + 1}/{totalRounds}</p>
        <div>
          <p className="text-white/50 text-sm mb-1">Guessing</p>
          <p className="text-white font-black text-2xl">{guesserNames.join(' & ')}</p>
        </div>
        <p className="text-white font-black text-5xl">{timeLeft}s</p>
        <p className="text-white/30 text-sm">Other players are waiting...</p>
      </div>
    );
  }

  if (phase === 'reveal' && result) {
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

  if (phase === 'leaderboard' || phase === 'finished') {
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
          <button onClick={() => window.location.reload()}
            className="w-full py-4 rounded-2xl bg-white/10 text-white font-bold text-xl hover:bg-white/20 transition-colors">
            New Game
          </button>
        )}
      </div>
    );
  }

  return null;
}
