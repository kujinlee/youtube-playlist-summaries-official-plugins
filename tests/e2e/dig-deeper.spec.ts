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

// ---------------------------------------------------------------------------
// Behavior 1: POST is issued (not GET); spinner ⏳ appears; then "view detail ↓"
//             opening the companion HTML shows <img src="data:image/jpeg;base64,...">
// ---------------------------------------------------------------------------

test('B1 (with slides): dig triggers POST, shows spinner, then view-detail link; companion HTML has base64 img', async ({ page }) => {
  const summaryHtml = makeSummaryHtml(VIDEO_ID_SLIDES, START_SEC_SLIDES);
  const companionHtml = makeCompanionHtmlWithSlides();

  await stubHtmlRoutes(page, VIDEO_ID_SLIDES, summaryHtml, companionHtml);
  await stubDigState(page, VIDEO_ID_SLIDES, []);
  await stubDigPost(page, VIDEO_ID_SLIDES, START_SEC_SLIDES);
  await stubDigStream(page, VIDEO_ID_SLIDES, START_SEC_SLIDES, [
    { type: 'step', step: 'Generating dig deeper…', current: 1, total: 2 },
    { type: 'done' },
  ]);

  // Capture requests to assert POST method (behavior B1).
  // Use route.fallback() (not route.continue()) so the request passes to the
  // previously-registered stubDigPost handler instead of the real network.
  const digRequests: { method: string }[] = [];
  await page.route(`**/api/videos/${VIDEO_ID_SLIDES}/dig/${START_SEC_SLIDES}`, (route) => {
    digRequests.push({ method: route.request().method() });
    route.fallback();
  });

  const summaryUrl = `http://localhost:3000/api/html/${VIDEO_ID_SLIDES}?outputFolder=${encodeURIComponent(OUTPUT_FOLDER)}&type=summary`;
  await page.goto(summaryUrl);

  // Wait for the dig control to initialise in idle state
  const digCtrl = page.locator('a.dig[data-section]');
  await expect(digCtrl).toBeVisible();
  await expect(digCtrl).toHaveText('dig deeper ▶');

  // Click the control — triggers POST
  await digCtrl.click();

  // Wait for the stable done state — "view detail ↓" (the transient ⏳ is not asserted here
  // because Playwright SSE stubs deliver the body atomically, so the stream completes too fast
  // for ⏳ to be stably visible — same pattern used in playlist-viewer.spec.ts for ingest).
  await expect(digCtrl).toHaveText('view detail ↓', { timeout: 5000 });

  // Assert POST method was issued (not GET) — collected via the spy above
  expect(digRequests.some((r) => r.method === 'POST')).toBe(true);
  expect(digRequests.every((r) => r.method !== 'GET')).toBe(true);

  // Follow the "view detail ↓" link (href set by applyDugState) — companion HTML shown
  const href = await digCtrl.getAttribute('href');
  expect(href).toBeTruthy();

  // Fetch the companion HTML via page.evaluate so route stubs fire
  const { status: companionStatus, body: companionBody } = await page.evaluate(async (url) => {
    const res = await fetch(url);
    return { status: res.status, body: await res.text() };
  }, href!);

  expect(companionStatus).toBe(200);
  // Companion HTML must contain a base64 <img>
  expect(companionBody).toContain('data:image/jpeg;base64,');
});

// ---------------------------------------------------------------------------
// Behavior 2: Dig a section with NO slides — text-only block, no <img>
// ---------------------------------------------------------------------------

test('B2 (no slides): dig completes to view-detail; companion HTML has no <img>', async ({ page }) => {
  const summaryHtml = makeSummaryHtml(VIDEO_ID_NO_SLIDES, START_SEC_NO_SLIDES);
  const companionHtml = makeCompanionHtmlNoSlides();

  await stubHtmlRoutes(page, VIDEO_ID_NO_SLIDES, summaryHtml, companionHtml);
  await stubDigState(page, VIDEO_ID_NO_SLIDES, []);
  await stubDigPost(page, VIDEO_ID_NO_SLIDES, START_SEC_NO_SLIDES);
  await stubDigStream(page, VIDEO_ID_NO_SLIDES, START_SEC_NO_SLIDES, [
    { type: 'step', step: 'Generating dig deeper…', current: 1, total: 1 },
    { type: 'done' },
  ]);

  const summaryUrl = `http://localhost:3000/api/html/${VIDEO_ID_NO_SLIDES}?outputFolder=${encodeURIComponent(OUTPUT_FOLDER)}&type=summary`;
  await page.goto(summaryUrl);

  const digCtrl = page.locator('a.dig[data-section]');
  await expect(digCtrl).toHaveText('dig deeper ▶');
  await digCtrl.click();

  // Reaches "view detail ↓"
  await expect(digCtrl).toHaveText('view detail ↓', { timeout: 5000 });

  // Fetch companion page and assert no <img>
  const href = await digCtrl.getAttribute('href');
  expect(href).toBeTruthy();

  const { body: companionBody } = await page.evaluate(async (url) => {
    const res = await fetch(url);
    return { body: await res.text() };
  }, href!);

  // Text-only: no <img> tag in the companion HTML
  expect(companionBody).not.toContain('<img');
});

// ---------------------------------------------------------------------------
// Behavior 3: "view detail ↓" link params — ALL of outputFolder, type=dig-deeper,
//             AND #t=<startSec> must be present (per dev-process URL-params rule).
// ---------------------------------------------------------------------------

test('B3: "view detail ↓" href contains outputFolder, type=dig-deeper, and #t=<startSec>', async ({ page }) => {
  const summaryHtml = makeSummaryHtml(VIDEO_ID_SLIDES, START_SEC_SLIDES);
  // Companion HTML not needed for URL-params assertion — reuse summaryHtml as placeholder
  await stubHtmlRoutes(page, VIDEO_ID_SLIDES, summaryHtml, summaryHtml);
  await stubDigState(page, VIDEO_ID_SLIDES, []);
  await stubDigPost(page, VIDEO_ID_SLIDES, START_SEC_SLIDES);
  await stubDigStream(page, VIDEO_ID_SLIDES, START_SEC_SLIDES, [{ type: 'done' }]);

  const summaryUrl = `http://localhost:3000/api/html/${VIDEO_ID_SLIDES}?outputFolder=${encodeURIComponent(OUTPUT_FOLDER)}&type=summary`;
  await page.goto(summaryUrl);

  const digCtrl = page.locator('a.dig[data-section]');
  await expect(digCtrl).toHaveText('dig deeper ▶');
  await digCtrl.click();

  await expect(digCtrl).toHaveText('view detail ↓', { timeout: 5000 });

  const href = await digCtrl.getAttribute('href');
  expect(href).toBeTruthy();

  // Parse the href — it is a relative URL; resolve against the base
  const u = new URL(href!, 'http://localhost:3000');

  // Assert ALL three required params (one expect per param per dev-process rule)
  expect(u.searchParams.get('outputFolder')).toBe(OUTPUT_FOLDER);
  expect(u.searchParams.get('type')).toBe('dig-deeper');
  expect(u.hash).toBe(`#t=${START_SEC_SLIDES}`);
});

// ---------------------------------------------------------------------------
// Behavior 4: Error path — POST 500 or stream error → "⚠ retry" visible
// ---------------------------------------------------------------------------

test('B4 (error path): stream error event shows ⚠ retry', async ({ page }) => {
  const summaryHtml = makeSummaryHtml(VIDEO_ID_SLIDES, START_SEC_SLIDES);
  await stubHtmlRoutes(page, VIDEO_ID_SLIDES, summaryHtml, summaryHtml);
  await stubDigState(page, VIDEO_ID_SLIDES, []);
  await stubDigPost(page, VIDEO_ID_SLIDES, START_SEC_SLIDES);
  // Stream returns an error event instead of done
  await stubDigStream(page, VIDEO_ID_SLIDES, START_SEC_SLIDES, [
    { type: 'error', log: 'Gemini quota exceeded' },
  ]);

  const summaryUrl = `http://localhost:3000/api/html/${VIDEO_ID_SLIDES}?outputFolder=${encodeURIComponent(OUTPUT_FOLDER)}&type=summary`;
  await page.goto(summaryUrl);

  const digCtrl = page.locator('a.dig[data-section]');
  await expect(digCtrl).toHaveText('dig deeper ▶');
  await digCtrl.click();

  // After stream error event: ⚠ retry appears
  await expect(digCtrl).toHaveText('⚠ retry', { timeout: 5000 });
});

// ---------------------------------------------------------------------------
// Behavior 5 (money-spending guard): the normal UI dig flow NEVER issues a GET
//             to the trigger endpoint — only POST is ever used.
//
// C1 fix: B5 now uses the same request-spy pattern as B1 (digRequests array).
// The assertion `digRequests.every(r => r.method !== 'GET')` is a REAL guard:
// if the client code were ever changed to issue a GET, this test fails. The old
// implementation was a self-fulfilling stub that tested the stub, not the app.
// ---------------------------------------------------------------------------

test('B5 (POST-only guard): normal UI dig flow never issues GET to the trigger endpoint', async ({ page }) => {
  const summaryHtml = makeSummaryHtml(VIDEO_ID_SLIDES, START_SEC_SLIDES);
  await stubHtmlRoutes(page, VIDEO_ID_SLIDES, summaryHtml, summaryHtml);
  await stubDigState(page, VIDEO_ID_SLIDES, []);
  await stubDigPost(page, VIDEO_ID_SLIDES, START_SEC_SLIDES);
  await stubDigStream(page, VIDEO_ID_SLIDES, START_SEC_SLIDES, [{ type: 'done' }]);

  // Spy on ALL requests to the dig trigger URL — mirrors the B1 spy pattern exactly.
  // route.fallback() passes each request to the previously-registered stubDigPost handler.
  const digRequests: { method: string }[] = [];
  await page.route(`**/api/videos/${VIDEO_ID_SLIDES}/dig/${START_SEC_SLIDES}`, (route) => {
    digRequests.push({ method: route.request().method() });
    route.fallback();
  });

  const summaryUrl = `http://localhost:3000/api/html/${VIDEO_ID_SLIDES}?outputFolder=${encodeURIComponent(OUTPUT_FOLDER)}&type=summary`;
  await page.goto(summaryUrl);

  const digCtrl = page.locator('a.dig[data-section]');
  await expect(digCtrl).toHaveText('dig deeper ▶');
  await digCtrl.click();
  await expect(digCtrl).toHaveText('view detail ↓', { timeout: 5000 });

  // The UI must have issued at least one request (confirming the spy fired)
  expect(digRequests.length).toBeGreaterThan(0);
  // No request to the trigger endpoint may have been GET — only POST is permitted.
  expect(digRequests.every((r) => r.method !== 'GET')).toBe(true);
  // Positive assertion: POST is the method used
  expect(digRequests.some((r) => r.method === 'POST')).toBe(true);
});

// ---------------------------------------------------------------------------
// Behavior 6 (M1): trigger POST returns 500 → "⚠ retry" visible
//             Keeps the existing B4 (stream error → ⚠ retry) and adds the
//             complementary POST-500 path per the review finding.
// ---------------------------------------------------------------------------

test('B6 (POST-500 error path): POST returning 500 shows ⚠ retry', async ({ page }) => {
  const summaryHtml = makeSummaryHtml(VIDEO_ID_SLIDES, START_SEC_SLIDES);
  await stubHtmlRoutes(page, VIDEO_ID_SLIDES, summaryHtml, summaryHtml);
  await stubDigState(page, VIDEO_ID_SLIDES, []);
  // Stub the trigger POST to return 500 (server error)
  await stubDigPost(page, VIDEO_ID_SLIDES, START_SEC_SLIDES, 'unused-job-id', 500);
  // No stream stub needed — 500 aborts before the stream phase

  const summaryUrl = `http://localhost:3000/api/html/${VIDEO_ID_SLIDES}?outputFolder=${encodeURIComponent(OUTPUT_FOLDER)}&type=summary`;
  await page.goto(summaryUrl);

  const digCtrl = page.locator('a.dig[data-section]');
  await expect(digCtrl).toHaveText('dig deeper ▶');
  await digCtrl.click();

  // After POST 500: ⚠ retry appears (same error state as stream error)
  await expect(digCtrl).toHaveText('⚠ retry', { timeout: 5000 });
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

  // First toggle: → show-gist (gist visible, dug hidden)
  await toggle.click();
  await expect(section).toHaveClass(/show-gist/, { timeout: 3000 });

  // Second toggle: → remove show-gist (dug visible, gist hidden again)
  await toggle.click();
  await expect(section).not.toHaveClass(/show-gist/, { timeout: 3000 });

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
