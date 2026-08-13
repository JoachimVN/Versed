import { useState, useEffect, useRef } from 'react';
import { socket } from '../../socket';
import { BID_OPTIONS } from '../../config';
import type { Award, Hint, LeaderboardEntry, PartyInfo, PointsBreakdown, RoundResultEvent } from '../../types';

export type Phase =
  | 'join' | 'waiting' | 'betting' | 'bid_submitted'
  | 'watching' | 'guessing' | 'passed' | 'reveal' | 'leaderboard' | 'finished';

type SavedPlayerSession = { pin: string; name: string; playerToken: string };

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
  myRank: { rank: number; total: number } | null;
  myPity: boolean;
  myPityAmount: number;
  myBreakdown: PointsBreakdown | null;
  myStreak: number;
  mode: 'classic' | 'race';
  artistOnly: boolean;
  yearOnly: boolean;
  choiceOptions: string[];
  party: PartyInfo | null;
  introParty: PartyInfo | null;
  artistGuessText: string;
  stealVictims: { name: string; score: number }[] | null;
  stealResult: { thief: string; victim: string; amount: number; skipped?: boolean } | null;
  myRacePoints: number;
  myRaceTimeMs: number | null;
  leaderboard: LeaderboardEntry[];
  leaderboardDeltas: Record<string, number>;
  awards: Award[];
  finalResultsSkipped: boolean;
  finishedAt: number | null;
  songPlaying: boolean;
  songTempo: number | null;
  reconnecting: boolean;
  hostReconnecting: boolean;
  savedSession: SavedPlayerSession | null;
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
  submitChoice: (option: string) => void;
  submitChaosTap: (index: number) => void;
  skipGuess: () => void;
  newGamePin: string | null;
  rejoinNewGame: () => void;
  renamePlayer: (newName: string) => void;
  waitingTransitionPending: boolean;
  completeWaitingTransition: () => void;
}

// Finale duelists (or, for underdog rounds, the trailing player(s)) are the
// only ones who actually get a turn — everyone else just listens along.
function isRestrictedFromTurn(party: PartyInfo | null, myName: string): boolean {
  let restricted: string[] | null = null;
  if (party?.finale) restricted = party.duelists;
  else if (party?.event === 'underdog') restricted = party.restricted;
  return !!restricted && !!myName && !restricted.includes(myName);
}

export function usePlayGame(pinParam?: string): PlayState {
  const [phase, setPhase] = useState<Phase>('join');
  const cameFromQR = !!pinParam;
  const [pin, setPin] = useState(pinParam ?? '');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [myName, setMyName] = useState('');
  const myNameRef = useRef('');
  const pinRef = useRef(pinParam ?? '');
  const playerTokenRef = useRef('');
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
  const [myPity, setMyPity] = useState(false);
  const [myPityAmount, setMyPityAmount] = useState(0);
  const [myBreakdown, setMyBreakdown] = useState<PointsBreakdown | null>(null);
  const [myStreak, setMyStreak] = useState(0);
  const [mode, setMode] = useState<'classic' | 'race'>('classic');
  const modeRef = useRef<'classic' | 'race'>('classic');
  const [artistOnly, setArtistOnly] = useState(false);
  const [yearOnly, setYearOnly] = useState(false);
  const [choiceOptions, setChoiceOptions] = useState<string[]>([]);
  const [party, setParty] = useState<PartyInfo | null>(null);
  const partyRef = useRef<PartyInfo | null>(null);
  // Separate from `party`: only updated on a genuine round start, never on
  // the `resync` round_start a reconnecting/mid-round-joining client gets
  // (see server/src/socket/sync.ts) — otherwise a player who steps away and
  // comes back mid-round would get the full-screen round announcement
  // replayed over a round already in progress.
  const [introParty, setIntroParty] = useState<PartyInfo | null>(null);
  const [artistGuessText, setArtistGuessText] = useState('');
  const artistGuessTextRef = useRef('');
  const [stealVictims, setStealVictims] = useState<{ name: string; score: number }[] | null>(null);
  const [stealResult, setStealResult] = useState<{ thief: string; victim: string; amount: number; skipped?: boolean } | null>(null);
  const [myRacePoints, setMyRacePoints] = useState(0);
  const [myRaceTimeMs, setMyRaceTimeMs] = useState<number | null>(null);
  // Rebuilt from every score_update (not the separate 'leaderboard' event,
  // which only fires once the reveal phase ends) so it's fresh the instant
  // the reveal screen mounts, matching what the host's own sorted standings
  // show for the same round.
  const [myRank, setMyRank] = useState<{ rank: number; total: number } | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const leaderboardRef = useRef<LeaderboardEntry[]>([]);
  const [leaderboardDeltas, setLeaderboardDeltas] = useState<Record<string, number>>({});
  const [awards, setAwards] = useState<Award[]>([]);
  const [finalResultsSkipped, setFinalResultsSkipped] = useState(false);
  const [finishedAt, setFinishedAt] = useState<number | null>(null);
  const [songPlaying, setSongPlaying] = useState(false);
  const [songTempo, setSongTempo] = useState<number | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [hostReconnecting, setHostReconnecting] = useState(false);
  const [newGamePin, setNewGamePin] = useState<string | null>(null);
  const newGamePinRef = useRef<string | null>(null);
  // Purely a visual-transition flag for the LogoMorph handoff between the
  // join card and the waiting card — never a source of truth for game state.
  // completeWaitingTransition() only ever moves phase 'join' -> 'waiting', so
  // a faster server event (e.g. the host starting the round mid-transition)
  // can't be clobbered by this firing late.
  const [waitingTransitionPending, setWaitingTransitionPending] = useState(false);
  const [savedSession, setSavedSession] = useState<SavedPlayerSession | null>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('versed_session') ?? 'null');
      return typeof saved?.pin === 'string' && typeof saved?.name === 'string' && typeof saved?.playerToken === 'string'
        ? saved
        : null;
    }
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

  function applyRaceRoundStart(data: { guessingEndsAt?: number; party?: PartyInfo | null }) {
    setGuesserNames([]);
    // On a resync mid-guessing window, land on the right phase in this
    // same render instead of starting on 'watching' and waiting for the
    // separate `your_turn` message to correct it a moment later — that
    // gap was visible as a flash of the wait-your-turn UI.
    if (data.guessingEndsAt) {
      setSongPlaying(true);
      startCountdown(data.guessingEndsAt);
      setPhase(isRestrictedFromTurn(data.party ?? null, myNameRef.current) ? 'watching' : 'guessing');
    } else {
      setPhase('watching');
    }
  }

  function applyClassicRoundStart(data: { bidOptions?: number[]; bidScores?: number[]; bettingTime?: number; endsAt?: number }) {
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

  useEffect(() => {
    socket.connect();

    // After any reconnect, re-attach this socket to the game so bids/guesses
    // aren't silently dropped (the new socket id is a stranger otherwise).
    socket.on('connect', () => {
      setReconnecting(false);
      if (myNameRef.current && pinRef.current && playerTokenRef.current) {
        socket.emit('rejoin_player', {
          pin: pinRef.current, name: myNameRef.current, playerToken: playerTokenRef.current,
        }, (res?: { ok: boolean }) => {
          if (res && !res.ok) {
            myNameRef.current = '';
            pinRef.current = '';
            playerTokenRef.current = '';
            setSavedSession(null);
            localStorage.removeItem('versed_session');
            setError('Game has ended.');
            setWaitingTransitionPending(false);
            setPhase('join');
          }
        });
      } else {
        try {
          const saved = JSON.parse(localStorage.getItem('versed_session') ?? 'null');
          if (saved?.pin && saved?.playerToken) {
            socket.emit('check_game', { pin: saved.pin }, ({ exists }: { exists: boolean }) => {
              if (!exists) {
                setSavedSession(null);
                localStorage.removeItem('versed_session');
              }
            });
          } else if (saved?.pin) {
            localStorage.removeItem('versed_session');
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
      mode?: 'classic' | 'race'; raceTime?: number; artistOnly?: boolean; yearOnly?: boolean; choiceOptions?: string[];
      party?: PartyInfo;
      bidOptions?: number[]; bidScores?: number[];
      tempo?: number | null;
      resync?: boolean;
      guessingEndsAt?: number;
    }) => {
      // A round starting is authoritative — it must win over a still-in-flight
      // waiting-screen morph transition, not get overwritten by it landing late.
      setWaitingTransitionPending(false);
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
      if (!data.resync) setIntroParty(data.party ?? null);
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
      // Always reset, never conditionally — an omitted/empty payload here
      // means this round fell back to free text, and a stale previous
      // round's choice buttons must not survive into it.
      setChoiceOptions(data.choiceOptions ?? []);

      if (roundMode === 'race') {
        applyRaceRoundStart(data);
      } else {
        applyClassicRoundStart(data);
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
      // Finale duelists (or, for underdog rounds, the trailing player(s)) are
      // the only ones who actually get to guess — everyone else just listens
      // along on the watching screen with the song + timer, no input.
      if (isRestrictedFromTurn(partyRef.current, myNameRef.current)) {
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
      // A steal round's second score_update (once the winner picks a victim)
      // arrives well after this one — reset here so that update's diff adds
      // onto this round's delta instead of a stale previous round's.
      setMyScoreDelta(0);
    });

    socket.on('score_update', ({ players }: { players: { name: string; score: number; streak: number; pity?: boolean; pityAmount?: number; breakdown?: PointsBreakdown }[] }) => {
      const me = players.find(p => p.name === myNameRef.current);
      if (me) {
        const diff = me.score - myScoreRef.current;
        // Merge rather than replace, and allow negative: a steal's diff must
        // add onto (not overwrite) the round's own delta, and a robbed
        // victim's score genuinely drops — clamping to 0 hid that entirely.
        setMyScoreDelta(prev => prev + diff);
        setMyPity(me.pity ?? false);
        setMyPityAmount(me.pityAmount ?? 0);
        setMyBreakdown(me.breakdown ?? null);
        myScoreRef.current = me.score;
        setMyScore(me.score);
        setMyStreak(me.streak);
        // Ties share a rank (standard competition ranking) rather than
        // splitting hairs over score-update arrival order.
        const ahead = players.filter(p => p.score > me.score).length;
        setMyRank({ rank: ahead + 1, total: players.length });
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

    socket.on('game_over', ({ leaderboard: lb, awards: aw, finishedAt: fa }: { leaderboard: LeaderboardEntry[]; awards?: Award[]; finishedAt?: number | null }) => {
      clearRoundTimers();
      applyLeaderboard(lb);
      setAwards(aw ?? []);
      setFinalResultsSkipped(false);
      setFinishedAt(fa ?? null);
      setPhase('finished');
    });

    // Host held down "skip" on the final-results cinematic — settle
    // immediately instead of sitting out the rest of the fixed-length
    // "look up at the board" timer for a ceremony that already ended.
    socket.on('final_results_skipped', () => {
      setFinalResultsSkipped(true);
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
      playerTokenRef.current = '';
      setSavedSession(null);
      localStorage.removeItem('versed_session');
      setWaitingTransitionPending(false);
      setPhase('join');
    });

    socket.on('kicked', () => {
      stopCountdown();
      setSavedSession(null);
      playerTokenRef.current = '';
      localStorage.removeItem('versed_session');
      setError('You were removed from the lobby.');
      setWaitingTransitionPending(false);
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
       'round_result','score_update','score_sync','leaderboard','game_over','final_results_skipped',
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
    socket.emit('join_game', { pin: p, name: n }, ({ success, playerToken, error: e }: { success?: boolean; playerToken?: string; error?: string }) => {
      if (e) { setError(e); return; }
      if (success && playerToken) {
        playerTokenRef.current = playerToken;
        myNameRef.current = n; pinRef.current = p; setMyName(n);
        setWaitingTransitionPending(true);
        const session = { pin: p, name: n, playerToken };
        setSavedSession(session);
        localStorage.setItem('versed_session', JSON.stringify(session));
      }
    });
  };

  const rejoinSaved = () => {
    if (!savedSession) return;
    const { pin: p, name: n, playerToken } = savedSession;
    setError('');
    socket.emit('join_game', { pin: p, name: n, playerToken }, ({ success, error: e }: { success?: boolean; error?: string }) => {
      if (e) {
        setError(e);
        setSavedSession(null);
        localStorage.removeItem('versed_session');
        return;
      }
      if (success) {
        playerTokenRef.current = playerToken;
        myNameRef.current = n;
        pinRef.current = p;
        setMyName(n);
        setWaitingTransitionPending(true);
      }
    });
  };

  // Only ever moves phase 'join' -> 'waiting' — if a server event (e.g. the
  // host starting the round) already moved phase on while the morph
  // transition was still in flight, this is a no-op rather than a regression.
  const completeWaitingTransition = () => {
    setWaitingTransitionPending(false);
    setPhase(p => (p === 'join' ? 'waiting' : p));
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

  // Multiple Choice: tapping an option submits its exact text immediately —
  // no typing state to manage, so this bypasses guessText/guessTextRef
  // entirely rather than routing through submitGuess (which reads from that
  // state and would otherwise race a just-set-but-not-yet-flushed value).
  const submitChoice = (option: string) => {
    if (guessAutoSubmitTimerRef.current) { clearTimeout(guessAutoSubmitTimerRef.current); guessAutoSubmitTimerRef.current = null; }
    stopCountdown();
    socket.emit('submit_guess', { text: option }, (r: { correct: boolean; points?: number; timeMs?: number }) => {
      if (r.correct && r.points != null) setMyRacePoints(r.points);
      if (r.timeMs != null) setMyRaceTimeMs(r.timeMs);
      setPhase('passed');
    });
  };

  // Chaos Hints: tapping a hint card submits its index immediately, same
  // "tap = submit" shape as submitChoice, but its own socket event since the
  // answer is an index, not free text.
  const submitChaosTap = (index: number) => {
    if (guessAutoSubmitTimerRef.current) { clearTimeout(guessAutoSubmitTimerRef.current); guessAutoSubmitTimerRef.current = null; }
    stopCountdown();
    socket.emit('submit_chaos_tap', { index }, (r: { correct: boolean; points?: number; timeMs?: number }) => {
      if (r.correct && r.points != null) setMyRacePoints(r.points);
      if (r.timeMs != null) setMyRaceTimeMs(r.timeMs);
      setPhase('passed');
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
    socket.emit('join_game', { pin: newPin, name: n }, ({ success, playerToken, error: e }: { success?: boolean; playerToken?: string; error?: string }) => {
      if (e) { setError(e); return; }
      if (success && playerToken) {
        playerTokenRef.current = playerToken;
        pinRef.current = newPin;
        setPin(newPin);
        newGamePinRef.current = null;
        setNewGamePin(null);
        // The replacement game has a new Player with a zero score. Reset the
        // local score baseline too, otherwise its first score_update is
        // compared with the previous game's total and looks like a loss.
        myScoreRef.current = 0;
        setMyScore(0);
        setMyScoreDelta(0);
        setMyRank(null);
        setMyPity(false);
        setMyPityAmount(0);
        setMyBreakdown(null);
        setMyStreak(0);
        setMyRacePoints(0);
        setMyRaceTimeMs(null);
        const session = { pin: newPin, name: n, playerToken };
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
        const session = { pin: pinRef.current, name: trimmed, playerToken: playerTokenRef.current };
        setSavedSession(session);
        localStorage.setItem('versed_session', JSON.stringify(session));
      }
    });
  };

  return {
    phase, pin, name, myName, error, roundIndex, totalRounds, hints,
    timeLeft, timerTotal, bettingTime, bidIndex, bidOptions, bidScores, myBid, guesserNames, lowestBid,
    guessText, result, myScore, myScoreDelta, myRank, myPity, myPityAmount, myBreakdown, myStreak, mode, artistOnly, yearOnly, choiceOptions, myRacePoints, myRaceTimeMs,
    party, introParty, artistGuessText, stealVictims, stealResult,
    leaderboard, leaderboardDeltas, awards, finalResultsSkipped, finishedAt, songPlaying, songTempo, reconnecting, hostReconnecting, savedSession, guessInputRef,
    cameFromQR, newGamePin, rejoinNewGame,
    setPin, setName,
    setArtistGuessText: (v: string) => {
      artistGuessTextRef.current = v;
      setArtistGuessText(v);
      socket.emit('update_guess_draft', { text: guessTextRef.current, artistText: v });
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
    socket.emit('update_guess_draft', { text: v, artistText: artistGuessTextRef.current });
  },
    join, rejoinSaved, submitBid, submitGuess, submitChoice, submitChaosTap, skipGuess, renamePlayer,
    waitingTransitionPending, completeWaitingTransition,
  };
}
