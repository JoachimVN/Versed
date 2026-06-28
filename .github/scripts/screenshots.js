import { chromium } from 'playwright';
import { prepPage, saveIfChanged } from './screenshot-utils.js';

const BASE = 'http://localhost:4321';
const OUT = 'docs/screenshots';
const VIEWPORT = { width: 1280, height: 800 };

async function take(browser, view, outFile) {
    const page = await browser.newPage();
    await prepPage(page);
    await page.setViewportSize(VIEWPORT);
    await page.goto(`${BASE}/screenshot?v=${view}`);
    await page.waitForTimeout(800);
    await saveIfChanged(page, `${OUT}/${outFile}`);
    await page.close();
    console.log(`${outFile} done.`);
}

try {
    const browser = await chromium.launch();
    await take(browser, 'lobby',   'Lobby.png');
    await take(browser, 'playing', 'Playing.png');
    await take(browser, 'betting', 'Betting.png');
    await browser.close();
} catch (e) {
    console.error(e);
    process.exit(1);
}
