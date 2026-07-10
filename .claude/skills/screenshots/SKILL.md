---
name: screenshots
description: Regenerate the README/docs screenshots locally (build client, serve on :4321, run the Playwright script), review the output, and commit "chore: update screenshots [skip ci]". Use when the user asks to update/run/redo the screenshots, or after a UI change that should be reflected in docs/screenshots.
---

# Regenerate Versed screenshots locally

Mirrors `.github/workflows/screenshots.yml` so screenshots can be refreshed without waiting for CI.

## Steps

1. **Build the client** (must be `--base=/`, not the production `/versed/` base):
   ```bash
   cd client && npx vite build --base=/
   ```

2. **Serve the build on port 4321** (background):
   ```bash
   npx serve@14 client/dist -p 4321 -s
   ```
   Wait until `curl -s http://localhost:4321` responds. If 4321 is busy, kill the stale `serve` first (`lsof -ti:4321 | xargs kill`).

3. **Run the screenshot script** from the repo root:
   ```bash
   node .github/scripts/screenshots.js
   ```
   Dependencies live in `.github/scripts/` (own package.json). If Playwright/Chromium is missing: `cd .github/scripts && npm ci --ignore-scripts && ./node_modules/.bin/playwright install chromium`.
   The script only rewrites a PNG when pixels actually changed (`saveIfChanged`), so an unchanged file means no visual diff — that's normal.

4. **Look at the results.** Read the changed PNGs in `docs/screenshots/` and sanity-check them (nothing blank, misrendered, or mid-animation). If a shot looks broken, investigate before committing.

5. **Kill the serve process**, then commit only if something changed:
   ```bash
   git add docs/screenshots/
   git commit -m "chore: update screenshots [skip ci]"
   ```
   Push only if the user asked to push.

## Notes

- The shots come from `/` and `/screenshot?v=...` fixture views (`client/src/pages/Screenshot.tsx`) — if a new UI phase should appear in docs, add a fixture variant there and a `take(...)` line in `.github/scripts/screenshots.js`.
- CI runs this same flow on PRs touching `client/src/**`, so a local run pre-empts the bot commit.
