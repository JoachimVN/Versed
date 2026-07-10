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

TypeScript type-checking is the main correctness check:
```bash
cd client && npx tsc --noEmit
cd server && npx tsc --noEmit
```

The server has a vitest suite covering the pure logic (`npm test -w server`): `fuzzyMatch.test.ts` is a characterization suite of guess-matching behavior — most cases lock in past playtest bug fixes, so a failure there usually means an old bug is coming back — and `scoring.test.ts` covers the bid ladder and race scoring. Add a case whenever a playtest finds a matching/scoring bug. Test files are excluded from the tsc build.

## Workflow

- **Branches**: day-to-day work lands on `dev`. PRs go `dev` → `main`, but only open one when asked. Never commit directly to `main`.
- **Commits**: one logical change per commit — never batch unrelated fixes/features together. Match the existing `git log` message style.
- **Verification split**: the user playtests the game manually (multiplayer/audio/timing can't be verified statically). When they say a change is verified, typecheck → commit → push without re-verifying. `tsc --noEmit` in the affected workspace is the shipping gate.
- **Skills**: `/ship` (typecheck + chunked commits + push to dev), `/screenshots` (regenerate `docs/screenshots/` locally instead of waiting for the CI bot), `/playtest` (triage a pasted bug list from a play session into per-fix commits).
- **Screenshots CI**: PRs touching `client/src/**` trigger `.github/workflows/screenshots.yml`, which pushes a `chore: update screenshots [skip ci]` commit to the branch — pull before assuming the branch is up to date after a PR.

## Architecture

Versed is a real-time multiplayer music guessing game. One player is the **host** (needs Spotify Premium), the rest are **players** who join via PIN.

### Topology

- **Client** — React SPA (Vite + Tailwind). In production, deployed to `joavn.dev/versed` (Vercel/portfolio). The `base` path is `/versed/` in production, `/` in dev.
- **Server** — Express + Socket.IO on Railway (port 3001). In production, also serves the client's built `dist/` as static files when `NODE_ENV=production` — so Railway is self-contained and the Vercel deployment is a separate optional route.
- **Socket connection** — `client/src/socket.ts` connects to `VITE_SERVER_URL` if set, otherwise falls back to `window.location.origin`. In dev the Vite proxy handles `/socket.io` → `:3001`.

### Game modes

- **Classic** — bid/tier flow (described under Game flow below).
- **Race** — everyone guesses at once; speed-based scoring, optional winner-only and artist-only toggles.
- **Party** — every round gets a random announced recipe (`buildPartyConfig` in `gameManager.ts`): a format (classic round, race round, or guess-the-year closest-wins), a guess target (title / artist / both, where "both" pays an artist bonus), and an optional event — double points, mystery multiplier (×1–3, hidden until the reveal), steal (round winner picks a victim via `choose_steal`/`steal_victim`, takes 15% min 300), snippet roulette (clip starts mid-song via `positionMs` on `play_song`), or full hints. Round 1 is a plain warm-up, events never repeat back-to-back, and the last round is a top-2 duel (first correct wins 1500). Non-classic party rounds ride the race flow; clients receive a sanitized `party` object on `round_start` and the revealed config on `round_result`.

### Game flow

All game state lives in-memory on the server (`gameManager.ts`). No database.

1. **Host** authenticates with Spotify OAuth (`/api/auth/spotify` → callback → redirects to `/host#access_token=...`, tokens in the URL fragment). Tokens go into `sessionStorage`, auto-refreshed every 50 min (and immediately when restored from storage).
2. Host calls `create_game` → server generates a 3-digit PIN and stores the `Game` object.
3. **Players** join via `/play` (or deep link `/play/:pin`) by emitting `join_game`.
4. Each round:
   - Server emits `host_round_start` with hints and betting time.
   - Players bid how many seconds of audio they need (from `BID_OPTIONS`). Lowest bid = least audio = higher score ceiling.
   - Server closes betting, groups players into **tiers** by bid value (`BidTier[]`). Lowest bidders guess first.
   - Host's Spotify Web Playback SDK plays the clip. The server emits `play_song`; the host prepares and starts the track, then emits `song_started` to sync everyone's timer.
   - Guessers type the song title. Matching uses fuzzy Levenshtein + homophone normalization (`fuzzyMatch.ts`). The title before a parenthetical also counts, as does a true subtitle (parenthetical content that isn't metadata like "feat."/"remastered").
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
- Bid bonus: up to 1000 pts, stepped down the `BID_OPTIONS` ladder — one equal notch (~77 pts) per ladder position, so a 0.1s bid pays meaningfully more than a 1s bid
- Difficulty bonus: up to 500 pts (based on song rank in the dataset)

The server sends `bidOptions` and per-option `bidScores` with each classic `round_start`; the client's bid picker uses those, so the preview can't drift from server scoring.

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
