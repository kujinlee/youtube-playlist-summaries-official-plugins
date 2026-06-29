import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { expect, test } from '@playwright/test';
import { renderDigDeeperDoc } from '../../lib/html-doc/render-dig-deeper';
import type { ParsedSummary } from '../../lib/html-doc/types';
import type { DugSection } from '../../lib/dig/companion-doc';
import type { CropBox } from '../../lib/dig/slide-crop';

const B64 = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKwAB/9k=';

function buildHtml(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-size-e2e-'));
  fs.mkdirSync(path.join(dir, 'assets', 'v'), { recursive: true });
  const assetAbs = path.join(dir, 'assets', 'v', '0-0.jpg');
  fs.writeFileSync(assetAbs, Buffer.from(B64, 'base64'));
  const summary = { title: 'Size Test', channel: null, duration: null, url: 'u', lang: 'EN',
    videoId: 'v', tldr: null, takeaways: [], sourceMd: 'x.md',
    sections: [{ numeral: '1', title: 'S', prose: 'p',
      timeRange: { startSec: 60, endSec: 120, label: '1:00–2:00', url: 'u&t=60s' } }] } as ParsedSummary;
  const dug = [{ sectionId: 60, startSec: 60, title: 'S', bodyMarkdown: '![a](assets/v/0-0.jpg)',
    generatedAt: '2026-01-01T00:00:00.000Z', genVersion: 1 }] as unknown as DugSection[];
  // PB2: pass a cropMap so a `figure.dig-slide-crop` is actually emitted (S7 needs it).
  // mdPath's dir == the asset dir, so the renderer resolves the ref to exactly assetAbs.
  const cropMap = new Map<string, CropBox | null>([[assetAbs, { trimTop: 0.25, trimBot: 0.05, width: 1280, height: 720 }]]);
  return renderDigDeeperDoc({ summary, envelope: null, dug, mdPath: path.join(dir, 'vid-size-test-dig-deeper.md'), videoId: 'v', cropMap });
}

const ROUTE = '**/api/html/vid-size-test**';
const URL = 'http://localhost:3000/api/html/vid-size-test?type=dig-deeper';

async function stub(page: import('@playwright/test').Page) {
  const html = buildHtml();
  await page.route(ROUTE, (r) => r.fulfill({ contentType: 'text/html', body: html }));
}
const scale = (page: import('@playwright/test').Page) => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--dig-slide-scale').trim());

test('S1 set range to 50 shrinks scale + updates readout', async ({ page }) => {
  await stub(page); await page.goto(URL);
  await page.locator('.dg-size-range').fill('50');
  await page.locator('.dg-size-range').dispatchEvent('input');
  expect(await scale(page)).toBe('0.5');
  await expect(page.locator('.dg-size-val')).toHaveText('50%');
});

test('S2 + button steps to 110', async ({ page }) => {
  await stub(page); await page.goto(URL);
  await page.locator('.dg-size-inc').click();
  expect(await scale(page)).toBe('1.1');
  await expect(page.locator('.dg-size-val')).toHaveText('110%');
});

test('S3 head script applies the saved scale PRE-PAINT, before the control exists (PH1)', async ({ page }) => {
  await stub(page);
  await page.addInitScript(() => {
    (window as any).__firstScaleSet = null;
    const orig = CSSStyleDeclaration.prototype.setProperty;
    CSSStyleDeclaration.prototype.setProperty = function (prop: string, ...rest: any[]) {
      if (prop === '--dig-slide-scale' && (window as any).__firstScaleSet === null) {
        (window as any).__firstScaleSet = {
          ready: document.readyState,
          hasControl: !!document.querySelector('.dg-size-range'),
        };
      }
      return (orig as any).call(this, prop, ...rest);
    };
    localStorage.setItem('digSlideScale', '120');
  });
  await page.goto(URL);
  const first = await page.evaluate(() => (window as any).__firstScaleSet);
  expect(first).not.toBeNull();
  expect(first.hasControl).toBe(false);                  // proves the HEAD script set it, not the body fallback
  expect(await scale(page)).toBe('1.2');
  await expect(page.locator('.dg-size-range')).toHaveValue('120');
});

test('S4 reset button works by click AND keyboard', async ({ page }) => {
  await stub(page); await page.goto(URL);
  await page.locator('.dg-size-inc').click();            // 110
  await page.locator('.dg-size-val').click();            // reset
  expect(await scale(page)).toBe('1');
  await page.locator('.dg-size-inc').click();            // 110 again
  await page.locator('.dg-size-val').focus();
  await page.keyboard.press('Enter');                    // keyboard reset
  expect(await scale(page)).toBe('1');
  await expect(page.locator('.dg-size-val')).toHaveText('100%');
});

// S5 table-driven sanitizer contract (PM2): snap-to-10 + clamp [50,150]; bad/missing → 100.
// Includes the Codex H2 in-browser proof row: stored ' ' (single space) → scale '1' (whitespace → 100%).
for (const [stored, expected] of ([['999', '1.5'], ['-1', '0.5'], ['44', '0.5'], ['120px', '1'], ['', '1'], [' ', '1']] as const)) {
  test(`S5 sanitize stored "${stored}" → scale ${expected}`, async ({ page }) => {
    await stub(page);
    await page.addInitScript((v) => localStorage.setItem('digSlideScale', v as string), stored);
    await page.goto(URL);
    expect(await scale(page)).toBe(expected);
  });
}
test('S5 missing storage → 100% (PB1 — Number(null) must NOT default to 50)', async ({ page }) => {
  await stub(page); await page.goto(URL);
  expect(await scale(page)).toBe('1');
  await expect(page.locator('.dg-size-range')).toHaveValue('100');
});

test('S6 survives blocked localStorage and proves it is actually blocked (PM3)', async ({ page }) => {
  await stub(page);
  await page.addInitScript(() => {
    const thrower = () => { throw new Error('blocked'); };
    try {
      Object.defineProperty(window, 'localStorage', { configurable: true, get: () => ({ getItem: thrower, setItem: thrower }) });
      (window as any).__lsBlocked = true;
    } catch { (window as any).__lsBlocked = false; }
  });
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  await page.goto(URL);
  expect(await page.evaluate(() => (window as any).__lsBlocked)).toBe(true);         // override took
  expect(await page.evaluate(() => { try { (window as any).localStorage.getItem('x'); return 'no-throw'; } catch { return 'throws'; } })).toBe('throws'); // really blocked
  expect(await scale(page)).toBe('1');                   // defaulted, no FOUC crash
  await page.locator('.dg-size-inc').click();
  expect(await scale(page)).toBe('1.1');                 // still operable for the session
  expect(pageErrors).toEqual([]);                        // no uncaught errors leaked
});

test('S7 print keeps base size + hides control, on a locked wide viewport (PH2)', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 900 });   // wide enough that 150% > base cap
  await stub(page);
  await page.addInitScript(() => localStorage.setItem('digSlideScale', '150'));
  await page.goto(URL);
  const fig = page.locator('figure.dig-slide-crop').first();
  const before = parseFloat(await fig.evaluate((el) => getComputedStyle(el).width));
  expect(before).toBeGreaterThan(541);                   // 150% genuinely inflates (precondition, not vacuous)
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.dg-size')).toBeHidden();
  const after = parseFloat(await fig.evaluate((el) => getComputedStyle(el).width));
  expect(after).toBeLessThanOrEqual(541);                // print override → base 540 cap, not 150%
});
