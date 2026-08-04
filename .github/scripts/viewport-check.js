// Renders key screens at a matrix of real device viewports and flags any
// element that visually overflows the viewport (the "cut off at the edges"
// failure mode — global `overflow: hidden` on html/body means overflow never
// shows as a scrollbar, it just clips silently). Not part of CI; run locally
// after a layout/scaling change:
//
//   npm exec -w client vite -- build --base=/
//   npx serve@14 client/dist -p 4321 -s &
//   node .github/scripts/viewport-check.js --views host-reveal,player-guessing --viewports iphone14-390x844-portrait
//
// Screenshots land in .github/scripts/viewport-check-out/<group>/<screen>/
// (gitignored) for a visual look; the console summary is the pass/fail signal.
// Run with --help for the full filtering reference, or --list to see the
// available screen and viewport names without launching a browser.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { prepPage } from './screenshot-utils.js';

const BASE = 'http://localhost:4321';
const OUT = '.github/scripts/viewport-check-out';

function parseCommaList(value) {
  return value.split(',').map(item => item.trim()).filter(Boolean);
}

function parseArgs(args) {
  const options = { views: [], groups: [], viewports: [], keyboard: 'all', list: false, help: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--list') options.list = true;
    else if (arg === '--views' || arg === '--groups' || arg === '--viewports' || arg === '--keyboard') {
      if (!value || value.startsWith('--')) throw new Error(`${arg} needs a value.`);
      const key = arg.slice(2);
      options[key] = key === 'keyboard' ? value : parseCommaList(value);
      index += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!['all', 'only', 'skip'].includes(options.keyboard)) {
    throw new Error('--keyboard must be one of: all, only, skip.');
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node .github/scripts/viewport-check.js [options]

Options:
  --views <name,...>       Capture only named screens (screen id, fixture id, or display name).
  --groups <name,...>      Capture only screen groups: host, player, shared.
  --viewports <name,...>   Capture only named device viewports.
  --keyboard <mode>        all (default), only, or skip keyboard-shrunken captures.
  --list                   List selectable screens and viewports, then exit.
  --help, -h               Show this help.

Examples:
  node .github/scripts/viewport-check.js --views host-reveal --viewports iphone14-390x844-portrait
  node .github/scripts/viewport-check.js --groups player --keyboard only
  node .github/scripts/viewport-check.js --views final-host,final-player --viewports desktop-1440x900`);
}

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
  // The everyday host-view case, not just a stress case: the host's actual
  // 1440x900 MacBook display, run fullscreen. Any mobile-squeeze tuning has
  // to leave this one untouched.
  { name: 'desktop-1440x900', width: 1440, height: 900 },
];

const VIEWS = [
  { id: 'host-lobby', group: 'host', v: 'lobby', name: 'LobbyView' },
  { id: 'host-playing', group: 'host', v: 'playing', name: 'PlayingView' },
  { id: 'host-reveal', group: 'host', v: 'reveal', name: 'RevealView' },
  { id: 'host-year-reveal', group: 'host', v: 'year', name: 'YearRevealView' },
  { id: 'host-mystery-reveal', group: 'host', v: 'mystery-reveal', name: 'MysteryRevealView' },
  { id: 'host-big-points-reveal', group: 'host', v: 'big-points-reveal', name: 'BigPointsRevealView' },
  // Heavier rosters (7 players, some with a second guess line) than the
  // 3-player fixtures above ever exercise — the actual worst case for a
  // reveal screen's vertical space, not just "more of the same row".
  { id: 'host-reveal-crowd', group: 'host', v: 'reveal-crowd', name: 'RevealViewCrowd' },
  { id: 'host-year-reveal-crowd', group: 'host', v: 'year-crowd', name: 'YearRevealViewCrowd' },
  { id: 'host-final-results', group: 'host', v: 'final-host', name: 'FinalResultsView', click: 'button:has-text("final reveal")', waitFor: '.standings-list' },
  { id: 'host-final-results-long-names', group: 'host', v: 'final-host-long', name: 'FinalResultsLongNamesView' },
  { id: 'host-final-results-empty', group: 'host', v: 'final-empty', name: 'FinalResultsEmptyView' },
  { id: 'player-waiting', group: 'player', v: 'waiting', name: 'WaitingView' },
  { id: 'player-watching', group: 'player', v: 'watching', name: 'WatchingView' },
  { id: 'player-guessing', group: 'player', v: 'guessing', name: 'GuessingView' },
  { id: 'player-year-guessing', group: 'player', v: 'year-guessing', name: 'YearGuessingView' },
  { id: 'player-guessing-both', group: 'player', v: 'guessing-both', name: 'GuessingBothView' },
  { id: 'player-reveal', group: 'player', v: 'play-reveal', name: 'RevealView' },
  { id: 'player-reveal-no-one', group: 'player', v: 'play-reveal-noone', name: 'RevealViewNoOne' },
  { id: 'player-reveal-crowd', group: 'player', v: 'play-reveal-crowd', name: 'RevealViewCrowd' },
  { id: 'player-final-results', group: 'player', v: 'final-player', name: 'FinalResultsView' },
  { id: 'shared-party-intro', group: 'shared', v: 'party-intro', name: 'PartyIntroView' },
];

// Text-input screens get a second pass with the on-screen keyboard "open" —
// see keyboardShrunkHeight() below. guessing-both (party's title+artist
// target) is the tightest case per GuessingView's own comments, so it only
// needs the keyboard-open pass, not a first plain one already covered by the
// others.
const KEYBOARD_VIEW_IDS = new Set(['player-guessing', 'player-year-guessing', 'player-guessing-both']);

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

function matchesView(view, requestedViews, requestedGroups) {
  const matchesName = requestedViews.length === 0
    || requestedViews.some(name => [view.id, view.v, view.name].includes(name));
  const matchesGroup = requestedGroups.length === 0 || requestedGroups.includes(view.group);
  return matchesName && matchesGroup;
}

function listChoices() {
  console.log('Screens:');
  for (const view of VIEWS) {
    const keyboard = KEYBOARD_VIEW_IDS.has(view.id) ? ' (keyboard)' : '';
    console.log(`  ${view.id.padEnd(31)} ${view.group.padEnd(7)} fixture: ${view.v}${keyboard}`);
  }
  console.log('\nViewports:');
  for (const viewport of VIEWPORTS) console.log(`  ${viewport.name}`);
}

function assertKnownFilters(options) {
  const validViews = new Set(VIEWS.flatMap(view => [view.id, view.v, view.name]));
  const validGroups = new Set(VIEWS.map(view => view.group));
  const validViewports = new Set(VIEWPORTS.map(viewport => viewport.name));
  const unknownViews = options.views.filter(view => !validViews.has(view));
  const unknownGroups = options.groups.filter(group => !validGroups.has(group));
  const unknownViewports = options.viewports.filter(viewport => !validViewports.has(viewport));
  if (unknownViews.length || unknownGroups.length || unknownViewports.length) {
    const messages = [
      unknownViews.length && `unknown screens: ${unknownViews.join(', ')}`,
      unknownGroups.length && `unknown groups: ${unknownGroups.join(', ')}`,
      unknownViewports.length && `unknown viewports: ${unknownViewports.join(', ')}`,
    ].filter(Boolean);
    throw new Error(`${messages.join('; ')}. Run with --list to see valid names.`);
  }
}

async function runCheck(browser, vp, view, height, outSuffix, focusInput) {
  const page = await browser.newPage();
  await prepPage(page);
  await page.setViewportSize({ width: vp.width, height });
  await page.goto(`${BASE}/screenshot?v=${view.v}`);
  await page.waitForTimeout(500);
  if (view.click) await page.locator(view.click).click();
  if (view.waitFor) {
    await page.locator(view.waitFor).waitFor();
    await page.waitForTimeout(300);
  }
  if (focusInput) {
    await page.locator('input').first().focus();
    await page.waitForTimeout(300);
  }
  const offenders = await findOverflow(page);
  const outPath = path.join(OUT, view.group, view.id, `${vp.name}${outSuffix}.png`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await page.screenshot({ path: outPath });
  await page.close();
  return { offenders, outPath };
}

let options;
try {
  options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    process.exit(0);
  }
  assertKnownFilters(options);
  if (options.list) {
    listChoices();
    process.exit(0);
  }
} catch (error) {
  console.error(error.message);
  console.error('Run with --help for usage.');
  process.exit(1);
}

const selectedViews = VIEWS.filter(view => matchesView(view, options.views, options.groups));
const selectedViewports = VIEWPORTS.filter(viewport => options.viewports.length === 0 || options.viewports.includes(viewport.name));
const selectedKeyboardViews = selectedViews.filter(view => KEYBOARD_VIEW_IDS.has(view.id));

if (selectedViews.length === 0 || selectedViewports.length === 0 || (options.keyboard === 'only' && selectedKeyboardViews.length === 0)) {
  console.error('No captures matched the supplied filters. Run with --list to see valid combinations.');
  process.exit(1);
}

const failures = [];
try {
  const browser = await chromium.launch({ channel: 'chrome' });
  for (const vp of selectedViewports) {
    if (options.keyboard !== 'only') {
      for (const view of selectedViews) {
        const { offenders } = await runCheck(browser, vp, view, vp.height, '', false);
        if (offenders.length > 0) {
          failures.push({ view: view.id, viewport: vp.name, offenders });
          console.log(`✗ ${view.id} @ ${vp.name}: ${offenders.map(o => `<${o.tag}.${o.cls}> +${o.overflowPx}px`).join(', ')}`);
        } else {
          console.log(`✓ ${view.id} @ ${vp.name}`);
        }
      }
    }
    if (options.keyboard !== 'skip') {
      for (const view of selectedKeyboardViews) {
        const label = `${view.id} @ ${vp.name} (keyboard open)`;
        const { offenders } = await runCheck(browser, vp, view, keyboardShrunkHeight(vp), '__keyboard', true);
        if (offenders.length > 0) {
          failures.push({ view: view.id, viewport: `${vp.name} (keyboard open)`, offenders });
          console.log(`✗ ${label}: ${offenders.map(o => `<${o.tag}.${o.cls}> +${o.overflowPx}px`).join(', ')}`);
        } else {
          console.log(`✓ ${label}`);
        }
      }
    }
  }
  await browser.close();
} catch (error) {
  console.error(error);
  process.exit(1);
}

console.log(`\n${failures.length === 0 ? 'All clear' : `${failures.length} overflow(s) found`} — screenshots in ${OUT}/`);
if (failures.length > 0) process.exit(1);
