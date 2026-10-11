// Headless Chromium for the smoke test and local probes. Uses CHROMIUM_PATH
// if set, else Playwright's own build; if that build isn't installed (a
// container that ships a different one), falls back to the newest Chromium
// already in the Playwright browsers folder instead of failing.
import { chromium } from 'playwright';
import { existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BINARIES = ['chrome-linux64/chrome', 'chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-win/chrome.exe'];

export function chromiumPath() {
    if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
    if (existsSync(chromium.executablePath())) return undefined;      // Playwright's own build
    const dir = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(os.homedir(), '.cache', 'ms-playwright');
    let builds = [];
    try { builds = readdirSync(dir).filter((d) => /^chromium-\d+$/.test(d)); } catch { return undefined; }
    builds.sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
    for (const b of builds) for (const bin of BINARIES) if (existsSync(path.join(dir, b, bin))) return path.join(dir, b, bin);
    return undefined;
}

export function launchChromium(options = {}) {
    return chromium.launch({
        executablePath: chromiumPath(),
        args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
        ...options,
    });
}
