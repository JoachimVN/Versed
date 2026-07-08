# AGENTS.md

## Project overview

Versed is a real-time multiplayer music guessing game. It is an npm workspace
with a React/Vite client and an Express/Socket.IO server. The host authenticates
with Spotify Premium and controls playback; players join by PIN.

## Commands

Run commands from the repository root unless noted otherwise.

```bash
npm install                    # Install all workspace dependencies
npm run dev                    # Run client and server concurrently
npm run build                  # Build client, then server
npm run start                  # Start the compiled production server
npm run dev -w client          # Client only, on port 5173
npm run dev -w server          # Server only, on port 3001
npm run build -w client        # Type-check and build the client
npm run build -w server        # Type-check/build server and copy song data
```

There is currently no automated test suite. Use TypeScript checks and the full
build as the primary validation:

```bash
cd client && npx tsc --noEmit
cd server && npx tsc --noEmit
npm run build
```

Run the narrowest relevant checks during development, then run the full build
before handing off changes that affect both workspaces or production output.

## Repository layout

- `client/`: React 19 SPA using Vite, Tailwind CSS, React Router, and the
  Socket.IO client.
- `server/`: Express and Socket.IO server. All game state is in memory; there
  is no database.
- `server/src/index.ts`: HTTP setup, Socket.IO handlers, and round lifecycle.
- `server/src/gameManager.ts`: Game rules and state transitions. Keep this
  module free of I/O.
- `server/src/types.ts`: Shared server-side domain types.
- `server/src/fuzzyMatch.ts`: Guess normalization and fuzzy matching.
- `server/src/songLoader.ts`: Loads the CSV song catalogue at startup.
- `server/src/spotifyAuth.ts`: Spotify OAuth and token refresh routes.
- `client/src/pages/Host.tsx`: Host UI phases.
- `client/src/pages/Play.tsx`: Player UI phases.
- `client/src/hooks/useSpotify.ts`: Spotify Web Playback SDK integration.
- `client/src/socket.ts`: Singleton Socket.IO client; it does not auto-connect.
- `client/src/config.ts`: Backend URL and bid options.

## Architecture and implementation rules

- Treat the server as authoritative for game state, timing, scoring, round
  progression, and answer correctness.
- Keep pure game logic in `gameManager.ts`; keep network and process I/O in the
  server integration modules.
- When changing a Socket.IO event or payload, update the emitter and every
  consumer together, including reconnect and mid-game synchronization paths.
- Keep client scoring previews derived from values sent by the server. Do not
  duplicate scoring rules in the UI.
- Preserve the host playback handshake: the server requests playback, the host
  prepares/starts the track, and `song_started` establishes the audible start
  used for synchronized timing.
- Account for all game modes when changing round behavior: Classic, Race, and
  Party. Party mode may use classic, race, or year-guess flows plus round
  modifiers.
- Maintain compatibility with the production client base path `/versed/` and
  the development base path `/`.
- Never commit secrets, access tokens, refresh tokens, or local `.env` files.

## Local environment

Server configuration lives in `server/.env`; use the corresponding example file
when available. Important variables include:

- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`
- `SPOTIFY_REDIRECT_URI`
- `FRONTEND_URL`
- `CORS_ORIGINS`
- `PORT` (defaults to `3001`)
- `NODE_ENV`

For local Spotify OAuth, use
`http://127.0.0.1:3001/api/auth/callback`; do not substitute `localhost`.
`VITE_SERVER_URL` is only needed when the client and server are hosted
separately. In normal local development, Vite proxies `/api` and `/socket.io`
to the server.

## Deployment-sensitive changes

Railway builds both workspaces and starts the server, which serves the client
build in production. The health endpoint is `/api/health`. Changes to build
output, static serving, CORS, OAuth redirects, or environment handling should be
checked against `railway.toml` and the portfolio sync workflow/script.

## Git and change hygiene

- Preserve unrelated user changes in the worktree.
- Keep generated build output and local environment files out of commits.
- Explain validation performed and any remaining validation gaps in the final
  handoff.
- Always add `Co-authored-by: Codex <codex@openai.com>` to commits created by
  Codex.
