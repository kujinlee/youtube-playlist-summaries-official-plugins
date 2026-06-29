// tests/e2e/dig-slide-captions.spec.ts
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { expect, test } from '@playwright/test';
import { renderDigDeeperDoc } from '../../lib/html-doc/render-dig-deeper';
import type { ParsedSummary } from '../../lib/html-doc/types';
import type { DugSection } from '../../lib/dig/companion-doc';

const B64 = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKwAB/9k=';

function buildHtml(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-cap-e2e-'));
  fs.mkdirSync(path.join(dir, 'assets', 'v'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'assets', 'v', '0-0.jpg'), Buffer.from(B64, 'base64'));
  const summary = { title: 'Cap Test', channel: null, duration: null, url: 'u', lang: 'EN',
    videoId: 'v', tldr: null, takeaways: [], sourceMd: 'x.md',
    sections: [{ numeral: '1', title: 'S', prose: 'p',
      timeRange: { startSec: 60, endSec: 120, label: '1:00–2:00', url: 'u&t=60s' } }] } as ParsedSummary;
  const dug = [{ sectionId: 60, startSec: 60, title: 'S', bodyMarkdown: '![A clear caption](assets/v/0-0.jpg)',
    generatedAt: '2026-01-01T00:00:00.000Z', genVersion: 1 }] as unknown as DugSection[];
  return renderDigDeeperDoc({ summary, envelope: null, dug, mdPath: path.join(dir, 'vid-cap-test-dig-deeper.md'), videoId: 'v' });
}

const ROUTE = '**/api/html/vid-cap-test**';
const URL = 'http://localhost:3000/api/html/vid-cap-test?type=dig-deeper';
async function stub(page: import('@playwright/test').Page) {
  const html = buildHtml();
  await page.route(ROUTE, (r) => r.fulfill({ contentType: 'text/html', body: html }));
}

test('C1 captions shown by default', async ({ page }) => {
  await stub(page); await page.goto(URL);
  await expect(page.locator('.dig-cap')).toHaveText('A clear caption');
  await expect(page.locator('.dig-cap')).toBeVisible();
  await expect(page.locator('.dg-caps-toggle')).toHaveAttribute('aria-pressed', 'true');
});

test('C2 toggle hides captions and persists across reload', async ({ page }) => {
  await stub(page); await page.goto(URL);
  await page.locator('.dg-caps-toggle').click();
  await expect(page.locator('.dig-cap')).toBeHidden();
  await expect(page.locator('.dg-caps-toggle')).toHaveAttribute('aria-pressed', 'false');
  await page.reload();
  await expect(page.locator('.dig-cap')).toBeHidden();        // persisted
  await expect(page.locator('.dg-caps-toggle')).toHaveAttribute('aria-pressed', 'false');
});

test('C3 pre-paint hides captions BEFORE the toggle exists (no FOUC, PH1)', async ({ page }) => {
  await stub(page);
  await page.addInitScript(() => {
    (window as any).__capState = null;
    const orig = DOMTokenList.prototype.add;
    DOMTokenList.prototype.add = function (...cls: string[]) {
      if (cls.indexOf('dg-hide-caps') !== -1 && (window as any).__capState === null) {
        (window as any).__capState = { ready: document.readyState, hasToggle: !!document.querySelector('.dg-caps-toggle') };
      }
      return (orig as any).apply(this, cls);
    };
    localStorage.setItem('digCaptions', 'off');
  });
  await page.goto(URL);
  const first = await page.evaluate(() => (window as any).__capState);
  expect(first).not.toBeNull();
  if (!first) return;                            // guard: avoid TypeError on null (clean fail via the assertion above)
  expect(first.hasToggle).toBe(false);          // HEAD script ran before the control parsed
  expect(first.ready).toBe('loading');
  await expect(page.locator('.dig-cap')).toBeHidden();
});

test('C4 survives blocked localStorage (default shown, no page errors)', async ({ page }) => {
  await stub(page);
  await page.addInitScript(() => {
    const thrower = () => { throw new Error('blocked'); };
    Object.defineProperty(window, 'localStorage', { configurable: true, get: () => ({ getItem: thrower, setItem: thrower }) });
  });
  const errs: string[] = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(URL);
  await expect(page.locator('.dig-cap')).toBeVisible();       // defaulted to shown
  expect(errs).toEqual([]);
});

test('C5 zoom overlay shows the slide caption', async ({ page }) => {
  await stub(page); await page.goto(URL);
  await page.locator('.dig-slide').click();
  await expect(page.locator('#_dg-zoom')).toHaveAttribute('data-open', '');
  await expect(page.locator('#_dg-zoom-cap')).toHaveText('A clear caption');
  await expect(page.locator('#_dg-zoom-cap')).toBeVisible();
});

test('C6 zoom caption hidden when captions toggled off', async ({ page }) => {
  await stub(page); await page.goto(URL);
  await page.locator('.dg-caps-toggle').click();      // captions off
  await page.locator('.dig-slide').click();
  await expect(page.locator('#_dg-zoom')).toHaveAttribute('data-open', '');
  await expect(page.locator('#_dg-zoom-cap')).toBeHidden();
});
