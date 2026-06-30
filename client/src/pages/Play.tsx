import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Music, ChevronLeft, ChevronRight, ArrowLeft, Flame, Pencil } from 'lucide-react';
import { socket } from '../socket';
import { RankBadge } from '../components/RankBadge';
import { RevealStatusHeader, RevealSongCard } from '../components/RevealShared';
import { APP_NAME, BID_OPTIONS } from '../config';
import type { Hint, LeaderboardEntry, RoundResultEvent } from '../types';

type Phase =
  | 'join' | 'waiting' | 'betting' | 'bid_submitted'
  | 'watching' | 'guessing' | 'passed' | 'reveal' | 'leaderboard' | 'finished';

export interface PlayState {
  phase: Phase;
  pin: string;
  name: string;
  myName: string;
  error: string;
  roundIndex: number;
  totalRounds: number;
  hints: Hint[];
  timeLeft: number;
  bettingTime: number;
  bidIndex: number;
  myBid: number;
  guesserNames: string[];
  lowestBid: number;
  guessText: string;
  result: RoundResultEvent | null;
  myScore: number;
  myStreak: number;
  mode: 'classic' | 'race';
  artistOnly: boolean;
  myRacePoints: number;
  myRaceTimeMs: number | null;
  leaderboard: LeaderboardEntry[];
  reconnecting: boolean;
  hostReconnecting: boolean;
  savedSession: { pin: string; name: string } | null;
  guessInputRef: React.RefObject<HTMLInputElement | null>;
  setPin: (v: string) => void;
  setName: (v: string) => void;
  setBidIndex: (i: number | ((prev: number) => number)) => void;
  setGuessText: (v: string) => void;
  join: () => void;
  rejoinSaved: () => void;
  submitBid: () => void;
  submitGuess: () => void;
  skipGuess: () => void;
  newGamePin: string | null;
  rejoinNewGame: () => void;
  renamePlayer: (newName: string) => void;
}

function usePlayGame(pinParam?: string): PlayState {
  const [phase, setPhase] = useState<Phase>('join');
  const [pin, setPin] = useState(pinParam ?? '');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [myName, setMyName] = useState('');
  const myNameRef = useRef('');
  const pinRef = useRef('');
  const [roundIndex, setRoundIndex] = useState(0);
  const [totalRounds, setTotalRounds] = useState(10);
  const [hints, setHints] = useState<Hint[]>([]);
  const [timeLeft, setTimeLeft] = useState(0);
  const [bettingTime, setBettingTime] = useState(15);
  const [bidIndex, setBidIndex] = useState(4); // default: 2s (index 4)
  const bidIndexRef = useRef(4);
  const [myBid, setMyBid] = useState(0);
  const [guesserNames, setGuesserNames] = useState<string[]>([]);
  const [lowestBid, setLowestBid] = useState(0);
  const [guessText, setGuessText] = useState('');
  const [result, setResult] = useState<RoundResultEvent | null>(null);
  const [myScore, setMyScore] = useState(0);
  const [myStreak, setMyStreak] = useState(0);
  const [mode, setMode] = useState<'classic' | 'race'>('classic');
  const modeRef = useRef<'classic' | 'race'>('classic');
  const [artistOnly, setArtistOnly] = useState(false);
  const [myRacePoints, setMyRacePoints] = useState(0);
  const [myRaceTimeMs, setMyRaceTimeMs] = useState<number | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [reconnecting, setReconnecting] = useState(false);
  const [hostReconnecting, setHostReconnecting] = useState(false);
  const [newGamePin, setNewGamePin] = useState<string | null>(null);
  const newGamePinRef = useRef<string | null>(null);
  const [savedSession, setSavedSession] = useState<{ pin: string; name: string } | null>(() => {
    try { return JSON.parse(localStorage.getItem('versed_session') ?? 'null'); }
    catch { return null; }
  });
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoSubmitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const guessAutoSubmitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bidSubmittedRef = useRef(false);
  const guessInputRef = useRef<HTMLInputElement>(null);
  const guessTextRef = useRef('');

  function autoSubmitGuess() {
    guessAutoSubmitTimerRef.current = null;
    const text = guessTextRef.current.trim();
    stopCountdown();
    if (text) {
      socket.emit('submit_guess', { text }, (r: { correct: boolean; points?: number; timeMs?: number }) => {
        if (modeRef.current === 'race') {
          if (r.correct && r.points != null) setMyRacePoints(r.points);
          if (r.timeMs != null) setMyRaceTimeMs(r.timeMs);
        }
        setPhase('passed');
      });
    } else {
      socket.emit('skip_guess');
      setPhase('passed');
    }
    guessTextRef.current = '';
    setGuessText('');
  }

  function autoSubmitBid() {
    if (bidSubmittedRef.current) return;
    bidSubmittedRef.current = true;
    const seconds = BID_OPTIONS[bidIndexRef.current];
    setMyBid(seconds);
    setPhase('bid_submitted');
    socket.emit('submit_bid', { seconds }, (res?: { ok: boolean }) => {
      if (res && !res.ok) {
        setError("That didn't go through — try again.");
        setPhase('betting');
      }
    });
  }

  function startCountdown(endsAt: number) {
    stopCountdown();
    const tick = () => {
      const remaining = Math.ceil(Math.max(0, endsAt - Date.now()) / 1000);
      setTimeLeft(remaining);
      if (remaining <= 0) stopCountdown();
    };
    tick();
    timerRef.current = setInterval(tick, 500);
  }

  function stopCountdown() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }

  useEffect(() => {
    socket.connect();

    // After any reconnect, re-attach this socket to the game so bids/guesses
    // aren't silently dropped (the new socket id is a stranger otherwise).
    socket.on('connect', () => {
      setReconnecting(false);
      if (myNameRef.current && pinRef.current) {
        socket.emit('rejoin_player', { pin: pinRef.current, name: myNameRef.current }, (res?: { ok: boolean }) => {
          if (res && !res.ok) {
            myNameRef.current = '';
            pinRef.current = '';
            setSavedSession(null);
            localStorage.removeItem('versed_session');
            setError('Game has ended.');
            setPhase('join');
          }
        });
      }
    });

    socket.on('disconnect', (reason: string) => {
      if (reason !== 'io client disconnect') setReconnecting(true);
    });

    socket.on('round_start', (data: {
      roundIndex: number; total: number;
      hints: Hint[]; bettingTime?: number; endsAt?: number;
      mode?: 'classic' | 'race'; raceTime?: number; artistOnly?: boolean;
    }) => {
      setRoundIndex(data.roundIndex);
      setTotalRounds(data.total);
      setHints(data.hints);
      guessTextRef.current = '';
      setGuessText('');
      setResult(null);
      setError('');
      setMyRacePoints(0);
      setMyRaceTimeMs(null);
      bidSubmittedRef.current = false;
      if (autoSubmitTimerRef.current) clearTimeout(autoSubmitTimerRef.current);
      if (guessAutoSubmitTimerRef.current) { clearTimeout(guessAutoSubmitTimerRef.current); guessAutoSubmitTimerRef.current = null; }

      const roundMode = data.mode === 'race' ? 'race' : 'classic';
      setMode(roundMode);
      modeRef.current = roundMode;
      setArtistOnly(data.artistOnly === true);

      if (roundMode === 'race') {
        setGuesserNames([]);
        setPhase('watching');
      } else {
        setBettingTime(data.bettingTime ?? 15);
        const endsAt = data.endsAt ?? (Date.now() + (data.bettingTime ?? 15) * 1000);
        autoSubmitTimerRef.current = setTimeout(autoSubmitBid, endsAt - Date.now());
        startCountdown(endsAt);
        setPhase('betting');
      }
    });

    socket.on('betting_closed', (data: { lowestBid: number; guesserNames: string[] }) => {
      stopCountdown();
      setLowestBid(data.lowestBid);
      setGuesserNames(data.guesserNames);
      setPhase('watching');
    });

    socket.on('guessing_start', (data: { guesserNames: string[]; timeLimit: number; endsAt?: number }) => {
      setGuesserNames(data.guesserNames);
      startCountdown(data.endsAt ?? (Date.now() + data.timeLimit * 1000));
    });

    socket.on('your_turn', (data: { timeLimit: number; endsAt?: number }) => {
      const endsAt = data.endsAt ?? (Date.now() + data.timeLimit * 1000);
      startCountdown(endsAt);
      setPhase('guessing');
      setTimeout(() => guessInputRef.current?.focus(), 100);
      if (guessAutoSubmitTimerRef.current) clearTimeout(guessAutoSubmitTimerRef.current);
      guessAutoSubmitTimerRef.current = setTimeout(autoSubmitGuess, Math.max(0, endsAt - Date.now()));
    });

    socket.on('round_result', (data: RoundResultEvent) => {
      stopCountdown();
      if (guessAutoSubmitTimerRef.current) { clearTimeout(guessAutoSubmitTimerRef.current); guessAutoSubmitTimerRef.current = null; }
      setResult(data);
      setPhase('reveal');
    });

    socket.on('score_update', ({ players }: { players: { name: string; score: number; streak: number }[] }) => {
      const me = players.find(p => p.name === myNameRef.current);
      if (me) { setMyScore(me.score); setMyStreak(me.streak); }
    });

    socket.on('leaderboard', ({ leaderboard: lb }: { leaderboard: LeaderboardEntry[] }) => {
      setLeaderboard(lb);
      setPhase('leaderboard');
    });

    socket.on('game_over', ({ leaderboard: lb }: { leaderboard: LeaderboardEntry[] }) => {
      setLeaderboard(lb);
      setPhase('finished');
    });

    socket.on('host_reconnecting', () => {
      setHostReconnecting(true);
    });

    socket.on('host_reconnected', () => {
      setHostReconnecting(false);
    });

    socket.on('host_disconnected', () => {
      setHostReconnecting(false);
      stopCountdown();
      setError('Host disconnected.');
      setPhase('join');
    });

    socket.on('kicked', () => {
      stopCountdown();
      setSavedSession(null);
      localStorage.removeItem('versed_session');
      setError('You were removed from the lobby.');
      setPhase('join');
    });

    socket.on('game_restarted', ({ newPin }: { newPin: string }) => {
      newGamePinRef.current = newPin;
      setNewGamePin(newPin);
    });

    return () => {
      stopCountdown();
      if (autoSubmitTimerRef.current) clearTimeout(autoSubmitTimerRef.current);
      if (guessAutoSubmitTimerRef.current) clearTimeout(guessAutoSubmitTimerRef.current);
      ['connect','disconnect','round_start','betting_closed','guessing_start','your_turn',
       'round_result','score_update','leaderboard','game_over',
       'host_reconnecting','host_reconnected','host_disconnected','game_restarted','kicked']
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
      if (success) {
        myNameRef.current = n; pinRef.current = p; setMyName(n); setPhase('waiting');
        const session = { pin: p, name: n };
        setSavedSession(session);
        localStorage.setItem('versed_session', JSON.stringify(session));
      }
    });
  };

  const rejoinSaved = () => {
    if (!savedSession) return;
    const { pin: p, name: n } = savedSession;
    setError('');
    socket.emit('join_game', { pin: p, name: n }, ({ success, error: e }: { success?: boolean; error?: string }) => {
      if (e) {
        setError(e);
        setSavedSession(null);
        localStorage.removeItem('versed_session');
        return;
      }
      if (success) { myNameRef.current = n; pinRef.current = p; setMyName(n); setPin(p); setName(n); setPhase('waiting'); }
    });
  };

  const submitBid = () => {
    if (bidSubmittedRef.current) return;
    bidSubmittedRef.current = true;
    if (autoSubmitTimerRef.current) { clearTimeout(autoSubmitTimerRef.current); autoSubmitTimerRef.current = null; }
    const seconds = BID_OPTIONS[bidIndex];
    setError('');
    setMyBid(seconds);
    setPhase('bid_submitted');
    socket.emit('submit_bid', { seconds }, (res?: { ok: boolean }) => {
      // Bid didn't register (e.g. mid-reconnect) — don't strand the player on
      // "waiting for others"; drop them back so they can lock in again.
      if (res && !res.ok) {
        bidSubmittedRef.current = false;
        setError("That didn't go through - try again.");
        setPhase('betting');
      }
    });
  };

  const submitGuess = () => {
    if (!guessText.trim()) return;
    if (guessAutoSubmitTimerRef.current) { clearTimeout(guessAutoSubmitTimerRef.current); guessAutoSubmitTimerRef.current = null; }
    stopCountdown();
    socket.emit('submit_guess', { text: guessText }, (r: { correct: boolean; points?: number; timeMs?: number }) => {
      if (modeRef.current === 'race') {
        if (r.correct && r.points != null) setMyRacePoints(r.points);
        if (r.timeMs != null) setMyRaceTimeMs(r.timeMs);
        setPhase('passed');
      } else if (!r.correct) {
        setPhase('passed');
      }
    });
  };

  const skipGuess = () => {
    if (guessAutoSubmitTimerRef.current) { clearTimeout(guessAutoSubmitTimerRef.current); guessAutoSubmitTimerRef.current = null; }
    stopCountdown();
    socket.emit('skip_guess');
    setPhase('passed');
  };

  const rejoinNewGame = () => {
    const newPin = newGamePinRef.current;
    const n = myNameRef.current;
    if (!newPin || !n) return;
    setError('');
    socket.emit('join_game', { pin: newPin, name: n }, ({ success, error: e }: { success?: boolean; error?: string }) => {
      if (e) { setError(e); return; }
      if (success) {
        pinRef.current = newPin;
        setPin(newPin);
        newGamePinRef.current = null;
        setNewGamePin(null);
        const session = { pin: newPin, name: n };
        setSavedSession(session);
        localStorage.setItem('versed_session', JSON.stringify(session));
        setLeaderboard([]);
        setResult(null);
        setPhase('waiting');
      }
    });
  };

  const renamePlayer = (newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    socket.emit('rename_player', { newName: trimmed }, ({ success, error: e }: { success?: boolean; error?: string }) => {
      if (e) { setError(e); return; }
      if (success) {
        myNameRef.current = trimmed;
        setMyName(trimmed);
        setError('');
        const session = { pin: pinRef.current, name: trimmed };
        setSavedSession(session);
        localStorage.setItem('versed_session', JSON.stringify(session));
      }
    });
  };

  return {
    phase, pin, name, myName, error, roundIndex, totalRounds, hints,
    timeLeft, bettingTime, bidIndex, myBid, guesserNames, lowestBid,
    guessText, result, myScore, myStreak, mode, artistOnly, myRacePoints, myRaceTimeMs,
    leaderboard, reconnecting, hostReconnecting, savedSession, guessInputRef,
    newGamePin, rejoinNewGame,
    setPin, setName,
  setBidIndex: (i: number | ((prev: number) => number)) => {
    setBidIndex(prev => {
      const next = typeof i === 'function' ? i(prev) : i;
      bidIndexRef.current = next;
      return next;
    });
  },
  setGuessText: (v: string) => { guessTextRef.current = v; setGuessText(v); },
    join, rejoinSaved, submitBid, submitGuess, skipGuess, renamePlayer,
  };
}

// ─── Phase views ─────────────────────────────────────────────────────────────

function JoinView({ game }: Readonly<{ game: PlayState }>) {
  const { pin, name, error, savedSession, setPin, setName, join, rejoinSaved } = game;
  const navigate = useNavigate();
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 gap-5">
      <button onClick={() => navigate('/')} className="absolute top-5 left-5 p-2 rounded-xl bg-white/10 text-white/60 hover:bg-white/20 hover:text-white transition-colors">
        <ArrowLeft className="w-5 h-5" />
      </button>
      <img src={`${import.meta.env.BASE_URL}logo.png`} alt={APP_NAME} className="h-48 w-auto" />

      {savedSession && (
        <div className="w-full max-w-xs">
          <button onClick={rejoinSaved}
            className="w-full py-4 rounded-2xl bg-purple-600 text-white font-bold text-xl hover:bg-purple-500 transition-colors">
            Rejoin as {savedSession.name}
          </button>
          <p className="text-white/30 text-xs text-center mt-2">PIN {savedSession.pin}</p>
        </div>
      )}

      <div className="w-full max-w-xs flex flex-col gap-3">
        {savedSession && <p className="text-white/30 text-xs text-center">— or join a different game —</p>}
        <input type="text" inputMode="numeric" pattern="[0-9]*" placeholder="Game PIN"
          value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} maxLength={3}
          className="w-full px-4 py-4 rounded-xl bg-white/10 text-white text-center text-2xl font-bold placeholder-white/30 outline-none focus:ring-2 focus:ring-white/30 tracking-widest" />
        <input type="text" placeholder="Your name"
          value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && join()} maxLength={20}
          className="w-full px-4 py-4 rounded-xl bg-white/10 text-white text-center text-xl placeholder-white/30 outline-none focus:ring-2 focus:ring-white/30" />
        {error && <p className="text-red-400 text-sm text-center">{error}</p>}
        <button onClick={join} disabled={!pin.trim() || !name.trim()}
          className="w-full py-4 rounded-2xl bg-white/10 text-white font-bold text-xl disabled:opacity-30 hover:bg-white/20 transition-colors">
          Join
        </button>
      </div>
    </div>
  );
}

function WaitingView({ game }: Readonly<{ game: PlayState }>) {
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState('');

  const startEdit = () => { setDraftName(game.myName); setEditing(true); };
  const cancelEdit = () => { setEditing(false); };
  const confirmEdit = () => {
    if (!draftName.trim() || draftName.trim() === game.myName) { setEditing(false); return; }
    game.renamePlayer(draftName);
    setEditing(false);
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6">
      <div className="w-12 h-12 border-4 border-purple-500 border-t-transparent rounded-full animate-spin" />
      {editing ? (
        <div className="flex flex-col items-center gap-2 w-full max-w-xs">
          <input
            autoFocus
            type="text"
            value={draftName}
            onChange={e => setDraftName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') confirmEdit(); else if (e.key === 'Escape') cancelEdit(); }}
            maxLength={20}
            className="w-full px-4 py-3 rounded-xl bg-white/10 text-white text-center text-xl placeholder-white/30 outline-none focus:ring-2 focus:ring-white/30"
          />
          {game.error && <p className="text-red-400 text-sm">{game.error}</p>}
          <div className="flex gap-2 w-full">
            <button onClick={cancelEdit} className="flex-1 py-2 rounded-xl bg-white/10 text-white/60 hover:bg-white/20 transition-colors text-sm">Cancel</button>
            <button onClick={confirmEdit} disabled={!draftName.trim()} className="flex-1 py-2 rounded-xl bg-purple-600 text-white font-bold hover:bg-purple-500 transition-colors text-sm disabled:opacity-30">Save</button>
          </div>
        </div>
      ) : (
        <button onClick={startEdit} className="flex items-center gap-2 text-white text-xl font-bold hover:text-white/80 transition-colors group">
          {game.myName}
          <Pencil className="w-4 h-4 text-white/30 group-hover:text-white/60 transition-colors" />
        </button>
      )}
      <p className="text-white/50">You're in! Hang tight…</p>
    </div>
  );
}

export function BettingView({ game }: Readonly<{ game: PlayState }>) {
  const { roundIndex, totalRounds, timeLeft, bettingTime, hints, bidIndex, myScore, error, submitBid, setBidIndex } = game;
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
        <div className="flex flex-col items-center gap-6">
          {hints.find(h => h.imageUrl)?.imageUrl && (
            <img
              src={hints.find(h => h.imageUrl)!.imageUrl}
              alt="Album art"
              className="w-40 h-40 rounded-3xl object-cover shadow-2xl blur-sm"
            />
          )}
          {hints.some(h => !h.imageUrl) && (
            <div className="flex flex-wrap justify-center gap-8">
              {hints.filter(h => !h.imageUrl).map(h => (
                <div key={h.label} className="flex flex-col items-center gap-1">
                  <span className="text-white/30 text-xs uppercase tracking-[0.2em]">{h.label}</span>
                  <span className="text-white font-black text-3xl">{h.value}</span>
                </div>
              ))}
            </div>
          )}
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

      {error && <p className="text-red-400 text-sm text-center">{error}</p>}

      <button onClick={submitBid}
        className="w-full py-4 rounded-2xl bg-purple-600 text-white font-bold text-xl hover:bg-purple-500 active:scale-95 transition-all">
        Lock In
      </button>
    </div>
  );
}

function BidSubmittedView({ game }: Readonly<{ game: PlayState }>) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-white/50">Your bid</p>
      <p className="text-white font-black text-6xl">{game.myBid}s</p>
      <p className="text-white/40">Waiting for others...</p>
    </div>
  );
}

function GuessInputSection({ guessText, guessInputRef, setGuessText, submitGuess, artistOnly }: Readonly<{
  guessText: string;
  guessInputRef: React.RefObject<HTMLInputElement | null>;
  setGuessText: (v: string) => void;
  submitGuess: () => void;
  artistOnly?: boolean;
}>) {
  return (
    <>
      <div className="flex-1 flex flex-col items-center justify-center gap-6">
        <p className="text-white/60">{artistOnly ? 'Name the artist' : 'Name the song'}</p>
        <input
          ref={guessInputRef}
          type="text"
          placeholder={artistOnly ? 'Type artist name...' : 'Type song title...'}
          value={guessText}
          onChange={e => setGuessText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submitGuess()}
          className="w-full px-4 py-4 rounded-xl bg-white/10 text-white text-center text-xl placeholder-white/30 outline-none focus:ring-2 focus:ring-purple-500"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />
      </div>
      <button onClick={submitGuess} disabled={!guessText.trim()}
        className="w-full py-4 rounded-2xl bg-purple-600 text-white font-bold text-xl disabled:opacity-30 hover:bg-purple-500 active:scale-95 transition-all">
        Submit
      </button>
    </>
  );
}

function WatchingView({ game }: Readonly<{ game: PlayState }>) {
  const { lowestBid, guesserNames, mode } = game;

  if (mode === 'race') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
        <Music className="w-14 h-14 text-white animate-pulse" />
        <p className="text-white font-black text-2xl">Get ready…</p>
        <p className="text-white/30 text-sm">Song starts soon — everyone guesses at once</p>
      </div>
    );
  }

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

// Handles both the "listening" sub-phase (watching, imGuessing) and the active
// guessing phase. Keeping a single component across both states means the input
// element is never unmounted — focus and text survive the transition, which
// prevents the mobile keyboard from dismissing mid-song.
function GuessingView({ game }: Readonly<{ game: PlayState }>) {
  const { phase, timeLeft, myScore, guessText, guessInputRef, setGuessText, submitGuess, skipGuess, artistOnly } = game;
  const isListening = phase === 'watching';
  return (
    <div className="min-h-screen flex flex-col p-5 gap-4">
      {isListening ? (
        <div className="flex justify-center items-center gap-2">
          <Music className="w-4 h-4 text-white/40 animate-pulse" />
          <span className="text-white/40 text-sm">Listening...</span>
        </div>
      ) : (
        <div className="flex justify-between items-center">
          <span className="text-white/50 text-sm">Your turn!</span>
          <span className="text-white font-black text-2xl">{timeLeft}s</span>
          <span className="text-white/50 text-sm">{myScore.toLocaleString()} pts</span>
        </div>
      )}
      <GuessInputSection guessText={guessText} guessInputRef={guessInputRef} setGuessText={setGuessText} submitGuess={submitGuess} artistOnly={artistOnly} />
      <button onClick={skipGuess}
        className="w-full py-3 rounded-2xl bg-white/5 text-white/50 font-semibold hover:bg-white/10 active:scale-95 transition-all">
        Skip, I don't know
      </button>
    </div>
  );
}

function PassedView({ game }: Readonly<{ game: PlayState }>) {
  const { mode, myRacePoints, myRaceTimeMs } = game;
  if (mode === 'race') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
        {myRacePoints > 0 ? (
          <>
            <p className="text-green-400 font-black text-2xl">Locked in!</p>
            <p className="text-white/50">
              {myRaceTimeMs !== null && `${(myRaceTimeMs / 1000).toFixed(1)}s`}
              {myRacePoints > 0 && ` · +${myRacePoints} pts`}
            </p>
          </>
        ) : (
          <p className="text-white/50 text-xl">Waiting for others…</p>
        )}
      </div>
    );
  }
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-white/50 text-xl">Waiting for others…</p>
    </div>
  );
}

export function RevealView({ game, result }: Readonly<{ game: PlayState; result: RoundResultEvent }>) {
  const { myName, myScore, myStreak, myRacePoints, myRaceTimeMs } = game;
  const isRace = result.mode === 'race';
  const iGotItInRace = isRace && !!result.correctGuessers?.includes(myName);
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 gap-6 text-center">
      <RevealStatusHeader result={result} myName={myName} />
      <RevealSongCard result={result} />
      {result.playerGuesses && result.playerGuesses.length > 0 && (
        <div className="bg-white/5 rounded-2xl p-4 w-full space-y-1.5">
          {result.playerGuesses.map(g => (
            <div key={g.name} className="flex justify-between items-center gap-4">
              <span className="text-white/50 text-sm shrink-0">{g.name}</span>
              {(() => {
                const skipped = g.guess === null;
                const correct = isRace
                  ? !!result.correctGuessers?.includes(g.name)
                  : (result.correct && g.name === result.guesserName);
                let cls = 'text-white/40';
                if (skipped) cls = 'text-white/25 italic';
                else if (correct) cls = 'text-green-400';
                return (
                  <span className={`text-sm text-right truncate ${cls}`}>
                    {skipped ? 'skipped' : `"${g.guess}"`}
                    {correct && g.timeMs != null && (
                      <span className="ml-1.5 text-white/30 text-xs">{(g.timeMs / 1000).toFixed(1)}s</span>
                    )}
                  </span>
                );
              })()}
            </div>
          ))}
        </div>
      )}
      <div className="bg-white/5 rounded-2xl px-8 py-4">
        <p className="text-3xl font-black text-white">{myScore.toLocaleString()}</p>
        <p className="text-white/40 text-sm">your score</p>
        {iGotItInRace && myRaceTimeMs != null && (
          <p className="text-green-400 text-xs font-semibold mt-1">
            You got it in {(myRaceTimeMs / 1000).toFixed(1)}s · +{myRacePoints}
          </p>
        )}
        {myStreak >= 2 && (
          <p className="flex items-center justify-center gap-1 text-orange-400 text-xs font-bold mt-1">
            <Flame className="w-3 h-3" />{myStreak} in a row
          </p>
        )}
      </div>
    </div>
  );
}

function LeaderboardView({ game }: Readonly<{ game: PlayState }>) {
  const { phase, myName, myScore, leaderboard, newGamePin, rejoinNewGame } = game;
  const navigate = useNavigate();
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
      {phase === 'finished' && newGamePin && (
        <div className="space-y-3">
          <div className="bg-emerald-900/40 border border-emerald-500/40 rounded-2xl px-4 py-3 text-center">
            <p className="text-emerald-300 text-sm font-semibold">Host started a new game!</p>
          </div>
          <button onClick={rejoinNewGame}
            className="w-full py-4 rounded-2xl bg-emerald-600 text-white font-bold text-xl hover:bg-emerald-500 transition-colors">
            Play Again
          </button>
          <button onClick={() => { navigate('/'); }}
            className="w-full py-3 rounded-2xl bg-white/10 text-white/60 font-semibold text-base hover:bg-white/20 transition-colors">
            Leave
          </button>
        </div>
      )}
      {phase === 'finished' && !newGamePin && (
        <button onClick={() => { navigate('/'); }}
          className="w-full py-4 rounded-2xl bg-white/10 text-white font-bold text-xl hover:bg-white/20 transition-colors">
          Leave
        </button>
      )}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Play() {
  const { pin: pinParam } = useParams<{ pin?: string }>();
  const game = usePlayGame(pinParam);
  const { phase, result, reconnecting, hostReconnecting, guesserNames, myName } = game;
  const imGuessing = guesserNames.includes(myName);

  return (
    <div className="relative">
      {phase === 'join' && <JoinView game={game} />}
      {phase === 'waiting' && <WaitingView game={game} />}
      {phase === 'betting' && <BettingView game={game} />}
      {phase === 'bid_submitted' && <BidSubmittedView game={game} />}
      {phase === 'watching' && !imGuessing && <WatchingView game={game} />}
      {(phase === 'guessing' || (phase === 'watching' && imGuessing)) && <GuessingView game={game} />}
      {phase === 'passed' && <PassedView game={game} />}
      {phase === 'reveal' && result && <RevealView game={game} result={result} />}
      {(phase === 'leaderboard' || phase === 'finished') && <LeaderboardView game={game} />}

      {reconnecting && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex flex-col items-center justify-center z-50 gap-3">
          <div className="w-10 h-10 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          <p className="text-white/70 text-sm font-medium">Reconnecting...</p>
        </div>
      )}
      {hostReconnecting && !reconnecting && (
        <div className="fixed bottom-5 right-5 flex items-center gap-2 bg-white/8 backdrop-blur-sm rounded-full px-3 py-1.5 z-40">
          <span className="w-1.5 h-1.5 rounded-full bg-white/50 animate-pulse" />
          <p className="text-white/50 text-xs">Host reconnecting</p>
        </div>
      )}
    </div>
  );
}
