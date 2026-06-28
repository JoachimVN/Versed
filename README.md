# Versed

A real-time, multiplayer music quiz with a bidding twist. The host's screen is the
"board" (think Kahoot / Hitster); everyone else plays from their phone. Each round
you don't just guess the song — you **bid how few seconds of it you need to hear**.
Lowest bid wins the right to guess. Hear less, score more.

Powered by the **Spotify Web Playback SDK**, so the host streams real tracks at full
quality straight from their Spotify account.

---

## How it plays

1. **Host** opens the app, connects Spotify, and gets a short game **PIN**.
2. **Players** join from their phones at `/play` by entering the PIN and a name.
3. Each round runs through four phases:
   - **Bidding** (15s) — everyone sees a few optional hints (era, chart peak,
     artist initials…) and bids how few seconds they'd need: `0.1s` up to `60s`.
   - **Playback** — the lowest bidder(s) win. A 3-second countdown buffers the
     track, then it plays for *exactly* the winning bid duration.
   - **Guessing** (15s) — the winner(s) type the title. Answers are fuzzy-matched,
     so minor typos and punctuation still count.
   - **Reveal** — the song and points are shown, then the running leaderboard.
4. After **10 rounds**, final scores are tallied.

**Scoring** rewards bold, low bids and rarer songs:

```
points = 500  +  up to 1000 (lower bid → more)  +  up to 500 (rarer song → more)
```

> Requires **Spotify Premium** on the host account (a Web Playback SDK requirement).

---

## Tech stack

| Layer      | Stack                                                                 |
| ---------- | --------------------------------------------------------------------- |
| Client     | React 18, TypeScript, Vite, Tailwind CSS, lucide-react, React Router  |
| Realtime   | Socket.IO (client + server)                                           |
| Server     | Node, Express, TypeScript (tsx in dev)                                |
| Audio      | Spotify Web Playback SDK + Spotify Web API                            |
| Tooling    | npm workspaces monorepo                                               |

Game timing is **server-authoritative** — the server drives round phases and the
host confirms the real audible start of each clip, so durations stay accurate.

---

## Project structure

```
Versed/
├── client/                 # React app (host board + player controller)
│   └── src/
│       ├── pages/          # Home, Host, Play
│       ├── hooks/          # useSpotify (Web Playback SDK + precise timing)
│       └── components/     # shared UI (e.g. RankBadge)
├── server/                 # Express + Socket.IO game server
│   └── src/
│       ├── index.ts        # HTTP + socket wiring, round lifecycle
│       ├── gameManager.ts  # game/round state, scoring, hints
│       ├── spotifyAuth.ts  # Spotify OAuth (login, callback, refresh)
│       ├── songLoader.ts   # loads the song catalogue from CSV
│       ├── fuzzyMatch.ts   # tolerant guess matching
│       └── data/           # music_index_full.csv (song catalogue)
├── railway.toml            # Railway deploy config
└── package.json            # workspace root + dev/build/start scripts
```

---

## Getting started

### Prerequisites

- **Node 18+** and npm
- A **Spotify Premium** account
- A Spotify app from the [Developer Dashboard](https://developer.spotify.com/dashboard)

### 1. Install

```bash
git clone https://github.com/JoachimVN/Versed.git
cd Versed
npm install
```

### 2. Configure your Spotify app

In the Spotify Developer Dashboard, add this **Redirect URI** to your app:

```
http://127.0.0.1:3001/api/auth/callback
```

> Use `127.0.0.1`, **not** `localhost` — Spotify no longer accepts `localhost` as a
> redirect host. For the same reason, open the app at `http://127.0.0.1:5173`.

### 3. Environment variables

Create `server/.env`:

```bash
SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret
SPOTIFY_REDIRECT_URI=http://127.0.0.1:3001/api/auth/callback
FRONTEND_URL=http://127.0.0.1:5173      # where to send the user after login
PORT=3001                               # optional, defaults to 3001
```

The client reads `VITE_SERVER_URL` (defaults to same-origin). For local dev you can
leave it unset — Vite proxies `/api` and `/socket.io` to the server automatically.
To point the client at a separate backend, create `client/.env`:

```bash
VITE_SERVER_URL=http://127.0.0.1:3001
```

### 4. Run

```bash
npm run dev
```

This starts both workspaces concurrently:

- **Host / players:** http://127.0.0.1:5173 (player view at `/play`)
- **API + sockets:** http://127.0.0.1:3001

Open the host view on a laptop/TV, then join from phones at
`http://<your-machine-ip>:5173/play` (Vite is exposed on the local network).

---

## Scripts

Run from the repo root:

| Command          | What it does                                            |
| ---------------- | ------------------------------------------------------- |
| `npm run dev`    | Runs client (Vite) and server (tsx watch) together      |
| `npm run build`  | Builds the client, then type-checks/compiles the server |
| `npm start`      | Starts the production server (`node dist/index.js`)     |

In production (`NODE_ENV=production`) the server serves the built client from
`client/dist`, so the whole app runs from a single origin/port.

---

## Deployment

The repo is configured for **Railway** via `railway.toml` (nixpacks builder,
`npm run build` → `npm start`, health check at `/api/health`).

For any host, the recipe is:

1. Set `NODE_ENV=production` and the Spotify env vars (with a **production** redirect
   URI, e.g. `https://your-domain/api/auth/callback`).
2. Add that redirect URI to your Spotify app.
3. `npm run build` then `npm start`.

---

## Configuration

Gameplay constants live in `server/src/gameManager.ts`:

| Constant        | Default      | Meaning                          |
| --------------- | ------------ | -------------------------------- |
| `TOTAL_ROUNDS`  | `10`         | Rounds per game                  |
| `BETTING_TIME`  | `15`         | Seconds to place a bid           |
| `GUESSING_TIME` | `15`         | Seconds to type a guess          |
| `BID_OPTIONS`   | `0.1 … 60`   | Selectable bid lengths (seconds) |

### Song catalogue

Songs are loaded at startup from `server/src/data/music_index_full.csv`. Each row
provides a Spotify track URL plus metadata (release year, decade, Billboard chart
weeks/peak, stream count) used to generate the optional in-round hints. Swap in your
own CSV with the same columns to change the music pool.

---

## Notes

- The host must keep the app tab open and active — it's the device actually
  streaming audio via the Web Playback SDK.
- If a song "plays short" or sub-second bids feel silent, that's the physical floor
  of streaming start-up latency; the app times each clip from the real audible start
  to keep it as tight as possible.
