import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import dotenv from 'dotenv';
import authRouter from './spotifyAuth';
import * as gm from './gameManager';
import { setIo } from './socket/context';
import { registerHostHandlers } from './socket/hostHandlers';
import { registerPlayerHandlers } from './socket/playerHandlers';
import { registerDisconnectHandler } from './socket/disconnect';

dotenv.config();
gm.initSongs();

const allowedOrigins = new Set(
  (process.env.CORS_ORIGINS || process.env.FRONTEND_URL || '')
    .split(',')
    .map((origin) => {
      try { return new URL(origin.trim()).origin; } catch { return origin.trim(); }
    })
    .filter(Boolean),
);

const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    if (!origin) return callback(null, true);
    if (process.env.NODE_ENV !== 'production') return callback(null, true);
    if (allowedOrigins.has(origin)) return callback(null, true);
    return callback(new Error('CORS origin not allowed'));
  },
  methods: ['GET', 'POST'],
};

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: corsOptions,
});

app.use(cors(corsOptions));
app.use(express.json());
app.use(rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
}));
app.use('/api/auth', authRouter);
app.get('/api/health', (_req, res) => res.json({ ok: true }));

if (process.env.NODE_ENV === 'production') {
  const clientDist = path.join(__dirname, '../../client/dist');
  app.use(express.static(clientDist, {
    // index.html references content-hashed bundle filenames, so it must be
    // revalidated on every load; everything else (JS/CSS bundles, theme.mp3,
    // images) is safe to cache for a day instead of round-tripping to Railway
    // to revalidate on every single page load.
    setHeaders: (res, filePath) => {
      res.setHeader('Cache-Control', filePath.endsWith('.html') ? 'no-cache' : 'public, max-age=86400');
    },
  }));
  app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

setIo(io);

io.on('connection', (socket) => {
  console.log(`[socket] connected: ${socket.id}`);
  socket.on('disconnect', (reason) => console.log(`[socket] disconnected: ${socket.id} (${reason})`));

  registerHostHandlers(socket);
  registerPlayerHandlers(socket);
  registerDisconnectHandler(socket);
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => console.log(`Server on port ${PORT}`));
