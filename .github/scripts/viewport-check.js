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
  // Heavier rosters (7 players, some with a second guess line) than the
  // 3-player fixtures above ever exercise — the actual worst case for a
  // reveal screen's vertical space, not just "more of the same row".
  { v: 'play-reveal-crowd', name: 'PlayRevealViewCrowd' },
  { v: 'reveal-crowd', name: 'HostRevealViewCrowd' },
  { v: 'year-crowd', name: 'HostYearRevealCrowd' },
];

// Text-input screens get a second pass with the on-screen keyboard "open" —
// see keyboardShrunkHeight() below. guessing-both (party's title+artist
// target) is the tightest case per GuessingView's own comments, so it only
// needs the keyboard-open pass, not a first plain one already covered by the
// others.
const KEYBOARD_VIEWS = [
  { v: 'guessing', name: 'GuessingView' },
  { v: 'year-guessing', name: 'YearGuessingView' },
  { v: 'guessing-both', name: 'GuessingViewBoth' },
];

// Scans every element for a bounding box that extends past its nearest
// clipping ancestor (the nearest overflow:hidden container going up to
// html/body, which are overflow:hidden globally) — the actual symptom
// (silent clipping), not just a proxy like document.scrollWidth (which an
// overflow:hidden ancestor would mask). Checked per axis and per element
// independently, because most of this app's own scroll containers only set
// overflow-y:auto (not the shorthand). Crucially, the ancestor walk *stops*
// at the first auto/scroll container it meets (reachable via scroll, so not
// a bug) instead of continuing past it looking for a hidden one further up
// (e.g. html/body) — otherwise every legitimately-scrollable reveal screen
// would falsely "fail" just for having content taller than the viewport.
// position:fixed elements skip the ancestor walk (fixed escapes normal
// clipping context) and are checked directly against the window instead.
// Small tolerance for subpixel rounding.
async function findOverflow(page) {
  return page.evaluate(() => {
    const TOLERANCE = 4;
    const offenders = [];

    function clipBound(el, axis) {
      let node = el.parentElement;
      while (node) {
        const val = getComputedStyle(node)[`overflow${axis}`];
        if (val === 'hidden') return node.getBoundingClientRect();
        if (val === 'auto' || val === 'scroll') return null;
        node = node.parentElement;
      }
      return null;
    }

    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      // pointer-events:none, non-interactive decorative layers (ambient glow
      // behind LiquidGlass pill labels, drawn via a deliberate negative-inset
      // bleed past their own box) are allowed to clip at the edge — that's
      // cosmetic, not a "user can't reach this" bug, and this codebase uses
      // that exact bleed pattern on every pill button.
      if (getComputedStyle(el).pointerEvents === 'none') continue;

      let overflow;
      if (getComputedStyle(el).position === 'fixed') {
        overflow = Math.max(r.right - window.innerWidth, -r.left, r.bottom - window.innerHeight, -r.top);
      } else {
        const xBound = clipBound(el, 'X');
        const yBound = clipBound(el, 'Y');
        const overflowX = xBound ? Math.max(r.right - xBound.right, xBound.left - r.left) : -Infinity;
        const overflowY = yBound ? Math.max(r.bottom - yBound.bottom, yBound.top - r.top) : -Infinity;
        overflow = Math.max(overflowX, overflowY);
      }

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

// Approximates an on-screen keyboard by shrinking the real viewport height —
// the same effect Android's interactive-widget=resizes-content produces (see
// useViewportLayout.ts's --app-height, which tracks window.innerHeight).
// Headless Chrome has no real IME, so visualViewport never diverges from
// innerHeight the way iOS's keyboard does — meaning this only exercises the
// Android-shaped half of the app's keyboard handling, not the iOS
// --keyboard-inset path. That's an accepted gap: per useViewportLayout's own
// comment, both platforms are driven through the same CSS, so this still
// catches a layout that can't cope with the keyboard's footprint. A
// landscape phone's keyboard eats a much bigger share of its short height
// than a portrait one, hence the different ratios.
function keyboardShrunkHeight(vp) {
  const ratio = vp.width > vp.height ? 0.55 : 0.42;
  return Math.max(120, Math.round(vp.height * (1 - ratio)));
}

async function runCheck(browser, vp, view, height, outSuffix, focusInput) {
  const page = await browser.newPage();
  await prepPage(page);
  await page.setViewportSize({ width: vp.width, height });
  await page.goto(`${BASE}/screenshot?v=${view.v}`);
  await page.waitForTimeout(500);
  if (focusInput) {
    await page.locator('input').first().focus();
    await page.waitForTimeout(300);
  }
  const offenders = await findOverflow(page);
  await page.screenshot({ path: `${OUT}/${view.name}__${vp.name}${outSuffix}.png` });
  await page.close();
  return offenders;
}

const failures = [];
try {
  const browser = await chromium.launch({ channel: 'chrome' });
  for (const vp of VIEWPORTS) {
    for (const view of VIEWS) {
      const offenders = await runCheck(browser, vp, view, vp.height, '', false);
      if (offenders.length > 0) {
        failures.push({ view: view.name, viewport: vp.name, offenders });
        console.log(`✗ ${view.name} @ ${vp.name}: ${offenders.map(o => `<${o.tag}.${o.cls}> +${o.overflowPx}px`).join(', ')}`);
      } else {
        console.log(`✓ ${view.name} @ ${vp.name}`);
      }
    }
    for (const view of KEYBOARD_VIEWS) {
      const label = `${view.name} @ ${vp.name} (keyboard open)`;
      const offenders = await runCheck(browser, vp, view, keyboardShrunkHeight(vp), '__keyboard', true);
      if (offenders.length > 0) {
        failures.push({ view: view.name, viewport: `${vp.name} (keyboard open)`, offenders });
        console.log(`✗ ${label}: ${offenders.map(o => `<${o.tag}.${o.cls}> +${o.overflowPx}px`).join(', ')}`);
      } else {
        console.log(`✓ ${label}`);
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
