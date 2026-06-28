import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { socket } from '../socket';
import { APP_NAME } from '../config';
import type { LeaderboardEntry } from '../types';

type Phase = 'join' | 'waiting' | 'question' | 'answered' | 'reveal' | 'leaderboard' | 'finished';

interface QuestionData {
  questionIndex: number;
  total: number;
  answers: string[];
  timeLimit: number;
}

interface RevealData {
  correctIndex: number;
  yourAnswerIndex: number;
  isCorrect: boolean;
  points: number;
  totalScore: number;
}

const ANSWER_COLORS = [
  { bg: 'bg-[#e74c3c]', hover: 'hover:bg-[#c0392b]', icon: '▲' },
  { bg: 'bg-[#2980b9]', hover: 'hover:bg-[#2471a3]', icon: '●' },
  { bg: 'bg-[#f39c12]', hover: 'hover:bg-[#d68910]', icon: '■' },
  { bg: 'bg-[#27ae60]', hover: 'hover:bg-[#1e8449]', icon: '◆' },
];

export default function Play() {
  const { pin: pinParam } = useParams<{ pin?: string }>();
  const [phase, setPhase] = useState<Phase>('join');
  const [pin, setPin] = useState(pinParam ?? '');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [question, setQuestion] = useState<QuestionData | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [timeLeft, setTimeLeft] = useState(0);
  const [reveal, setReveal] = useState<RevealData | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [myScore, setMyScore] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    socket.connect();

    socket.on('question_start', (data: QuestionData) => {
      setQuestion(data);
      setSelectedIndex(-1);
      setReveal(null);
      setTimeLeft(data.timeLimit);
      setPhase('question');

      timerRef.current = setInterval(() => {
        setTimeLeft((t) => {
          if (t <= 1) {
            clearInterval(timerRef.current!);
            return 0;
          }
          return t - 1;
        });
      }, 1000);
    });

    socket.on('answer_reveal', (data: RevealData) => {
      if (timerRef.current) clearInterval(timerRef.current);
      setReveal(data);
      setMyScore(data.totalScore);
      setPhase('reveal');
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
      setError('The host disconnected.');
      setPhase('join');
    });

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      socket.off('question_start');
      socket.off('answer_reveal');
      socket.off('leaderboard');
      socket.off('game_over');
      socket.off('host_disconnected');
      socket.disconnect();
    };
  }, []);

  const join = () => {
    const trimmedName = name.trim();
    const trimmedPin = pin.trim();
    if (!trimmedName || !trimmedPin) return;
    setError('');

    socket.emit(
      'join_game',
      { pin: trimmedPin, name: trimmedName },
      ({ success, error: e }: { success?: boolean; error?: string }) => {
        if (e) { setError(e); return; }
        if (success) setPhase('waiting');
      }
    );
  };

  const submitAnswer = (index: number) => {
    if (selectedIndex !== -1 || timeLeft === 0) return;
    setSelectedIndex(index);
    setPhase('answered');
    if (timerRef.current) clearInterval(timerRef.current);

    socket.emit('submit_answer', { answerIndex: index });
  };

  // ─── Join screen ──────────────────────────────────────────────────────────
  if (phase === 'join') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 gap-6">
        <h1 className="text-4xl font-black text-white">{APP_NAME}</h1>
        <div className="w-full max-w-xs flex flex-col gap-3">
          <input
            type="text"
            inputMode="numeric"
            placeholder="Game PIN"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            maxLength={6}
            className="w-full px-4 py-4 rounded-xl bg-white/10 text-white text-center text-2xl font-bold placeholder-white/30 outline-none focus:ring-2 focus:ring-white/30 tracking-widest"
          />
          <input
            type="text"
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && join()}
            maxLength={20}
            className="w-full px-4 py-4 rounded-xl bg-white/10 text-white text-center text-xl placeholder-white/30 outline-none focus:ring-2 focus:ring-white/30"
          />
          {error && <p className="text-red-400 text-sm text-center">{error}</p>}
          <button
            onClick={join}
            disabled={!pin.trim() || !name.trim()}
            className="w-full py-4 rounded-2xl bg-purple-600 text-white font-bold text-xl disabled:opacity-30 hover:bg-purple-500 active:scale-95 transition-all"
          >
            Join
          </button>
        </div>
      </div>
    );
  }

  // ─── Waiting room ─────────────────────────────────────────────────────────
  if (phase === 'waiting') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6">
        <div className="w-12 h-12 border-4 border-purple-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-white text-xl font-bold">{name}</p>
        <p className="text-white/50">Waiting for the host to start...</p>
      </div>
    );
  }

  // ─── Question / Answered ──────────────────────────────────────────────────
  if ((phase === 'question' || phase === 'answered') && question) {
    const timerPct = (timeLeft / question.timeLimit) * 100;
    const timerColor = timerPct > 50 ? 'bg-green-500' : timerPct > 20 ? 'bg-yellow-500' : 'bg-red-500';

    return (
      <div className="min-h-screen flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <span className="text-white/50 text-sm font-semibold">
            {question.questionIndex + 1}/{question.total}
          </span>
          <span className="text-white font-black text-xl">{timeLeft}s</span>
          <span className="text-white/50 text-sm font-semibold">{myScore.toLocaleString()} pts</span>
        </div>

        {/* Timer bar */}
        <div className="w-full h-1.5 bg-white/10">
          <div
            className={`h-full transition-all duration-1000 ${timerColor}`}
            style={{ width: `${timerPct}%` }}
          />
        </div>

        {/* Answer grid */}
        <div className="flex-1 grid grid-cols-2 gap-3 p-4">
          {question.answers.map((answer, i) => {
            const color = ANSWER_COLORS[i];
            const isSelected = selectedIndex === i;
            const isDisabled = selectedIndex !== -1 || timeLeft === 0;

            return (
              <button
                key={i}
                onClick={() => submitAnswer(i)}
                disabled={isDisabled}
                className={`
                  ${color.bg} ${!isDisabled ? color.hover : ''}
                  rounded-2xl p-4 flex flex-col items-center justify-center gap-2 text-center
                  transition-all active:scale-95
                  ${isDisabled && !isSelected ? 'opacity-40' : ''}
                  ${isSelected ? 'ring-4 ring-white scale-105' : ''}
                `}
              >
                <span className="text-white/80 text-2xl">{color.icon}</span>
                <span className="text-white font-bold text-base leading-tight">{answer}</span>
              </button>
            );
          })}
        </div>

        {phase === 'answered' && (
          <p className="text-center text-white/50 pb-6 text-sm">Waiting for others...</p>
        )}
        {timeLeft === 0 && phase === 'question' && (
          <p className="text-center text-white/50 pb-6 text-sm">Time's up!</p>
        )}
      </div>
    );
  }

  // ─── Reveal ───────────────────────────────────────────────────────────────
  if (phase === 'reveal' && reveal && question) {
    const colors = ANSWER_COLORS;
    const isCorrect = reveal.isCorrect;
    const didAnswer = reveal.yourAnswerIndex !== -1;

    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 gap-6 text-center">
        <div className={`w-24 h-24 rounded-full flex items-center justify-center text-5xl ${
          isCorrect ? 'bg-green-500/20' : 'bg-red-500/20'
        }`}>
          {isCorrect ? '✓' : didAnswer ? '✗' : '⏰'}
        </div>

        <div>
          <p className={`text-3xl font-black ${isCorrect ? 'text-green-400' : 'text-red-400'}`}>
            {isCorrect ? 'Correct!' : didAnswer ? 'Wrong!' : "Time's up!"}
          </p>
          {isCorrect && (
            <p className="text-white/50 mt-1">+{reveal.points} points</p>
          )}
        </div>

        <div className={`w-full rounded-2xl p-4 ${colors[reveal.correctIndex].bg}`}>
          <p className="text-white/70 text-sm mb-1">Correct answer</p>
          <p className="text-white font-black text-xl">{question.answers[reveal.correctIndex]}</p>
        </div>

        <div className="bg-white/5 rounded-2xl px-8 py-4">
          <p className="text-3xl font-black text-white">{reveal.totalScore.toLocaleString()}</p>
          <p className="text-white/40 text-sm">total score</p>
        </div>
      </div>
    );
  }

  // ─── Leaderboard / Finished ───────────────────────────────────────────────
  if (phase === 'leaderboard' || phase === 'finished') {
    const myEntry = leaderboard.find((e) => e.score === myScore);
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
          {leaderboard.slice(0, 10).map((entry) => (
            <div
              key={entry.name}
              className={`flex items-center gap-4 px-4 py-3 rounded-xl ${
                entry.score === myScore
                  ? 'bg-purple-600/20 border border-purple-500/40'
                  : 'bg-white/5'
              }`}
            >
              <span className="text-xl w-8 text-center">
                {entry.rank === 1 ? '🥇' : entry.rank === 2 ? '🥈' : entry.rank === 3 ? '🥉' : `${entry.rank}.`}
              </span>
              <span className="text-white font-bold flex-1">{entry.name}</span>
              <span className="text-white/60 font-semibold">{entry.score.toLocaleString()}</span>
            </div>
          ))}
        </div>

        {phase === 'finished' && (
          <button
            onClick={() => (window.location.href = '/')}
            className="w-full py-4 rounded-2xl bg-white/10 text-white font-bold text-xl hover:bg-white/20 active:scale-95 transition-all"
          >
            Play Again
          </button>
        )}

        {phase === 'leaderboard' && (
          <p className="text-center text-white/30 text-sm">Waiting for host...</p>
        )}
      </div>
    );
  }

  return null;
}
