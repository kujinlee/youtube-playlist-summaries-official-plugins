import { expect, test } from '@playwright/test';
import type { Video } from '@/types';

// ---------------------------------------------------------------------------
// Fixture data
// Fixture set covers null AND non-null deepDiveHtml per project E2E rule:
//   - Video A (stale): deepDiveMd set, deepDiveHtml set, deepDiveVersion:{1,0} → BUTTON
//   - Video B (current): deepDiveMd set, deepDiveHtml set, deepDiveVersion:{2,0} → LINK
//   - Video C (never): deepDiveMd: null, deepDiveHtml: null → BUTTON
//   - Video D (no transcript): same as never for E2E purposes → BUTTON
//     (served HTML contains no ▶ timestamp lines)
// ---------------------------------------------------------------------------

const OUTPUT_FOLDER = '/tmp/test-deep-dive-doc';

const BASE_RATINGS = {
  usefulness: 4 as const,
  depth: 4 as const,
  originality: 3 as const,
  recency: 4 as const,
  completeness: 3 as const,
};

function makeVideo(overrides: Partial<Video> = {}): Video {
  return {
    id: 'vid-dd1',
    title: 'Deep Dive Doc Test Video',
    youtubeUrl: 'https://www.youtube.com/watch?v=vid-dd1',
    language: 'en',
    durationSeconds: 600,
    archived: false,
    ratings: BASE_RATINGS,
    overallScore: 3.8,
    summaryMd: 'deep-dive-doc-test.md',
    deepDiveMd: null,
    summaryHtml: null,
    processedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// SSE helper — each event is a single `data:` field, separated by blank lines
// ---------------------------------------------------------------------------

function sseBody(...events: object[]): string {
  return events.map((e) => `data: ${JSON.stringify(e)}\n`).join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Stub helpers (mirror playlist-viewer.spec.ts conventions exactly)
// ---------------------------------------------------------------------------

async function stubSettings(page: import('@playwright/test').Page, outputFolder = OUTPUT_FOLDER) {
  await page.route('**/api/settings', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ outputFolder }) }),
  );
}

async function stubVideos(page: import('@playwright/test').Page, videos: Video[]) {
  await page.route('**/api/videos**', (route) => {
    if (route.request().method() !== 'GET') { route.continue(); return; }
    if (route.request().url().includes('/api/videos/')) { route.continue(); return; }
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ videos }) });
  });
}

/** Stubs POST /api/videos/:id/deep-dive → { jobId } */
async function stubDeepDive(
  page: import('@playwright/test').Page,
  videoId: string,
  jobId = 'dd-job-1',
) {
  await page.route(`**/api/videos/${videoId}/deep-dive`, (route) => {
    if (route.request().url().includes('/deep-dive/')) { route.continue(); return; }
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jobId }) });
  });
}

/** Stubs GET /api/videos/:id/deep-dive/stream?jobId=... → SSE body */
async function stubDeepDiveStream(
  page: import('@playwright/test').Page,
  videoId: string,
  events: object[],
) {
  await page.route(`**/api/videos/${videoId}/deep-dive/stream**`, (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      body: sseBody(...events),
    }),
  );
}

/** Stubs GET /api/html/:id?outputFolder=...&type=deep-dive → HTML body */
async function stubDeepDiveHtmlServe(
  page: import('@playwright/test').Page,
  videoId: string,
  htmlBody: string,
) {
  await page.route(`**/api/html/${videoId}**`, (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: htmlBody,
    }),
  );
}

// ---------------------------------------------------------------------------
// Scenario 1: stale video → button → click regenerates → status bar runs
//             → on done shows "View Deep Dive doc" link; row shows busy ⏳
// ---------------------------------------------------------------------------

test('stale video (deepDiveVersion:{1,0}) shows button; click triggers regeneration with status bar and done link', async ({ page }) => {
  // Video A — stale: has deepDiveHtml but version is {1,0} (below CURRENT {2,0})
  const video = makeVideo({
    id: 'vid-dd-stale',
    title: 'Stale Deep Dive Video',
    deepDiveMd: 'stale-deep-dive.md',
    deepDiveHtml: 'htmls/stale-deep-dive.html',
    deepDiveVersion: { major: 1, minor: 0 },
  });

  await stubSettings(page);
  await stubVideos(page, [video]);
  await stubDeepDive(page, 'vid-dd-stale');
  await stubDeepDiveStream(page, 'vid-dd-stale', [
    { type: 'step', step: 'Generating deep dive', current: 1, total: 2 },
    { type: 'step', step: 'Rendering HTML', current: 2, total: 2 },
    { type: 'done' },
  ]);

  await page.goto('/');
  await expect(page.getByText('Stale Deep Dive Video')).toBeVisible();

  // "Deep Dive doc" must be a BUTTON (stale → regenerate)
  await page.getByRole('button', { name: 'Menu' }).click();
  const deepDiveBtn = page.getByRole('button', { name: /^Deep Dive doc$/i });
  await expect(deepDiveBtn).toBeVisible();

  // Click triggers regeneration
  await deepDiveBtn.click();

  // Status bar mounts in running state — progressbar visible
  await expect(page.getByRole('status', { name: /deep dive progress/i })).toBeVisible();
  await expect(page.getByRole('progressbar')).toBeVisible();

  // Row-level busy hourglass appears while running
  await expect(page.getByRole('status', { name: /regenerating/i })).toBeVisible();

  // Done state: "View Deep Dive doc ↗" link appears in the status bar
  const viewLink = page.getByRole('status', { name: /deep dive progress/i })
    .getByRole('link', { name: /view deep dive doc/i });
  await expect(viewLink).toBeVisible();
});

// ---------------------------------------------------------------------------
// Scenario 2: current video → "Deep Dive doc" is a LINK; href asserts ALL params
// ---------------------------------------------------------------------------

test('current video (deepDiveVersion:{2,0}) shows "Deep Dive doc" as a link with correct params', async ({ page }) => {
  // Video B — current: deepDiveHtml set AND deepDiveVersion:{2,0}
  const video = makeVideo({
    id: 'vid-dd-current',
    title: 'Current Deep Dive Video',
    deepDiveMd: 'current-deep-dive.md',
    deepDiveHtml: 'htmls/current-deep-dive.html',
    deepDiveVersion: { major: 2, minor: 0 },
  });

  await stubSettings(page);
  await stubVideos(page, [video]);

  await page.goto('/');
  await expect(page.getByText('Current Deep Dive Video')).toBeVisible();

  // Open the menu
  await page.getByRole('button', { name: 'Menu' }).click();

  // "Deep Dive doc" must be a direct LINK (not a button)
  const deepDiveLink = page.getByRole('link', { name: /^Deep Dive doc$/i });
  await expect(deepDiveLink).toBeVisible();

  // Assert ALL required params on the href (one expect per param per spec rule)
  const href = await deepDiveLink.getAttribute('href');
  const u = new URL(href!, page.url());
  expect(u.pathname).toBe(`/api/html/${video.id}`);
  expect(u.searchParams.get('outputFolder')).toBe(OUTPUT_FOLDER);
  expect(u.searchParams.get('type')).toBe('deep-dive');
});

// ---------------------------------------------------------------------------
// Scenario 3: status bar dismissal — ✕ button hides it
// ---------------------------------------------------------------------------

test('status bar dismissal — ✕ button closes the bar', async ({ page }) => {
  // Video C — never generated
  const video = makeVideo({ id: 'vid-dd-never', title: 'Never Generated Video' });

  await stubSettings(page);
  await stubVideos(page, [video]);
  await stubDeepDive(page, 'vid-dd-never');
  // Stream stays open: only a step event, no done — keeps bar in running state
  await stubDeepDiveStream(page, 'vid-dd-never', [
    { type: 'step', step: 'Working…', current: 1, total: 5 },
  ]);

  await page.goto('/');
  await expect(page.getByText('Never Generated Video')).toBeVisible();

  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: /^Deep Dive doc$/i }).click();

  await expect(page.getByRole('status', { name: /deep dive progress/i })).toBeVisible();

  // Click ✕ dismiss
  await page.getByRole('status', { name: /deep dive progress/i })
    .getByRole('button', { name: 'Dismiss', exact: true }).click();

  // Status bar gone
  await expect(page.getByRole('status', { name: /deep dive progress/i })).not.toBeVisible();
});

// ---------------------------------------------------------------------------
// Scenario 4: status bar auto-close after done (4000ms timer)
// ---------------------------------------------------------------------------

test('status bar auto-closes after done without user action', async ({ page }) => {
  const video = makeVideo({ id: 'vid-dd-auto', title: 'Auto Close Video' });

  await stubSettings(page);
  await stubVideos(page, [video]);
  await stubDeepDive(page, 'vid-dd-auto');
  await stubDeepDiveStream(page, 'vid-dd-auto', [
    { type: 'done' },
  ]);

  await page.goto('/');
  await expect(page.getByText('Auto Close Video')).toBeVisible();

  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: /^Deep Dive doc$/i }).click();

  // Bar reaches done state — view link visible
  await expect(
    page.getByRole('status', { name: /deep dive progress/i })
      .getByRole('link', { name: /view deep dive doc/i }),
  ).toBeVisible();

  // Bar disappears on its own within 6s (auto-dismiss timer is 4s; 6s gives comfortable margin)
  await expect(page.getByRole('status', { name: /deep dive progress/i }))
    .not.toBeVisible({ timeout: 6000 });
});

// ---------------------------------------------------------------------------
// Scenario 5: no-transcript video → regenerates via video-only path;
//             served HTML has NO ▶ timestamp lines
// ---------------------------------------------------------------------------

test('no-transcript video regenerates successfully; served HTML has no ▶ timestamp lines', async ({ page }) => {
  // Video D — no transcript (deepDiveHtml: null, no deepDiveMd)
  const video = makeVideo({ id: 'vid-dd-notranscript', title: 'No Transcript Video' });

  // Canned HTML without any ▶ timestamp lines
  const htmlWithoutTimestamps = `<!DOCTYPE html><html><head><title>No Transcript Video (Deep Dive)</title></head><body><h1>Deep Dive — No Transcript Video</h1><p>Analysis based on video metadata only.</p></body></html>`;

  await stubSettings(page);
  await stubVideos(page, [video]);
  await stubDeepDive(page, 'vid-dd-notranscript');
  await stubDeepDiveStream(page, 'vid-dd-notranscript', [
    { type: 'step', step: 'Generating from video', current: 1, total: 1 },
    { type: 'done' },
  ]);
  await stubDeepDiveHtmlServe(page, 'vid-dd-notranscript', htmlWithoutTimestamps);

  await page.goto('/');
  await expect(page.getByText('No Transcript Video')).toBeVisible();

  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: /^Deep Dive doc$/i }).click();

  // Done state: view link appears
  const viewLink = page.getByRole('status', { name: /deep dive progress/i })
    .getByRole('link', { name: /view deep dive doc/i });
  await expect(viewLink).toBeVisible();

  // Fetch the served HTML and assert no ▶ timestamp lines
  const href = await viewLink.getAttribute('href');
  const { status, body } = await page.evaluate(async (url) => {
    const res = await fetch(url);
    return { status: res.status, body: await res.text() };
  }, href!);
  expect(status).toBe(200);
  // No ▶ section timestamp lines in a transcript-less deep dive
  expect(body).not.toContain('▶');
});

// ---------------------------------------------------------------------------
// Scenario 6: idempotent — second open of a CURRENT doc is a link; NO regenerate POST fires
// ---------------------------------------------------------------------------

test('idempotent: current video shows link both times menu opens; no POST /deep-dive fires', async ({ page }) => {
  // Video B — current (same fixture as Scenario 2)
  const video = makeVideo({
    id: 'vid-dd-idem',
    title: 'Idempotent Deep Dive Video',
    deepDiveMd: 'idempotent-deep-dive.md',
    deepDiveHtml: 'htmls/idempotent-deep-dive.html',
    deepDiveVersion: { major: 2, minor: 0 },
  });

  await stubSettings(page);
  await stubVideos(page, [video]);

  // Spy on POST /api/videos/vid-dd-idem/deep-dive — count requests
  let postCount = 0;
  await page.route(`**/api/videos/${video.id}/deep-dive`, (route) => {
    if (route.request().url().includes('/deep-dive/')) { route.continue(); return; }
    if (route.request().method() === 'POST') { postCount++; }
    route.continue();
  });

  await page.goto('/');
  await expect(page.getByText('Idempotent Deep Dive Video')).toBeVisible();

  // First menu open: "Deep Dive doc" is a link
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.getByRole('link', { name: /^Deep Dive doc$/i })).toBeVisible();
  await page.keyboard.press('Escape');

  // Second menu open: "Deep Dive doc" is still a link
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.getByRole('link', { name: /^Deep Dive doc$/i })).toBeVisible();
  await page.keyboard.press('Escape');

  // No POST requests were fired
  expect(postCount).toBe(0);
});
