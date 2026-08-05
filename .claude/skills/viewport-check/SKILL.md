---
name: viewport-check
description: Find and fix viewport overflow/clipping bugs (content cut off at short/narrow/wide screens) using the local viewport-check script, iterating fix-by-fix with a separate commit per fix. Use when the user reports something cut off, overflowing, or not fitting on a phone/short/landscape/zoomed/large-monitor viewport, or asks to run/check viewports.
---

# Viewport check: find, fix, and reverify overflow bugs

`.github/scripts/viewport-check.js` renders the app's fixture screens at a matrix of
real device sizes and flags any element that visually overflows its clipping
ancestor — the "cut off at the edges" failure mode that a global
`overflow: hidden` on html/body hides from a normal scrollbar check. Not part
of CI; this skill runs it locally in an iterate-fix-reverify loop.

## Setup (once per session)

```bash
cd client && npx vite build --base=/   # must be --base=/, not the production /versed/ base
npx serve@14 client/dist -p 4321 -s &  # background; wait until curl -s http://localhost:4321 responds
```
If port 4321 is busy with a stale `serve`: `lsof -ti:4321 | xargs kill`.

Rebuild+restart serve whenever a fix changes client code — the server serves the built `dist/`, not source.

## Loop

1. **Scope the run.** Never start with a full sweep — it's ~20 views × 9 viewports × keyboard variants and is slow. If the user named a screen or symptom, scope to it:
   ```bash
   node .github/scripts/viewport-check.js --views host-reveal,player-guessing --viewports iphone14-390x844-portrait
   ```
   `--list` shows valid screen/viewport names. `--groups host|player|shared` and `--keyboard all|only|skip` narrow further. If nothing was named, start with `--groups` for the area under active work, or run the full matrix once to get a baseline list of failures to work through.

2. **Read a failure.** The console line names the offending element (tag/class/overflow px); the PNG lands in `.github/scripts/viewport-check-out/<group>/<screen>/<viewport>.png` (gitignored) for a visual look. Read the relevant component/CSS to find the cause — usually a fixed dimension, missing `min-height: 0`/`min-width: 0` on a flex child, or a scale transform not accounting for the shrunk viewport.

3. **If the screenshot + console line aren't enough to diagnose**, write a throwaway inspector script rather than guessing: a small Playwright script that navigates to `http://localhost:4321/screenshot?v=<fixture>`, sets the viewport, and `page.evaluate()`s computed styles / `getBoundingClientRect()` for the suspect selectors, then logs JSON. Put it in `/private/tmp/...` (the scratchpad) or delete it once done — it's a one-off, not something to commit or leave in `.github/scripts/`.

4. **Fix the CSS/layout**, one root cause at a time.

5. **Reverify with the same scoped command** from step 1 (same view + viewport) before moving on. Don't trust the fix until the script reports `✓`.

6. **Commit immediately after each confirmed fix**, before moving to the next failure — message describing the user-visible symptom (matches this repo's existing style, e.g. `fix: fit player watching screen on short viewports`, `fix: clamp award row label/name to one line`). Never batch multiple unrelated overflow fixes into one commit.

7. **Repeat** until the scoped failures are clear, then run the full matrix once (`node .github/scripts/viewport-check.js`) to catch regressions the scoped runs wouldn't have shown, before reporting done.

## Notes

- Screens/viewports/keyboard-shrink behavior are defined at the top of `viewport-check.js` — add a new fixture there (and a matching case in `client/src/pages/Screenshot.tsx`) if a screen isn't covered yet, rather than improvising a one-off check.
- `viewport-check-cinematic.js` is a separate one-off script for the host final-results podium cinematic specifically (needs real animation timing, not the frozen-animation fixtures the main script uses) — reach for it only if the bug is in that sequence. It expects the client dev server on :5180 (`npm run dev -w client`), not the built/served :4321.
- Decorative elements (`pointer-events: none`, 0 opacity, liquid-glass-react's internal filter SVG) are deliberately excluded from the overflow check — see the comments in `findOverflow()` before "fixing" something that's actually a correctly-ignored false positive.
