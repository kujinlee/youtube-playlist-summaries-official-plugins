import fs from 'fs';
import os from 'os';
import path from 'path';
import { expect, test } from '@playwright/test';
// Relative imports (NOT '@/…'): the '@/' alias is unproven for RUNTIME (value) imports under
// Playwright's loader — the only existing E2E '@/' import is `import type` (erased).
import { renderMagazineHtml } from '../../lib/html-doc/render';
import { renderDigDeeperDoc } from '../../lib/html-doc/render-dig-deeper';
import type { ParsedSummary, MagazineModel } from '../../lib/html-doc/types';
import type { ModelEnvelope } from '../../lib/html-doc/model-store';
import type { DugSection } from '../../lib/dig/companion-doc';
import { DIG_GENERATOR_VERSION } from '../../lib/dig/generate';

// ---------------------------------------------------------------------------
// Fixtures
// Fixture set covers null AND non-null slide cases per the dev-process
// conditional-rendering rule:
//   - videoWithSlides ('vid-dig-slides'): startSec=120. Companion HTML includes
//     a base64 <img src="data:image/jpeg;base64,..."> (slides present).
//   - videoNoSlides ('vid-dig-noslides'): startSec=60. Companion HTML is
//     text-only, no <img> (no slides captured).
// ---------------------------------------------------------------------------

const OUTPUT_FOLDER = '/tmp/test-dig-deeper';
const VIDEO_ID_SLIDES = 'vid-dig-slides';
const VIDEO_ID_NO_SLIDES = 'vid-dig-noslides';
const START_SEC_SLIDES = 120;
const START_SEC_NO_SLIDES = 60;

// A minimal base64 JPEG (a 1×1 white pixel) to use in the companion HTML fixture.
const MINIMAL_B64 =
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKwAB/9k=';

// ---------------------------------------------------------------------------
// Build fixture HTMLs
// ---------------------------------------------------------------------------

function makeSummaryHtml(videoId: string, startSec: number): string {
  const parsed: ParsedSummary = {
    title: 'Dig Deeper Test Video',
    channel: 'TestChan',
    duration: '10:00',
    url: `https://www.youtube.com/watch?v=${videoId}`,
    lang: 'EN',
    videoId,
    tldr: 'Test summary.',
    takeaways: ['Key point 1.'],
    sections: [
      {
        numeral: '1',
        title: 'Section One',
        prose: 'p',
        timeRange: {
          startSec,
          endSec: startSec + 60,
          label: `${Math.floor(startSec / 60)}:00-${Math.floor((startSec + 60) / 60)}:00`,
          url: `https://www.youtube.com/watch?v=${videoId}&t=${startSec}s`,
        },
      },
    ],
    sourceMd: `${videoId}.md`,
  };
  const model: MagazineModel = {
    sections: [{ lead: 'Lead sentence.', bullets: [{ label: 'A', text: 'Bullet point.' }] }],
  };
  return renderMagazineHtml(parsed, model);
}

/**
 * Companion HTML WITH a base64-inlined slide image, produced by the real renderer.
 *
 * I1/I2 fix: build the companion HTML by calling renderDigDeeperDoc with a real
 * temp `.md` path that references `assets/<videoId>/<sectionId>-<sec>.jpg`, and a
 * real tiny JPEG written to that assets path. The renderer's image rule base64-inlines
 * the file, so B1's `toContain('data:image/jpeg;base64,')` assertion exercises the
 * actual renderer pipeline end-to-end (not hand-crafted HTML).
 */
function makeCompanionHtmlWithSlides(): string {
  // Create a temp dir that acts as the "wiki" directory containing the .md and assets/
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-slides-'));
  const assetDir = path.join(tmpDir, 'assets', VIDEO_ID_SLIDES);
  fs.mkdirSync(assetDir, { recursive: true });

  // Write a minimal real JPEG to the assets path the renderer will resolve.
  const assetFilename = `${START_SEC_SLIDES}-0.jpg`;
  const assetPath = path.join(assetDir, assetFilename);
  fs.writeFileSync(assetPath, Buffer.from(MINIMAL_B64, 'base64'));

  const mdPath = path.join(tmpDir, `${VIDEO_ID_SLIDES}-dig-deeper.md`);

  const summary: ParsedSummary = {
    title: 'Dig Deeper — Section One',
    channel: null,
    duration: null,
    url: `https://www.youtube.com/watch?v=${VIDEO_ID_SLIDES}`,
    lang: 'EN',
    videoId: VIDEO_ID_SLIDES,
    tldr: null,
    takeaways: [],
    sourceMd: `${VIDEO_ID_SLIDES}.md`,
    sections: [
      {
        numeral: '1',
        title: 'Section One',
        prose: 'Intro prose',
        timeRange: { startSec: START_SEC_SLIDES, endSec: START_SEC_SLIDES + 60, label: '2:00–3:00', url: `https://www.youtube.com/watch?v=${VIDEO_ID_SLIDES}&t=${START_SEC_SLIDES}s` },
      },
    ],
  };

  const dug: DugSection[] = [
    {
      sectionId: START_SEC_SLIDES,
      startSec: START_SEC_SLIDES,
      title: 'Section One',
      bodyMarkdown: `## Section One\n\n![slide](assets/${VIDEO_ID_SLIDES}/${assetFilename})\n\nKey insight about the slide content.\n`,
      generatedAt: '2026-01-01T00:00:00.000Z',
      genVersion: DIG_GENERATOR_VERSION,
    },
  ];

  // Call the real renderer — it will base64-inline the JPEG via its image rule.
  return renderDigDeeperDoc({ summary, envelope: null, dug, mdPath, videoId: VIDEO_ID_SLIDES });
}

/** Companion HTML with NO images (text-only). */
function makeCompanionHtmlNoSlides(): string {
  const summary: ParsedSummary = {
    title: 'Dig Deeper — Section One',
    channel: null,
    duration: null,
    url: `https://www.youtube.com/watch?v=${VIDEO_ID_NO_SLIDES}`,
    lang: 'EN',
    videoId: VIDEO_ID_NO_SLIDES,
    tldr: null,
    takeaways: [],
    sourceMd: `${VIDEO_ID_NO_SLIDES}.md`,
    sections: [
      {
        numeral: '1',
        title: 'Section One',
        prose: 'Intro prose',
        timeRange: { startSec: START_SEC_NO_SLIDES, endSec: START_SEC_NO_SLIDES + 60, label: '1:00–2:00', url: `https://www.youtube.com/watch?v=${VIDEO_ID_NO_SLIDES}&t=${START_SEC_NO_SLIDES}s` },
      },
    ],
  };

  const dug: DugSection[] = [
    {
      sectionId: START_SEC_NO_SLIDES,
      startSec: START_SEC_NO_SLIDES,
      title: 'Section One',
      bodyMarkdown: '## Section One\n\nKey insight with no slides here.\n',
      generatedAt: '2026-01-01T00:00:00.000Z',
      genVersion: DIG_GENERATOR_VERSION,
    },
  ];

  return renderDigDeeperDoc({ summary, envelope: null, dug, mdPath: '/tmp/fake-no-slides-dig-deeper.md', videoId: VIDEO_ID_NO_SLIDES });
}

// ---------------------------------------------------------------------------
// SSE helper
// ---------------------------------------------------------------------------

function sseBody(...events: object[]): string {
  return events.map((e) => `data: ${JSON.stringify(e)}\n`).join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Route setup helpers
// ---------------------------------------------------------------------------

/**
 * Serve both summary and companion HTML for a video at its canonical API URL.
 * A single route handler is used to avoid Playwright's `route.continue()` /
 * `route.fallback()` ordering issue when multiple handlers share the same URL
 * pattern. (In Playwright, `continue()` goes to the real network; `fallback()`
 * goes to the previously-registered handler — but a single handler is simpler
 * and avoids the ambiguity entirely.)
 */
async function stubHtmlRoutes(
  page: import('@playwright/test').Page,
  videoId: string,
  summaryHtml: string,
  companionHtml: string,
) {
  await page.route(`**/api/html/${videoId}**`, (route) => {
    const url = route.request().url();
    if (url.includes('type=dig-deeper')) {
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        body: companionHtml,
      });
    } else {
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        body: summaryHtml,
      });
    }
  });
}

async function stubDigState(
  page: import('@playwright/test').Page,
  videoId: string,
  sectionIds: number[] = [],
) {
  await page.route(`**/api/videos/${videoId}/dig-state**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ sectionIds }),
    }),
  );
}

async function stubDigPost(
  page: import('@playwright/test').Page,
  videoId: string,
  sectionId: number,
  jobId = 'dig-job-1',
  status = 200,
) {
  await page.route(`**/api/videos/${videoId}/dig/${sectionId}`, (route) => {
    if (route.request().method() !== 'POST') { route.continue(); return; }
    route.fulfill({
      status,
      contentType: 'application/json',
      body: status === 200 ? JSON.stringify({ jobId }) : JSON.stringify({ error: 'server error' }),
    });
  });
}

async function stubDigStream(
  page: import('@playwright/test').Page,
  videoId: string,
  sectionId: number,
  events: object[],
) {
  await page.route(`**/api/videos/${videoId}/dig/${sectionId}/stream**`, (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      body: sseBody(...events),
    }),
  );
}

// stubCompanionHtml removed — both summary and companion HTML are served
// by stubHtmlRoutes in a single handler to avoid route-fallback ordering issues.

// ===========================================================================
// F-SERIES: Summary→Dig same-tab nav, v1 regression, fixtures
// (Task 14 spec §10)
// ===========================================================================

// ---------------------------------------------------------------------------
// F1: Click "dig deeper ▶" on summary → same-tab navigation (no new tab);
//     URL has all three required params: outputFolder, type=dig-deeper, dig=N
// ---------------------------------------------------------------------------

test('F1 (same-tab nav un-dug): click dig-deeper ▶ → same tab; URL has outputFolder, type=dig-deeper, dig=N', async ({ page, context }) => {
  const summaryHtml = makeSummaryHtml(VIDEO_ID_SLIDES, START_SEC_SLIDES);
  const companionHtml = makeCompanionHtmlWithSlides();

  await stubHtmlRoutes(page, VIDEO_ID_SLIDES, summaryHtml, companionHtml);
  await stubDigState(page, VIDEO_ID_SLIDES, []);  // section NOT yet dug → "dig deeper ▶"

  const summaryUrl = `http://localhost:3000/api/html/${VIDEO_ID_SLIDES}?outputFolder=${encodeURIComponent(OUTPUT_FOLDER)}&type=summary`;
  await page.goto(summaryUrl);

  // Wait for dig-state fetch to complete and control to settle
  const digCtrl = page.locator('a.dig[data-section]');
  await expect(digCtrl).toHaveText('dig deeper ▶', { timeout: 5000 });

  // Record how many pages/tabs are open before click
  const pageCountBefore = context.pages().length;

  // The control is an <a> with href already set (by initDigControls); clicking navigates same-tab.
  // Grab href before clicking so we can assert the params.
  const href = await digCtrl.getAttribute('href');
  expect(href).toBeTruthy();
  const resolvedUrl = new URL(href!, 'http://localhost:3000');
  // Assert ALL required params
  expect(resolvedUrl.searchParams.get('outputFolder')).toBe(OUTPUT_FOLDER);
  expect(resolvedUrl.searchParams.get('type')).toBe('dig-deeper');
  expect(resolvedUrl.searchParams.get('dig')).toBe(String(START_SEC_SLIDES));

  // Navigate (same tab)
  await digCtrl.click();

  // Same-tab: no new tab opened
  expect(context.pages().length).toBe(pageCountBefore);

  // URL changed to the dig-deeper page (same tab navigated)
  await page.waitForURL('**/api/html/**type=dig-deeper**', { timeout: 5000 });
  const afterUrl = new URL(page.url());
  expect(afterUrl.searchParams.get('type')).toBe('dig-deeper');
  expect(afterUrl.searchParams.get('outputFolder')).toBe(OUTPUT_FOLDER);
  expect(afterUrl.searchParams.get('dig')).toBe(String(START_SEC_SLIDES));
});

// ---------------------------------------------------------------------------
// F2: Click "view detail ↓" on summary (already-dug) → same-tab navigation;
//     URL has outputFolder + type=dig-deeper but NO ?dig param; hash has #t=N
// ---------------------------------------------------------------------------

test('F2 (same-tab nav dug): click view detail ↓ → same tab; URL has outputFolder + type=dig-deeper, no dig param; hash #t=N', async ({ page, context }) => {
  const summaryHtml = makeSummaryHtml(VIDEO_ID_SLIDES, START_SEC_SLIDES);
  const companionHtml = makeCompanionHtmlWithSlides();

  await stubHtmlRoutes(page, VIDEO_ID_SLIDES, summaryHtml, companionHtml);
  // Section IS already dug → control shows "view detail ↓"
  await stubDigState(page, VIDEO_ID_SLIDES, [START_SEC_SLIDES]);

  const summaryUrl = `http://localhost:3000/api/html/${VIDEO_ID_SLIDES}?outputFolder=${encodeURIComponent(OUTPUT_FOLDER)}&type=summary`;
  await page.goto(summaryUrl);

  const digCtrl = page.locator('a.dig[data-section]');
  await expect(digCtrl).toHaveText('view detail ↓', { timeout: 5000 });

  const pageCountBefore = context.pages().length;

  // Href must have outputFolder, type=dig-deeper, NO dig param, hash #t=N
  const href = await digCtrl.getAttribute('href');
  expect(href).toBeTruthy();
  const resolvedUrl = new URL(href!, 'http://localhost:3000');
  expect(resolvedUrl.searchParams.get('outputFolder')).toBe(OUTPUT_FOLDER);
  expect(resolvedUrl.searchParams.get('type')).toBe('dig-deeper');
  expect(resolvedUrl.searchParams.has('dig')).toBe(false);
  expect(resolvedUrl.hash).toBe(`#t=${START_SEC_SLIDES}`);

  // Click → same tab
  await digCtrl.click();
  expect(context.pages().length).toBe(pageCountBefore);

  // URL navigated (same tab) to dig-deeper
  await page.waitForURL('**/api/html/**type=dig-deeper**', { timeout: 5000 });
  const afterUrl = new URL(page.url());
  expect(afterUrl.searchParams.get('type')).toBe('dig-deeper');
  expect(afterUrl.searchParams.get('outputFolder')).toBe(OUTPUT_FOLDER);
  expect(afterUrl.searchParams.has('dig')).toBe(false);
});

// ---------------------------------------------------------------------------
// F3: From the dig-doc, click "↑ summary" → same-tab nav to type=summary;
//     the link has no target="_blank" and navigates in the current tab.
// ---------------------------------------------------------------------------

test('F3 (↑ summary same-tab): click ↑ summary → same tab; URL type=summary; no target=_blank', async ({ page, context }) => {
  // Use the dug companion HTML (it has the ↑ summary link in the top bar)
  const companionHtml = makeCompanionHtmlWithSlides();
  const summaryHtml = makeSummaryHtml(VIDEO_ID_SLIDES, START_SEC_SLIDES);

  await stubHtmlRoutes(page, VIDEO_ID_SLIDES, summaryHtml, companionHtml);

  const digDocUrl = `http://localhost:3000/api/html/${VIDEO_ID_SLIDES}?outputFolder=${encodeURIComponent(OUTPUT_FOLDER)}&type=dig-deeper`;
  await page.goto(digDocUrl);

  // The top bar has an ↑ summary link (a.dig with data-type="summary")
  const summaryLink = page.locator('a.dig[data-type="summary"]');
  await expect(summaryLink).toBeVisible({ timeout: 3000 });
  await expect(summaryLink).toHaveText('↑ summary');

  const pageCountBefore = context.pages().length;

  // Get the href after wireDigLinks sets it
  const href = await summaryLink.getAttribute('href');
  expect(href).toBeTruthy();
  const resolvedUrl = new URL(href!, 'http://localhost:3000');
  expect(resolvedUrl.searchParams.get('type')).toBe('summary');
  expect(resolvedUrl.searchParams.get('outputFolder')).toBe(OUTPUT_FOLDER);
  // Same-tab nav link: no target="_blank"
  const target = await summaryLink.getAttribute('target');
  expect(target).not.toBe('_blank');

  // Click → same tab (no new page)
  await summaryLink.click();
  expect(context.pages().length).toBe(pageCountBefore);

  // Navigated to summary type
  await page.waitForURL('**/api/html/**type=summary**', { timeout: 5000 });
  expect(new URL(page.url()).searchParams.get('type')).toBe('summary');
});

// ---------------------------------------------------------------------------
// F4 (v1 regression): Summary HTML cached at magazine-skim v1 (stale) →
//     GET /api/html/[id]?type=summary triggers version-gated re-render →
//     served HTML contains dig controls (class="dig").
//     This test sets up REAL disk files so the API route exercises the actual
//     re-render path (no mocking of the route).
// ---------------------------------------------------------------------------

test('F4 (v1 regression): stale summary (magazine-skim v1) → re-render served → has dig controls', async ({ page }) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require('os') as typeof import('os');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('path') as typeof import('path');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs') as typeof import('fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { renderMagazineHtml: renderMag } = require('../../lib/html-doc/render') as typeof import('../../lib/html-doc/render');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { parseSummaryMarkdown: parseMd } = require('../../lib/html-doc/parse') as typeof import('../../lib/html-doc/parse');

  // Create a temp output folder inside $HOME so assertOutputFolder accepts it
  const tmpDir = fs.mkdtempSync(path.join(os.homedir(), '.tmp-e2e-v1regen-')) as string;
  try {
    // Video and file naming
    const videoId = 'vid-v1-regen';
    const baseName = 'vid-v1-regen-summary';
    const summaryMdRel = `${baseName}.md`;
    const summaryHtmlRel = `htmls/${baseName}.html`;

    // ── Write index.json ──────────────────────────────────────────────────
    const index = {
      playlistUrl: 'https://www.youtube.com/playlist?list=PL_test',
      outputFolder: tmpDir,
      videos: [{
        id: videoId,
        title: 'V1 Regression Test Video',
        youtubeUrl: `https://www.youtube.com/watch?v=${videoId}`,
        language: 'en',
        durationSeconds: 300,
        archived: false,
        ratings: { usefulness: 3, depth: 3, originality: 3, recency: 3, completeness: 3 },
        overallScore: 3,
        summaryMd: summaryMdRel,
        summaryPdf: null,
        deepDiveMd: null,
        deepDivePdf: null,
        summaryHtml: summaryHtmlRel,
        processedAt: '2026-01-01T00:00:00.000Z',
      }],
    };
    fs.writeFileSync(path.join(tmpDir, 'playlist-index.json'), JSON.stringify(index, null, 2));

    // ── Write summary .md ─────────────────────────────────────────────────
    const sectionTitle = 'Introduction';
    const summaryMd = [
      `# V1 Regression Test Video`,
      ``,
      `channel: TestChan`,
      `duration: 5:00`,
      `url: https://www.youtube.com/watch?v=${videoId}`,
      `lang: EN`,
      ``,
      `## 1. ${sectionTitle}`,
      `▶ [0:00–1:00](https://www.youtube.com/watch?v=${videoId}&t=0s)`,
      ``,
      `A brief intro section.`,
    ].join('\n');
    fs.writeFileSync(path.join(tmpDir, summaryMdRel), summaryMd, 'utf-8');

    // ── Write model envelope ──────────────────────────────────────────────
    const modelDir = path.join(tmpDir, 'models');
    fs.mkdirSync(modelDir, { recursive: true });
    const envelope = {
      sourceMd: summaryMdRel,
      generatedAt: '2026-01-01T00:00:00.000Z',
      sourceSections: [sectionTitle],
      model: {
        sections: [{
          lead: 'Key point.',
          bullets: [
            { label: 'A', text: 'Bullet one.' },
            { label: 'B', text: 'Bullet two.' },
            { label: 'C', text: 'Bullet three.' },
          ],
        }],
      },
    };
    fs.writeFileSync(path.join(modelDir, `${baseName}.json`), JSON.stringify(envelope, null, 2));

    // ── Write stale HTML (magazine-skim v1) ───────────────────────────────
    // Parse the .md, render fresh HTML, then patch the generator tag to v1.
    const parsed = parseMd(summaryMd);
    parsed.sourceMd = summaryMdRel;
    const freshHtml = renderMag(parsed, envelope.model);
    // Patch: replace 'magazine-skim v2' with 'magazine-skim v1' to simulate stale cache
    const staleHtml = freshHtml.replace('magazine-skim v2', 'magazine-skim v1');
    expect(staleHtml).toContain('magazine-skim v1'); // confirm patch worked

    const htmlDir = path.join(tmpDir, 'htmls');
    fs.mkdirSync(htmlDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, summaryHtmlRel), staleHtml, 'utf-8');

    // ── Hit the REAL API route (no page.route mock) ───────────────────────
    const apiUrl = `http://localhost:3000/api/html/${videoId}?outputFolder=${encodeURIComponent(tmpDir)}&type=summary`;
    await page.goto(apiUrl);

    // The route detects v1 ≠ v2 → calls reRenderSummaryHtml → returns fresh HTML.
    // Fresh HTML must contain the dig controls rendered by renderMagazineHtml (nav.ts digControl).
    const html = await page.content();
    expect(html).toContain('class="dig"');
    expect(html).toContain('magazine-skim v2');
    expect(html).not.toContain('magazine-skim v1');
    // Specifically the dig control for the section (startSec=0 from the ▶ link t=0s)
    expect(html).toContain('data-section="0"');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// F5a: renderDigDeeperDoc fixture — mixed dug/un-dug (some sections dug,
//      some not). Both .dig-trigger and .dug blocks present.
// ---------------------------------------------------------------------------

const VIDEO_ID_FIXTURE = 'vid-fixture';
const SEC_A = 60;
const SEC_B = 120;
const SEC_C = 180;

function makeFixtureMixedHtml(): string {
  const summary: ParsedSummary = {
    title: 'Fixture Mixed',
    channel: null,
    duration: null,
    url: `https://www.youtube.com/watch?v=${VIDEO_ID_FIXTURE}`,
    lang: 'EN',
    videoId: VIDEO_ID_FIXTURE,
    tldr: null,
    takeaways: [],
    sourceMd: `${VIDEO_ID_FIXTURE}.md`,
    sections: [
      { numeral: '1', title: 'Alpha', prose: 'p', timeRange: { startSec: SEC_A, endSec: SEC_A + 60, label: '1:00–2:00', url: `https://www.youtube.com/watch?v=${VIDEO_ID_FIXTURE}&t=${SEC_A}s` } },
      { numeral: '2', title: 'Beta',  prose: 'p', timeRange: { startSec: SEC_B, endSec: SEC_B + 60, label: '2:00–3:00', url: `https://www.youtube.com/watch?v=${VIDEO_ID_FIXTURE}&t=${SEC_B}s` } },
      { numeral: '3', title: 'Gamma', prose: 'p', timeRange: { startSec: SEC_C, endSec: SEC_C + 60, label: '3:00–4:00', url: `https://www.youtube.com/watch?v=${VIDEO_ID_FIXTURE}&t=${SEC_C}s` } },
    ],
  };
  const dug: DugSection[] = [
    { sectionId: SEC_A, startSec: SEC_A, title: 'Alpha', bodyMarkdown: '## Alpha\n\nDug body.\n', generatedAt: '2026-01-01T00:00:00.000Z', genVersion: DIG_GENERATOR_VERSION },
    // SEC_B and SEC_C are not dug
  ];
  return renderDigDeeperDoc({ summary, envelope: null, dug, mdPath: '/tmp/fixture-mixed-dig.md', videoId: VIDEO_ID_FIXTURE });
}

test('F5a (fixture mixed dug/un-dug): dug section has .dug; un-dug sections have .dig-trigger', async ({ page }) => {
  const html = makeFixtureMixedHtml();
  await page.route(`**/api/html/${VIDEO_ID_FIXTURE}**`, (route) =>
    route.fulfill({ status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: html }),
  );

  await page.goto(`http://localhost:3000/api/html/${VIDEO_ID_FIXTURE}?outputFolder=${encodeURIComponent(OUTPUT_FOLDER)}&type=dig-deeper`);

  // SEC_A is dug → data-dug="true", .dug block present
  const secA = page.locator(`section[data-start="${SEC_A}"]`);
  await expect(secA).toHaveAttribute('data-dug', 'true');
  await expect(secA.locator('.dug')).toBeVisible();
  await expect(secA.locator('.dig-trigger')).toHaveCount(0);

  // SEC_B is un-dug → data-dug="false", dig-trigger present
  const secB = page.locator(`section[data-start="${SEC_B}"]`);
  await expect(secB).toHaveAttribute('data-dug', 'false');
  await expect(secB.locator('.dig-trigger')).toBeVisible();

  // SEC_C is also un-dug
  const secC = page.locator(`section[data-start="${SEC_C}"]`);
  await expect(secC).toHaveAttribute('data-dug', 'false');
  await expect(secC.locator('.dig-trigger')).toBeVisible();

  // Total counts
  await expect(page.locator('section[data-dug="true"]')).toHaveCount(1);
  await expect(page.locator('section[data-dug="false"]')).toHaveCount(2);
  await expect(page.locator('.dig-trigger')).toHaveCount(2);
});

// ---------------------------------------------------------------------------
// F5b: renderDigDeeperDoc — zero dug sections (skeleton) → all sections have
//      .dig-trigger; none have .dug; no orphan region.
// ---------------------------------------------------------------------------

const VIDEO_ID_SKELETON = 'vid-skeleton';
const SKELETON_SECS = [30, 90, 150];

function makeFixtureSkeletonHtml(): string {
  const summary: ParsedSummary = {
    title: 'Skeleton Test',
    channel: null,
    duration: null,
    url: `https://www.youtube.com/watch?v=${VIDEO_ID_SKELETON}`,
    lang: 'EN',
    videoId: VIDEO_ID_SKELETON,
    tldr: null,
    takeaways: [],
    sourceMd: `${VIDEO_ID_SKELETON}.md`,
    sections: SKELETON_SECS.map((sec, i) => ({
      numeral: String(i + 1),
      title: `Section ${i + 1}`,
      prose: 'p',
      timeRange: { startSec: sec, endSec: sec + 60, label: `${i}:30–${i + 1}:30`, url: `https://www.youtube.com/watch?v=${VIDEO_ID_SKELETON}&t=${sec}s` },
    })),
  };
  // No dug sections → skeleton
  return renderDigDeeperDoc({ summary, envelope: null, dug: [], mdPath: '/tmp/skeleton-dig.md', videoId: VIDEO_ID_SKELETON });
}

test('F5b (zero-dug skeleton): all sections un-dug; no .dug blocks; no orphan region', async ({ page }) => {
  const html = makeFixtureSkeletonHtml();
  await page.route(`**/api/html/${VIDEO_ID_SKELETON}**`, (route) =>
    route.fulfill({ status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: html }),
  );

  await page.goto(`http://localhost:3000/api/html/${VIDEO_ID_SKELETON}?outputFolder=${encodeURIComponent(OUTPUT_FOLDER)}&type=dig-deeper`);

  // All sections are un-dug
  await expect(page.locator('section[data-dug="true"]')).toHaveCount(0);
  await expect(page.locator('section[data-dug="false"]')).toHaveCount(SKELETON_SECS.length);
  // Each has a dig-trigger
  await expect(page.locator('.dig-trigger')).toHaveCount(SKELETON_SECS.length);
  // No .dug blocks
  await expect(page.locator('.dug')).toHaveCount(0);
  // No orphan region
  await expect(page.locator('.dg-orphans')).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// F5c: renderDigDeeperDoc — missing-asset: companion references an asset file
//      that does NOT exist on disk → .missing-slide placeholder visible.
// ---------------------------------------------------------------------------

const VIDEO_ID_MISSING = 'vid-missing-asset';
const SEC_MISSING = 45;

function makeFixtureMissingAssetHtml(): string {
  const summary: ParsedSummary = {
    title: 'Missing Asset Test',
    channel: null,
    duration: null,
    url: `https://www.youtube.com/watch?v=${VIDEO_ID_MISSING}`,
    lang: 'EN',
    videoId: VIDEO_ID_MISSING,
    tldr: null,
    takeaways: [],
    sourceMd: `${VIDEO_ID_MISSING}.md`,
    sections: [
      { numeral: '1', title: 'Only Section', prose: 'p', timeRange: { startSec: SEC_MISSING, endSec: SEC_MISSING + 60, label: '0:45–1:45', url: `https://www.youtube.com/watch?v=${VIDEO_ID_MISSING}&t=${SEC_MISSING}s` } },
    ],
  };
  // Dug body references an asset that does NOT exist on disk
  const dug: DugSection[] = [
    {
      sectionId: SEC_MISSING,
      startSec: SEC_MISSING,
      title: 'Only Section',
      // references an asset path that doesn't exist — renderer returns .missing-slide
      bodyMarkdown: `## Only Section\n\n![slide](assets/${VIDEO_ID_MISSING}/nonexistent-frame.jpg)\n\nSome insight.\n`,
      generatedAt: '2026-01-01T00:00:00.000Z',
      genVersion: DIG_GENERATOR_VERSION,
    },
  ];
  // mdPath uses /tmp so the asset resolves to /tmp/assets/... which won't exist.
  return renderDigDeeperDoc({ summary, envelope: null, dug, mdPath: '/tmp/missing-asset-dig.md', videoId: VIDEO_ID_MISSING });
}

test('F5c (missing-asset): unreachable slide image → .missing-slide placeholder visible', async ({ page }) => {
  const html = makeFixtureMissingAssetHtml();
  await page.route(`**/api/html/${VIDEO_ID_MISSING}**`, (route) =>
    route.fulfill({ status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: html }),
  );

  await page.goto(`http://localhost:3000/api/html/${VIDEO_ID_MISSING}?outputFolder=${encodeURIComponent(OUTPUT_FOLDER)}&type=dig-deeper`);

  // The .missing-slide placeholder should be visible (rendered instead of <img>)
  const placeholder = page.locator('.missing-slide');
  await expect(placeholder).toBeVisible();
  // Should NOT have an <img> since the asset is missing
  await expect(page.locator('img')).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// F5d: renderDigDeeperDoc — orphan companion section: companion has a section
//      whose sectionId does not match any summary section → "Unmapped dug sections"
//      region rendered.
// ---------------------------------------------------------------------------

const VIDEO_ID_ORPHAN = 'vid-orphan';
const SEC_ORPHAN_SUMMARY = 60;
const SEC_ORPHAN_COMPANION = 9999;  // not in summary → orphan

function makeFixtureOrphanHtml(): string {
  const summary: ParsedSummary = {
    title: 'Orphan Test',
    channel: null,
    duration: null,
    url: `https://www.youtube.com/watch?v=${VIDEO_ID_ORPHAN}`,
    lang: 'EN',
    videoId: VIDEO_ID_ORPHAN,
    tldr: null,
    takeaways: [],
    sourceMd: `${VIDEO_ID_ORPHAN}.md`,
    sections: [
      { numeral: '1', title: 'Real Section', prose: 'p', timeRange: { startSec: SEC_ORPHAN_SUMMARY, endSec: SEC_ORPHAN_SUMMARY + 60, label: '1:00–2:00', url: `https://www.youtube.com/watch?v=${VIDEO_ID_ORPHAN}&t=${SEC_ORPHAN_SUMMARY}s` } },
    ],
  };
  const dug: DugSection[] = [
    // This one matches SEC_ORPHAN_SUMMARY
    { sectionId: SEC_ORPHAN_SUMMARY, startSec: SEC_ORPHAN_SUMMARY, title: 'Real Section', bodyMarkdown: '## Real Section\n\nMatched.\n', generatedAt: '2026-01-01T00:00:00.000Z', genVersion: DIG_GENERATOR_VERSION },
    // This one does NOT match any summary section → orphan
    { sectionId: SEC_ORPHAN_COMPANION, startSec: SEC_ORPHAN_COMPANION, title: 'Ghost Section', bodyMarkdown: '## Ghost Section\n\nOrphaned.\n', generatedAt: '2026-01-01T00:00:00.000Z', genVersion: DIG_GENERATOR_VERSION },
  ];
  return renderDigDeeperDoc({ summary, envelope: null, dug, mdPath: '/tmp/orphan-dig.md', videoId: VIDEO_ID_ORPHAN });
}

test('F5d (orphan companion section): unmatched companion section → "Unmapped dug sections" region visible', async ({ page }) => {
  const html = makeFixtureOrphanHtml();
  await page.route(`**/api/html/${VIDEO_ID_ORPHAN}**`, (route) =>
    route.fulfill({ status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: html }),
  );

  await page.goto(`http://localhost:3000/api/html/${VIDEO_ID_ORPHAN}?outputFolder=${encodeURIComponent(OUTPUT_FOLDER)}&type=dig-deeper`);

  // The orphan region must be visible
  const orphanRegion = page.locator('.dg-orphans');
  await expect(orphanRegion).toBeVisible();
  // It should contain the "Unmapped dug sections" heading (first h2 in the region)
  await expect(orphanRegion.locator('h2').first()).toHaveText('Unmapped dug sections');
  // The orphan section title appears inside
  await expect(orphanRegion).toContainText('Ghost Section');
});

// ===========================================================================
// DIG-DOC CLIENT STATE MACHINE (Task 10)
// Tests for the event-delegated in-place expand + toggle on the dig-deeper page.
// Fixtures are served at type=dig-deeper (the dig doc URL).
// ===========================================================================

const VIDEO_ID_DIG_DOC = 'vid-dig-doc';
const START_SEC_DIG_DOC = 90;

/**
 * Render a dig-deeper doc with the given section in un-dug state.
 * Serves as the "before" fixture (page with dig-trigger control).
 */
function makeDigDocHtmlUndug(): string {
  const summary: ParsedSummary = {
    title: 'Dig Doc Test',
    channel: null,
    duration: null,
    url: `https://www.youtube.com/watch?v=${VIDEO_ID_DIG_DOC}`,
    lang: 'EN',
    videoId: VIDEO_ID_DIG_DOC,
    tldr: null,
    takeaways: [],
    sourceMd: `${VIDEO_ID_DIG_DOC}.md`,
    sections: [
      {
        numeral: '1',
        title: 'Section Alpha',
        prose: 'Intro prose',
        timeRange: { startSec: START_SEC_DIG_DOC, endSec: START_SEC_DIG_DOC + 60, label: '1:30–2:30', url: `https://www.youtube.com/watch?v=${VIDEO_ID_DIG_DOC}&t=${START_SEC_DIG_DOC}s` },
      },
    ],
  };
  // No dug sections — renders dig-trigger
  return renderDigDeeperDoc({ summary, envelope: null, dug: [], mdPath: '/tmp/dig-doc-test-dig.md', videoId: VIDEO_ID_DIG_DOC });
}

/**
 * Render a dig-deeper doc with the section in dug state (with content).
 * Serves as the "after" fixture returned by the re-GET after dig completes.
 * Includes a ModelEnvelope so the .gist block is rendered (required for C2/C3
 * toggle tests that assert .gist visibility).
 */
function makeDigDocHtmlDug(): string {
  const summary: ParsedSummary = {
    title: 'Dig Doc Test',
    channel: null,
    duration: null,
    url: `https://www.youtube.com/watch?v=${VIDEO_ID_DIG_DOC}`,
    lang: 'EN',
    videoId: VIDEO_ID_DIG_DOC,
    tldr: null,
    takeaways: [],
    sourceMd: `${VIDEO_ID_DIG_DOC}.md`,
    sections: [
      {
        numeral: '1',
        title: 'Section Alpha',
        prose: 'Intro prose',
        timeRange: { startSec: START_SEC_DIG_DOC, endSec: START_SEC_DIG_DOC + 60, label: '1:30–2:30', url: `https://www.youtube.com/watch?v=${VIDEO_ID_DIG_DOC}&t=${START_SEC_DIG_DOC}s` },
      },
    ],
  };
  // Envelope with matching sourceSections allows the renderer to emit a .gist block,
  // which is needed for C2/C3 toggle assertions on .gist visibility.
  const envelope: ModelEnvelope = {
    sourceMd: `${VIDEO_ID_DIG_DOC}.md`,
    generatedAt: '2026-01-01T00:00:00.000Z',
    sourceSections: ['Section Alpha'],
    model: {
      sections: [
        { lead: 'Key summary lead sentence.', bullets: [{ label: 'A', text: 'Bullet one.' }, { label: 'B', text: 'Bullet two.' }, { label: 'C', text: 'Bullet three.' }] },
      ],
    },
  };
  const dug: DugSection[] = [
    {
      sectionId: START_SEC_DIG_DOC,
      startSec: START_SEC_DIG_DOC,
      title: 'Section Alpha',
      bodyMarkdown: '## Section Alpha\n\nDeep insight after digging.\n',
      generatedAt: '2026-01-01T00:00:00.000Z',
      genVersion: DIG_GENERATOR_VERSION,
    },
  ];
  return renderDigDeeperDoc({ summary, envelope, dug, mdPath: '/tmp/dig-doc-test-dig.md', videoId: VIDEO_ID_DIG_DOC });
}

// ---------------------------------------------------------------------------
// Helper: serve dig-doc HTML with a stateful toggle so the re-GET returns the dug version.
// ---------------------------------------------------------------------------

async function stubDigDocRoutes(
  page: import('@playwright/test').Page,
  videoId: string,
  undugHtml: string,
  dugHtml: string,
) {
  // Track whether dig has completed so re-GET returns updated HTML.
  // Use a simple array to allow mutation inside the closure.
  const state = { dug: false };

  // POST dig trigger → returns jobId; also flips state.dug so re-GET gets the dug version
  await page.route(`**/api/videos/${videoId}/dig/${START_SEC_DIG_DOC}`, (route) => {
    if (route.request().method() !== 'POST') { route.continue(); return; }
    state.dug = true;
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ jobId: 'dig-doc-job-1' }),
    });
  });

  // SSE stream → emits done immediately
  await page.route(`**/api/videos/${videoId}/dig/${START_SEC_DIG_DOC}/stream**`, (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      body: sseBody({ type: 'done' }),
    }),
  );

  // Dig-doc HTML route — returns undug initially, dug after POST sets state.dug
  await page.route(`**/api/html/${videoId}**`, (route) => {
    const html = state.dug ? dugHtml : undugHtml;
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: html,
    });
  });
}

// ---------------------------------------------------------------------------
// Task 10 — Behavior C1: click dig-trigger → in-place expand (POST+stream+re-GET)
//   After done: section has data-dug="true", shows .dug content, control is
//   "show summary ⌃", page did NOT navigate.
// ---------------------------------------------------------------------------

test('C1 (dig-doc expand): click dig-trigger → in-place expand; section shows .dug; control becomes show summary ⌃; no navigation', async ({ page }) => {
  const undugHtml = makeDigDocHtmlUndug();
  const dugHtml = makeDigDocHtmlDug();
  await stubDigDocRoutes(page, VIDEO_ID_DIG_DOC, undugHtml, dugHtml);

  const digDocUrl = `http://localhost:3000/api/html/${VIDEO_ID_DIG_DOC}?outputFolder=${encodeURIComponent(OUTPUT_FOLDER)}&type=dig-deeper`;
  await page.goto(digDocUrl);

  // Before: section is un-dug, dig-trigger visible
  const trigger = page.locator('a.dig-trigger[data-section]');
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveText('dig deeper ▶');

  // Record URL before click — no navigation should occur
  const urlBefore = page.url();

  // Click the trigger
  await trigger.click();

  // After stream done + re-GET: the section is replaced with the dug version.
  // The trigger is gone; a dig-toggle appears in its place.
  const toggle = page.locator('a.dig-toggle');
  await expect(toggle).toBeVisible({ timeout: 5000 });
  await expect(toggle).toHaveText('show summary ⌃');

  // The .dug content block is present (rendered dug body markdown)
  const dugBlock = page.locator('section[data-dug="true"] .dug');
  await expect(dugBlock).toBeVisible();

  // Page did NOT navigate
  expect(page.url()).toBe(urlBefore);
});

// ---------------------------------------------------------------------------
// Task 10 — Behavior C2: click dig-toggle → .gist visible, .dug hidden
// ---------------------------------------------------------------------------

test('C2 (dig-doc toggle to summary): click show-summary ⌃ → gist visible, dug hidden', async ({ page }) => {
  // Start on the DUG version of the page (section already dug)
  const dugHtml = makeDigDocHtmlDug();
  // Re-GET won't be needed here — we start already dug; stub HTML route directly
  await page.route(`**/api/html/${VIDEO_ID_DIG_DOC}**`, (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: dugHtml,
    }),
  );

  const digDocUrl = `http://localhost:3000/api/html/${VIDEO_ID_DIG_DOC}?outputFolder=${encodeURIComponent(OUTPUT_FOLDER)}&type=dig-deeper`;
  await page.goto(digDocUrl);

  // The section is pre-dug; dig-toggle should be visible
  // data-dug="true" sections: .gist is hidden by default CSS; .dug is shown
  const section = page.locator('section[data-dug="true"]');
  await expect(section).toBeVisible();

  const toggle = page.locator('a.dig-toggle');
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveText('show summary ⌃');

  // Click toggle: adds .show-gist → .gist shown, .dug hidden
  await toggle.click();

  // .gist should now be visible (show-gist class added to section)
  const gistBlock = section.locator('.gist');
  // .dug should now be hidden
  const dugBlock = section.locator('.dug');

  // section[data-dug="true"] .gist is hidden by CSS; .show-gist .gist is visible
  // After toggle click, section gets .show-gist → gist becomes visible, dug hidden
  await expect(section).toHaveClass(/show-gist/, { timeout: 3000 });
  await expect(gistBlock).toBeVisible();
  await expect(dugBlock).toBeHidden();

  // Label flips to describe the next action (show the dug detail again)
  await expect(toggle).toHaveText('show dig deeper ▶');
});

// ---------------------------------------------------------------------------
// Task 10 — Behavior C3: click dig-toggle again → toggle back (.dug visible, .gist hidden)
// ---------------------------------------------------------------------------

test('C3 (dig-doc toggle back to dug): toggle again → dug visible, gist hidden', async ({ page }) => {
  const dugHtml = makeDigDocHtmlDug();
  await page.route(`**/api/html/${VIDEO_ID_DIG_DOC}**`, (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: dugHtml,
    }),
  );

  const digDocUrl = `http://localhost:3000/api/html/${VIDEO_ID_DIG_DOC}?outputFolder=${encodeURIComponent(OUTPUT_FOLDER)}&type=dig-deeper`;
  await page.goto(digDocUrl);

  const section = page.locator('section[data-dug="true"]');
  const toggle = page.locator('a.dig-toggle');
  await expect(toggle).toBeVisible();

  // First toggle: → show-gist (gist visible, dug hidden); label → "show dig deeper ▶"
  await toggle.click();
  await expect(section).toHaveClass(/show-gist/, { timeout: 3000 });
  await expect(toggle).toHaveText('show dig deeper ▶');

  // Second toggle: → remove show-gist (dug visible, gist hidden again); label → "show summary ⌃"
  await toggle.click();
  await expect(section).not.toHaveClass(/show-gist/, { timeout: 3000 });
  await expect(toggle).toHaveText('show summary ⌃');

  const dugBlock = section.locator('.dug');
  const gistBlock = section.locator('.gist');
  await expect(dugBlock).toBeVisible();
  await expect(gistBlock).toBeHidden();
});

// ---------------------------------------------------------------------------
// Task 10 — Behavior C4: mocked POST returns 500 → ⚠ retry visible, section stays un-dug
// ---------------------------------------------------------------------------

test('C4 (dig-doc POST-500): POST 500 → ⚠ retry on trigger; section stays un-dug', async ({ page }) => {
  const undugHtml = makeDigDocHtmlUndug();

  // Stub dig-doc route
  await page.route(`**/api/html/${VIDEO_ID_DIG_DOC}**`, (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: undugHtml,
    }),
  );

  // Stub POST to return 500
  await page.route(`**/api/videos/${VIDEO_ID_DIG_DOC}/dig/${START_SEC_DIG_DOC}`, (route) => {
    if (route.request().method() !== 'POST') { route.continue(); return; }
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'server error' }),
    });
  });

  const digDocUrl = `http://localhost:3000/api/html/${VIDEO_ID_DIG_DOC}?outputFolder=${encodeURIComponent(OUTPUT_FOLDER)}&type=dig-deeper`;
  await page.goto(digDocUrl);

  const trigger = page.locator('a.dig-trigger[data-section]');
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveText('dig deeper ▶');

  // Click trigger
  await trigger.click();

  // After POST 500: trigger shows ⚠ retry
  await expect(trigger).toHaveText('⚠ retry', { timeout: 5000 });

  // Section still un-dug (no replacement occurred)
  await expect(page.locator('section[data-dug="true"]')).toHaveCount(0);
  await expect(page.locator('section[data-dug="false"]')).toBeVisible();
});

// ===========================================================================
// DIG-DOC ?dig=N AUTO-TRIGGER (Task 11)
// Tests for guarded ?dig= URL param: already-dug → no POST, un-dug → fires once,
// URL stripped via replaceState, bfcache pageshow re-fetches dig-state.
// ===========================================================================

const VIDEO_ID_DIG_PARAM = 'vid-dig-param';
const START_SEC_DIG_PARAM = 90; // matches the dig-trigger data-section in makeDigDocHtmlUndug variant

/**
 * Un-dug dig-doc fixture for D-series tests.
 * Uses VIDEO_ID_DIG_PARAM so routes don't clash with C-series.
 */
function makeDigParamHtmlUndug(): string {
  const summary: ParsedSummary = {
    title: 'Dig Param Test',
    channel: null,
    duration: null,
    url: `https://www.youtube.com/watch?v=${VIDEO_ID_DIG_PARAM}`,
    lang: 'EN',
    videoId: VIDEO_ID_DIG_PARAM,
    tldr: null,
    takeaways: [],
    sourceMd: `${VIDEO_ID_DIG_PARAM}.md`,
    sections: [
      {
        numeral: '1',
        title: 'Section Beta',
        prose: 'Intro prose',
        timeRange: { startSec: START_SEC_DIG_PARAM, endSec: START_SEC_DIG_PARAM + 60, label: '1:30–2:30', url: `https://www.youtube.com/watch?v=${VIDEO_ID_DIG_PARAM}&t=${START_SEC_DIG_PARAM}s` },
      },
    ],
  };
  return renderDigDeeperDoc({ summary, envelope: null, dug: [], mdPath: '/tmp/dig-param-test-dig.md', videoId: VIDEO_ID_DIG_PARAM });
}

/**
 * Dug dig-doc fixture for D-series tests.
 */
function makeDigParamHtmlDug(): string {
  const summary: ParsedSummary = {
    title: 'Dig Param Test',
    channel: null,
    duration: null,
    url: `https://www.youtube.com/watch?v=${VIDEO_ID_DIG_PARAM}`,
    lang: 'EN',
    videoId: VIDEO_ID_DIG_PARAM,
    tldr: null,
    takeaways: [],
    sourceMd: `${VIDEO_ID_DIG_PARAM}.md`,
    sections: [
      {
        numeral: '1',
        title: 'Section Beta',
        prose: 'Intro prose',
        timeRange: { startSec: START_SEC_DIG_PARAM, endSec: START_SEC_DIG_PARAM + 60, label: '1:30–2:30', url: `https://www.youtube.com/watch?v=${VIDEO_ID_DIG_PARAM}&t=${START_SEC_DIG_PARAM}s` },
      },
    ],
  };
  const dug: DugSection[] = [
    {
      sectionId: START_SEC_DIG_PARAM,
      startSec: START_SEC_DIG_PARAM,
      title: 'Section Beta',
      bodyMarkdown: '## Section Beta\n\nDeep insight after auto-dig.\n',
      generatedAt: '2026-01-01T00:00:00.000Z',
      genVersion: DIG_GENERATOR_VERSION,
    },
  ];
  return renderDigDeeperDoc({ summary, envelope: null, dug, mdPath: '/tmp/dig-param-test-dig.md', videoId: VIDEO_ID_DIG_PARAM });
}

/**
 * Wire routes for D-series: dig-doc HTML (stateful: undug → dug after POST),
 * dig-state, POST, SSE stream.
 */
async function stubDigParamRoutes(
  page: import('@playwright/test').Page,
  opts: {
    initialDigState?: number[];   // sectionIds already dug on load
    postStatus?: number;          // default 200
    postSpy?: (method: string) => void;
  } = {},
) {
  const { initialDigState = [], postStatus = 200 } = opts;
  const state = { dug: false };

  const undugHtml = makeDigParamHtmlUndug();
  const dugHtml = makeDigParamHtmlDug();

  // dig-state: returns initialDigState on first fetch; after POST, returns section as dug
  await page.route(`**/api/videos/${VIDEO_ID_DIG_PARAM}/dig-state**`, (route) => {
    const ids = state.dug ? [START_SEC_DIG_PARAM] : initialDigState;
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ sectionIds: ids }),
    });
  });

  // POST trigger
  await page.route(`**/api/videos/${VIDEO_ID_DIG_PARAM}/dig/${START_SEC_DIG_PARAM}`, (route) => {
    if (route.request().method() !== 'POST') { route.continue(); return; }
    opts.postSpy?.(route.request().method());
    if (postStatus === 200) {
      state.dug = true;
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ jobId: 'dig-param-job-1' }),
      });
    } else {
      route.fulfill({
        status: postStatus,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'server error' }),
      });
    }
  });

  // SSE stream
  await page.route(`**/api/videos/${VIDEO_ID_DIG_PARAM}/dig/${START_SEC_DIG_PARAM}/stream**`, (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      body: sseBody({ type: 'done' }),
    }),
  );

  // HTML route: returns undug initially, dug after POST
  await page.route(`**/api/html/${VIDEO_ID_DIG_PARAM}**`, (route) => {
    const html = state.dug ? dugHtml : undugHtml;
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: html,
    });
  });
}

// ---------------------------------------------------------------------------
// D1: ?dig=N on an un-dug section → generation fires once, section expands,
//     URL no longer contains dig=
// ---------------------------------------------------------------------------

test('D1 (?dig= un-dug): generation fires once, section expands, URL stripped', async ({ page }) => {
  const postCalls: string[] = [];
  await stubDigParamRoutes(page, {
    initialDigState: [],
    postSpy: (method) => postCalls.push(method),
  });

  // Navigate to dig-doc with ?dig=<sec>
  const digDocUrl = `http://localhost:3000/api/html/${VIDEO_ID_DIG_PARAM}?outputFolder=${encodeURIComponent(OUTPUT_FOLDER)}&type=dig-deeper&dig=${START_SEC_DIG_PARAM}`;
  await page.goto(digDocUrl);

  // Auto-trigger fires: section should expand to dug state (dig-toggle visible)
  const toggle = page.locator('a.dig-toggle');
  await expect(toggle).toBeVisible({ timeout: 8000 });

  // Exactly one POST was fired
  expect(postCalls).toHaveLength(1);

  // URL no longer contains dig= param
  const finalUrl = page.url();
  expect(new URL(finalUrl).searchParams.has('dig')).toBe(false);
  // type and outputFolder are preserved
  expect(new URL(finalUrl).searchParams.get('type')).toBe('dig-deeper');
  expect(new URL(finalUrl).searchParams.get('outputFolder')).toBe(OUTPUT_FOLDER);
});

// ---------------------------------------------------------------------------
// D2: ?dig=N on an ALREADY-dug section → NO POST fired, scrolls, URL stripped
// ---------------------------------------------------------------------------

test('D2 (?dig= already-dug): no POST fired, URL stripped', async ({ page }) => {
  // Section is already dug on load
  let postFired = false;
  await stubDigParamRoutes(page, {
    initialDigState: [START_SEC_DIG_PARAM],
    postSpy: () => { postFired = true; },
  });

  // Use the DUG html from the start (section already dug, dig-toggle present)
  // The stubDigParamRoutes HTML route starts with undugHtml, but dig-state already includes the section.
  // We need the HTML to also reflect dug state — override the HTML route.
  // Re-stub HTML with dug version (later route registration wins in Playwright).
  const dugHtml = makeDigParamHtmlDug();
  await page.route(`**/api/html/${VIDEO_ID_DIG_PARAM}**`, (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: dugHtml,
    }),
  );

  const digDocUrl = `http://localhost:3000/api/html/${VIDEO_ID_DIG_PARAM}?outputFolder=${encodeURIComponent(OUTPUT_FOLDER)}&type=dig-deeper&dig=${START_SEC_DIG_PARAM}`;
  await page.goto(digDocUrl);

  // The section is already dug — wait for the page to stabilise (dig-state fetch completes)
  await page.waitForLoadState('networkidle', { timeout: 5000 });

  // No POST must have been fired
  expect(postFired).toBe(false);

  // URL no longer contains dig= param
  const finalUrl = page.url();
  expect(new URL(finalUrl).searchParams.has('dig')).toBe(false);
  // type and outputFolder preserved
  expect(new URL(finalUrl).searchParams.get('type')).toBe('dig-deeper');
  expect(new URL(finalUrl).searchParams.get('outputFolder')).toBe(OUTPUT_FOLDER);
});

// ---------------------------------------------------------------------------
// D3: reload after auto-trigger → no second POST
// ---------------------------------------------------------------------------

test('D3 (reload after ?dig=): no second POST on reload', async ({ page }) => {
  const postCalls: string[] = [];
  await stubDigParamRoutes(page, {
    initialDigState: [],
    postSpy: (method) => postCalls.push(method),
  });

  // First load: auto-trigger fires
  const digDocUrl = `http://localhost:3000/api/html/${VIDEO_ID_DIG_PARAM}?outputFolder=${encodeURIComponent(OUTPUT_FOLDER)}&type=dig-deeper&dig=${START_SEC_DIG_PARAM}`;
  await page.goto(digDocUrl);

  // Wait for section to expand (first trigger done)
  await expect(page.locator('a.dig-toggle')).toBeVisible({ timeout: 8000 });
  const afterFirstLoad = postCalls.length;
  expect(afterFirstLoad).toBe(1);

  // The URL should now have dig stripped; reload (no ?dig= in URL → no second trigger)
  await page.reload();
  await page.waitForLoadState('networkidle', { timeout: 5000 });

  // Still exactly 1 POST total
  expect(postCalls).toHaveLength(1);
});

// ---------------------------------------------------------------------------
// D4: bfcache back navigation → pageshow re-fetches dig-state
// ---------------------------------------------------------------------------

test('D4 (bfcache pageshow): navigate away and back → pageshow re-fetches dig-state', async ({ page }) => {
  let digStateFetchCount = 0;
  await stubDigParamRoutes(page, { initialDigState: [] });

  // Count dig-state fetches via a separate spy route (falls through to the stub)
  await page.route(`**/api/videos/${VIDEO_ID_DIG_PARAM}/dig-state**`, (route) => {
    digStateFetchCount++;
    route.fallback();
  });

  // Stub a second page for navigation target
  await page.route('**/about-blank-nav**', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/html' },
      body: '<html><body>Away</body></html>',
    }),
  );

  // Load dig-doc page (no ?dig= param — just test the pageshow re-fetch)
  const digDocUrl = `http://localhost:3000/api/html/${VIDEO_ID_DIG_PARAM}?outputFolder=${encodeURIComponent(OUTPUT_FOLDER)}&type=dig-deeper`;
  await page.goto(digDocUrl);
  await page.waitForLoadState('networkidle', { timeout: 5000 });

  const fetchesAfterFirstLoad = digStateFetchCount;
  expect(fetchesAfterFirstLoad).toBeGreaterThanOrEqual(1);

  // Navigate away
  await page.goto('http://localhost:3000/about-blank-nav');

  // Go back — this simulates bfcache restoration (page restored from cache)
  await page.goBack();
  await page.waitForLoadState('networkidle', { timeout: 5000 });

  // pageshow listener should re-fetch dig-state
  expect(digStateFetchCount).toBeGreaterThan(fetchesAfterFirstLoad);
});

// ===========================================================================
// EXPAND-ALL (Task 12)
// Tests for the ⤢ expand all button: confirm dialog, serialized batch,
// cancel mid-batch, failure handling.
// ===========================================================================

const VIDEO_ID_EA = 'vid-expand-all';
// Three sections, all with distinct startSecs so routes don't clash.
const SEC_EA_1 = 100;
const SEC_EA_2 = 200;
const SEC_EA_3 = 300;

/**
 * Render a dig-doc page with N un-dug sections (all have startSec → dig-trigger rendered).
 * Optionally the first `dugCount` sections are pre-dug.
 */
function makeExpandAllHtml(dugCount = 0): string {
  const allSecs = [SEC_EA_1, SEC_EA_2, SEC_EA_3];
  const summary: ParsedSummary = {
    title: 'Expand All Test',
    channel: null,
    duration: null,
    url: `https://www.youtube.com/watch?v=${VIDEO_ID_EA}`,
    lang: 'EN',
    videoId: VIDEO_ID_EA,
    tldr: null,
    takeaways: [],
    sourceMd: `${VIDEO_ID_EA}.md`,
    sections: allSecs.map((sec, i) => ({
      numeral: String(i + 1),
      title: `Section ${i + 1}`,
      prose: `Prose ${i + 1}`,
      timeRange: { startSec: sec, endSec: sec + 60, label: `${i + 1}:00–${i + 2}:00`, url: `https://www.youtube.com/watch?v=${VIDEO_ID_EA}&t=${sec}s` },
    })),
  };
  const dug: DugSection[] = allSecs.slice(0, dugCount).map((sec, i) => ({
    sectionId: sec,
    startSec: sec,
    title: `Section ${i + 1}`,
    bodyMarkdown: `## Section ${i + 1}\n\nDug content.\n`,
    generatedAt: '2026-01-01T00:00:00.000Z',
    genVersion: DIG_GENERATOR_VERSION,
  }));
  return renderDigDeeperDoc({ summary, envelope: null, dug, mdPath: '/tmp/expand-all-dig.md', videoId: VIDEO_ID_EA });
}

/** Render the dug version of the page (all 3 sections dug). */
function makeExpandAllHtmlAllDug(): string {
  return makeExpandAllHtml(3);
}

/** Render a version with only sec1 dug. */
function makeExpandAllHtmlSec1Dug(): string {
  return makeExpandAllHtml(1);
}

/** Render a version with sec1+sec2 dug. */
function makeExpandAllHtmlSec1Sec2Dug(): string {
  return makeExpandAllHtml(2);
}

/**
 * Wire routes for expand-all tests.
 * - GET /api/html/<id>?type=dig-deeper returns the current HTML (stateful via htmlFn).
 * - Per-section POST + SSE + reGET controlled by `sectionOpts`.
 */
async function stubExpandAllRoutes(
  page: import('@playwright/test').Page,
  opts: {
    /** Stateful fn — called each time the HTML route is hit. */
    htmlFn?: () => string;
    /** Per-section POST status (default 200). Map of startSec → status. */
    postStatus?: Record<number, number>;
    /** Per-section POST spy. */
    postSpy?: (sec: number) => void;
    /** Optional delay (ms) on the HTML re-GET after SSE done, to allow cancel timing. */
    reGetDelayMs?: number;
  } = {},
) {
  const { htmlFn = makeExpandAllHtml, postStatus = {}, postSpy, reGetDelayMs = 0 } = opts;

  // Dig-doc HTML route — serves current HTML (stateful)
  await page.route(`**/api/html/${VIDEO_ID_EA}**`, (route) => {
    const body = htmlFn();
    if (reGetDelayMs > 0) {
      setTimeout(() => {
        route.fulfill({
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
          body,
        });
      }, reGetDelayMs);
    } else {
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        body,
      });
    }
  });

  // Per-section POST + SSE for each of the 3 sections
  for (const sec of [SEC_EA_1, SEC_EA_2, SEC_EA_3]) {
    const status = postStatus[sec] ?? 200;
    // POST route
    await page.route(`**/api/videos/${VIDEO_ID_EA}/dig/${sec}`, (route) => {
      if (route.request().method() !== 'POST') { route.continue(); return; }
      postSpy?.(sec);
      route.fulfill({
        status,
        contentType: 'application/json',
        body: status === 200
          ? JSON.stringify({ jobId: `ea-job-${sec}` })
          : JSON.stringify({ error: 'server error' }),
      });
    });
    // SSE stream
    await page.route(`**/api/videos/${VIDEO_ID_EA}/dig/${sec}/stream**`, (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
        body: sseBody({ type: 'done' }),
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// E1: clicking ⤢ expand all shows a confirm dialog with count, ~$ and ~min text
// ---------------------------------------------------------------------------

test('E1 (expand-all dialog): shows count, ~$ cost, ~min estimate', async ({ page }) => {
  // Page with 3 un-dug sections → N=3, X="0.15", Y=2
  const undugHtml = makeExpandAllHtml(0);
  await page.route(`**/api/html/${VIDEO_ID_EA}**`, (route) =>
    route.fulfill({ status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: undugHtml }),
  );

  const digDocUrl = `http://localhost:3000/api/html/${VIDEO_ID_EA}?outputFolder=${encodeURIComponent(OUTPUT_FOLDER)}&type=dig-deeper`;
  await page.goto(digDocUrl);

  // Click the expand-all button
  const expandBtn = page.locator('.dg-expand-all');
  await expect(expandBtn).toBeVisible();
  await expandBtn.click();

  // Dialog should appear
  const dialog = page.locator('#_dg-ea-dlg[data-open]');
  await expect(dialog).toBeVisible({ timeout: 3000 });

  // Message must contain: count, ~$, ~min
  const msg = page.locator('#_dg-ea-msg');
  const msgText = await msg.textContent();
  expect(msgText).toContain('Expand 3 remaining sections?');
  expect(msgText).toContain('~$0.15');
  expect(msgText).toContain('~2 min');
  expect(msgText).toContain('rough estimate');
});

// ---------------------------------------------------------------------------
// E2: confirm → all un-dug sections become dug (progress shown, auto-close)
// ---------------------------------------------------------------------------

test('E2 (expand-all confirm): all un-dug sections become dug; progress shown; auto-close', async ({ page }) => {
  // Stateful HTML: tracks how many sections have been dug
  let dugCount = 0;
  const htmlFn = () => makeExpandAllHtml(dugCount);

  // After each section's re-GET we advance dugCount so the HTML reflects the new state.
  // We use a separate POST spy to increment dugCount when each section POST fires.
  const postsSeen: number[] = [];

  // Wire HTML route (stateful)
  await page.route(`**/api/html/${VIDEO_ID_EA}**`, (route) => {
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: htmlFn(),
    });
  });

  for (const sec of [SEC_EA_1, SEC_EA_2, SEC_EA_3]) {
    await page.route(`**/api/videos/${VIDEO_ID_EA}/dig/${sec}`, (route) => {
      if (route.request().method() !== 'POST') { route.continue(); return; }
      postsSeen.push(sec);
      dugCount++;  // advance so re-GET returns updated HTML
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jobId: `ea-job-${sec}` }) });
    });
    await page.route(`**/api/videos/${VIDEO_ID_EA}/dig/${sec}/stream**`, (route) =>
      route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }, body: sseBody({ type: 'done' }) }),
    );
  }

  const digDocUrl = `http://localhost:3000/api/html/${VIDEO_ID_EA}?outputFolder=${encodeURIComponent(OUTPUT_FOLDER)}&type=dig-deeper`;
  await page.goto(digDocUrl);

  // 3 dig-triggers should be visible initially
  await expect(page.locator('.dig-trigger[data-section]')).toHaveCount(3);

  // Click expand-all
  await page.locator('.dg-expand-all').click();
  const dialog = page.locator('#_dg-ea-dlg[data-open]');
  await expect(dialog).toBeVisible({ timeout: 3000 });

  // Confirm
  await page.locator('#_dg-ea-confirm').click();

  // Progress overlay should be visible
  await expect(page.locator('#_dg-ea-prog[data-open]')).toBeVisible({ timeout: 3000 });

  // Progress text should contain "section N of 3…"
  await expect(page.locator('#_dg-ea-prog-msg')).toContainText('of 3', { timeout: 5000 });

  // Wait for all sections to be processed (progress overlay auto-closes)
  await expect(page.locator('#_dg-ea-prog[data-open]')).toHaveCount(0, { timeout: 15000 });

  // All 3 sections should now be dug (no dig-triggers remain)
  await expect(page.locator('.dig-trigger[data-section]')).toHaveCount(0, { timeout: 5000 });

  // All 3 POSTs were fired
  expect(postsSeen).toHaveLength(3);
});

// ---------------------------------------------------------------------------
// E3: cancel dialog → no generation (0 POSTs)
// ---------------------------------------------------------------------------

test('E3 (expand-all cancel dialog): cancel → no POST fired', async ({ page }) => {
  const undugHtml = makeExpandAllHtml(0);
  await page.route(`**/api/html/${VIDEO_ID_EA}**`, (route) =>
    route.fulfill({ status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: undugHtml }),
  );

  const postsSeen: number[] = [];
  for (const sec of [SEC_EA_1, SEC_EA_2, SEC_EA_3]) {
    await page.route(`**/api/videos/${VIDEO_ID_EA}/dig/${sec}`, (route) => {
      if (route.request().method() !== 'POST') { route.continue(); return; }
      postsSeen.push(sec);
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jobId: `ea-job-${sec}` }) });
    });
  }

  const digDocUrl = `http://localhost:3000/api/html/${VIDEO_ID_EA}?outputFolder=${encodeURIComponent(OUTPUT_FOLDER)}&type=dig-deeper`;
  await page.goto(digDocUrl);

  // Click expand-all
  await page.locator('.dg-expand-all').click();
  await expect(page.locator('#_dg-ea-dlg[data-open]')).toBeVisible({ timeout: 3000 });

  // Cancel the dialog
  await page.locator('#_dg-ea-cancel-dlg').click();

  // Dialog should close
  await expect(page.locator('#_dg-ea-dlg[data-open]')).toHaveCount(0, { timeout: 3000 });

  // No progress overlay
  await expect(page.locator('#_dg-ea-prog[data-open]')).toHaveCount(0);

  // Wait to confirm no POST fires
  await page.waitForTimeout(500);
  expect(postsSeen).toHaveLength(0);

  // All sections still un-dug
  await expect(page.locator('.dig-trigger[data-section]')).toHaveCount(3);
});

// ---------------------------------------------------------------------------
// E3b: backdrop click dismiss → dialog closes; ZERO POSTs fire
// ---------------------------------------------------------------------------

test('E3b (expand-all backdrop dismiss): click backdrop → dialog closes; no POST fired', async ({ page }) => {
  const undugHtml = makeExpandAllHtml(0);
  await page.route(`**/api/html/${VIDEO_ID_EA}**`, (route) =>
    route.fulfill({ status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: undugHtml }),
  );

  const postsSeen: number[] = [];
  for (const sec of [SEC_EA_1, SEC_EA_2, SEC_EA_3]) {
    await page.route(`**/api/videos/${VIDEO_ID_EA}/dig/${sec}`, (route) => {
      if (route.request().method() !== 'POST') { route.continue(); return; }
      postsSeen.push(sec);
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jobId: `ea-job-${sec}` }) });
    });
  }

  const digDocUrl = `http://localhost:3000/api/html/${VIDEO_ID_EA}?outputFolder=${encodeURIComponent(OUTPUT_FOLDER)}&type=dig-deeper`;
  await page.goto(digDocUrl);

  // Click expand-all → dialog opens
  await page.locator('.dg-expand-all').click();
  const dialog = page.locator('#_dg-ea-dlg[data-open]');
  await expect(dialog).toBeVisible({ timeout: 3000 });

  // Click the backdrop (the dialog element itself, not its children)
  const dialogEl = page.locator('#_dg-ea-dlg');
  await dialogEl.click({ position: { x: 5, y: 5 } });

  // Dialog should close
  await expect(page.locator('#_dg-ea-dlg[data-open]')).toHaveCount(0, { timeout: 3000 });

  // No progress overlay
  await expect(page.locator('#_dg-ea-prog[data-open]')).toHaveCount(0);

  // Wait to confirm no POST fires
  await page.waitForTimeout(500);
  expect(postsSeen).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// E3c: Escape key dismiss → dialog closes; ZERO POSTs fire
// ---------------------------------------------------------------------------

test('E3c (expand-all Escape dismiss): Escape key → dialog closes; no POST fired', async ({ page }) => {
  const undugHtml = makeExpandAllHtml(0);
  await page.route(`**/api/html/${VIDEO_ID_EA}**`, (route) =>
    route.fulfill({ status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: undugHtml }),
  );

  const postsSeen: number[] = [];
  for (const sec of [SEC_EA_1, SEC_EA_2, SEC_EA_3]) {
    await page.route(`**/api/videos/${VIDEO_ID_EA}/dig/${sec}`, (route) => {
      if (route.request().method() !== 'POST') { route.continue(); return; }
      postsSeen.push(sec);
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jobId: `ea-job-${sec}` }) });
    });
  }

  const digDocUrl = `http://localhost:3000/api/html/${VIDEO_ID_EA}?outputFolder=${encodeURIComponent(OUTPUT_FOLDER)}&type=dig-deeper`;
  await page.goto(digDocUrl);

  // Click expand-all → dialog opens
  await page.locator('.dg-expand-all').click();
  await expect(page.locator('#_dg-ea-dlg[data-open]')).toBeVisible({ timeout: 3000 });

  // Press Escape
  await page.keyboard.press('Escape');

  // Dialog should close
  await expect(page.locator('#_dg-ea-dlg[data-open]')).toHaveCount(0, { timeout: 3000 });

  // No progress overlay
  await expect(page.locator('#_dg-ea-prog[data-open]')).toHaveCount(0);

  // Wait to confirm no POST fires
  await page.waitForTimeout(500);
  expect(postsSeen).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// E4: cancel mid-batch → stops after current section; prior sections stay dug
// ---------------------------------------------------------------------------

test('E4 (expand-all cancel mid-batch): cancel stops after current; prior sections dug', async ({ page }) => {
  // Strategy: make sec1's re-GET delayed so we can click cancel during that window.
  // sec1 POST → SSE done → re-GET (delayed 200ms) → sec1 dug → cancel clicked → sec2/sec3 not started.
  let dugCount = 0;

  // HTML route with delay on re-GET (to give cancel a chance after sec1 SSE completes)
  await page.route(`**/api/html/${VIDEO_ID_EA}**`, (route) => {
    const body = makeExpandAllHtml(dugCount);
    // Use a timeout so the cancel click can arrive between sec1 completing and sec2 starting.
    setTimeout(() => {
      route.fulfill({ status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body });
    }, 80);
  });

  const postsSeen: number[] = [];

  // sec1: POST succeeds (increments dugCount so re-GET returns sec1-dug HTML)
  await page.route(`**/api/videos/${VIDEO_ID_EA}/dig/${SEC_EA_1}`, (route) => {
    if (route.request().method() !== 'POST') { route.continue(); return; }
    postsSeen.push(SEC_EA_1);
    dugCount = 1;
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jobId: 'ea-job-sec1' }) });
  });
  await page.route(`**/api/videos/${VIDEO_ID_EA}/dig/${SEC_EA_1}/stream**`, (route) =>
    route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }, body: sseBody({ type: 'done' }) }),
  );

  // sec2/sec3: track POSTs (should NOT fire after cancel)
  for (const sec of [SEC_EA_2, SEC_EA_3]) {
    await page.route(`**/api/videos/${VIDEO_ID_EA}/dig/${sec}`, (route) => {
      if (route.request().method() !== 'POST') { route.continue(); return; }
      postsSeen.push(sec);
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jobId: `ea-job-${sec}` }) });
    });
    await page.route(`**/api/videos/${VIDEO_ID_EA}/dig/${sec}/stream**`, (route) =>
      route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }, body: sseBody({ type: 'done' }) }),
    );
  }

  const digDocUrl = `http://localhost:3000/api/html/${VIDEO_ID_EA}?outputFolder=${encodeURIComponent(OUTPUT_FOLDER)}&type=dig-deeper`;
  await page.goto(digDocUrl);
  await expect(page.locator('.dig-trigger[data-section]')).toHaveCount(3);

  // Click expand-all → confirm
  await page.locator('.dg-expand-all').click();
  await expect(page.locator('#_dg-ea-dlg[data-open]')).toBeVisible({ timeout: 3000 });
  await page.locator('#_dg-ea-confirm').click();

  // Progress overlay visible
  await expect(page.locator('#_dg-ea-prog[data-open]')).toBeVisible({ timeout: 3000 });

  // Wait for sec1 POST to fire (sec1 is in progress)
  await page.waitForFunction(() => {
    const msg = document.getElementById('_dg-ea-prog-msg');
    return msg && msg.textContent && msg.textContent.includes('section 1');
  }, { timeout: 5000 });

  // Click cancel during sec1's re-GET delay window
  await page.locator('#_dg-ea-cancel-prog').click();

  // Wait for progress overlay to close (cancel takes effect after current section)
  await expect(page.locator('#_dg-ea-prog[data-open]')).toHaveCount(0, { timeout: 10000 });

  // sec1 POST fired
  expect(postsSeen).toContain(SEC_EA_1);

  // sec2 and sec3 POSTs should NOT have fired
  expect(postsSeen).not.toContain(SEC_EA_2);
  expect(postsSeen).not.toContain(SEC_EA_3);

  // sec1 is now dug (DOM reflects the re-GET result)
  await expect(page.locator(`section[data-start="${SEC_EA_1}"][data-dug="true"]`)).toBeVisible({ timeout: 5000 });
});

// ---------------------------------------------------------------------------
// E5: one section POST returns 500 → batch continues, failure reported at end
// ---------------------------------------------------------------------------

test('E5 (expand-all failure): POST 500 for one section → batch continues; failure reported', async ({ page }) => {
  // sec1 succeeds; sec2 returns 500 (failure); sec3 succeeds.
  // Expected: sec1 dug, sec3 dug, failure message shown mentioning sec2's startSec (200).
  const dugSecs = new Set<number>();
  const postsSeen: number[] = [];

  function buildHtml(): string {
    const dugArray: DugSection[] = Array.from(dugSecs).map((sec) => ({
      sectionId: sec,
      startSec: sec,
      title: `Section ${[SEC_EA_1, SEC_EA_2, SEC_EA_3].indexOf(sec) + 1}`,
      bodyMarkdown: `## Section\n\nDug content.\n`,
      generatedAt: '2026-01-01T00:00:00.000Z',
      genVersion: DIG_GENERATOR_VERSION,
    }));
    const summary: ParsedSummary = {
      title: 'Expand All Test',
      channel: null, duration: null,
      url: `https://www.youtube.com/watch?v=${VIDEO_ID_EA}`,
      lang: 'EN', videoId: VIDEO_ID_EA, tldr: null, takeaways: [],
      sourceMd: `${VIDEO_ID_EA}.md`,
      sections: [SEC_EA_1, SEC_EA_2, SEC_EA_3].map((sec, i) => ({
        numeral: String(i + 1), title: `Section ${i + 1}`, prose: `Prose`,
        timeRange: { startSec: sec, endSec: sec + 60, label: `${i + 1}:00`, url: `https://www.youtube.com/watch?v=${VIDEO_ID_EA}&t=${sec}s` },
      })),
    };
    return renderDigDeeperDoc({ summary, envelope: null, dug: dugArray, mdPath: '/tmp/ea-e5.md', videoId: VIDEO_ID_EA });
  }

  // Stateful HTML route — single handler using `dugSecs` set
  await page.route(`**/api/html/${VIDEO_ID_EA}**`, (route) => {
    route.fulfill({ status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: buildHtml() });
  });

  // sec1: POST succeeds
  await page.route(`**/api/videos/${VIDEO_ID_EA}/dig/${SEC_EA_1}`, (route) => {
    if (route.request().method() !== 'POST') { route.continue(); return; }
    postsSeen.push(SEC_EA_1);
    dugSecs.add(SEC_EA_1);
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jobId: 'ea-job-sec1' }) });
  });
  await page.route(`**/api/videos/${VIDEO_ID_EA}/dig/${SEC_EA_1}/stream**`, (route) =>
    route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }, body: sseBody({ type: 'done' }) }),
  );

  // sec2: POST returns 500 (failure — no stream needed)
  await page.route(`**/api/videos/${VIDEO_ID_EA}/dig/${SEC_EA_2}`, (route) => {
    if (route.request().method() !== 'POST') { route.continue(); return; }
    postsSeen.push(SEC_EA_2);
    route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'server error' }) });
  });

  // sec3: POST succeeds
  await page.route(`**/api/videos/${VIDEO_ID_EA}/dig/${SEC_EA_3}`, (route) => {
    if (route.request().method() !== 'POST') { route.continue(); return; }
    postsSeen.push(SEC_EA_3);
    dugSecs.add(SEC_EA_3);
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jobId: 'ea-job-sec3' }) });
  });
  await page.route(`**/api/videos/${VIDEO_ID_EA}/dig/${SEC_EA_3}/stream**`, (route) =>
    route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }, body: sseBody({ type: 'done' }) }),
  );

  const digDocUrl = `http://localhost:3000/api/html/${VIDEO_ID_EA}?outputFolder=${encodeURIComponent(OUTPUT_FOLDER)}&type=dig-deeper`;
  await page.goto(digDocUrl);
  await expect(page.locator('.dig-trigger[data-section]')).toHaveCount(3);

  // Click expand-all → confirm
  await page.locator('.dg-expand-all').click();
  await expect(page.locator('#_dg-ea-dlg[data-open]')).toBeVisible({ timeout: 3000 });
  await page.locator('#_dg-ea-confirm').click();

  // Wait for progress overlay to show failure message (overlay stays open during failure display)
  // The failure message becomes visible before the overlay auto-closes.
  const failMsg = page.locator('#_dg-ea-fail-msg');
  await expect(failMsg).toBeVisible({ timeout: 15000 });
  const failText = await failMsg.textContent();
  expect(failText).toContain(String(SEC_EA_2));  // sec2's startSec (200) in the failed-sections list

  // Wait for progress overlay to eventually auto-close (6s timeout)
  await expect(page.locator('#_dg-ea-prog[data-open]')).toHaveCount(0, { timeout: 12000 });

  // All 3 POSTs were attempted (sec1 + sec2 (failed) + sec3)
  expect(postsSeen).toContain(SEC_EA_1);
  expect(postsSeen).toContain(SEC_EA_2);
  expect(postsSeen).toContain(SEC_EA_3);

  // sec1 is dug (DOM swap happened)
  await expect(page.locator(`section[data-start="${SEC_EA_1}"][data-dug="true"]`)).toBeVisible();
  // sec3 is dug
  await expect(page.locator(`section[data-start="${SEC_EA_3}"][data-dug="true"]`)).toBeVisible();
});

// ===========================================================================
// DIG-REFRESH (Task 6)
// Tests for the ↻ outdated click delegation: clicking the badge on a stale
// dug section re-digs it and the badge disappears after the swap.
// ===========================================================================

const VIDEO_ID_REFRESH = 'vid-dig-refresh';
const START_SEC_REFRESH = 75;

/**
 * Stale dig-doc HTML: the section is dug but genVersion < DIG_GENERATOR_VERSION,
 * so isStale=true → the renderer emits .dig-refresh on the section heading.
 */
function makeStaleDigDocHtml(): string {
  const summary: ParsedSummary = {
    title: 'Dig Refresh Test',
    channel: null,
    duration: null,
    url: `https://www.youtube.com/watch?v=${VIDEO_ID_REFRESH}`,
    lang: 'EN',
    videoId: VIDEO_ID_REFRESH,
    tldr: null,
    takeaways: [],
    sourceMd: `${VIDEO_ID_REFRESH}.md`,
    sections: [
      {
        numeral: '1',
        title: 'Section Gamma',
        prose: 'Intro prose',
        timeRange: {
          startSec: START_SEC_REFRESH,
          endSec: START_SEC_REFRESH + 60,
          label: '1:15–2:15',
          url: `https://www.youtube.com/watch?v=${VIDEO_ID_REFRESH}&t=${START_SEC_REFRESH}s`,
        },
      },
    ],
  };
  // genVersion < DIG_GENERATOR_VERSION → isStale=true → .dig-refresh rendered
  const dug: DugSection[] = [
    {
      sectionId: START_SEC_REFRESH,
      startSec: START_SEC_REFRESH,
      title: 'Section Gamma',
      bodyMarkdown: '## Section Gamma\n\nOld dug content.\n',
      generatedAt: '2026-01-01T00:00:00.000Z',
      genVersion: DIG_GENERATOR_VERSION - 1,
    },
  ];
  return renderDigDeeperDoc({
    summary,
    envelope: null,
    dug,
    mdPath: '/tmp/dig-refresh-test-dig.md',
    videoId: VIDEO_ID_REFRESH,
  });
}

/**
 * Fresh dig-doc HTML: same section now dug at current genVersion → isStale=false
 * → no .dig-refresh badge. This is what the re-GET returns after the re-dig completes.
 */
function makeFreshDigDocHtml(): string {
  const summary: ParsedSummary = {
    title: 'Dig Refresh Test',
    channel: null,
    duration: null,
    url: `https://www.youtube.com/watch?v=${VIDEO_ID_REFRESH}`,
    lang: 'EN',
    videoId: VIDEO_ID_REFRESH,
    tldr: null,
    takeaways: [],
    sourceMd: `${VIDEO_ID_REFRESH}.md`,
    sections: [
      {
        numeral: '1',
        title: 'Section Gamma',
        prose: 'Intro prose',
        timeRange: {
          startSec: START_SEC_REFRESH,
          endSec: START_SEC_REFRESH + 60,
          label: '1:15–2:15',
          url: `https://www.youtube.com/watch?v=${VIDEO_ID_REFRESH}&t=${START_SEC_REFRESH}s`,
        },
      },
    ],
  };
  // genVersion = DIG_GENERATOR_VERSION → isStale=false → no .dig-refresh badge
  const dug: DugSection[] = [
    {
      sectionId: START_SEC_REFRESH,
      startSec: START_SEC_REFRESH,
      title: 'Section Gamma',
      bodyMarkdown: '## Section Gamma\n\nFreshly re-dug content.\n',
      generatedAt: '2026-06-25T00:00:00.000Z',
      genVersion: DIG_GENERATOR_VERSION,
    },
  ];
  return renderDigDeeperDoc({
    summary,
    envelope: null,
    dug,
    mdPath: '/tmp/dig-refresh-test-dig.md',
    videoId: VIDEO_ID_REFRESH,
  });
}

// ---------------------------------------------------------------------------
// R1: clicking ↻ outdated re-digs the section and the badge is gone after the swap
// ---------------------------------------------------------------------------

test('R1 (dig-refresh click): clicking ↻ outdated re-digs and the badge is gone after the swap', async ({ page }) => {
  const staleHtml = makeStaleDigDocHtml();
  const freshHtml = makeFreshDigDocHtml();

  // Initial stub: serve stale HTML for the dig-doc route
  await page.route(`**/api/html/${VIDEO_ID_REFRESH}**`, (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: staleHtml,
    }),
  );

  // Stub POST → returns jobId
  await page.route(`**/api/videos/${VIDEO_ID_REFRESH}/dig/${START_SEC_REFRESH}`, (route) => {
    if (route.request().method() !== 'POST') { route.continue(); return; }
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ jobId: 'refresh-job-1' }),
    });
  });

  // Stub SSE stream → emits done immediately
  await page.route(`**/api/videos/${VIDEO_ID_REFRESH}/dig/${START_SEC_REFRESH}/stream**`, (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      body: sseBody({ type: 'done' }),
    }),
  );

  const digDocUrl = `http://localhost:3000/api/html/${VIDEO_ID_REFRESH}?outputFolder=${encodeURIComponent(OUTPUT_FOLDER)}&type=dig-deeper`;
  await page.goto(digDocUrl);

  // Confirm the stale badge is present before click
  await expect(page.locator('.dig-refresh')).toHaveCount(1);

  // CRITICAL: re-route /api/html/ to FRESH HTML before the click so the re-GET swap
  // returns a page without .dig-refresh. Playwright applies the most-recently-registered
  // matching route first (LIFO) — this override takes effect for the re-GET fetch.
  await page.route(`**/api/html/${VIDEO_ID_REFRESH}**`, (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: freshHtml,
    }),
  );

  await page.locator('.dig-refresh').click();

  // After POST → SSE done → re-GET swap returns fresh HTML → no .dig-refresh badge
  await expect(page.locator('.dig-refresh')).toHaveCount(0, { timeout: 5000 });
});

// ---------------------------------------------------------------------------
// R2: opening a doc with stale sections fires NO dig POST until a click
// ---------------------------------------------------------------------------

test('R2 (NO dig POST on load): opening a doc with stale sections fires no dig POST until a click', async ({ page }) => {
  const staleHtml = makeStaleDigDocHtml();

  await page.route(`**/api/html/${VIDEO_ID_REFRESH}**`, (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: staleHtml,
    }),
  );

  let posted = false;
  await page.route(`**/api/videos/${VIDEO_ID_REFRESH}/dig/**`, (route) => {
    if (route.request().method() === 'POST') { posted = true; }
    route.continue();
  });

  const digDocUrl = `http://localhost:3000/api/html/${VIDEO_ID_REFRESH}?outputFolder=${encodeURIComponent(OUTPUT_FOLDER)}&type=dig-deeper`;
  await page.goto(digDocUrl);
  await page.waitForTimeout(300);

  expect(posted).toBe(false);
});

// ===========================================================================
// EXPAND-ALL INCLUDES STALE SECTIONS (Task 7)
// Tests that the ⤢ expand all button includes .dig-refresh (stale dug)
// sections in the batch — not only .dig-trigger (un-dug) sections.
// ===========================================================================

const VIDEO_ID_EA_MIXED = 'vid-ea-mixed';
const SEC_EA_MIXED_UNDUG = 110;   // un-dug → .dig-trigger
const SEC_EA_MIXED_STALE = 220;   // stale dug → .dig-refresh


// ---------------------------------------------------------------------------
// E6: expand-all (⤢) includes STALE dug sections (.dig-refresh) in the batch
//     Fixture: 1 un-dug (.dig-trigger) + 1 stale dug (.dig-refresh).
//     Expected: confirm dialog counts 2 sections; after batch, no .dig-trigger
//     and no .dig-refresh remain.
// ---------------------------------------------------------------------------

test('E6 (expand-all includes stale): ⤢ refreshes .dig-refresh sections too; dialog counts 2; both resolved after batch', async ({ page }) => {
  // Track POST calls per section
  const postsSeen: number[] = [];

  // Stateful HTML tracking: each section independently flips to "resolved" after its POST.
  // The re-GET for each section swap fetches the CURRENT HTML, which must not contain
  // that section's trigger/refresh anymore — otherwise the batch loop re-queues it.
  const resolved = new Set<number>();

  function buildMixedHtml(): string {
    // Build HTML reflecting current resolved state.
    // - If UNDUG section is resolved: include it in dug[] at current genVersion.
    // - If STALE section is resolved: include it in dug[] at current genVersion.
    // - Otherwise: stale section stays in dug[] at genVersion-1; undug section absent.
    const dugEntries: DugSection[] = [];
    if (resolved.has(SEC_EA_MIXED_UNDUG)) {
      dugEntries.push({
        sectionId: SEC_EA_MIXED_UNDUG,
        startSec: SEC_EA_MIXED_UNDUG,
        title: 'Un-Dug Section',
        bodyMarkdown: '## Un-Dug Section\n\nNowly dug content.\n',
        generatedAt: '2026-06-25T00:00:00.000Z',
        genVersion: DIG_GENERATOR_VERSION,
      });
    }
    // Stale section is always dug but genVersion depends on resolved state
    dugEntries.push({
      sectionId: SEC_EA_MIXED_STALE,
      startSec: SEC_EA_MIXED_STALE,
      title: 'Stale Section',
      bodyMarkdown: resolved.has(SEC_EA_MIXED_STALE)
        ? '## Stale Section\n\nFreshly re-dug content.\n'
        : '## Stale Section\n\nOld dug content.\n',
      generatedAt: '2026-01-01T00:00:00.000Z',
      genVersion: resolved.has(SEC_EA_MIXED_STALE) ? DIG_GENERATOR_VERSION : DIG_GENERATOR_VERSION - 1,
    });
    const summary: ParsedSummary = {
      title: 'Expand All Mixed Test',
      channel: null,
      duration: null,
      url: `https://www.youtube.com/watch?v=${VIDEO_ID_EA_MIXED}`,
      lang: 'EN',
      videoId: VIDEO_ID_EA_MIXED,
      tldr: null,
      takeaways: [],
      sourceMd: `${VIDEO_ID_EA_MIXED}.md`,
      sections: [
        {
          numeral: '1',
          title: 'Un-Dug Section',
          prose: 'Not yet dug.',
          timeRange: { startSec: SEC_EA_MIXED_UNDUG, endSec: SEC_EA_MIXED_UNDUG + 60, label: '1:50–2:50', url: `https://www.youtube.com/watch?v=${VIDEO_ID_EA_MIXED}&t=${SEC_EA_MIXED_UNDUG}s` },
        },
        {
          numeral: '2',
          title: 'Stale Section',
          prose: 'Already dug, but stale.',
          timeRange: { startSec: SEC_EA_MIXED_STALE, endSec: SEC_EA_MIXED_STALE + 60, label: '3:40–4:40', url: `https://www.youtube.com/watch?v=${VIDEO_ID_EA_MIXED}&t=${SEC_EA_MIXED_STALE}s` },
        },
      ],
    };
    return renderDigDeeperDoc({
      summary,
      envelope: null,
      dug: dugEntries,
      mdPath: '/tmp/expand-all-mixed-dig.md',
      videoId: VIDEO_ID_EA_MIXED,
    });
  }

  await page.route(`**/api/html/${VIDEO_ID_EA_MIXED}**`, (route) => {
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: buildMixedHtml(),
    });
  });

  // POST + SSE for the un-dug section
  await page.route(`**/api/videos/${VIDEO_ID_EA_MIXED}/dig/${SEC_EA_MIXED_UNDUG}`, (route) => {
    if (route.request().method() !== 'POST') { route.continue(); return; }
    postsSeen.push(SEC_EA_MIXED_UNDUG);
    resolved.add(SEC_EA_MIXED_UNDUG);
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ jobId: `ea-mixed-job-${SEC_EA_MIXED_UNDUG}` }),
    });
  });
  await page.route(`**/api/videos/${VIDEO_ID_EA_MIXED}/dig/${SEC_EA_MIXED_UNDUG}/stream**`, (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      body: sseBody({ type: 'done' }),
    }),
  );

  // POST + SSE for the stale dug section
  await page.route(`**/api/videos/${VIDEO_ID_EA_MIXED}/dig/${SEC_EA_MIXED_STALE}`, (route) => {
    if (route.request().method() !== 'POST') { route.continue(); return; }
    postsSeen.push(SEC_EA_MIXED_STALE);
    resolved.add(SEC_EA_MIXED_STALE);
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ jobId: `ea-mixed-job-${SEC_EA_MIXED_STALE}` }),
    });
  });
  await page.route(`**/api/videos/${VIDEO_ID_EA_MIXED}/dig/${SEC_EA_MIXED_STALE}/stream**`, (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      body: sseBody({ type: 'done' }),
    }),
  );

  const digDocUrl = `http://localhost:3000/api/html/${VIDEO_ID_EA_MIXED}?outputFolder=${encodeURIComponent(OUTPUT_FOLDER)}&type=dig-deeper`;
  await page.goto(digDocUrl);

  // Confirm fixture: 1 .dig-trigger (un-dug) and 1 .dig-refresh (stale dug)
  await expect(page.locator('.dig-trigger[data-section]')).toHaveCount(1);
  await expect(page.locator('.dig-refresh[data-section]')).toHaveCount(1);

  // Click expand-all → dialog should open
  await page.locator('.dg-expand-all').click();
  const dialog = page.locator('#_dg-ea-dlg[data-open]');
  await expect(dialog).toBeVisible({ timeout: 3000 });

  // Assert dialog counts 2 sections (not 1) — stale section is included in N
  const msgText = await page.locator('#_dg-ea-msg').textContent();
  expect(msgText).toContain('Expand 2 remaining sections?');

  // Confirm the batch
  await page.locator('#_dg-ea-confirm').click();

  // Progress overlay should be visible
  await expect(page.locator('#_dg-ea-prog[data-open]')).toBeVisible({ timeout: 3000 });

  // Wait for batch to complete (progress overlay auto-closes)
  await expect(page.locator('#_dg-ea-prog[data-open]')).toHaveCount(0, { timeout: 15000 });

  // After batch: no .dig-trigger AND no .dig-refresh remain — both resolved
  await expect(page.locator('.dig-trigger, .dig-refresh')).toHaveCount(0, { timeout: 5000 });

  // Both sections were POSTed
  expect(postsSeen).toContain(SEC_EA_MIXED_UNDUG);
  expect(postsSeen).toContain(SEC_EA_MIXED_STALE);
  expect(postsSeen).toHaveLength(2);
});

// ---------------------------------------------------------------------------
// Slide zoom lightbox (Feature 1) — one test block per dismissal path.
// ---------------------------------------------------------------------------

// Route the slides fixture, navigate, return the overlay + the (closed-state) slide locator.
async function openZoom(page: import('@playwright/test').Page) {
  const html = makeCompanionHtmlWithSlides();
  await page.route(`**/api/html/${VIDEO_ID_SLIDES}**`, (route) =>
    route.fulfill({ status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: html }),
  );
  await page.goto(`http://localhost:3000/api/html/${VIDEO_ID_SLIDES}?outputFolder=${encodeURIComponent(OUTPUT_FOLDER)}&type=dig-deeper`);
  const overlay = page.locator('#_dg-zoom');
  const slide = page.locator('img.dig-slide').first();
  await expect(slide).toBeVisible();
  return { overlay, slide };
}

test('Z0 (zoom): Esc with lightbox CLOSED is a no-op', async ({ page }) => {
  const { overlay } = await openZoom(page);
  await expect(overlay).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(overlay).toBeHidden();
});

test('Z1 (zoom dismissal — backdrop): click .dig-slide opens; backdrop click closes', async ({ page }) => {
  const { overlay, slide } = await openZoom(page);
  await slide.click();
  await expect(overlay).toBeVisible();
  // Overlay is a centered flexbox; the zoomed image is capped at 95vw/95vh, so on the
  // default 1280×720 viewport the (5,5) corner is guaranteed backdrop (≥32px margin).
  await overlay.click({ position: { x: 5, y: 5 } });
  await expect(overlay).toBeHidden();
});

test('Z2 (zoom dismissal — Esc): open then Esc closes', async ({ page }) => {
  const { overlay, slide } = await openZoom(page);
  await slide.click();
  await expect(overlay).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(overlay).toBeHidden();
});

test('Z3 (zoom dismissal — ✕): open then close button closes', async ({ page }) => {
  const { overlay, slide } = await openZoom(page);
  await slide.click();
  await expect(overlay).toBeVisible();
  await page.locator('#_dg-zoom-close').click();
  await expect(overlay).toBeHidden();
});
