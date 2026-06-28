import fs from 'node:fs';
import pngjs from 'pngjs';
import pixelmatch from 'pixelmatch';

const { PNG } = pngjs;

const DIFF_PIXEL_THRESHOLD = 50;
const COLOR_THRESHOLD = 0.1;

// Freeze all animations and transitions so captures are deterministic.
async function prepPage(page) {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(() => {
        const css = `*, *::before, *::after {
            animation-duration: 0s !important;
            animation-delay: 0s !important;
            transition-duration: 0s !important;
            transition-delay: 0s !important;
        }`;
        const inject = () => {
            const style = document.createElement('style');
            style.textContent = css;
            (document.head || document.documentElement).appendChild(style);
        };
        if (document.head || document.documentElement) inject();
        else document.addEventListener('DOMContentLoaded', inject);
    });
}

// Write screenshot only when it differs meaningfully from the committed baseline.
async function saveIfChanged(page, outPath, options = {}) {
    const { diffThreshold = DIFF_PIXEL_THRESHOLD, ...shotOptions } = options;

    await page.evaluate(() => (document.fonts ? document.fonts.ready : null));

    const buf = await page.screenshot(shotOptions);
    const next = PNG.sync.read(buf);

    if (fs.existsSync(outPath)) {
        let prev = null;
        try {
            prev = PNG.sync.read(fs.readFileSync(outPath));
        } catch {
            prev = null;
        }
        if (prev && prev.width === next.width && prev.height === next.height) {
            const changed = pixelmatch(
                prev.data, next.data, null,
                next.width, next.height,
                { threshold: COLOR_THRESHOLD, includeAA: false },
            );
            if (changed <= diffThreshold) {
                console.log(`${outPath}: ${changed} px changed (<= ${diffThreshold}), keeping baseline.`);
                return false;
            }
            console.log(`${outPath}: ${changed} px changed, updating.`);
        }
    }

    fs.writeFileSync(outPath, buf);
    return true;
}

export { prepPage, saveIfChanged, DIFF_PIXEL_THRESHOLD, COLOR_THRESHOLD };
