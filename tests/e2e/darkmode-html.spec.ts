import { expect, test } from '@playwright/test';
// Relative imports (NOT '@/…'): the '@/' alias is unproven for RUNTIME (value) imports under
// Playwright's loader — the only existing E2E '@/' import is `import type` (erased). (Review B1)
import { renderMagazineHtml } from '../../lib/html-doc/render';
import { renderDeepDiveHtml } from '../../lib/html-doc/render-deep-dive';
import type { ParsedSummary, MagazineModel } from '../../lib/html-doc/types';

const parsed: ParsedSummary = {
  title: 'Dark Mode Demo', channel: 'Chan', duration: '10:00', url: 'https://youtu.be/x',
  lang: 'EN', videoId: 'dm1', tldr: 'A summary.', takeaways: ['One point.'],
  sections: [{ numeral: '1', title: 'Section', prose: 'p' }], sourceMd: 'dark-mode-demo.md',
};
const model: MagazineModel = {
  sections: [{ lead: 'Lead.', bullets: [
    { label: 'A', text: 'x.' }, { label: 'B', text: 'y.' }, { label: 'C', text: 'z.' },
  ] }],
};

const DD_MD = `---
video_id: "dd-e2e"
lang: EN
---

# Deep Dive Dark Demo

Body paragraph for the dark-mode runtime check.
`;

const DOC_URL = 'https://example.test/doc.html';
const DD_URL = 'https://example.test/deepdive.html';

/** Intercept DOC_URL and return freshly-rendered magazine HTML. */
async function serveDoc(page: import('@playwright/test').Page) {
  const html = renderMagazineHtml(parsed, model);
  await page.route(DOC_URL, (route) =>
    route.fulfill({ status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: html }),
  );
}

/** Intercept DD_URL and return freshly-rendered deep-dive HTML (M6 — deep-dive coverage). */
async function serveDeepDive(page: import('@playwright/test').Page) {
  const html = renderDeepDiveHtml(DD_MD, 'deep-dive-dark-demo.md');
  await page.route(DD_URL, (route) =>
    route.fulfill({ status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: html }),
  );
}

const LIGHT_BG = 'rgb(238, 240, 243)'; // magazine #eef0f3
const DARK_BG = 'rgb(26, 23, 20)';     // magazine #1a1714
const DD_DARK_BG = 'rgb(26, 23, 20)';  // deep-dive dark --page #1a1714 (shared magazine palette)

test.describe('exported HTML dark mode', () => {
  test('follows system dark preference when never toggled', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await serveDoc(page);
    await page.goto(DOC_URL);
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe(DARK_BG);
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBeNull();
  });

  test('follows system light preference when never toggled', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await serveDoc(page);
    await page.goto(DOC_URL);
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe(LIGHT_BG);
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBeNull();
  });

  test('toggle flips theme against the system preference', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await serveDoc(page);
    await page.goto(DOC_URL);
    await page.locator('#theme-toggle').click();
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('dark');
    // toHaveCSS auto-retries past the .2s background-color transition (theme-ready) that the
    // toggle script enables; a one-shot getComputedStyle samples the color mid-fade. (harness)
    await expect(page.locator('body')).toHaveCSS('background-color', DARK_BG);
    // Icon flips to the sun once the doc is dark (default/light icon is the moon 🌙).
    await expect(page.locator('#theme-toggle')).toHaveText('\u{2600}\u{FE0F}');
  });

  test('explicit LIGHT override beats a dark OS preference (regression for the :not guard)', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await serveDoc(page);
    await page.goto(DOC_URL);
    await page.locator('#theme-toggle').click();
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('light');
    // toHaveCSS auto-retries past the .2s background-color transition. (harness)
    await expect(page.locator('body')).toHaveCSS('background-color', LIGHT_BG);
  });

  test('remembers a manual override across reloads', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await serveDoc(page);
    await page.goto(DOC_URL);
    await page.locator('#theme-toggle').click();
    await page.reload();
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('dark');
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe(DARK_BG);
  });

  test('without a prior toggle, reload stays on the system theme (persistence is real)', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await serveDoc(page);
    await page.goto(DOC_URL);
    await page.reload();
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBeNull();
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(LIGHT_BG);
  });

  test('hides the toggle when printing', async ({ page }) => {
    await serveDoc(page);
    await page.goto(DOC_URL);
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('#theme-toggle')).toBeHidden();
  });

  test('prints a LIGHT card even on a dark OS when never toggled', async ({ page }) => {
    // Regression: the print rule must beat the system-dark cascade (:root:not([data-theme])),
    // or a never-toggled doc on a dark OS would print a dark card with pale text.
    await page.emulateMedia({ colorScheme: 'dark' });
    await serveDoc(page);
    await page.goto(DOC_URL);
    // Sanity: on screen it IS dark (system-following).
    await expect(page.locator('.v4')).toHaveCSS('background-color', 'rgb(34, 29, 24)'); // dark --card #221d18
    // Under print media the card must resolve to the LIGHT palette card color.
    await page.emulateMedia({ colorScheme: 'dark', media: 'print' });
    await expect(page.locator('.v4')).toHaveCSS('background-color', 'rgb(251, 249, 246)'); // light --card #fbf9f6
  });

  test('deep-dive export follows system dark (M6 — deep-dive runtime coverage)', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await serveDeepDive(page);
    await page.goto(DD_URL);
    // body background → --page dark = #1a1714 = rgb(26, 23, 20). toHaveCSS retries past transition.
    await expect(page.locator('body')).toHaveCSS('background-color', DD_DARK_BG);
    // .dd card background → --card dark = #221d18 = rgb(34, 29, 24).
    await expect(page.locator('article.dd')).toHaveCSS('background-color', 'rgb(34, 29, 24)');
    // .dd p ink → --ink dark = #e8e2d6 = rgb(232, 226, 214).
    await expect(page.locator('.dd p').first()).toHaveCSS('color', 'rgb(232, 226, 214)');
    await expect(page.locator('#theme-toggle')).toBeVisible();
  });

  test('deep-dive: explicit light beats dark OS and shows its own light palette', async ({ page }) => {
    // Mirrors the magazine :not-guard regression, but asserts the deep-dive's OWN light page color.
    await page.emulateMedia({ colorScheme: 'dark' });
    await serveDeepDive(page);
    await page.goto(DD_URL);
    await page.locator('#theme-toggle').click(); // system dark → flips to explicit light
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('light');
    // deep-dive light --page is #eef0f3 = rgb(238, 240, 243) (shared magazine palette).
    // toHaveCSS retries past the .2s transition.
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(238, 240, 243)');
  });
});
