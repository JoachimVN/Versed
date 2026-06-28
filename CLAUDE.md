# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Run both client and server in dev mode (concurrent)
npm run dev

# Build everything (client then server)
npm run build

# Start production server
npm run start

# Client only
npm run dev -w client      # Vite dev server on :5173, proxies /api and /socket.io to :3001
npm run build -w client

# Server only
npm run dev -w server      # tsx watch, hot-reloads on :3001
npm run build -w server    # tsc + copies src/data/ to dist/
```

There are no tests. TypeScript type-checking is the main correctness check:
```bash
cd client && npx tsc --noEmit
cd server && npx tsc --noEmit
```

## Architecture

Versed is a real-time multiplayer music guessing game. One player is the **host** (needs Spotify Premium), the rest are **players** who join via PIN.

### Topology

- **Client** — React SPA (Vite + Tailwind). In production, deployed to `joavn.dev/versed` (Vercel/portfolio). The `base` path is `/versed/` in production, `/` in dev.
- **Server** — Express + Socket.IO on Railway (port 3001). In production, also serves the client's built `dist/` as static files when `NODE_ENV=production` — so Railway is self-contained and the Vercel deployment is a separate optional route.
- **Socket connection** — `client/src/socket.ts` connects to `VITE_SERVER_URL` if set, otherwise falls back to `window.location.origin`. In dev the Vite proxy handles `/socket.io` → `:3001`.

### Game flow

All game state lives in-memory on the server (`gameManager.ts`). No database.

1. **Host** authenticates with Spotify OAuth (`/api/auth/spotify` → callback → redirects to `/host?access_token=...`). Tokens go into `sessionStorage`, auto-refreshed every 50 min.
2. Host calls `create_game` → server generates a 3-digit PIN and stores the `Game` object.
3. **Players** join via `/play` (or deep link `/play/:pin`) by emitting `join_game`.
4. Each round:
   - Server emits `host_round_start` with hints and betting time.
   - Players bid how many seconds of audio they need (from `BID_OPTIONS`). Lowest bid = least audio = higher score ceiling.
   - Server closes betting, groups players into **tiers** by bid value (`BidTier[]`). Lowest bidders guess first.
   - Host's Spotify Web Playback SDK plays the clip. The server emits `play_song`; the host prepares and starts the track, then emits `song_started` to sync everyone's timer.
   - Guessers type the song title. Matching uses fuzzy Levenshtein + homophone normalization (`fuzzyMatch.ts`). A partial title (all words except the last) also counts.
   - If a tier's guessers all pass/fail, the next tier gets a turn with their longer bid duration.
5. `round_result` → `leaderboard`/`game_over`.

### Key server files

| File | Role |
|---|---|
| `server/src/index.ts` | Express + Socket.IO setup, CORS (reads `CORS_ORIGINS` or falls back to `FRONTEND_URL`), all socket event handlers |
| `server/src/gameManager.ts` | All game logic — pure functions operating on `Game` / `Round` types. No I/O. |
| `server/src/types.ts` | Shared type definitions (`Game`, `Round`, `Player`, `Song`, `BidTier`) |
| `server/src/songLoader.ts` | Parses `src/data/music_index_full.csv` at startup into `Song[]` |
| `server/src/fuzzyMatch.ts` | `isCorrectGuess()` — normalises text, runs Levenshtein, handles homophones |
| `server/src/spotifyAuth.ts` | OAuth routes: `/api/auth/spotify`, `/api/auth/callback`, `/api/auth/refresh` |

### Key client files

| File | Role |
|---|---|
| `client/src/pages/Host.tsx` | All host UI phases in one file, driven by `useHostGame()` hook |
| `client/src/pages/Play.tsx` | All player UI phases in one file, driven by `usePlayGame()` hook |
| `client/src/hooks/useSpotify.ts` | Spotify Web Playback SDK integration — loads SDK, manages device, `prepareTrack` / `startPrepared` / `pauseTrack` |
| `client/src/socket.ts` | Singleton socket instance (`autoConnect: false`) |
| `client/src/config.ts` | `BACKEND_URL` (from `VITE_SERVER_URL`) and `BID_OPTIONS` array |

### Scoring

`calcPoints(bid, rank)` in `gameManager.ts`:
- Base: 500 pts
- Bid bonus: up to 1000 pts (inversely proportional to seconds bid, capped at 60s)
- Difficulty bonus: up to 500 pts (based on song rank in the dataset)

### Environment variables

**Server** (`server/.env`, see `.env.example`):
- `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REDIRECT_URI`
- `FRONTEND_URL` — where to redirect after OAuth (empty in dev, production URL on Railway)
- `CORS_ORIGINS` — comma-separated allowed origins; falls back to `FRONTEND_URL` if unset
- `PORT` — defaults to 3001
- `NODE_ENV`

**Client** (only needed for split-host deployment):
- `VITE_SERVER_URL` — Railway URL; set in `client/.env.production` (gitignored)

### Deployment

Railway runs `npm run build` (builds both workspaces) then `npm run start` (starts the server which serves the client dist). The `railway.toml` configures this. Health check is at `/api/health`.

The `sync-portfolio.sh` script and `.github/workflows/sync-portfolio.yml` sync the client build to a separate portfolio repository for the `joavn.dev/versed` route.
