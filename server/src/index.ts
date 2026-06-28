import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import dotenv from 'dotenv';
import authRouter from './spotifyAuth';
import * as gm from './gameManager';
import { QuizTrack } from './types';

dotenv.config();

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

app.use(cors({ origin: '*' }));
app.use(express.json());

app.use('/api/auth', authRouter);

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Serve React build in production
if (process.env.NODE_ENV === 'production') {
  const clientDist = path.join(__dirname, '../../client/dist');
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

io.on('connection', (socket) => {
  socket.on('create_game', (tracks: QuizTrack[], callback: (res: { pin?: string; error?: string }) => void) => {
    if (!Array.isArray(tracks) || tracks.length < 4) {
      return callback({ error: 'Need at least 4 songs' });
    }
    const game = gm.createGame(socket.id, tracks);
    socket.join(game.pin);
    socket.join(`host:${game.pin}`);
    callback({ pin: game.pin });
  });

  socket.on(
    'join_game',
    (
      { pin, name }: { pin: string; name: string },
      callback: (res: { error?: string; success?: boolean }) => void
    ) => {
      const game = gm.getGame(pin);
      if (!game) return callback({ error: 'Game not found' });
      if (game.phase !== 'lobby') return callback({ error: 'Game already started' });

      const player = gm.addPlayer(game, socket.id, name);
      if (!player) return callback({ error: 'Name already taken' });

      socket.join(pin);
      socket.join(`player:${pin}`);
      callback({ success: true });

      const players = Array.from(game.players.values()).map((p) => ({
        name: p.name,
        score: p.score,
      }));
      io.to(`host:${pin}`).emit('player_joined', { name: player.name, players });
    }
  );

  socket.on('start_game', () => {
    const game = gm.getGameBySocket(socket.id);
    if (!game || game.hostSocketId !== socket.id || game.phase !== 'lobby') return;

    game.phase = 'question';
    game.currentQuestion = 0;
    game.answers.clear();
    game.questionStartTime = Date.now();

    const q = game.questions[0];
    io.to(`player:${game.pin}`).emit('question_start', {
      questionIndex: 0,
      total: game.questions.length,
      answers: q.answers,
      timeLimit: q.timeLimit,
    });
    io.to(`host:${game.pin}`).emit('host_question_start', {
      questionIndex: 0,
      total: game.questions.length,
      question: q,
      playerCount: game.players.size,
    });
  });

  socket.on(
    'submit_answer',
    (
      { answerIndex }: { answerIndex: number },
      callback?: (res: { error?: string; isCorrect?: boolean; points?: number }) => void
    ) => {
      const game = gm.getGameBySocket(socket.id);
      if (!game) return callback?.({ error: 'Not in a game' });

      const answer = gm.recordAnswer(game, socket.id, answerIndex);
      if (!answer) return callback?.({ error: 'Cannot answer now' });

      callback?.({ isCorrect: answer.isCorrect, points: answer.points });

      const player = game.players.get(socket.id);
      io.to(`host:${game.pin}`).emit('player_answered', {
        name: player?.name,
        answeredCount: game.answers.size,
        totalPlayers: game.players.size,
      });
    }
  );

  socket.on('reveal_answers', () => {
    const game = gm.getGameBySocket(socket.id);
    if (!game || game.hostSocketId !== socket.id) return;

    game.phase = 'reveal';
    const q = game.questions[game.currentQuestion];

    for (const [sid, player] of game.players) {
      const answer = game.answers.get(sid);
      io.to(sid).emit('answer_reveal', {
        correctIndex: q.correctIndex,
        yourAnswerIndex: answer?.answerIndex ?? -1,
        isCorrect: answer?.isCorrect ?? false,
        points: answer?.points ?? 0,
        totalScore: player.score,
      });
    }

    const results = Array.from(game.players.entries()).map(([sid, player]) => {
      const answer = game.answers.get(sid);
      return {
        name: player.name,
        answerIndex: answer?.answerIndex ?? -1,
        isCorrect: answer?.isCorrect ?? false,
        points: answer?.points ?? 0,
      };
    });
    io.to(`host:${game.pin}`).emit('host_answer_reveal', {
      correctIndex: q.correctIndex,
      results,
    });
  });

  socket.on('show_leaderboard', () => {
    const game = gm.getGameBySocket(socket.id);
    if (!game || game.hostSocketId !== socket.id) return;

    game.phase = 'leaderboard';
    const leaderboard = gm.getLeaderboard(game);
    io.to(game.pin).emit('leaderboard', { leaderboard });
  });

  socket.on('next_question', () => {
    const game = gm.getGameBySocket(socket.id);
    if (!game || game.hostSocketId !== socket.id) return;

    game.currentQuestion += 1;

    if (game.currentQuestion >= game.questions.length) {
      game.phase = 'finished';
      const leaderboard = gm.getLeaderboard(game);
      io.to(game.pin).emit('game_over', { leaderboard });
      return;
    }

    game.phase = 'question';
    game.answers.clear();
    game.questionStartTime = Date.now();

    const q = game.questions[game.currentQuestion];
    io.to(`player:${game.pin}`).emit('question_start', {
      questionIndex: game.currentQuestion,
      total: game.questions.length,
      answers: q.answers,
      timeLimit: q.timeLimit,
    });
    io.to(`host:${game.pin}`).emit('host_question_start', {
      questionIndex: game.currentQuestion,
      total: game.questions.length,
      question: q,
      playerCount: game.players.size,
    });
  });

  socket.on('disconnect', () => {
    const result = gm.removeSocket(socket.id);
    if (!result) return;
    const { game, wasHost } = result;

    if (wasHost) {
      io.to(game.pin).emit('host_disconnected');
      gm.cleanupGame(game.pin);
    } else {
      const players = Array.from(game.players.values()).map((p) => ({
        name: p.name,
        score: p.score,
      }));
      io.to(`host:${game.pin}`).emit('player_left', { players });
    }
  });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
