import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Flame, Pencil } from 'lucide-react';
import LiquidGlass from 'liquid-glass-react';
import { socket } from '../socket';
import { RankBadge } from '../components/RankBadge';
import { useAnimatedScore } from '../hooks/useAnimatedScore';
import { useKeyboardOpen } from '../hooks/useViewportHeight';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { NoOneGotItCardContent, GotItCardContent, YearTimelineContent } from '../components/RevealShared';
import { RoundIntro, PartyBadge, PartyRevealExtras } from '../components/RoundIntro';
import { BackButton } from '../components/BackButton';
import { CircularTimer, timerColor } from '../components/CircularTimer';
import { AudioBars } from '../components/AudioBars';
import { LIQUID_CARD_PROPS, LIQUID_PILL_PROPS } from '../components/liquidGlassPresets';
import { APP_NAME, BID_OPTIONS } from '../config';
import { commonPhaseAnnouncement } from '../utils/phaseAnnouncement';
import type { Hint, LeaderboardEntry, PartyInfo, RoundResultEvent } from '../types';

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
  timerTotal: number;
  bettingTime: number;
  bidIndex: number;
  bidOptions: number[];
  bidScores: number[] | null;
  myBid: number;
  guesserNames: string[];
  lowestBid: number;
  guessText: string;
  result: RoundResultEvent | null;
  myScore: number;
  myScoreDelta: number;
  myStreak: number;
  mode: 'classic' | 'race';
  artistOnly: boolean;
  yearOnly: boolean;
  party: PartyInfo | null;
  artistGuessText: string;
  stealVictims: { name: string; score: number }[] | null;
  stealResult: { thief: string; victim: string; amount: number; skipped?: boolean } | null;
  myRacePoints: number;
  myRaceTimeMs: number | null;
  leaderboard: LeaderboardEntry[];
  leaderboardDeltas: Record<string, number>;
  songPlaying: boolean;
  songTempo: number | null;
  reconnecting: boolean;
  hostReconnecting: boolean;
  savedSession: { pin: string; name: string } | null;
  guessInputRef: React.RefObject<HTMLInputElement | null>;
  cameFromQR: boolean;
  setPin: (v: string) => void;
  setName: (v: string) => void;
  setBidIndex: (i: number | ((prev: number) => number)) => void;
  setGuessText: (v: string) => void;
  setArtistGuessText: (v: string) => void;
  submitStealVictim: (name: string) => void;
  skipSteal: () => void;
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
  const cameFromQR = !!pinParam;
  const [pin, setPin] = useState(pinParam ?? '');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [myName, setMyName] = useState('');
  const myNameRef = useRef('');
  const pinRef = useRef(pinParam ?? '');
  const [roundIndex, setRoundIndex] = useState(0);
  const [totalRounds, setTotalRounds] = useState(10);
  const [hints, setHints] = useState<Hint[]>([]);
  const [timeLeft, setTimeLeft] = useState(0);
  const [timerTotal, setTimerTotal] = useState(0);
  const [bettingTime, setBettingTime] = useState(15);
  const [bidIndex, setBidIndex] = useState(4); // default: 2s (index 4)
  const bidIndexRef = useRef(4);
  // The server is the source of truth for the bid ladder and its point values
  // (sent with each classic round_start); the local constant is only a
  // fallback until the first round arrives.
  const [bidOptions, setBidOptions] = useState<number[]>(BID_OPTIONS);
  const bidOptionsRef = useRef<number[]>(BID_OPTIONS);
  const [bidScores, setBidScores] = useState<number[] | null>(null);
  const [myBid, setMyBid] = useState(0);
  const [guesserNames, setGuesserNames] = useState<string[]>([]);
  const [lowestBid, setLowestBid] = useState(0);
  const [guessText, setGuessText] = useState('');
  const [result, setResult] = useState<RoundResultEvent | null>(null);
  const [myScore, setMyScore] = useState(0);
  const myScoreRef = useRef(0);
  const [myScoreDelta, setMyScoreDelta] = useState(0);
  const [myStreak, setMyStreak] = useState(0);
  const [mode, setMode] = useState<'classic' | 'race'>('classic');
  const modeRef = useRef<'classic' | 'race'>('classic');
  const [artistOnly, setArtistOnly] = useState(false);
  const [yearOnly, setYearOnly] = useState(false);
  const [party, setParty] = useState<PartyInfo | null>(null);
  const partyRef = useRef<PartyInfo | null>(null);
  const [artistGuessText, setArtistGuessText] = useState('');
  const artistGuessTextRef = useRef('');
  const [stealVictims, setStealVictims] = useState<{ name: string; score: number }[] | null>(null);
  const [stealResult, setStealResult] = useState<{ thief: string; victim: string; amount: number; skipped?: boolean } | null>(null);
  const [myRacePoints, setMyRacePoints] = useState(0);
  const [myRaceTimeMs, setMyRaceTimeMs] = useState<number | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const leaderboardRef = useRef<LeaderboardEntry[]>([]);
  const [leaderboardDeltas, setLeaderboardDeltas] = useState<Record<string, number>>({});
  const [songPlaying, setSongPlaying] = useState(false);
  const [songTempo, setSongTempo] = useState<number | null>(null);
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
    guessInputRef.current?.blur();
    guessAutoSubmitTimerRef.current = null;
    const text = guessTextRef.current.trim();
    const artistText = artistGuessTextRef.current.trim() || undefined;
    stopCountdown();
    if (text) {
      socket.emit('submit_guess', { text, artistText }, (r: { correct: boolean; points?: number; timeMs?: number }) => {
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
    artistGuessTextRef.current = '';
    setArtistGuessText('');
  }

  function autoSubmitBid() {
    if (bidSubmittedRef.current) return;
    bidSubmittedRef.current = true;
    const seconds = bidOptionsRef.current[bidIndexRef.current];
    setMyBid(seconds);
    setPhase('bid_submitted');
    socket.emit('submit_bid', { seconds }, (res?: { ok: boolean }) => {
      // Only fall back to the betting screen if we're still in the bid flow —
      // the round may have moved on (e.g. host reload parked the game on the
      // leaderboard) by the time this rejection arrives.
      if (res && !res.ok) {
        setError("That didn't go through, try again.");
        setPhase(p => (p === 'bid_submitted' ? 'betting' : p));
      }
    });
  }

  function startCountdown(endsAt: number) {
    stopCountdown();
    setTimerTotal(Math.max(1, Math.ceil((endsAt - Date.now()) / 1000)));
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
    setTimeLeft(0);
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
      } else {
        try {
          const saved = JSON.parse(localStorage.getItem('versed_session') ?? 'null');
          if (saved?.pin) {
            socket.emit('check_game', { pin: saved.pin }, ({ exists }: { exists: boolean }) => {
              if (!exists) {
                setSavedSession(null);
                localStorage.removeItem('versed_session');
              }
            });
          }
        } catch { /* ignore */ }
      }
    });

    socket.on('disconnect', (reason: string) => {
      if (reason !== 'io client disconnect') setReconnecting(true);
    });

    socket.on('round_start', (data: {
      roundIndex: number; total: number;
      hints: Hint[]; bettingTime?: number; endsAt?: number;
      mode?: 'classic' | 'race'; raceTime?: number; artistOnly?: boolean; yearOnly?: boolean;
      party?: PartyInfo;
      bidOptions?: number[]; bidScores?: number[];
      tempo?: number | null;
    }) => {
      setRoundIndex(data.roundIndex);
      setTotalRounds(data.total);
      setHints(data.hints);
      setSongTempo(data.tempo ?? null);
      guessTextRef.current = '';
      setGuessText('');
      artistGuessTextRef.current = '';
      setArtistGuessText('');
      setResult(null);
      setMyScoreDelta(0);
      setError('');
      setMyRacePoints(0);
      setMyRaceTimeMs(null);
      setParty(data.party ?? null);
      partyRef.current = data.party ?? null;
      setStealVictims(null);
      setStealResult(null);
      bidSubmittedRef.current = false;
      if (autoSubmitTimerRef.current) clearTimeout(autoSubmitTimerRef.current);
      if (guessAutoSubmitTimerRef.current) { clearTimeout(guessAutoSubmitTimerRef.current); guessAutoSubmitTimerRef.current = null; }

      const roundMode = data.mode === 'race' ? 'race' : 'classic';
      setMode(roundMode);
      modeRef.current = roundMode;
      setArtistOnly(data.artistOnly === true);
      setYearOnly(data.yearOnly === true);

      if (roundMode === 'race') {
        setGuesserNames([]);
        setPhase('watching');
      } else {
        if (data.bidOptions?.length) {
          setBidOptions(data.bidOptions);
          bidOptionsRef.current = data.bidOptions;
          bidIndexRef.current = Math.min(bidIndexRef.current, data.bidOptions.length - 1);
          setBidIndex(i => Math.min(i, data.bidOptions!.length - 1));
        }
        if (data.bidScores?.length) setBidScores(data.bidScores);
        setBettingTime(data.bettingTime ?? 15);
        const endsAt = data.endsAt ?? (Date.now() + (data.bettingTime ?? 15) * 1000);
        autoSubmitTimerRef.current = setTimeout(autoSubmitBid, endsAt - Date.now());
        startCountdown(endsAt);
        setPhase('betting');
      }
    });

    socket.on('betting_closed', (data: { lowestBid: number; guesserNames: string[] }) => {
      stopCountdown();
      if (autoSubmitTimerRef.current) { clearTimeout(autoSubmitTimerRef.current); autoSubmitTimerRef.current = null; }
      setSongPlaying(false);
      setLowestBid(data.lowestBid);
      setGuesserNames(data.guesserNames);
      setPhase('watching');
    });

    socket.on('song_playing', () => setSongPlaying(true));

    socket.on('guessing_start', (data: { guesserNames: string[]; timeLimit: number; endsAt?: number }) => {
      setSongPlaying(false);
      setGuesserNames(data.guesserNames);
      startCountdown(data.endsAt ?? (Date.now() + data.timeLimit * 1000));
    });

    socket.on('your_turn', (data: { timeLimit: number; endsAt?: number }) => {
      // Finale spectators just listen along: keep them on the watching screen
      // with the song + timer, no input.
      const p = partyRef.current;
      if (p?.finale && myNameRef.current && !p.duelists.includes(myNameRef.current)) {
        setSongPlaying(true);
        startCountdown(data.endsAt ?? (Date.now() + data.timeLimit * 1000));
        return;
      }
      // Race mode: playback starts the instant everyone's turn begins, so the
      // song is actually playing here. Classic mode: this is a specific tier's
      // guessing turn, which only starts after the host has paused the song.
      setSongPlaying(modeRef.current === 'race');
      const endsAt = data.endsAt ?? (Date.now() + data.timeLimit * 1000);
      startCountdown(endsAt);
      setPhase('guessing');
      // Don't steal focus if the player already jumped into an input while
      // listening (e.g. typing the artist bonus field) — only autofocus the
      // title field when nothing's being typed into yet.
      setTimeout(() => {
        const active = document.activeElement;
        const alreadyTyping = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
        if (!alreadyTyping) guessInputRef.current?.focus();
      }, 100);
      if (guessAutoSubmitTimerRef.current) clearTimeout(guessAutoSubmitTimerRef.current);
      guessAutoSubmitTimerRef.current = setTimeout(autoSubmitGuess, Math.max(0, endsAt - Date.now()));
    });

    socket.on('round_result', (data: RoundResultEvent) => {
      setSongPlaying(false);
      guessInputRef.current?.blur();
      stopCountdown();
      if (guessAutoSubmitTimerRef.current) { clearTimeout(guessAutoSubmitTimerRef.current); guessAutoSubmitTimerRef.current = null; }
      setResult(data);
      setPhase('reveal');
    });

    socket.on('score_update', ({ players }: { players: { name: string; score: number; streak: number }[] }) => {
      const me = players.find(p => p.name === myNameRef.current);
      if (me) {
        setMyScoreDelta(Math.max(0, me.score - myScoreRef.current));
        myScoreRef.current = me.score;
        setMyScore(me.score);
        setMyStreak(me.streak);
      }
    });

    // Reconnect/rejoin state sync — not a round result, so don't touch the delta.
    socket.on('score_sync', ({ score, streak }: { score: number; streak: number }) => {
      myScoreRef.current = score;
      setMyScore(score);
      setMyStreak(streak);
    });

    const applyLeaderboard = (lb: LeaderboardEntry[]) => {
      const deltas: Record<string, number> = {};
      for (const entry of lb) {
        const prev = leaderboardRef.current.find(e => e.name === entry.name);
        deltas[entry.name] = prev ? Math.max(0, entry.score - prev.score) : entry.score;
      }
      setLeaderboardDeltas(deltas);
      leaderboardRef.current = lb;
      setLeaderboard(lb);
    };

    // The game can be parked on the leaderboard mid-round (host reload
    // recovery), so clear any pending bid/guess auto-submit timers here — a
    // late auto-submit would bounce off the server and yank the player back
    // to a dead betting screen.
    const clearRoundTimers = () => {
      stopCountdown();
      if (autoSubmitTimerRef.current) { clearTimeout(autoSubmitTimerRef.current); autoSubmitTimerRef.current = null; }
      if (guessAutoSubmitTimerRef.current) { clearTimeout(guessAutoSubmitTimerRef.current); guessAutoSubmitTimerRef.current = null; }
    };

    socket.on('leaderboard', ({ leaderboard: lb }: { leaderboard: LeaderboardEntry[] }) => {
      clearRoundTimers();
      applyLeaderboard(lb);
      setPhase('leaderboard');
    });

    socket.on('game_over', ({ leaderboard: lb }: { leaderboard: LeaderboardEntry[] }) => {
      clearRoundTimers();
      applyLeaderboard(lb);
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

    // Party steal round: I won and get to pick a victim (list arrives with
    // current scores); everyone sees the outcome.
    socket.on('choose_steal', ({ victims }: { victims: { name: string; score: number }[] }) => {
      setStealVictims(victims);
    });

    socket.on('steal_result', (r: { thief: string; victim: string; amount: number; skipped?: boolean }) => {
      setStealVictims(null);
      setStealResult(r);
    });

    return () => {
      stopCountdown();
      if (autoSubmitTimerRef.current) clearTimeout(autoSubmitTimerRef.current);
      if (guessAutoSubmitTimerRef.current) clearTimeout(guessAutoSubmitTimerRef.current);
      ['connect','disconnect','round_start','betting_closed','song_playing','guessing_start','your_turn',
       'round_result','score_update','score_sync','leaderboard','game_over',
       'host_reconnecting','host_reconnected','host_disconnected','game_restarted','kicked',
       'choose_steal','steal_result']
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
    const seconds = bidOptions[bidIndex];
    setError('');
    setMyBid(seconds);
    setPhase('bid_submitted');
    socket.emit('submit_bid', { seconds }, (res?: { ok: boolean }) => {
      // Bid didn't register (e.g. mid-reconnect) — don't strand the player on
      // "waiting for others"; drop them back so they can lock in again. But
      // only if the game hasn't already moved past the bid flow.
      if (res && !res.ok) {
        bidSubmittedRef.current = false;
        setError("That didn't go through, try again.");
        setPhase(p => (p === 'bid_submitted' ? 'betting' : p));
      }
    });
  };

  const submitGuess = () => {
    if (!guessText.trim()) return;
    guessInputRef.current?.blur();
    if (guessAutoSubmitTimerRef.current) { clearTimeout(guessAutoSubmitTimerRef.current); guessAutoSubmitTimerRef.current = null; }
    stopCountdown();
    const artistText = artistGuessTextRef.current.trim() || undefined;
    socket.emit('submit_guess', { text: guessText, artistText }, (r: { correct: boolean; points?: number; timeMs?: number }) => {
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
    guessInputRef.current?.blur();
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
        leaderboardRef.current = [];
        setLeaderboardDeltas({});
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
    timeLeft, timerTotal, bettingTime, bidIndex, bidOptions, bidScores, myBid, guesserNames, lowestBid,
    guessText, result, myScore, myScoreDelta, myStreak, mode, artistOnly, yearOnly, myRacePoints, myRaceTimeMs,
    party, artistGuessText, stealVictims, stealResult,
    leaderboard, leaderboardDeltas, songPlaying, songTempo, reconnecting, hostReconnecting, savedSession, guessInputRef,
    cameFromQR, newGamePin, rejoinNewGame,
    setPin, setName,
    setArtistGuessText: (v: string) => {
      artistGuessTextRef.current = v;
      setArtistGuessText(v);
    },
    submitStealVictim: (victimName: string) => {
      socket.emit('steal_victim', { name: victimName });
      setStealVictims(null);
    },
    skipSteal: () => {
      socket.emit('skip_steal');
      setStealVictims(null);
    },
  setBidIndex: (i: number | ((prev: number) => number)) => {
    setBidIndex(prev => {
      const next = typeof i === 'function' ? i(prev) : i;
      bidIndexRef.current = next;
      return next;
    });
  },
  setGuessText: (v: string) => {
    guessTextRef.current = v;
    setGuessText(v);
    socket.emit('update_guess_draft', { text: v });
  },
    join, rejoinSaved, submitBid, submitGuess, skipGuess, renamePlayer,
  };
}

function guessTextClass(guess: string | null, correct: boolean): string {
  if (guess === null) return 'text-white/28 italic';
  return correct ? 'text-green-400' : 'text-white/28 italic';
}

function bidArrowStyle(enabled: boolean, pressed: boolean, hovered: boolean): { bg: string; border: string } {
  if (!enabled) return { bg: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.04)' };
  if (pressed) return { bg: 'rgba(158,18,204,0.28)', border: '1px solid rgba(158,18,204,0.5)' };
  if (hovered) return { bg: 'rgba(255,255,255,0.13)', border: '1px solid rgba(255,255,255,0.18)' };
  return { bg: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.10)' };
}

function BidArrow({ direction, enabled, onClick }: Readonly<{ direction: 'left' | 'right'; enabled: boolean; onClick: () => void }>) {
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const { bg, border } = bidArrowStyle(enabled, pressed, hovered);
  return (
    <button
      onClick={() => enabled && onClick()}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setPressed(false); }}
      onMouseDown={() => enabled && setPressed(true)}
      onMouseUp={() => setPressed(false)}
      aria-label={direction === 'left' ? 'Decrease bid time' : 'Increase bid time'}
      disabled={!enabled}
      style={{
        width: 52, height: 52, borderRadius: '50%', border,
        cursor: enabled ? 'pointer' : 'default',
        background: bg,
        opacity: enabled ? 1 : 0.22,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'background 0.15s ease, border-color 0.15s ease, transform 0.1s ease',
        transform: pressed ? 'scale(0.9)' : 'scale(1)',
      }}
    >
      {direction === 'left'
        ? <ChevronLeft className="w-5 h-5 text-white" />
        : <ChevronRight className="w-5 h-5 text-white" />}
    </button>
  );
}

// ─── Phase views ─────────────────────────────────────────────────────────────

function JoinView({ game }: Readonly<{ game: PlayState }>) {
  const { pin, name, error, savedSession, cameFromQR, setPin, setName, join, rejoinSaved } = game;
  const [joinHovered, setJoinHovered] = useState(false);
  const [pinFocused, setPinFocused] = useState(false);
  const [nameFocused, setNameFocused] = useState(false);
  const canJoin = cameFromQR ? name.trim().length > 0 : (pin.length === 3 && name.trim().length > 0);
  const keyboardOpen = useKeyboardOpen();

  return (
    <div
      className="page-enter relative min-h-screen keyboard-resize"
      style={{ zIndex: 1, overflowY: 'auto' }}
    >
      <BackButton />

      {/* minHeight (not height) lets this grow past the viewport instead of
          fighting it for space — centered when it fits, top-to-bottom
          scrollable overflow (no Safari "unreachable centered overflow"
          quirk) when the keyboard shrinks the viewport past what fits.
          Centering splits that overflow between top and bottom though, which
          traps the Join button under the keyboard with no way to scroll to
          it — so once a field is focused, align to the top instead, where
          plain top-to-bottom scrolling reaches everything. */}
      <div className="flex flex-col items-center p-6 gap-10" style={{ minHeight: '100%', justifyContent: keyboardOpen ? 'flex-start' : 'center' }}>

      <img
        src={`${import.meta.env.BASE_URL}logo.png`}
        alt={APP_NAME}
        className="h-32 w-auto drop-shadow-2xl"
      />

      {savedSession && !cameFromQR && (
        <div className="flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={rejoinSaved}
            className="liquid-btn relative cursor-pointer border-0 bg-transparent p-0"
            style={{ width: '310px', height: '70px', borderRadius: '100px', background: 'rgba(0,0,0,0.001)' }}
          >
            <div style={{
              position: 'absolute', inset: 0, borderRadius: '100px',
              background: 'rgba(158,18,204,0.05)',
              pointerEvents: 'none',
            }} />
            <LiquidGlass
              style={{ position: 'absolute', top: '50%', left: '50%' }}
              {...LIQUID_PILL_PROPS}
              padding="13px 48px"
            >
              <div style={{ textAlign: 'center', whiteSpace: 'nowrap', minWidth: '214px' }}>
                <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.6rem', letterSpacing: '0.18em', textTransform: 'uppercase', lineHeight: 1, marginBottom: '5px' }}>
                  Continue as · {savedSession.pin}
                </p>
                <p className="text-white font-black text-xl" style={{ lineHeight: 1.2 }}>{savedSession.name}</p>
              </div>
            </LiquidGlass>
          </button>
          <p className="text-white/45 text-xs tracking-wider">or join a different game</p>
        </div>
      )}

      {/* Input card: LiquidGlass */}
      <div className="liquid-btn relative" style={{ width: '310px', height: cameFromQR ? '115px' : '165px' }}>
        <LiquidGlass
          style={{ position: 'absolute', top: '50%', left: '50%' }}
          {...LIQUID_CARD_PROPS}
          padding="20px 24px"
        >
          <div style={{ width: '262px', textAlign: 'center' }}>
            {!cameFromQR && (
              <>
                {/* PIN */}
                <div style={{ marginBottom: '14px' }}>
                  <span style={{
                    display: 'block',
                    color: pinFocused ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.45)',
                    fontSize: '0.6rem', letterSpacing: '0.18em', textTransform: 'uppercase',
                    marginBottom: '6px', transition: 'color 0.2s ease',
                  }}>Game PIN</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder="1 2 3"
                    value={pin}
                    onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
                    maxLength={3}
                    onFocus={() => setPinFocused(true)}
                    onBlur={() => setPinFocused(false)}
                    className="text-white font-black outline-none bg-transparent w-full text-center placeholder-white/20"
                    style={{ fontSize: '2rem', letterSpacing: '0.4em', textIndent: '0.4em', lineHeight: '1', display: 'block' }}
                  />
                </div>
                <div style={{ height: '1px', background: 'rgba(255,255,255,0.10)', marginBottom: '14px' }} />
              </>
            )}
            {/* Name */}
            <div>
              <span style={{
                display: 'block',
                color: nameFocused ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.45)',
                fontSize: '0.6rem', letterSpacing: '0.18em', textTransform: 'uppercase',
                marginBottom: '6px', transition: 'color 0.2s ease',
              }}>Your name</span>
              <input
                type="text"
                placeholder="Enter your name"
                value={name}
                onChange={e => setName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && join()}
                onFocus={() => setNameFocused(true)}
                onBlur={() => setNameFocused(false)}
                maxLength={20}
                className="text-white text-xl font-semibold placeholder-white/22 outline-none bg-transparent w-full text-center"
                style={{ lineHeight: '1.4', display: 'block' }}
              />
            </div>
          </div>
        </LiquidGlass>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateRows: error ? '1fr' : '0fr',
        transition: 'grid-template-rows 0.25s ease',
      }}>
        <div style={{ overflow: 'hidden' }}>
          <p
            className="text-sm text-center"
            aria-live="assertive"
            style={{
              width: '310px',
              paddingTop: '2px',
              opacity: error ? 1 : 0,
              transition: 'opacity 0.2s ease',
              color: 'rgba(248, 113, 113, 0.9)',
              letterSpacing: '0.01em',
            }}
          >{error}</p>
        </div>
      </div>

      <button
        type="button"
        className="liquid-btn glass-tint-teal relative border-0 bg-transparent p-0"
        style={{
          width: '310px',
          height: '64px',
          borderRadius: '100px',
          background: 'rgba(0,0,0,0.001)',
          opacity: canJoin ? 1 : 0.3,
          cursor: canJoin ? 'pointer' : 'not-allowed',
          transition: 'opacity 0.25s ease',
        }}
        onMouseEnter={() => setJoinHovered(true)}
        onMouseLeave={() => setJoinHovered(false)}
        onClick={() => canJoin && join()}
      >
        <LiquidGlass
          style={{
            position: 'absolute', top: '50%', left: '50%',
            filter: joinHovered ? 'drop-shadow(0 0 10px rgba(0,166,163,0.65))' : 'drop-shadow(0 0 0px rgba(0,166,163,0))',
            transition: 'filter 0.25s ease',
          }}
          {...LIQUID_PILL_PROPS}
          padding="18px 96px"
        >
          <div style={{ position: 'relative' }}>
            <div style={{ position: 'absolute', inset: '-18px -96px', borderRadius: '100px', pointerEvents: 'none', background: 'rgba(0,166,163,0.088)' }} />
            <span className="text-white font-bold text-xl" style={{ whiteSpace: 'nowrap', position: 'relative' }}>Join game</span>
          </div>
        </LiquidGlass>
      </button>
      </div>
    </div>
  );
}

function WaitingView({ game }: Readonly<{ game: PlayState }>) {
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [visible, setVisible] = useState(false);

  useEffect(() => { const t = setTimeout(() => setVisible(true), 40); return () => clearTimeout(t); }, []);

  const startEdit = () => { setDraftName(game.myName); setEditing(true); };
  const cancelEdit = () => setEditing(false);
  const confirmEdit = () => {
    if (!draftName.trim() || draftName.trim() === game.myName) { setEditing(false); return; }
    game.renamePlayer(draftName);
    setEditing(false);
  };

  return (
    <div className="relative min-h-screen overflow-hidden">
      {/* Background */}
      <img
        src={`${import.meta.env.BASE_URL}background.svg`}
        alt=""
        aria-hidden="true"
        style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 0 }}
      />
      {/* Blur + dark scrim */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 1, background: 'rgba(5,5,14,0.80)', backdropFilter: 'blur(28px)' }} />

      {/* Content */}
      <div
        className="relative flex flex-col items-center justify-center min-h-screen gap-10 p-6"
        style={{ zIndex: 2, transition: 'opacity 0.5s ease, transform 0.5s ease', opacity: visible ? 1 : 0, transform: visible ? 'translateY(0)' : 'translateY(16px)' }}
      >
        <BackButton />
        <img src={`${import.meta.env.BASE_URL}logo.png`} alt={APP_NAME} className="w-auto drop-shadow-2xl" style={{ height: '168px' }} />

        <div className="liquid-btn relative" style={{ width: '310px', height: '330px' }}>
          <LiquidGlass
            style={{ position: 'absolute', top: '50%', left: '50%' }}
            {...LIQUID_CARD_PROPS}
            padding="24px 28px"
          >
            <div style={{ width: '254px', minHeight: '220px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <span style={{
                fontSize: '1.95rem', fontFamily: "'Montserrat', sans-serif", fontWeight: 900, letterSpacing: '0.08em', textTransform: 'uppercase',
                background: 'linear-gradient(to bottom left, rgba(158,18,204,0.45) 0%, transparent 55%), linear-gradient(to top right, rgba(0,238,232,0.45) 0%, transparent 55%), #fff',
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
              }}>
                You're in!
              </span>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '10px', width: '100%' }}>
                <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.6rem', letterSpacing: '0.14em', textTransform: 'uppercase' }}>
                  Playing as
                </span>
                {editing ? (
                  <>
                    <input
                      autoFocus
                      type="text"
                      value={draftName}
                      onChange={e => setDraftName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') confirmEdit(); else if (e.key === 'Escape') cancelEdit(); }}
                      onBlur={confirmEdit}
                      maxLength={20}
                      style={{
                        background: 'none', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.25)',
                        color: 'white', fontSize: '1.5rem', fontWeight: 800, textAlign: 'center',
                        outline: 'none', width: '100%', letterSpacing: '-0.01em',
                        padding: '2px 0 4px', fontFamily: 'inherit',
                      }}
                    />
                    {game.error && <p style={{ color: '#f87171', fontSize: '0.7rem' }} aria-live="assertive">{game.error}</p>}
                  </>
                ) : (
                  <button onClick={startEdit} style={{ display: 'flex', alignItems: 'center', gap: '7px', background: 'none', border: 'none', cursor: 'pointer', color: 'white', fontSize: '1.5rem', fontWeight: 800, letterSpacing: '-0.01em' }}>
                    {game.myName}
                    <Pencil style={{ width: '14px', height: '14px', color: 'rgba(255,255,255,0.45)', flexShrink: 0 }} />
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', width: '100%' }}>
                <div style={{ width: '100%', height: '1px', background: 'rgba(255,255,255,0.07)', marginBottom: '4px' }} />
                <div style={{ display: 'flex', gap: '6px' }}>
                  {[0, 1, 2].map(i => (
                    <div key={i} style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'rgba(0,166,163,0.8)', animation: 'dotBounce 1.4s ease-in-out infinite', animationDelay: `${i * 0.18}s` }} />
                  ))}
                </div>
                <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.72rem', letterSpacing: '0.03em' }}>
                  Waiting for host to start…
                </span>
              </div>
            </div>
          </LiquidGlass>
        </div>
      </div>
    </div>
  );
}

export function BettingView({ game }: Readonly<{ game: PlayState }>) {
  const { roundIndex, totalRounds, timeLeft, bettingTime, bidIndex, bidOptions, bidScores, party, error, submitBid, setBidIndex } = game;
  const timerPct = bettingTime > 0 ? Math.max(0, (timeLeft / bettingTime)) * 100 : 0;
  const currentBid = bidOptions[bidIndex];
  const canGoLeft = bidIndex > 0;
  const canGoRight = bidIndex < bidOptions.length - 1;
  // Server-sent per-option scores; the formula fallback only covers a server
  // that predates the bidScores payload.
  const basePoints = bidScores?.[bidIndex] ?? (500 + Math.round(1000 * Math.max(0, 1 - currentBid / 60)));
  // Fold a known party multiplier into the preview; a hidden mystery shows ×?.
  const estPoints = basePoints * (party?.multiplier ?? 1);
  const mysteryHidden = party?.event === 'mystery' && party.multiplier === null;

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden" style={{ background: '#080812' }}>
      <img
        src={`${import.meta.env.BASE_URL}background2.svg`}
        alt=""
        aria-hidden="true"
        style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 0, transform: 'rotate(270deg)' }}
      />
      <div style={{ position: 'fixed', inset: 0, zIndex: 1, background: 'rgba(5,5,14,0.82)', backdropFilter: 'blur(28px)' }} />

      {/* Top bar */}
      <div className="flex items-center justify-between px-5 pt-5 pb-3" style={{ position: 'relative', zIndex: 2 }}>
        <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.85rem', fontWeight: 600 }}>
          Round {roundIndex + 1}<span style={{ color: 'rgba(255,255,255,0.45)' }}>/{totalRounds}</span>
        </span>
        <span
          className="font-black text-2xl tabular-nums"
          style={{ color: 'white', transition: 'color 0.3s ease' }}
        >
          {timeLeft}s
        </span>
      </div>

      {/* Timer bar */}
      <div className="mx-5 h-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.07)', position: 'relative', zIndex: 2 }}>
        <div
          className="h-0.5 rounded-full"
          style={{
            width: `${timerPct}%`,
            background: timerColor(timerPct / 100),
            transition: timerPct === 0 ? 'none' : 'width 1s linear, background 0.4s ease',
          }}
        />
      </div>

      {/* Bid picker */}
      <div className="flex-1 flex flex-col items-center justify-center gap-6 px-5" style={{ position: 'relative', zIndex: 2 }}>
        <PartyBadge party={party} />
        <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.14em' }}>
          How many seconds do you need?
        </p>

        <div className="flex items-center gap-5">
          <BidArrow direction="left" enabled={canGoLeft} onClick={() => setBidIndex(i => i - 1)} />

          {/* Bid value — LiquidGlass */}
          <div className="liquid-btn relative" style={{ width: 160, height: 110 }}>
            <LiquidGlass
              style={{ position: 'absolute', top: '50%', left: '50%' }}
              displacementScale={55}
              blurAmount={0.06}
              saturation={130}
              aberrationIntensity={1.5}
              elasticity={0.08}
              cornerRadius={22}
              padding="20px 32px"
            >
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, width: '96px' }}>
                <span style={{ display: 'inline-block', minWidth: '60px', textAlign: 'center', color: 'white', fontWeight: 900, fontSize: '2.8rem', lineHeight: 1 }}>
                  {currentBid}
                </span>
                <span style={{ display: 'inline-block', color: 'rgba(255,255,255,0.45)', fontSize: '0.65rem', letterSpacing: '0.14em', textTransform: 'uppercase' }}>
                  seconds
                </span>
              </div>
            </LiquidGlass>
          </div>

          <BidArrow direction="right" enabled={canGoRight} onClick={() => setBidIndex(i => i + 1)} />
        </div>

        {/* Score potential */}
        <div className="flex flex-col items-center gap-1">
          <span
            className="tabular-nums transition-all duration-200"
            style={{ color: 'rgba(158,18,204,0.9)', fontWeight: 900, fontSize: '1.6rem', lineHeight: 1 }}
          >
            ~{estPoints.toLocaleString()}
            {mysteryHidden && <span style={{ color: 'rgba(94,234,212,0.8)', fontSize: '1rem', marginLeft: '6px' }}>×?</span>}
          </span>
          <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.68rem' }}>pts + difficulty bonus</p>
        </div>
      </div>

      {error && <p className="text-red-400 text-sm text-center px-5 pb-2" style={{ position: 'relative', zIndex: 2 }} aria-live="assertive">{error}</p>}

      {/* Lock In */}
      <div className="px-5 pb-8 flex justify-center" style={{ position: 'relative', zIndex: 2 }}>
        <button
          type="button"
          className="liquid-btn relative cursor-pointer border-0 bg-transparent p-0"
          style={{ width: '310px', height: '64px', borderRadius: '100px', background: 'rgba(0,0,0,0.001)' }}
          onClick={submitBid}
        >
          <LiquidGlass
            style={{ position: 'absolute', top: '50%', left: '50%' }}
            {...LIQUID_PILL_PROPS}
          >
            <div style={{ position: 'relative' }}>
              <div style={{ position: 'absolute', inset: '-18px -36px', borderRadius: '100px', pointerEvents: 'none', background: 'rgba(158,18,204,0.15)' }} />
              <span className="text-white font-bold text-xl" style={{ whiteSpace: 'nowrap', position: 'relative', display: 'inline-block', minWidth: '238px', textAlign: 'center' }}>
                Lock In · {currentBid}s
              </span>
            </div>
          </LiquidGlass>
        </button>
      </div>
    </div>
  );
}

function BidSubmittedView({ game }: Readonly<{ game: PlayState }>) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-white/50">Your bid</p>
      <p className="text-white font-black text-6xl">{game.myBid}s</p>
      <p className="text-white/45">Waiting for others...</p>
    </div>
  );
}


export function WatchingView({ game }: Readonly<{ game: PlayState }>) {
  const { lowestBid, guesserNames, mode, yearOnly, songPlaying, songTempo, party, roundIndex, totalRounds, myScore, myStreak } = game;
  const [visible, setVisible] = useState(false);
  useEffect(() => { const t = setTimeout(() => setVisible(true), 30); return () => clearTimeout(t); }, []);
  const isRace = mode === 'race';
  const isDuel = !!party?.finale;
  const isYear = party ? party.format === 'year' : yearOnly;
  const nonYearAccent = isRace ? 'race' : 'classic';
  const watchAccent = isYear ? 'year' : nonYearAccent;

  return (
    <div className="relative min-h-screen overflow-hidden">
      {/* Background */}
      <img
        src={`${import.meta.env.BASE_URL}background4.svg`}
        alt=""
        aria-hidden="true"
        style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 0, transform: 'rotate(180deg)' }}
      />
      <div style={{ position: 'fixed', inset: 0, zIndex: 1, background: 'rgba(5,5,14,0.82)', backdropFilter: 'blur(28px)' }} />

      {/* Content */}
      <div
        className="relative flex flex-col items-center min-h-screen gap-6 px-5 py-8"
        style={{
          zIndex: 2,
          transition: 'opacity 0.4s ease, transform 0.4s ease',
          opacity: visible ? 1 : 0,
          transform: visible ? 'translateY(0)' : 'translateY(14px)',
        }}
      >
        <div className="flex flex-col items-center gap-2">
          <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.85rem' }}>
            Round {roundIndex + 1}<span style={{ color: 'rgba(255,255,255,0.45)' }}>/{totalRounds}</span>
          </p>
          <PartyBadge party={party} />
        </div>

        <div className="flex-1 flex items-center justify-center w-full">
          <div className="liquid-btn relative" style={{ width: 'min(90vw, 360px)', height: 'min(75vh, 620px)' }}>
            <LiquidGlass
              style={{ position: 'absolute', top: '50%', left: '50%' }}
              displacementScale={58}
              blurAmount={0.06}
              saturation={130}
              aberrationIntensity={1.5}
              elasticity={0.08}
              cornerRadius={28}
              padding="80px 24px"
            >
              <div style={{ width: '298px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '44px' }}>

                <AudioBars playing={songPlaying} accent={watchAccent} height={56} bpm={songTempo} />

                <div style={{ width: '100%', height: '1px', background: 'rgba(255,255,255,0.07)' }} />

                <GetReadyBody isDuel={isDuel} isRace={isRace} party={party} lowestBid={lowestBid} guesserNames={guesserNames} songPlaying={songPlaying} />
              </div>
            </LiquidGlass>
          </div>
        </div>

        <div style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', padding: '10px 30px', textAlign: 'center' }}>
          <p className="text-white font-black text-2xl tabular-nums">{myScore.toLocaleString()}</p>
          <p className="text-white/45 text-xs">your score</p>
          {myStreak >= 2 && (
            <p className="flex items-center justify-center gap-1 text-orange-400 text-xs font-bold mt-1">
              <Flame className="w-3 h-3" />{myStreak} in a row
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function GetReadyBody({ isDuel, isRace, party, lowestBid, guesserNames, songPlaying }: Readonly<{
  isDuel: boolean; isRace: boolean; party: PartyInfo | null; lowestBid: number; guesserNames: string[]; songPlaying: boolean;
}>) {
  if (isDuel) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
        <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.65rem', letterSpacing: '0.2em', textTransform: 'uppercase' }}>
          The finale
        </span>
        <span style={{ display: 'inline-block', minWidth: '220px', color: 'white', fontWeight: 900, fontSize: '1.65rem', lineHeight: 1.3, textAlign: 'center' }}>
          {party!.duelists.join(' vs ')}
        </span>
        <span style={{ display: 'inline-block', minWidth: '170px', color: 'rgba(255,255,255,0.45)', fontSize: '0.88rem', textAlign: 'center' }}>
          First correct wins
        </span>
      </div>
    );
  }
  if (isRace) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
        <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.65rem', letterSpacing: '0.2em', textTransform: 'uppercase' }}>
          Get ready
        </span>
        <span style={{ display: 'inline-block', minWidth: '220px', color: 'white', fontWeight: 900, fontSize: '1.65rem', lineHeight: 1.3, textAlign: 'center' }}>
          Everyone guesses at once
        </span>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
      <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.65rem', letterSpacing: '0.2em', textTransform: 'uppercase' }}>
        {songPlaying ? 'Listen closely' : 'Get ready'}
      </span>
      <span style={{
        display: 'inline-block', minWidth: '220px', textAlign: 'center',
        fontWeight: 900, fontSize: '1.75rem', lineHeight: 1.25,
        background: 'linear-gradient(to bottom left, rgba(0,238,232,0.4) 0%, transparent 55%), linear-gradient(to top right, rgba(158,18,204,0.5) 0%, transparent 55%), #fff',
        WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
      }}>
        {guesserNames.join(' & ')}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
        <div style={{ display: 'flex', gap: '3px' }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{
              width: '4px', height: '4px', borderRadius: '50%', background: 'rgba(158,18,204,0.8)',
              animation: 'dotBounce 1.4s ease-in-out infinite', animationDelay: `${i * 0.18}s`,
            }} />
          ))}
        </div>
        <span style={{ display: 'inline-block', color: 'rgba(255,255,255,0.45)', fontSize: '0.88rem', textAlign: 'center' }}>
          guesses after {lowestBid}s
        </span>
      </div>
    </div>
  );
}

// Handles both the "listening" sub-phase (watching, imGuessing) and the active
// guessing phase. Keeping a single component across both states means the input
// element is never unmounted — focus and text survive the transition, which
// prevents the mobile keyboard from dismissing mid-song.
function ListeningHeader({ songPlaying, songTempo, isYear }: Readonly<{ songPlaying: boolean; songTempo: number | null; isYear: boolean }>) {
  const accent = isYear ? 'year' : 'classic';
  return (
    <div className="flex flex-col items-center gap-2.5 pt-10 pb-4">
      <AudioBars playing={songPlaying} accent={accent} height={28} bpm={songTempo} />
      <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.72rem', letterSpacing: '0.08em' }}>
        {songPlaying ? 'Your song is playing…' : 'Get ready…'}
      </span>
    </div>
  );
}

// Race mode plays the song throughout the guessing window, so it keeps the
// waveform going here too; classic has already stopped the song by the time
// a tier's turn starts, so it stays timer-only.
function ActiveHeader({ timeLeft, timerTotal, myScore, isRace, isYear, songPlaying, songTempo }: Readonly<{ timeLeft: number; timerTotal: number; myScore: number; isRace: boolean; isYear: boolean; songPlaying: boolean; songTempo: number | null }>) {
  const accent = isYear ? 'year' : 'race';
  return (
    <div className="flex flex-col items-center gap-2 pt-4 pb-3">
      <div className="flex items-center justify-between w-full px-5">
        <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.85rem', fontWeight: 600 }}>Your turn</span>
        <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.8rem', fontWeight: 500 }}>
          {myScore.toLocaleString()} pts
        </span>
      </div>
      <CircularTimer timeLeft={timeLeft} total={timerTotal} size={80} />
      {(isRace || isYear) && (
        <AudioBars playing={songPlaying} accent={accent} height={20} bpm={songTempo} />
      )}
    </div>
  );
}

function guessInputBoxStyle(isListening: boolean, focused: boolean): { border: string; background: string; boxShadow: string } {
  if (isListening) {
    return { border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.03)', boxShadow: 'none' };
  }
  if (focused) {
    return { border: '1px solid rgba(158,18,204,0.7)', background: 'rgba(158,18,204,0.1)', boxShadow: '0 0 28px rgba(0,238,232,0.18), 0 0 20px rgba(158,18,204,0.22)' };
  }
  return { border: '1px solid rgba(158,18,204,0.4)', background: 'rgba(158,18,204,0.08)', boxShadow: '0 0 24px rgba(158,18,204,0.1)' };
}

// 4-box OTP-style display for year guesses. A single transparent input
// underneath keeps the real focus/keyboard target (so the mobile keyboard
// never dismisses), while these boxes render its current characters.
function YearDigitBox({ digit, active }: Readonly<{ digit: string; active: boolean }>) {
  return (
    <div
      style={{
        width: '48px', height: '58px', borderRadius: '12px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '1.5rem', fontWeight: 800, color: 'white',
        border: active ? '1px solid rgba(158,18,204,0.8)' : '1px solid rgba(255,255,255,0.12)',
        background: active ? 'rgba(158,18,204,0.12)' : 'rgba(255,255,255,0.04)',
        boxShadow: active ? '0 0 16px rgba(158,18,204,0.35)' : 'none',
        transition: 'border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease',
      }}
    >
      {digit}
    </div>
  );
}

// A year guess is always exactly 4 digits — a fixed set of positional
// slots, not a reorderable list, so each box is written out rather than
// mapped over an index.
function YearDigitBoxes({ value, focused }: Readonly<{ value: string; focused: boolean }>) {
  const activeIndex = Math.min(value.length, 3);
  return (
    <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', pointerEvents: 'none' }}>
      <YearDigitBox digit={value[0] ?? ''} active={focused && activeIndex === 0} />
      <YearDigitBox digit={value[1] ?? ''} active={focused && activeIndex === 1} />
      <YearDigitBox digit={value[2] ?? ''} active={focused && activeIndex === 2} />
      <YearDigitBox digit={value[3] ?? ''} active={focused && activeIndex === 3} />
    </div>
  );
}

export function GuessingView({ game }: Readonly<{ game: PlayState }>) {
  const { phase, timeLeft, timerTotal, myScore, guessText, guessInputRef, setGuessText, submitGuess, skipGuess, artistOnly, yearOnly, songPlaying, songTempo, mode, party, artistGuessText, setArtistGuessText } = game;
  const isListening = phase === 'watching';
  // What this round wants answered: party rounds carry it per-round,
  // classic/race games use the game-wide artist/year toggles.
  let target: 'title' | 'artist' | 'both' | 'year';
  if (party) {
    target = party.format === 'year' ? 'year' : party.target;
  } else if (yearOnly) {
    target = 'year';
  } else {
    target = artistOnly ? 'artist' : 'title';
  }
  const isYear = target === 'year';
  const canSubmit = isYear ? guessText.trim().length === 4 : guessText.trim().length > 0;
  const [inputFocused, setInputFocused] = useState(false);
  const inputBoxStyle = guessInputBoxStyle(isListening, inputFocused);
  const label = {
    title: 'Name the song',
    artist: 'Name the artist',
    both: 'Name the song · artist = bonus',
    year: 'Guess the release year',
  }[target];
  const placeholder = {
    title: 'Type song title…',
    artist: 'Type artist name…',
    both: 'Type song title…',
    year: 'e.g. 1994',
  }[target];

  return (
    <div className="relative min-h-screen keyboard-resize flex flex-col overflow-hidden" style={{ background: '#080812' }}>
      <img src={`${import.meta.env.BASE_URL}background4.svg`} alt="" aria-hidden="true" style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 0, transform: 'rotate(180deg)' }} />
      <div style={{ position: 'fixed', inset: 0, zIndex: 1, background: 'rgba(5,5,14,0.82)', backdropFilter: 'blur(28px)' }} />

      <div className="relative flex flex-col flex-1" style={{ zIndex: 2 }}>

      {/* Header: waveform while listening, timer + score when active */}
      {isListening
        ? <ListeningHeader songPlaying={songPlaying} songTempo={songTempo} isYear={isYear} />
        : <ActiveHeader timeLeft={timeLeft} timerTotal={timerTotal} myScore={myScore} isRace={mode === 'race'} isYear={isYear} songPlaying={songPlaying} songTempo={songTempo} />}

      {/* Input area */}
      <div className="flex-1 flex flex-col items-center justify-center gap-5 px-5">
        {party && <PartyBadge party={party} />}
        <p style={{
          color: isListening ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.6)',
          fontSize: '0.9rem', fontWeight: 600, letterSpacing: '0.03em',
          transition: 'color 0.5s ease',
        }}>
          {label}
        </p>

        {isYear ? (
          <div style={{ position: 'relative' }}>
            <YearDigitBoxes value={guessText} focused={inputFocused} />
            <input
              ref={guessInputRef}
              type="text"
              inputMode="numeric"
              value={guessText}
              onChange={e => setGuessText(e.target.value.replace(/\D/g, '').slice(0, 4))}
              onKeyDown={e => e.key === 'Enter' && canSubmit && submitGuess()}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
              autoComplete="off" autoCorrect="off" spellCheck={false}
              style={{
                position: 'absolute', inset: 0, width: '100%', height: '100%',
                background: 'transparent', border: 'none', outline: 'none',
                color: 'transparent', caretColor: 'transparent', fontSize: '1.5rem',
              }}
            />
          </div>
        ) : (
          <div style={{
            width: '100%', borderRadius: '16px', overflow: 'hidden',
            border: inputBoxStyle.border,
            background: inputBoxStyle.background,
            boxShadow: inputBoxStyle.boxShadow,
            transition: 'border-color 0.5s ease, background 0.5s ease, box-shadow 0.5s ease',
          }}>
            <input
              ref={guessInputRef}
              type="text"
              placeholder={placeholder}
              value={guessText}
              onChange={e => setGuessText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && canSubmit && submitGuess()}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
              autoComplete="off" autoCorrect="off" spellCheck={false}
              style={{
                display: 'block', width: '100%', background: 'transparent', border: 'none',
                color: 'white', fontSize: '1.3rem', fontWeight: 700, textAlign: 'center',
                padding: '20px 16px', outline: 'none', fontFamily: 'inherit',
              }}
              className="placeholder-white/20"
            />
          </div>
        )}

        {target === 'both' && (
          <div style={{
            width: '100%', borderRadius: '14px', overflow: 'hidden',
            border: '1px solid rgba(0,238,232,0.25)',
            background: 'rgba(0,238,232,0.05)',
          }}>
            <input
              type="text"
              placeholder="Artist (bonus points)…"
              value={artistGuessText}
              onChange={e => setArtistGuessText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && canSubmit && submitGuess()}
              autoComplete="off" autoCorrect="off" spellCheck={false}
              style={{
                display: 'block', width: '100%', background: 'transparent', border: 'none',
                color: 'white', fontSize: '1.05rem', fontWeight: 600, textAlign: 'center',
                padding: '14px 16px', outline: 'none', fontFamily: 'inherit',
              }}
              className="placeholder-white/20"
            />
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="px-5 pb-8 flex flex-col items-center gap-4">
        <button
          type="button"
          className="liquid-btn relative cursor-pointer border-0 bg-transparent p-0"
          style={{
            width: '310px', height: '64px', borderRadius: '100px',
            background: 'rgba(0,0,0,0.001)',
            opacity: canSubmit ? 1 : 0.28,
            cursor: canSubmit ? 'pointer' : 'not-allowed',
            transition: 'opacity 0.25s ease',
          }}
          onClick={() => canSubmit && submitGuess()}
        >
          <LiquidGlass
            style={{ position: 'absolute', top: '50%', left: '50%' }}
            {...LIQUID_PILL_PROPS}
          >
            <div style={{ position: 'relative' }}>
              <div style={{ position: 'absolute', inset: '-18px -36px', borderRadius: '100px', pointerEvents: 'none', background: 'rgba(158,18,204,0.15)' }} />
              <span className="text-white font-bold text-xl" style={{ whiteSpace: 'nowrap', position: 'relative', display: 'inline-block', minWidth: '238px', textAlign: 'center' }}>
                Submit
              </span>
            </div>
          </LiquidGlass>
        </button>

        <button
          onClick={skipGuess}
          style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.28)', fontSize: '0.82rem', cursor: 'pointer', transition: 'color 0.2s ease' }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.5)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.28)'; }}
        >
          Skip, I don't know
        </button>
      </div>

      </div>{/* end zIndex wrapper */}
    </div>
  );
}

function PassedView({ game }: Readonly<{ game: PlayState }>) {
  const { mode, myRacePoints, myRaceTimeMs } = game;
  const [visible, setVisible] = useState(false);
  useEffect(() => { const t = setTimeout(() => setVisible(true), 30); return () => clearTimeout(t); }, []);
  const gotIt = mode === 'race' && myRacePoints > 0;

  return (
    <div className="relative min-h-screen overflow-hidden">
      <img
        src={`${import.meta.env.BASE_URL}background3.svg`}
        alt=""
        aria-hidden="true"
        style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 0 }}
      />
      <div style={{ position: 'fixed', inset: 0, zIndex: 1, background: 'rgba(5,5,14,0.82)', backdropFilter: 'blur(28px)' }} />

      <div
        className="relative flex flex-col items-center justify-center min-h-screen p-6"
        style={{
          zIndex: 2,
          transition: 'opacity 0.4s ease, transform 0.4s ease',
          opacity: visible ? 1 : 0,
          transform: visible ? 'translateY(0)' : 'translateY(14px)',
        }}
      >
        <div className="liquid-btn relative" style={{ width: '310px', height: gotIt ? '180px' : '150px' }}>
          <LiquidGlass
            style={{ position: 'absolute', top: '50%', left: '50%' }}
            {...LIQUID_CARD_PROPS}
            padding="28px 28px"
          >
            <div style={{ width: '254px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px' }}>
              {gotIt ? (
                <>
                  <span style={{ display: 'inline-block', minWidth: '120px', color: '#4ade80', fontWeight: 900, fontSize: '1.6rem', textAlign: 'center' }}>
                    Got it!
                  </span>
                  <div style={{ width: '100%', height: '1px', background: 'rgba(255,255,255,0.07)' }} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    {myRaceTimeMs !== null && (
                      <span style={{ display: 'inline-block', color: 'rgba(255,255,255,0.45)', fontSize: '0.9rem' }}>
                        {(myRaceTimeMs / 1000).toFixed(1)}s
                      </span>
                    )}
                    <span style={{ display: 'inline-block', color: '#38bdf8', fontWeight: 700, fontSize: '1rem' }}>
                      +{myRacePoints} pts
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    {[0, 1, 2].map(i => (
                      <div key={i} style={{
                        width: '6px', height: '6px', borderRadius: '50%',
                        background: 'rgba(0,166,163,0.8)',
                        animation: 'dotBounce 1.4s ease-in-out infinite',
                        animationDelay: `${i * 0.18}s`,
                      }} />
                    ))}
                  </div>
                  <span style={{ display: 'inline-block', minWidth: '180px', color: 'rgba(255,255,255,0.45)', fontSize: '0.9rem', textAlign: 'center' }}>
                    Waiting for others…
                  </span>
                </>
              )}
            </div>
          </LiquidGlass>
        </div>
      </div>
    </div>
  );
}

// Full-screen victim picker for the steal-round winner.
function StealPicker({ victims, onPick, onSkip }: Readonly<{
  victims: { name: string; score: number }[];
  onPick: (name: string) => void;
  onSkip: () => void;
}>) {
  const pickerRef = useRef<HTMLDialogElement>(null);
  useEscapeKey(onSkip, true);
  useFocusTrap(pickerRef, true);
  return (
    <dialog
      ref={pickerRef}
      open
      aria-modal="true"
      aria-label="Pick a steal victim"
      className="fixed inset-0 flex flex-col items-center justify-center gap-6 p-6"
      style={{ zIndex: 70, margin: 0, border: 'none', color: 'inherit', width: '100%', height: '100%', background: 'rgba(5,5,14,0.93)', backdropFilter: 'blur(24px)' }}
    >
      <div style={{ textAlign: 'center' }}>
        <p style={{
          fontSize: '1.7rem', fontWeight: 900, marginBottom: '8px',
          background: 'linear-gradient(to bottom left, rgba(248,113,113,0.55) 0%, transparent 55%), linear-gradient(to top right, rgba(250,185,40,0.4) 0%, transparent 55%), #fff',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
        }}>
          You won the steal!
        </p>
        <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.85rem' }}>
          Pick a victim: you take 15% of their score (min 300)
        </p>
      </div>
      <div className="flex flex-col gap-2.5 w-full" style={{ maxWidth: '310px', maxHeight: '50vh', overflowY: 'auto' }}>
        {victims.map(v => (
          <button
            key={v.name}
            onClick={() => onPick(v.name)}
            className="flex items-center justify-between px-5 py-3.5 rounded-2xl"
            style={{
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
              cursor: 'pointer', transition: 'background 0.15s ease, border-color 0.15s ease',
            }}
            onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = 'rgba(248,113,113,0.12)'; el.style.borderColor = 'rgba(248,113,113,0.4)'; }}
            onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = 'rgba(255,255,255,0.06)'; el.style.borderColor = 'rgba(255,255,255,0.12)'; }}
          >
            <span className="text-white font-bold">{v.name}</span>
            <span className="text-white/45 text-sm tabular-nums">{v.score.toLocaleString()} pts</span>
          </button>
        ))}
      </div>
      <button
        onClick={onSkip}
        style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.28)', fontSize: '0.82rem', cursor: 'pointer', transition: 'color 0.2s ease' }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.5)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.28)'; }}
      >
        Skip, don't steal
      </button>
    </dialog>
  );
}

// Reveal for "guess the year" rounds: the year card plus everyone's distances.
// Shared shell for the three reveal-screen variants (year / no-one-got-it /
// got-it): page background, liquid card, party extras, a guesses list, and
// the player's score box. Only the card content, guesses list, and an
// optional extra line under the score differ between them.
function PlayRevealShell({
  game, result, cardHeight, cardContent, guessesList, scoreExtra, wide = false,
}: Readonly<{
  game: PlayState;
  result: RoundResultEvent;
  cardHeight: number;
  cardContent: React.ReactNode;
  guessesList: React.ReactNode;
  scoreExtra?: React.ReactNode;
  wide?: boolean;
}>) {
  const { myScore, myScoreDelta, myStreak, stealResult } = game;
  return (
    <div className={`page-enter relative min-h-screen flex flex-col items-center justify-center gap-5 overflow-hidden ${wide ? 'px-2 py-6' : 'p-6'}`}>
      <img
        src={`${import.meta.env.BASE_URL}background3.svg`}
        alt=""
        aria-hidden="true"
        style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 0 }}
      />
      <div style={{ position: 'fixed', inset: 0, zIndex: 1, background: 'rgba(5,5,14,0.82)', backdropFilter: 'blur(28px)' }} />
      <div className="relative flex flex-col items-center gap-5 w-full" style={{ zIndex: 2 }}>
        <div className="liquid-btn relative" style={{ width: wide ? 'min(88vw, 366px)' : '310px', height: `${cardHeight}px` }}>
          <LiquidGlass
            style={{ position: 'absolute', top: '50%', left: '50%' }}
            {...LIQUID_CARD_PROPS}
            padding={wide ? '18px 18px' : '24px 24px'}
          >
            {cardContent}
          </LiquidGlass>
        </div>

        <PartyRevealExtras result={result} stealResult={stealResult} />

        {guessesList}

        <div style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', padding: '16px 32px', textAlign: 'center' }}>
          {myScoreDelta > 0 && (
            <p className="text-sky-400 text-sm font-bold tabular-nums">+{myScoreDelta.toLocaleString()} pts</p>
          )}
          <p className="text-3xl font-black text-white">{myScore.toLocaleString()}</p>
          <p className="text-white/45 text-sm">your score</p>
          {scoreExtra}
          {myStreak >= 2 && (
            <p className="flex items-center justify-center gap-1 text-orange-400 text-xs font-bold mt-1">
              <Flame className="w-3 h-3" />{myStreak} in a row
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function YearRevealView({ game, result }: Readonly<{ game: PlayState; result: RoundResultEvent }>) {
  const { myName } = game;
  // The timeline card already shows every player's guess and distance —
  // this strip only adds what it doesn't: points earned this round.
  const scorers = (result.yearResults ?? []).filter(r => r.points > 0).sort((a, b) => b.points - a.points);
  const guessesList = scorers.length > 0 && (
    <div style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', padding: '8px 12px', width: '310px', maxWidth: '92vw' }} className="space-y-1">
      {scorers.map(r => (
        <div key={r.name} className="flex justify-between items-center gap-2">
          <span className={`text-xs min-w-0 truncate ${r.name === myName ? 'text-white font-semibold' : 'text-white/45'}`}>{r.name}</span>
          <span className="ml-1.5 text-xs text-sky-400 font-semibold tabular-nums shrink-0">+{r.points.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
  return (
    <PlayRevealShell
      game={game}
      result={result}
      wide
      cardHeight={result.coverUrl ? 500 : 380}
      cardContent={<YearTimelineContent result={result} />}
      guessesList={guessesList}
    />
  );
}

export function RevealView({ game, result }: Readonly<{ game: PlayState; result: RoundResultEvent }>) {
  const { myName, myRacePoints, myRaceTimeMs } = game;
  const isRace = result.mode === 'race';
  const iGotItInRace = isRace && !!result.correctGuessers?.includes(myName);

  if (!result.correct) {
    const guessesList = result.playerGuesses && result.playerGuesses.length > 0 && (
      <div style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', padding: '8px 12px', width: '310px', maxWidth: '92vw' }} className="space-y-1">
        {result.playerGuesses.map(g => {
          const ellipsis = g.live ? '…' : '';
          return (
            <div key={g.name} className="flex justify-between items-center gap-2">
              <span className="text-white/45 text-xs min-w-0 truncate">{g.name}</span>
              <span className="text-xs text-right min-w-0 truncate italic text-white/28">
                {g.guess === null ? 'skipped' : `"${g.guess}${ellipsis}"`}
              </span>
            </div>
          );
        })}
      </div>
    );
    return (
      <PlayRevealShell
        game={game}
        result={result}
        cardHeight={result.coverUrl ? 480 : 240}
        cardContent={<NoOneGotItCardContent result={result} />}
        guessesList={guessesList}
      />
    );
  }

  const guessesList = result.playerGuesses && result.playerGuesses.length > 0 && (
    <div style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', padding: '8px 12px', width: '310px', maxWidth: '92vw' }} className="space-y-1">
      {result.playerGuesses.map(g => {
        const correct = isRace ? !!result.correctGuessers?.includes(g.name) : (g.name === result.guesserName);
        const guessClass = guessTextClass(g.guess, correct);
        const ellipsis = g.live ? '…' : '';
        return (
          <div key={g.name} className="flex justify-between items-center gap-2">
            <span className={`text-xs min-w-0 truncate ${correct ? 'text-white font-semibold' : 'text-white/45'}`}>{g.name}</span>
            <span className={`text-xs text-right min-w-0 truncate ${guessClass}`}>
              {g.guess === null ? 'skipped' : `"${g.guess}${ellipsis}"`}
              {correct && g.timeMs != null && (
                <span className="ml-1 text-white/45 text-xs">{(g.timeMs / 1000).toFixed(1)}s</span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
  return (
    <PlayRevealShell
      game={game}
      result={result}
      cardHeight={result.coverUrl ? 480 : 240}
      cardContent={<GotItCardContent result={result} myName={myName} />}
      guessesList={guessesList}
      scoreExtra={iGotItInRace && myRaceTimeMs != null && (
        <p className="text-green-400 text-xs font-semibold mt-1">
          You got it in {(myRaceTimeMs / 1000).toFixed(1)}s · +{myRacePoints}
        </p>
      )}
    />
  );
}

function PlayerLeaderboardRow({ entry, delay, isMe }: Readonly<{ entry: LeaderboardEntry; delay: number; isMe: boolean }>) {
  const { displayScore } = useAnimatedScore(entry.score, 0, delay);
  return (
    <div className={`flex items-center gap-4 px-4 py-3 rounded-xl ${isMe ? 'bg-white/10' : 'bg-white/5'}`}>
      <span className="w-8 flex justify-center">
        <RankBadge rank={entry.rank} />
      </span>
      <span className="text-white font-bold flex-1">{entry.name}</span>
      <p className="text-white/60 font-semibold tabular-nums min-w-[56px] text-right">{displayScore.toLocaleString()}</p>
    </div>
  );
}

function MyScoreCard({ entry, delay }: Readonly<{ entry: LeaderboardEntry; delay: number }>) {
  const { displayScore } = useAnimatedScore(entry.score, 0, delay);
  return (
    <div className="liquid-btn relative mx-auto" style={{ width: '240px', height: '92px' }}>
      <LiquidGlass
        style={{ position: 'absolute', top: '50%', left: '50%' }}
        displacementScale={50}
        blurAmount={0.06}
        saturation={130}
        aberrationIntensity={1.5}
        elasticity={0.08}
        cornerRadius={18}
        padding="16px 24px"
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, width: '192px' }}>
          <span style={{ display: 'inline-block', color: 'rgba(255,255,255,0.6)', fontSize: '0.875rem' }}>You're #{entry.rank}</span>
          <span className="tabular-nums" style={{ display: 'inline-block', color: 'white', fontWeight: 900, fontSize: '1.5rem' }}>
            {displayScore.toLocaleString()} pts
          </span>
        </div>
      </LiquidGlass>
    </div>
  );
}

function LeaderboardView({ game }: Readonly<{ game: PlayState }>) {
  const { phase, myName, leaderboard, newGamePin, rejoinNewGame } = game;
  const navigate = useNavigate();
  const myEntry = leaderboard.find(e => e.name === myName);
  const isFinished = phase === 'finished';

  return (
    <div className="relative min-h-screen flex flex-col p-6 gap-4">
      {isFinished && (
        <>
          <img
            src={`${import.meta.env.BASE_URL}background5.svg`}
            alt=""
            aria-hidden="true"
            style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 0 }}
          />
          <div
            className="fixed inset-0 pointer-events-none"
            style={{
              background: 'rgba(8,8,18,0.88)',
              backdropFilter: 'blur(48px)',
              zIndex: 1,
            }}
          />
        </>
      )}

      <h2 className="text-3xl font-black text-white text-center relative z-10">
        {isFinished ? 'Final Scores' : 'Leaderboard'}
      </h2>

      {myEntry && (
        <div className="relative z-10">
          <MyScoreCard
            entry={myEntry}
            delay={0}
          />
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto space-y-3 relative z-10">
        {leaderboard.slice(0, 10).map((e, i) => (
          <PlayerLeaderboardRow
            key={e.name}
            entry={e}
            delay={100 + i * 80}
            isMe={e.name === myName}
          />
        ))}
      </div>

      {phase === 'leaderboard' && <p className="text-center text-white/45 text-sm relative z-10">Waiting for the host to start the next round…</p>}

      {isFinished && (
        <div className="relative z-10 flex flex-col items-center gap-3">
          {newGamePin && (
            <>
              <div
                className="flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-center"
                style={{
                  background: 'linear-gradient(90deg, rgba(0,166,163,0.16) 0%, rgba(158,18,204,0.16) 100%)',
                  border: '1px solid rgba(0,235,219,0.35)',
                  boxShadow: '0 0 24px rgba(0,166,163,0.12)',
                }}
              >
                <p className="text-sm font-semibold" style={{ color: '#5eead4' }}>Host started a new game!</p>
              </div>
              <button
                type="button"
                className="liquid-btn relative cursor-pointer border-0 bg-transparent p-0"
                style={{ width: '310px', height: '64px', borderRadius: '100px', background: 'rgba(0,0,0,0.001)' }}
                onClick={rejoinNewGame}
              >
                <LiquidGlass
                  style={{ position: 'absolute', top: '50%', left: '50%' }}
                  {...LIQUID_PILL_PROPS}
                >
                  <div style={{ position: 'relative' }}>
                    <div style={{ position: 'absolute', inset: '-18px -36px', borderRadius: '100px', pointerEvents: 'none', background: 'rgba(0,166,163,0.18)' }} />
                    <span className="text-white font-bold text-xl" style={{ whiteSpace: 'nowrap', position: 'relative', display: 'inline-block', minWidth: '210px', textAlign: 'center' }}>
                      Play Again
                    </span>
                  </div>
                </LiquidGlass>
              </button>
            </>
          )}

          <button
            type="button"
            className="liquid-btn relative cursor-pointer border-0 bg-transparent p-0"
            style={{ width: '310px', height: '64px', borderRadius: '100px', background: 'rgba(0,0,0,0.001)' }}
            onClick={() => navigate('/')}
          >
            <LiquidGlass
              style={{ position: 'absolute', top: '50%', left: '50%' }}
              {...LIQUID_PILL_PROPS}
            >
              <span className="text-white font-bold text-xl" style={{ whiteSpace: 'nowrap', position: 'relative', display: 'inline-block', minWidth: '210px', textAlign: 'center' }}>
                Leave
              </span>
            </LiquidGlass>
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

// Screen-reader narration of major phase changes — see the matching function
// in Host.tsx for why this exists.
function phaseAnnouncement(phase: Phase, result: RoundResultEvent | null): string {
  const common = commonPhaseAnnouncement(phase, result);
  if (common !== null) return common;
  switch (phase) {
    case 'waiting': return 'Waiting for the host to start.';
    case 'betting': return 'Place your bid.';
    case 'bid_submitted': return 'Bid submitted. Waiting for others.';
    case 'watching': return 'Get ready. Listen closely.';
    case 'guessing': return 'Your turn to guess.';
    case 'passed': return 'Answer submitted.';
    default: return '';
  }
}

export default function Play() {
  const { pin: pinParam } = useParams<{ pin?: string }>();
  const game = usePlayGame(pinParam);
  const { phase, result, reconnecting, hostReconnecting, guesserNames, myName } = game;
  const imGuessing = guesserNames.includes(myName);
  const isJoin = phase === 'join';
  const showsGuessInput = phase === 'guessing' || (phase === 'watching' && imGuessing);

  // Fade the glow in after mount, out when leaving join phase.
  const [glowMounted, setGlowMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setGlowMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div
      className="relative"
      style={isJoin ? undefined : {
        background: '#080812',
        height: 'var(--app-height, 100vh)',
        minHeight: 'var(--app-height, 100vh)',
        ...(showsGuessInput ? { transition: 'height 0.25s ease, min-height 0.25s ease' } : {}),
      }}
    >
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse 80% 55% at 50% 115%, rgba(134,6,189,0.26) 0%, rgba(60,44,102,0.10) 45%, transparent 65%)',
          opacity: glowMounted && isJoin ? 1 : 0,
          transition: 'opacity 0.45s ease',
          zIndex: 0,
        }}
      />
      <div aria-live="polite" className="sr-only">{phaseAnnouncement(phase, result)}</div>
      {phase === 'join' && <JoinView game={game} />}
      {phase === 'waiting' && <WaitingView game={game} />}
      {phase === 'betting' && <BettingView game={game} />}
      {phase === 'bid_submitted' && <BidSubmittedView game={game} />}
      {phase === 'watching' && !imGuessing && <WatchingView game={game} />}
      {(phase === 'guessing' || (phase === 'watching' && imGuessing)) && <GuessingView game={game} />}
      {phase === 'passed' && <PassedView game={game} />}
      {phase === 'reveal' && result && (
        result.party?.format === 'year' || result.yearOnly
          ? <YearRevealView game={game} result={result} />
          : <RevealView game={game} result={result} />
      )}
      {(phase === 'leaderboard' || phase === 'finished') && <LeaderboardView game={game} />}

      <RoundIntro party={game.party} roundKey={game.roundIndex} dismissible={false} />
      {game.stealVictims && <StealPicker victims={game.stealVictims} onPick={game.submitStealVictim} onSkip={game.skipSteal} />}

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
