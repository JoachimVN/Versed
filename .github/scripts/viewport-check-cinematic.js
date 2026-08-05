// One-off variant of viewport-check.js for the host final-results *cinematic*
// (the 3rd/2nd/1st reveal sequence before it settles into the recap panel).
// Not reusing runCheck()'s prepPage: that emulates prefers-reduced-motion,
// which makes FinalResultsView jump straight to 'settled' and skip the
// cinematic entirely -- exactly the state the existing host-final-results
// viewport-check entry captures instead. This hits the dev server directly
// and waits out real ceremony timing (112 BPM, see FinalResults.tsx) to land
// mid-hold on each podium stage.
//
//   npm run dev -w client   # (or any dev server on :5173)
//   node .github/scripts/viewport-check-cinematic.js
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE = 'http://localhost:5180';
const OUT = '.github/scripts/viewport-check-out';

const VIEWPORTS = [
  { name: 'desktop-1440x900', width: 1440, height: 900 },
  { name: 'desktop-2560x1440', width: 2560, height: 1440 },
];

// Timeline in FinalResults.tsx at 112 BPM (BEAT_MS ~= 535.71ms):
// bronze @1071ms (holds to 4821), silver @5357ms (holds to 9107),
// gold @9643ms (holds to 13929). Picking a point mid-hold for each.
const STAGES = [
  { id: 'bronze', waitMs: 2900 },
  { id: 'silver', waitMs: 7200 },
  { id: 'gold', waitMs: 11500 },
];

fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome' });
for (const vp of VIEWPORTS) {
  const page = await browser.newPage({ deviceScaleFactor: 2 });
  await page.setViewportSize({ width: vp.width, height: vp.height });
  for (const stage of STAGES) {
    await page.goto(`${BASE}/screenshot?v=final-host`);
    await page.waitForTimeout(500);
    await page.locator('button:has-text("final reveal")').click();
    await page.waitForTimeout(stage.waitMs);
    const outPath = path.join(OUT, 'host', `host-final-results-${stage.id}`, `${vp.name}.png`);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    await page.screenshot({ path: outPath });
    console.log(`✓ ${stage.id} @ ${vp.name} -> ${outPath}`);
  }
  await page.close();
}
await browser.close();
console.log(`\nDone — screenshots in ${OUT}/`);
