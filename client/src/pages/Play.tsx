import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { Music, Trophy, Frown, ChevronLeft, ChevronRight } from 'lucide-react';
import { socket } from '../socket';
import { RankBadge } from '../components/RankBadge';
import { APP_NAME, BID_OPTIONS } from '../config';
import type { Hint, LeaderboardEntry, RoundResultEvent } from '../types';

type Phase =
  | 'join' | 'waiting' | 'betting' | 'bid_submitted'
  | 'watching' | 'guessing' | 'passed' | 'reveal' | 'leaderboard' | 'finished';

export default function Play() {
  const { pin: pinParam } = useParams<{ pin?: string }>();
  const [phase, setPhase] = useState<Phase>('join');
  const [pin, setPin] = useState(pinParam ?? '');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [myName, setMyName] = useState('');
  const myNameRef = useRef('');
  const [roundIndex, setRoundIndex] = useState(0);
  const [totalRounds, setTotalRounds] = useState(10);
  const [hints, setHints] = useState<Hint[]>([]);
  const [timeLeft, setTimeLeft] = useState(0);
  const [bettingTime, setBettingTime] = useState(15);
  const [bidIndex, setBidIndex] = useState(4); // default: 2s (index 4)
  const [myBid, setMyBid] = useState(0);
  const [guesserNames, setGuesserNames] = useState<string[]>([]);
  const [lowestBid, setLowestBid] = useState(0);
  const [guessText, setGuessText] = useState('');
  const [guessWrong, setGuessWrong] = useState(false);
  const [result, setResult] = useState<RoundResultEvent | null>(null);
  const [myScore, setMyScore] = useState(0);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const guessInputRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    socket.connect();

    socket.on('round_start', (data: {
      roundIndex: number; total: number;
      hints: Hint[]; bettingTime: number;
    }) => {
      setRoundIndex(data.roundIndex);
      setTotalRounds(data.total);
      setHints(data.hints);
      setBettingTime(data.bettingTime);
      setGuessText('');
      setResult(null);
      startCountdown(data.bettingTime);
      setPhase('betting');
    });

    socket.on('betting_closed', (data: { lowestBid: number; guesserNames: string[] }) => {
      stopCountdown();
      setLowestBid(data.lowestBid);
      setGuesserNames(data.guesserNames);
      setPhase('watching');
    });

    socket.on('guessing_start', (data: { guesserNames: string[]; timeLimit: number }) => {
      setGuesserNames(data.guesserNames);
      startCountdown(data.timeLimit);
    });

    socket.on('your_turn', (data: { timeLimit: number }) => {
      startCountdown(data.timeLimit);
      setPhase('guessing');
      setTimeout(() => guessInputRef.current?.focus(), 100);
    });

    socket.on('round_result', (data: RoundResultEvent) => {
      stopCountdown();
      setResult(data);
      setPhase('reveal');
    });

    socket.on('score_update', ({ players }: { players: { name: string; score: number }[] }) => {
      const me = players.find(p => p.name === myNameRef.current);
      if (me) setMyScore(me.score);
    });

    socket.on('leaderboard', ({ leaderboard: lb }: { leaderboard: LeaderboardEntry[] }) => {
      setLeaderboard(lb);
      setPhase('leaderboard');
    });

    socket.on('game_over', ({ leaderboard: lb }: { leaderboard: LeaderboardEntry[] }) => {
      setLeaderboard(lb);
      setPhase('finished');
    });

    socket.on('host_disconnected', () => {
      stopCountdown();
      setError('Host disconnected.');
      setPhase('join');
    });

    return () => {
      stopCountdown();
      ['round_start','betting_closed','guessing_start','your_turn',
       'round_result','score_update','leaderboard','game_over','host_disconnected']
        .forEach(e => socket.off(e));
      socket.disconnect();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const join = () => {
    const n = name.trim();
    const p = pin.trim();
    if (!n || !p) return;
    setError('');
    socket.emit('join_game', { pin: p, name: n }, ({ success, error: e }: { success?: boolean; error?: string }) => {
      if (e) { setError(e); return; }
      if (success) { myNameRef.current = n; setMyName(n); setPhase('waiting'); }
    });
  };

  const submitBid = () => {
    const seconds = BID_OPTIONS[bidIndex];
    setMyBid(seconds);
    socket.emit('submit_bid', { seconds });
    setPhase('bid_submitted');
  };

  const submitGuess = () => {
    if (!guessText.trim()) return;
    socket.emit('submit_guess', { text: guessText }, ({ correct }: { correct: boolean }) => {
      if (!correct) {
        setGuessWrong(true);
        setTimeout(() => setGuessWrong(false), 800);
      }
    });
  };

  const skipGuess = () => {
    stopCountdown();
    socket.emit('skip_guess');
    setPhase('passed');
  };

  // ─── Join ─────────────────────────────────────────────────────────────────
  if (phase === 'join') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 gap-5">
        <img src="/logo.svg" alt={APP_NAME} className="h-16 w-auto" />
        <div className="w-full max-w-xs flex flex-col gap-3">
          <input type="text" inputMode="numeric" pattern="[0-9]*" placeholder="Game PIN"
            value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} maxLength={6}
            className="w-full px-4 py-4 rounded-xl bg-white/10 text-white text-center text-2xl font-bold placeholder-white/30 outline-none focus:ring-2 focus:ring-white/30 tracking-widest" />
          <input type="text" placeholder="Your name"
            value={name} onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && join()} maxLength={20}
            className="w-full px-4 py-4 rounded-xl bg-white/10 text-white text-center text-xl placeholder-white/30 outline-none focus:ring-2 focus:ring-white/30" />
          {error && <p className="text-red-400 text-sm text-center">{error}</p>}
          <button onClick={join} disabled={!pin.trim() || !name.trim()}
            className="w-full py-4 rounded-2xl bg-purple-600 text-white font-bold text-xl disabled:opacity-30 hover:bg-purple-500 transition-colors">
            Join
          </button>
        </div>
      </div>
    );
  }

  // ─── Waiting ──────────────────────────────────────────────────────────────
  if (phase === 'waiting') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6">
        <div className="w-12 h-12 border-4 border-purple-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-white text-xl font-bold">{myName}</p>
        <p className="text-white/50">You're in! Waiting for the host to start the game…</p>
      </div>
    );
  }

  // ─── Betting ──────────────────────────────────────────────────────────────
  if (phase === 'betting') {
    const timerPct = (timeLeft / bettingTime) * 100;
    return (
      <div className="min-h-screen flex flex-col p-5 gap-4">
        <div className="flex justify-between items-center">
          <span className="text-white/50 text-sm">{roundIndex + 1}/{totalRounds}</span>
          <span className="text-white font-black text-xl">{timeLeft}s</span>
          <span className="text-white/50 text-sm">{myScore.toLocaleString()} pts</span>
        </div>
        <div className="w-full bg-white/10 rounded-full h-1.5">
          <div className="bg-purple-500 h-1.5 rounded-full transition-all duration-1000"
            style={{ width: `${timerPct}%` }} />
        </div>

        {hints.length > 0 && (
          <div className="bg-white/5 rounded-2xl p-4 space-y-2">
            {hints.map((h, i) => (
              <div key={i} className="flex justify-between">
                <span className="text-white/50 text-sm">{h.label}</span>
                <span className="text-white font-semibold text-sm">{h.value}</span>
              </div>
            ))}
          </div>
        )}

        <div className="flex-1 flex flex-col items-center justify-center gap-6">
          <p className="text-white/60 text-center">How fast can you name this song?</p>

          <div className="flex items-center gap-6">
            <button
              onClick={() => setBidIndex(i => Math.max(0, i - 1))}
              className="w-14 h-14 rounded-full bg-white/10 text-white flex items-center justify-center hover:bg-white/20 active:scale-95 transition-all"
            ><ChevronLeft className="w-6 h-6" /></button>
            <div className="text-center w-28">
              <p className="text-white font-black text-5xl">{BID_OPTIONS[bidIndex]}</p>
              <p className="text-white/40 text-sm">seconds</p>
            </div>
            <button
              onClick={() => setBidIndex(i => Math.min(BID_OPTIONS.length - 1, i + 1))}
              className="w-14 h-14 rounded-full bg-white/10 text-white flex items-center justify-center hover:bg-white/20 active:scale-95 transition-all"
            ><ChevronRight className="w-6 h-6" /></button>
          </div>
        </div>

        <button onClick={submitBid}
          className="w-full py-4 rounded-2xl bg-purple-600 text-white font-bold text-xl hover:bg-purple-500 active:scale-95 transition-all">
          Lock In
        </button>
      </div>
    );
  }

  // ─── Bid submitted ────────────────────────────────────────────────────────
  if (phase === 'bid_submitted') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-white/50">Your bid</p>
        <p className="text-white font-black text-6xl">{myBid}s</p>
        <p className="text-white/40">Waiting for others...</p>
      </div>
    );
  }

  // ─── Watching ─────────────────────────────────────────────────────────────
  if (phase === 'watching') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
        <Music className="w-14 h-14 text-white animate-pulse" />
        <div>
          <p className="text-white/40 text-sm mb-1">Guessing after {lowestBid}s</p>
          <p className="text-white font-black text-2xl">{guesserNames.join(' & ')}</p>
        </div>
        <p className="text-white/30 text-sm">Listen closely...</p>
      </div>
    );
  }

  // ─── Guessing ─────────────────────────────────────────────────────────────
  if (phase === 'guessing') {
    return (
      <div className="min-h-screen flex flex-col p-5 gap-4">
        <div className="flex justify-between items-center">
          <span className="text-white/50 text-sm">Your turn!</span>
          <span className="text-white font-black text-2xl">{timeLeft}s</span>
          <span className="text-white/50 text-sm">{myScore.toLocaleString()} pts</span>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-6">
          <p className="text-white/60">Name the song</p>
          <input
            ref={guessInputRef}
            type="text"
            placeholder="Type song title..."
            value={guessText}
            onChange={e => { setGuessText(e.target.value); setGuessWrong(false); }}
            onKeyDown={e => e.key === 'Enter' && submitGuess()}
            className={`w-full px-4 py-4 rounded-xl text-white text-center text-xl placeholder-white/30 outline-none focus:ring-2 transition-colors ${guessWrong ? 'bg-red-900/50 ring-2 ring-red-500' : 'bg-white/10 focus:ring-purple-500'}`}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
          {guessWrong && <p className="text-red-400 text-sm text-center">Not quite - try again</p>}
        </div>
        <button onClick={submitGuess} disabled={!guessText.trim()}
          className="w-full py-4 rounded-2xl bg-purple-600 text-white font-bold text-xl disabled:opacity-30 hover:bg-purple-500 active:scale-95 transition-all">
          Submit
        </button>
        <button onClick={skipGuess}
          className="w-full py-3 rounded-2xl bg-white/5 text-white/50 font-semibold hover:bg-white/10 active:scale-95 transition-all">
          Skip — I don't know
        </button>
      </div>
    );
  }

  // ─── Passed (skipped) ─────────────────────────────────────────────────────
  if (phase === 'passed') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-white font-black text-2xl">You passed</p>
        <p className="text-white/40">Handing it over…</p>
      </div>
    );
  }

  // ─── Reveal ───────────────────────────────────────────────────────────────
  if (phase === 'reveal' && result) {
    const iWon = result.correct && result.guesserName === myName;
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 gap-6 text-center">
        <div className={`w-24 h-24 rounded-full flex items-center justify-center ${result.correct ? 'bg-green-500/20' : 'bg-white/5'}`}>
          {result.correct
            ? (iWon ? <Trophy className="w-12 h-12 text-amber-400" /> : <Frown className="w-12 h-12 text-white/60" />)
            : <Music className="w-12 h-12 text-white/60" />}
        </div>
        <div>
          {result.correct
            ? <p className={`text-2xl font-black ${iWon ? 'text-green-400' : 'text-white'}`}>
                {iWon ? `+${result.points} pts!` : `${result.guesserName} got it`}
              </p>
            : <p className="text-white/60 text-xl">No one got it</p>
          }
        </div>
        <div className="bg-white/5 rounded-2xl p-5 w-full">
          <p className="text-white/40 text-sm mb-1">The song was</p>
          <p className="text-white font-black text-xl">{result.songTitle}</p>
          <p className="text-white/60">{result.artist}</p>
        </div>
        <div className="bg-white/5 rounded-2xl px-8 py-4">
          <p className="text-3xl font-black text-white">{myScore.toLocaleString()}</p>
          <p className="text-white/40 text-sm">your score</p>
        </div>
      </div>
    );
  }

  // ─── Leaderboard / Finished ───────────────────────────────────────────────
  if (phase === 'leaderboard' || phase === 'finished') {
    const myEntry = leaderboard.find(e => e.name === myName);
    return (
      <div className="min-h-screen flex flex-col p-6 gap-4">
        <h2 className="text-3xl font-black text-white text-center">
          {phase === 'finished' ? 'Final Scores' : 'Leaderboard'}
        </h2>
        {myEntry && (
          <div className="bg-purple-600/30 border border-purple-500/40 rounded-2xl px-6 py-3 text-center">
            <p className="text-white/60 text-sm">You're #{myEntry.rank}</p>
            <p className="text-white font-black text-2xl">{myScore.toLocaleString()} pts</p>
          </div>
        )}
        <div className="flex-1 space-y-3">
          {leaderboard.slice(0, 10).map(e => (
            <div key={e.name} className={`flex items-center gap-4 px-4 py-3 rounded-xl ${e.name === myName ? 'bg-purple-600/20 border border-purple-500/40' : 'bg-white/5'}`}>
              <span className="w-8 flex justify-center">
                <RankBadge rank={e.rank} />
              </span>
              <span className="text-white font-bold flex-1">{e.name}</span>
              <span className="text-white/60 font-semibold">{e.score.toLocaleString()}</span>
            </div>
          ))}
        </div>
        {phase === 'leaderboard' && <p className="text-center text-white/30 text-sm">Waiting for the host to start the next round…</p>}
        {phase === 'finished' && (
          <button onClick={() => window.location.href = '/'}
            className="w-full py-4 rounded-2xl bg-white/10 text-white font-bold text-xl hover:bg-white/20 transition-colors">
            Play Again
          </button>
        )}
      </div>
    );
  }

  return null;
}
