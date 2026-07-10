---
name: screenshots
description: Regenerate and visually verify Versed README and documentation screenshots locally. Use when the user asks to update, run, redo, or inspect screenshots, or when a Versed UI change should be reflected in docs/screenshots.
---

# Regenerate Versed screenshots

Mirror `.github/workflows/screenshots.yml` locally so screenshot changes can be reviewed before CI.

## Workflow

1. Inspect `git status --short` and preserve unrelated changes.
2. Build the client with the development base path:

   ```bash
   cd client && npx vite build --base=/
   ```

3. Serve `client/dist` on port 4321 from the repository root:

   ```bash
   npx serve@14 client/dist -p 4321 -s
   ```

   Poll `http://localhost:4321` until it responds. If the port is occupied, identify the process and stop it only when it is a stale server from this workflow.

4. Run the repository screenshot script:

   ```bash
   node .github/scripts/screenshots.js
   ```

   Dependencies live in `.github/scripts/`. If they are missing, run `npm ci --ignore-scripts` there. Install Playwright Chromium only when the local browser binary is missing.

5. Inspect every changed PNG in `docs/screenshots/`. Confirm that each image is non-blank, fully rendered, and captured after animations settle. Investigate broken output before handing it off.
6. Stop the static server started by this workflow.
7. Report changed and unchanged screenshots. Do not commit or push unless the user explicitly asks.

## Commit behavior

When the user explicitly asks to commit, stage only `docs/screenshots/` and use `chore: update screenshots [skip ci]` with the required Codex co-author trailer. Never push unless explicitly requested.

## Repository details

- Screenshots come from `/` and `/screenshot?v=...` fixtures in `client/src/pages/Screenshot.tsx`.
- Add a fixture variant and a matching `take(...)` call in `.github/scripts/screenshots.js` when documentation needs a new UI phase.
- The script's `saveIfChanged` behavior intentionally leaves pixel-identical PNGs untouched.
