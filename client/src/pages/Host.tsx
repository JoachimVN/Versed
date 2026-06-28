import { useState, useEffect, useRef, useCallback } from 'react';
import { socket } from '../socket';
import { useSpotify } from '../hooks/useSpotify';
import { APP_NAME } from '../config';
import type { QuizTrack, GameQuestion, LeaderboardEntry, PlayerResult } from '../types';

type Phase = 'connect' | 'building' | 'lobby' | 'question' | 'reveal' | 'leaderboard' | 'finished';

interface PlayerInfo { name: string; score: number }

export default function Host() {
  const spotify = useSpotify();
  const [phase, setPhase] = useState<Phase>('connect');
  const [tracks, setTracks] = useState<QuizTrack[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<QuizTrack[]>([]);
  const [searching, setSearching] = useState(false);
  const [pin, setPin] = useState('');
  const [players, setPlayers] = useState<PlayerInfo[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState<GameQuestion | null>(null);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [totalQuestions, setTotalQuestions] = useState(0);
  const [answeredCount, setAnsweredCount] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [revealData, setRevealData] = useState<{ correctIndex: number; results: PlayerResult[] } | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [error, setError] = useState('');
  const playTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (spotify.isConnected && phase === 'connect') setPhase('building');
  }, [spotify.isConnected, phase]);

  useEffect(() => {
    socket.connect();

    socket.on('player_joined', ({ players: p }: { players: PlayerInfo[] }) => {
      setPlayers(p);
    });

    socket.on('player_left', ({ players: p }: { players: PlayerInfo[] }) => {
      setPlayers(p);
    });

    socket.on(
      'host_question_start',
      ({ questionIndex: qi, total, question, playerCount }: {
        questionIndex: number;
        total: number;
        question: GameQuestion;
        playerCount: number;
      }) => {
        setCurrentQuestion(question);
        setQuestionIndex(qi);
        setTotalQuestions(total);
        setAnsweredCount(0);
        setIsPlaying(false);
        setRevealData(null);
        setPlayers((prev) => prev.slice(0, playerCount));
        setPhase('question');
      }
    );

    socket.on('player_answered', ({ answeredCount: ac }: { answeredCount: number }) => {
      setAnsweredCount(ac);
    });

    socket.on('host_answer_reveal', (data: { correctIndex: number; results: PlayerResult[] }) => {
      setRevealData(data);
      setPhase('reveal');
      if (playTimerRef.current) clearTimeout(playTimerRef.current);
      spotify.pauseTrack();
      setIsPlaying(false);
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
      socket.off('player_joined');
      socket.off('player_left');
      socket.off('host_question_start');
      socket.off('player_answered');
      socket.off('host_answer_reveal');
      socket.off('leaderboard');
      socket.off('game_over');
      socket.disconnect();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSearch = (q: string) => {
    setSearchQuery(q);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    if (!q.trim()) { setSearchResults([]); return; }
    searchDebounceRef.current = setTimeout(async () => {
      setSearching(true);
      const results = await spotify.searchTracks(q);
      setSearchResults(results);
      setSearching(false);
    }, 400);
  };

  const addTrack = (track: QuizTrack) => {
    if (tracks.some((t) => t.uri === track.uri)) return;
    setTracks((prev) => [...prev, track]);
  };

  const removeTrack = (uri: string) => {
    setTracks((prev) => prev.filter((t) => t.uri !== uri));
  };

  const createGame = () => {
    socket.emit('create_game', tracks, ({ pin: p, error: e }: { pin?: string; error?: string }) => {
      if (e) { setError(e); return; }
      setPin(p!);
      setPhase('lobby');
    });
  };

  const startGame = () => socket.emit('start_game');

  const handlePlayMusic = useCallback(async () => {
    if (!currentQuestion) return;
    setIsPlaying(true);
    await spotify.playTrack(currentQuestion.trackUri, currentQuestion.startMs);
    playTimerRef.current = setTimeout(async () => {
      await spotify.pauseTrack();
      setIsPlaying(false);
    }, currentQuestion.playDurationMs);
  }, [currentQuestion, spotify]);

  const handlePause = async () => {
    if (playTimerRef.current) clearTimeout(playTimerRef.current);
    await spotify.pauseTrack();
    setIsPlaying(false);
  };

  const revealAnswers = () => socket.emit('reveal_answers');
  const showLeaderboard = () => socket.emit('show_leaderboard');
  const nextQuestion = () => socket.emit('next_question');

  // ─── Views ────────────────────────────────────────────────────────────────

  if (phase === 'connect') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-6 p-6">
        <h1 className="text-4xl font-black text-white">{APP_NAME}</h1>
        {spotify.isConnected && !spotify.playerReady ? (
          <p className="text-white/60">Connecting to Spotify...</p>
        ) : (
          <p className="text-white/60">Connecting...</p>
        )}
      </div>
    );
  }

  if (phase === 'building') {
    const trackUris = new Set(tracks.map((t) => t.uri));
    return (
      <div className="min-h-screen flex flex-col p-4 gap-4 max-w-2xl mx-auto">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-black text-white">{APP_NAME}</h1>
          <span className="text-white/50 text-sm">
            {spotify.playerReady ? '🟢 Spotify ready' : '🟡 Loading Spotify...'}
          </span>
        </div>

        {/* Search */}
        <div>
          <input
            type="text"
            placeholder="Search for songs..."
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            className="w-full px-4 py-3 rounded-xl bg-white/10 text-white placeholder-white/40 outline-none focus:ring-2 focus:ring-white/30 text-lg"
          />
        </div>

        {/* Search Results */}
        {(searchResults.length > 0 || searching) && (
          <div className="rounded-xl overflow-hidden bg-white/5 divide-y divide-white/5">
            {searching && <p className="p-3 text-white/40 text-sm">Searching...</p>}
            {searchResults.map((track) => (
              <div key={track.uri} className="flex items-center gap-3 p-3">
                <img src={track.albumArt} alt="" className="w-10 h-10 rounded object-cover flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-white font-semibold truncate">{track.name}</p>
                  <p className="text-white/50 text-sm truncate">{track.artist}</p>
                </div>
                <button
                  onClick={() => addTrack(track)}
                  disabled={trackUris.has(track.uri)}
                  className="px-3 py-1.5 rounded-lg bg-white/10 text-white text-sm font-bold disabled:opacity-30 hover:bg-white/20 transition-colors flex-shrink-0"
                >
                  {trackUris.has(track.uri) ? 'Added' : '+ Add'}
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Selected Tracks */}
        {tracks.length > 0 && (
          <div>
            <p className="text-white/50 text-sm mb-2 font-semibold uppercase tracking-wide">
              Quiz ({tracks.length} song{tracks.length !== 1 ? 's' : ''})
            </p>
            <div className="rounded-xl overflow-hidden bg-white/5 divide-y divide-white/5">
              {tracks.map((track, i) => (
                <div key={track.uri} className="flex items-center gap-3 p-3">
                  <span className="text-white/30 text-sm w-5 text-center">{i + 1}</span>
                  <img src={track.albumArt} alt="" className="w-10 h-10 rounded object-cover flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-semibold truncate">{track.name}</p>
                    <p className="text-white/50 text-sm truncate">{track.artist}</p>
                  </div>
                  <button
                    onClick={() => removeTrack(track.uri)}
                    className="text-white/30 hover:text-red-400 transition-colors text-xl px-2"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <button
          onClick={createGame}
          disabled={tracks.length < 4 || !spotify.playerReady}
          className="w-full py-4 rounded-2xl bg-purple-600 text-white font-bold text-xl disabled:opacity-30 hover:bg-purple-500 active:scale-95 transition-all mt-auto"
        >
          {tracks.length < 4 ? `Add ${4 - tracks.length} more song${4 - tracks.length !== 1 ? 's' : ''}` : 'Create Game'}
        </button>
      </div>
    );
  }

  if (phase === 'lobby') {
    return (
      <div className="min-h-screen flex flex-col items-center p-6 gap-6">
        <h1 className="text-3xl font-black text-white">{APP_NAME}</h1>
        <div className="text-center">
          <p className="text-white/50 text-sm uppercase tracking-widest mb-1">Game PIN</p>
          <p className="text-7xl font-black text-white tracking-widest">{pin}</p>
        </div>
        <p className="text-white/40 text-sm">Players join at <span className="text-white/70">{window.location.origin}/play</span></p>
        <div className="w-full max-w-sm">
          <p className="text-white/50 text-sm mb-2">{players.length} player{players.length !== 1 ? 's' : ''} joined</p>
          <div className="flex flex-wrap gap-2">
            {players.map((p) => (
              <span key={p.name} className="px-3 py-1.5 rounded-full bg-white/10 text-white text-sm font-semibold">
                {p.name}
              </span>
            ))}
          </div>
        </div>
        <button
          onClick={startGame}
          disabled={players.length === 0}
          className="w-full max-w-sm py-4 rounded-2xl bg-purple-600 text-white font-bold text-xl disabled:opacity-30 hover:bg-purple-500 active:scale-95 transition-all mt-auto"
        >
          Start Game
        </button>
      </div>
    );
  }

  if (phase === 'question' && currentQuestion) {
    return (
      <div className="min-h-screen flex flex-col p-6 gap-6">
        <div className="flex items-center justify-between">
          <p className="text-white/50 font-semibold">Question {questionIndex + 1}/{totalQuestions}</p>
          <p className="text-white/50 font-semibold">PIN: {pin}</p>
        </div>

        <div className="flex items-center gap-4 bg-white/5 rounded-2xl p-4">
          {currentQuestion.albumArt && (
            <img src={currentQuestion.albumArt} alt="" className="w-20 h-20 rounded-xl object-cover flex-shrink-0" />
          )}
          <div>
            <p className="text-white/40 text-xs uppercase tracking-widest mb-0.5">Now playing</p>
            <p className="text-white text-xl font-bold">{currentQuestion.trackName}</p>
            <p className="text-white/60">{currentQuestion.artist}</p>
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={handlePlayMusic}
            disabled={isPlaying}
            className="flex-1 py-3 rounded-xl bg-[#1DB954] text-white font-bold text-lg disabled:opacity-50 hover:bg-[#1ed760] transition-colors"
          >
            {isPlaying ? 'Playing...' : '▶ Play Music'}
          </button>
          {isPlaying && (
            <button
              onClick={handlePause}
              className="px-5 py-3 rounded-xl bg-white/10 text-white font-bold hover:bg-white/20 transition-colors"
            >
              ⏸
            </button>
          )}
        </div>

        <div className="text-center py-4 bg-white/5 rounded-2xl">
          <p className="text-4xl font-black text-white">{answeredCount}</p>
          <p className="text-white/40 text-sm">of {players.length} answered</p>
        </div>

        <div className="grid grid-cols-2 gap-3 flex-1">
          {currentQuestion.answers.map((answer, i) => {
            const colors = ['bg-[#e74c3c]', 'bg-[#2980b9]', 'bg-[#f39c12]', 'bg-[#27ae60]'];
            return (
              <div key={i} className={`${colors[i]} rounded-2xl p-4 flex items-center justify-center text-center`}>
                <p className="text-white font-bold text-lg leading-tight">{answer}</p>
              </div>
            );
          })}
        </div>

        <button
          onClick={revealAnswers}
          className="w-full py-4 rounded-2xl bg-white text-navy-900 font-black text-xl hover:bg-white/90 active:scale-95 transition-all"
          style={{ color: '#0d0d1a' }}
        >
          Reveal Answers
        </button>
      </div>
    );
  }

  if (phase === 'reveal' && revealData && currentQuestion) {
    const { correctIndex, results } = revealData;
    const colors = ['bg-[#e74c3c]', 'bg-[#2980b9]', 'bg-[#f39c12]', 'bg-[#27ae60]'];
    const correctCount = results.filter((r) => r.isCorrect).length;
    return (
      <div className="min-h-screen flex flex-col p-6 gap-4">
        <p className="text-white/50 font-semibold text-center">
          Question {questionIndex + 1}/{totalQuestions}
        </p>
        <p className="text-center text-white/50 text-sm">Correct answer</p>
        <div className={`${colors[correctIndex]} rounded-2xl p-5 text-center`}>
          <p className="text-white font-black text-2xl">{currentQuestion.answers[correctIndex]}</p>
        </div>
        <p className="text-white/50 text-center text-sm">
          {correctCount}/{results.length} players got it right
        </p>
        <div className="overflow-y-auto flex-1 space-y-2">
          {results
            .sort((a, b) => (b.isCorrect ? 1 : 0) - (a.isCorrect ? 1 : 0))
            .map((r) => (
              <div
                key={r.name}
                className={`flex items-center justify-between px-4 py-3 rounded-xl ${r.isCorrect ? 'bg-green-900/40 border border-green-700/40' : 'bg-white/5'}`}
              >
                <span className="text-white font-semibold">{r.name}</span>
                <span className={`font-bold ${r.isCorrect ? 'text-green-400' : 'text-white/30'}`}>
                  {r.isCorrect ? `+${r.points}` : '—'}
                </span>
              </div>
            ))}
        </div>
        <button
          onClick={showLeaderboard}
          className="w-full py-4 rounded-2xl bg-purple-600 text-white font-bold text-xl hover:bg-purple-500 active:scale-95 transition-all"
        >
          Show Leaderboard
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
          {leaderboard.slice(0, 10).map((entry) => (
            <div
              key={entry.name}
              className={`flex items-center gap-4 px-4 py-3 rounded-xl ${
                entry.rank === 1
                  ? 'bg-yellow-500/20 border border-yellow-500/40'
                  : entry.rank === 2
                  ? 'bg-gray-400/10 border border-gray-400/20'
                  : entry.rank === 3
                  ? 'bg-orange-700/10 border border-orange-700/20'
                  : 'bg-white/5'
              }`}
            >
              <span className="text-2xl w-8 text-center">
                {entry.rank === 1 ? '🥇' : entry.rank === 2 ? '🥈' : entry.rank === 3 ? '🥉' : `${entry.rank}.`}
              </span>
              <span className="text-white font-bold flex-1 text-lg">{entry.name}</span>
              <span className="text-white/70 font-semibold">{entry.score.toLocaleString()}</span>
            </div>
          ))}
        </div>
        {phase === 'leaderboard' && (
          <button
            onClick={nextQuestion}
            className="w-full py-4 rounded-2xl bg-purple-600 text-white font-bold text-xl hover:bg-purple-500 active:scale-95 transition-all"
          >
            {questionIndex + 1 >= totalQuestions ? 'Final Results' : 'Next Question'}
          </button>
        )}
        {phase === 'finished' && (
          <button
            onClick={() => (window.location.href = '/host')}
            className="w-full py-4 rounded-2xl bg-white/10 text-white font-bold text-xl hover:bg-white/20 active:scale-95 transition-all"
          >
            New Game
          </button>
        )}
      </div>
    );
  }

  return null;
}
