// Renders key screens at a matrix of real device viewports and flags any
// element that visually overflows the viewport (the "cut off at the edges"
// failure mode — global `overflow: hidden` on html/body means overflow never
// shows as a scrollbar, it just clips silently). Not part of CI; run locally
// after a layout/scaling change:
//
//   cd client && npx vite build --base=/
//   npx serve@14 client/dist -p 4321 -s &
//   node .github/scripts/viewport-check.js
//
// Screenshots land in .github/scripts/viewport-check-out/ (gitignored) for a
// visual look; the console summary is the pass/fail signal.
import fs from 'node:fs';
import { chromium } from 'playwright';
import { prepPage } from './screenshot-utils.js';

const BASE = 'http://localhost:4321';
const OUT = '.github/scripts/viewport-check-out';

// Real, currently-relevant device sizes rather than round numbers: the
// smallest phone still worth supporting (SE-class), two common modern phone
// sizes, and both of those rotated to landscape (short-viewport is the other
// failure axis — a tall fixed-height card that's fine in portrait can
// overflow vertically once width and height trade places).
const VIEWPORTS = [
  // Narrower than any real phone in normal use, but easily reached via
  // desktop browser zoom (reported repro: host reveal screen, Mac, zoomed in
  // a lot) or iOS's "Zoomed" display-size accessibility setting.
  { name: 'zoomed-desktop-280x600', width: 280, height: 600 },
  { name: 'se-320x568-portrait', width: 320, height: 568 },
  { name: 'iphone8-375x667-portrait', width: 375, height: 667 },
  { name: 'iphone14-390x844-portrait', width: 390, height: 844 },
  { name: 'android-360x740-portrait', width: 360, height: 740 },
  { name: 'iphone8-667x375-landscape', width: 667, height: 375 },
  { name: 'iphone14-844x390-landscape', width: 844, height: 390 },
];

const VIEWS = [
  { v: 'guessing', name: 'GuessingView' },
  { v: 'year-guessing', name: 'YearGuessingView' },
  { v: 'play-reveal', name: 'PlayRevealView' },
  { v: 'play-reveal-noone', name: 'PlayRevealViewNoOne' },
  { v: 'reveal', name: 'HostRevealView' },
  { v: 'year', name: 'HostYearReveal' },
];

// Scans every element for a bounding box that extends past the viewport —
// the actual symptom (silent clipping via the global `overflow: hidden`),
// not just a proxy like document.scrollWidth (which overflow:hidden
// ancestors would mask). Small tolerance for subpixel rounding.
async function findOverflow(page) {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const TOLERANCE = 4;
    const offenders = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      const overflow = Math.max(r.right - vw, -r.left);
      if (overflow > TOLERANCE) {
        offenders.push({
          tag: el.tagName.toLowerCase(),
          cls: typeof el.className === 'string' ? el.className.slice(0, 50) : '',
          overflowPx: Math.round(overflow),
        });
      }
    }
    return offenders.sort((a, b) => b.overflowPx - a.overflowPx).slice(0, 3);
  });
}

fs.mkdirSync(OUT, { recursive: true });

const failures = [];
try {
  const browser = await chromium.launch({ channel: 'chrome' });
  for (const vp of VIEWPORTS) {
    for (const view of VIEWS) {
      const page = await browser.newPage();
      await prepPage(page);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(`${BASE}/screenshot?v=${view.v}`);
      await page.waitForTimeout(500);
      const offenders = await findOverflow(page);
      const outFile = `${OUT}/${view.name}__${vp.name}.png`;
      await page.screenshot({ path: outFile });
      await page.close();
      if (offenders.length > 0) {
        failures.push({ view: view.name, viewport: vp.name, offenders });
        console.log(`✗ ${view.name} @ ${vp.name}: ${offenders.map(o => `<${o.tag}.${o.cls}> +${o.overflowPx}px`).join(', ')}`);
      } else {
        console.log(`✓ ${view.name} @ ${vp.name}`);
      }
    }
  }
  await browser.close();
} catch (e) {
  console.error(e);
  process.exit(1);
}

console.log(`\n${failures.length === 0 ? 'All clear' : `${failures.length} overflow(s) found`} — screenshots in ${OUT}/`);
if (failures.length > 0) process.exit(1);
