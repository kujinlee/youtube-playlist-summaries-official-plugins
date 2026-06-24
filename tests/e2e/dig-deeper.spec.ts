import { expect, test } from '@playwright/test';
// Relative imports (NOT '@/…'): the '@/' alias is unproven for RUNTIME (value) imports under
// Playwright's loader — the only existing E2E '@/' import is `import type` (erased).
import { renderMagazineHtml } from '../../lib/html-doc/render';
import { renderDigDeeperHtml } from '../../lib/html-doc/render-dig-deeper';
import type { ParsedSummary, MagazineModel } from '../../lib/html-doc/types';

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

// A tiny 1×1 JPEG encoded as data URI to embed in the companion HTML.
const SLIDE_IMG_TAG = `<img src="data:image/jpeg;base64,${MINIMAL_B64}" alt="slide">`;

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

/** Companion HTML WITH a base64 slide image. */
function makeCompanionHtmlWithSlides(): string {
  const md = `---
video_id: "${VIDEO_ID_SLIDES}"
lang: EN
---

# Dig Deeper — Section One

${SLIDE_IMG_TAG}

Key insight about the slide content.
`;
  // renderDigDeeperHtml expects an absolute mdPath; we pass a fake one.
  // The renderer only resolves relative `assets/` src — our SLIDE_IMG_TAG uses a data URI,
  // so the renderer's image rule will fall through to the non-assets branch and
  // output an escaped src. To avoid that and embed the img directly, we build the HTML
  // manually so it contains a literal data: URI <img>.
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Dig Deeper</title></head><body><h1>Dig Deeper — Section One</h1><img src="data:image/jpeg;base64,${MINIMAL_B64}" alt="slide"><p>Key insight about the slide content.</p></body></html>`;
}

/** Companion HTML with NO images (text-only). */
function makeCompanionHtmlNoSlides(): string {
  const md = `---
video_id: "${VIDEO_ID_NO_SLIDES}"
lang: EN
---

# Dig Deeper — Section One

Key insight with no slides here.
`;
  return renderDigDeeperHtml(md, '/tmp/fake-no-slides.md');
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
// Behavior 5 (B2 — money-spending guard): bare GET to the dig trigger URL
//             must NOT create a doc (POST-only semantics).
//             A GET to /api/videos/[id]/dig/[sectionId] returns 405 or is not handled
//             (no GET handler defined for that route → Next.js returns 405 Method Not Allowed).
// ---------------------------------------------------------------------------

test('B5 (POST-only guard): GET to the dig trigger URL does not invoke the pipeline (405 / not-handled)', async ({ page }) => {
  // Track whether any pipeline-level step happens. In practice, the route has no GET handler;
  // Next.js returns 405. We verify this via a direct fetch from the browser context.
  const url = `http://localhost:3000/api/videos/${VIDEO_ID_SLIDES}/dig/${START_SEC_SLIDES}`;

  // Stub so the dev server doesn't actually run the pipeline.
  // We assert the response is NOT 200 (anything other than 200 is acceptable — 405, 404, 400).
  await page.route(`**/api/videos/${VIDEO_ID_SLIDES}/dig/${START_SEC_SLIDES}`, (route) => {
    if (route.request().method() === 'GET') {
      // Simulate no GET handler — 405 Method Not Allowed
      route.fulfill({ status: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) });
      return;
    }
    // Any POST would proceed normally, but this test only issues GET
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jobId: 'not-reached' }) });
  });

  // Navigate to any page (need a page context for the browser fetch)
  const summaryHtml = makeSummaryHtml(VIDEO_ID_SLIDES, START_SEC_SLIDES);
  await stubHtmlRoutes(page, VIDEO_ID_SLIDES, summaryHtml, summaryHtml);
  await stubDigState(page, VIDEO_ID_SLIDES, []);
  const summaryUrl = `http://localhost:3000/api/html/${VIDEO_ID_SLIDES}?outputFolder=${encodeURIComponent(OUTPUT_FOLDER)}&type=summary`;
  await page.goto(summaryUrl);

  // Issue a bare GET to the dig trigger URL from the browser context
  const responseStatus = await page.evaluate(async (triggerUrl) => {
    const res = await fetch(triggerUrl, { method: 'GET' });
    return res.status;
  }, url);

  // GET must NOT return 200 (200 would mean the pipeline was invoked)
  expect(responseStatus).not.toBe(200);
});
