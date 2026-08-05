import { chromium } from 'playwright';
import { prepPage, saveIfChanged } from './screenshot-utils.js';

const BASE = 'http://localhost:4321';
const OUT = 'docs/screenshots';
const VIEWPORT = { width: 1280, height: 800 };

async function take(browser, url, outFile, options = {}) {
    // deviceScaleFactor 2 matches a real Retina Mac; at the Playwright default
    // of 1, canvas-drawn confetti renders with hard blocky edges instead of
    // the soft anti-aliased look it has on the actual dev machine, making the
    // screenshots look uniformly sharper/less blurred than the real app.
    const page = await browser.newPage({ deviceScaleFactor: 2 });
    await prepPage(page);
    await page.setViewportSize(VIEWPORT);
    await page.goto(`${BASE}${url}`);
    await page.waitForTimeout(800);
    if (options.click) {
        await page.click(options.click);
    }
    if (options.waitFor) {
        await page.waitForSelector(options.waitFor);
        await page.waitForTimeout(300);
    }
    await saveIfChanged(page, `${OUT}/${outFile}`);
    await page.close();
    console.log(`${outFile} done.`);
}

try {
    const browser = await chromium.launch();
    await take(browser, '/',                        'Lobby.png');
    await take(browser, '/screenshot?v=playing',     'Playing.png');
    await take(browser, '/screenshot?v=reveal',      'Reveal.png');
    await take(browser, '/screenshot?v=lobby',       'HostLobby.png');
    await take(browser, '/screenshot?v=party-intro', 'PartyIntro.png');
    await take(browser, '/screenshot?v=final-host',  'FinalResults.png', { click: 'button:has-text("final reveal")', waitFor: '.standings-list' });
    await browser.close();
} catch (e) {
    console.error(e);
    process.exit(1);
}
