import { expect, test } from '@playwright/test';
import type { Video } from '@/types';

// ---------------------------------------------------------------------------
// Fixture data
// Fixture set covers:
//   - one video that is CURRENT (summaryHtml set AND docVersion: {major:2,minor:0})
//     → "HTML doc" renders as a direct <a> link (no Generate/Regenerate/View labels)
//   - one video that is PRE-FEATURE (summaryHtml set but NO docVersion)
//     → "HTML doc" renders as a <button> → triggers job → status bar
//   - one video with summaryHtml: null (no docVersion)
//     → "HTML doc" renders as a <button> → triggers job → status bar
//   - one KO video with summaryHtml: null — used in KO round-trip test
//   - error case: PRE-FEATURE video + transform fails → status bar shows error
// ---------------------------------------------------------------------------

const OUTPUT_FOLDER = '/tmp/test-html-doc';

const BASE_RATINGS = {
  usefulness: 4 as const,
  depth: 3 as const,
  originality: 4 as const,
  recency: 5 as const,
  completeness: 3 as const,
};

function makeVideo(overrides: Partial<Video> = {}): Video {
  return {
    id: 'vid-hd1',
    title: 'Deep Dive into LLMs',
    youtubeUrl: 'https://www.youtube.com/watch?v=vid-hd1',
    language: 'en',
    durationSeconds: 600,
    archived: false,
    ratings: BASE_RATINGS,
    overallScore: 3.8,
    summaryMd: 'deep-dive-into-llms.md',
    summaryPdf: null,
    deepDiveMd: null,
    deepDivePdf: null,
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

/** Stubs POST /api/videos/:id/html-doc → { jobId } */
async function stubHtmlDocPost(
  page: import('@playwright/test').Page,
  videoId: string,
  jobId = 'hd-job-1',
) {
  await page.route(`**/api/videos/${videoId}/html-doc`, (route) => {
    // Guard: skip deeper paths like /html-doc/stream
    if (route.request().url().includes('/html-doc/')) { route.continue(); return; }
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jobId }) });
  });
}

/** Stubs GET /api/videos/:id/html-doc/stream?jobId=... → SSE body */
async function stubHtmlDocStream(
  page: import('@playwright/test').Page,
  videoId: string,
  events: object[],
) {
  await page.route(`**/api/videos/${videoId}/html-doc/stream**`, (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      body: sseBody(...events),
    }),
  );
}

/** Stubs GET /api/html/:id?outputFolder=...&type=summary → HTML body */
async function stubHtmlServe(
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
// Scenarios
// ---------------------------------------------------------------------------

test('a CURRENT video (summaryHtml + docVersion:{2,0}) shows a single HTML doc link — no Generate/Regenerate/View labels', async ({ page }) => {
  // Fixture: video that is CURRENT — direct link, no job triggering
  const video = makeVideo({
    id: 'vid-hd-current',
    summaryHtml: 'htmls/deep-dive-into-llms.html',
    docVersion: { major: 2, minor: 0 },
  });

  await stubSettings(page);
  await stubVideos(page, [video]);

  await page.goto('/');
  await expect(page.getByText('Deep Dive into LLMs')).toBeVisible();

  // Open the row menu
  await page.getByRole('button', { name: 'Menu' }).click();

  // "HTML doc" is a direct link (role=link, not button) — no View/Regenerate/Generate text
  const htmlLink = page.getByRole('link', { name: /^HTML doc$/i });
  await expect(htmlLink).toBeVisible();

  // Verify the href carries both required params
  const href = await htmlLink.getAttribute('href');
  const u = new URL(href!, page.url());
  expect(u.pathname).toBe(`/api/html/${video.id}`);
  expect(u.searchParams.get('outputFolder')).toBe(OUTPUT_FOLDER);
  expect(u.searchParams.get('type')).toBe('summary');

  // No "Generate" or "Regenerate" or separate "View" label
  await expect(page.getByRole('button', { name: /generate html doc/i })).not.toBeVisible();
  await expect(page.getByRole('button', { name: /regenerate html doc/i })).not.toBeVisible();
  await expect(page.getByRole('link', { name: /view html doc/i })).not.toBeVisible();
});

test('a PRE-FEATURE video (summaryHtml set, no docVersion) shows "HTML doc" as a button that starts the job', async ({ page }) => {
  // Fixture: summaryHtml set but NO docVersion → treat as stale → button
  const video = makeVideo({
    id: 'vid-hd2',
    summaryHtml: 'htmls/deep-dive-into-llms.html',
    // docVersion intentionally absent
  });

  await stubSettings(page);
  await stubVideos(page, [video]);
  await stubHtmlDocPost(page, 'vid-hd2');
  await stubHtmlDocStream(page, 'vid-hd2', [
    { type: 'step', step: 'Reading summary…', current: 1, total: 3 },
    { type: 'step', step: 'Transforming to skim view…', current: 2, total: 3 },
    { type: 'step', step: 'Rendering HTML…', current: 3, total: 3 },
    { type: 'done' },
  ]);

  await page.goto('/');
  await expect(page.getByText('Deep Dive into LLMs')).toBeVisible();

  // Open the row menu — "HTML doc" must be a button (not a link)
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: /^HTML doc$/i }).click();

  // Status bar mounts in running state — progressbar visible
  await expect(page.getByRole('status', { name: /html doc progress/i })).toBeVisible();
  await expect(page.getByRole('progressbar')).toBeVisible();

  // After done: "View HTML doc ↗" link appears in the status bar
  const viewLink = page.getByRole('status', { name: /html doc progress/i })
    .getByRole('link', { name: /view html doc/i });
  await expect(viewLink).toBeVisible();

  // Assert BOTH required params on the href
  const href = await viewLink.getAttribute('href');
  const u = new URL(href!, page.url());
  expect(u.searchParams.get('outputFolder')).toBe(OUTPUT_FOLDER);
  expect(u.searchParams.get('type')).toBe('summary');
});

test('a video with no summaryHtml shows "HTML doc" as a button that starts the job and reveals the View link', async ({ page }) => {
  // Fixture: EN video with summaryHtml: null (not yet generated)
  const video = makeVideo({ id: 'vid-hd1', summaryHtml: null });

  await stubSettings(page);
  await stubVideos(page, [video]);
  await stubHtmlDocPost(page, 'vid-hd1');
  await stubHtmlDocStream(page, 'vid-hd1', [
    { type: 'step', step: 'Reading summary…', current: 1, total: 3 },
    { type: 'step', step: 'Transforming to skim view…', current: 2, total: 3 },
    { type: 'step', step: 'Rendering HTML…', current: 3, total: 3 },
    { type: 'done' },
  ]);

  await page.goto('/');
  await expect(page.getByText('Deep Dive into LLMs')).toBeVisible();

  // Open the row menu and click the single "HTML doc" button
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: /^HTML doc$/i }).click();

  // Status bar mounts in running state — progressbar visible
  await expect(page.getByRole('status', { name: /html doc progress/i })).toBeVisible();
  await expect(page.getByRole('progressbar')).toBeVisible();

  // After done: "View HTML doc ↗" link appears in the status bar
  const viewLink = page.getByRole('status', { name: /html doc progress/i })
    .getByRole('link', { name: /view html doc/i });
  await expect(viewLink).toBeVisible();

  // Assert BOTH required params on the href
  const href = await viewLink.getAttribute('href');
  const u = new URL(href!, page.url());
  expect(u.searchParams.get('outputFolder')).toBe(OUTPUT_FOLDER);
  expect(u.searchParams.get('type')).toBe('summary');
});

test('surfaces an error in the status bar when the transform fails (no file written)', async ({ page }) => {
  // Fixture: EN video with summaryHtml: null; transform stub returns error event
  const video = makeVideo({ id: 'vid-hd3', summaryHtml: null });

  await stubSettings(page);
  await stubVideos(page, [video]);
  await stubHtmlDocPost(page, 'vid-hd3', 'hd-job-err');
  await stubHtmlDocStream(page, 'vid-hd3', [
    { type: 'error', log: 'Gemini transform failed: quota exceeded' },
  ]);

  await page.goto('/');
  await expect(page.getByText('Deep Dive into LLMs')).toBeVisible();

  // Trigger via the single "HTML doc" button
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: /^HTML doc$/i }).click();

  // Status bar shows error (role=alert inside the status region)
  const errorBar = page.getByRole('status', { name: /html doc progress/i });
  await expect(errorBar).toBeVisible();
  await expect(errorBar.getByRole('alert')).toBeVisible();
  await expect(errorBar.getByRole('alert')).toContainText('Gemini transform failed');

  // The menu still shows "HTML doc" as a button (no file written — summaryHtml still null)
  // Re-open the menu to verify. Scope Dismiss to the status bar to avoid the backfill banner's
  // "Dismiss backfill" button matching the same /dismiss/i pattern.
  await errorBar.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.getByRole('button', { name: /^HTML doc$/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /view html doc/i })).not.toBeVisible();
});

test('KO summary generates without mangling Korean text', async ({ page }) => {
  // Fixture: KO video with summaryHtml: null
  const video = makeVideo({
    id: 'vid-hd4',
    title: '한국어 딥 다이브',
    language: 'ko',
    summaryHtml: null,
  });

  // The HTML the serve route returns after generation — contains Korean text
  const koHtml = `<!DOCTYPE html>
<html lang="ko">
<head><meta charset="utf-8"><title>한국어 딥 다이브</title></head>
<body><h1>한국어 딥 다이브</h1><p>핵심 요약입니다.</p><li>첫 번째 요점.</li></body>
</html>`;

  await stubSettings(page);
  await stubVideos(page, [video]);
  await stubHtmlDocPost(page, 'vid-hd4', 'hd-job-ko');
  await stubHtmlDocStream(page, 'vid-hd4', [
    { type: 'step', step: 'Transforming to skim view…', current: 2, total: 3 },
    { type: 'done' },
  ]);
  // Stub the serve route so fetching the View URL returns KO HTML
  await stubHtmlServe(page, 'vid-hd4', koHtml);

  await page.goto('/');
  await expect(page.getByText('한국어 딥 다이브')).toBeVisible();

  // Generate the HTML doc via the single "HTML doc" button
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: /^HTML doc$/i }).click();

  // Wait for done — View link appears
  const viewLink = page.getByRole('status', { name: /html doc progress/i })
    .getByRole('link', { name: /view html doc/i });
  await expect(viewLink).toBeVisible();

  // Assert BOTH params on the KO view URL
  const href = await viewLink.getAttribute('href');
  const u = new URL(href!, page.url());
  expect(u.searchParams.get('outputFolder')).toBe(OUTPUT_FOLDER);
  expect(u.searchParams.get('type')).toBe('summary');

  // Fetch the served HTML via the View URL and assert Korean text is present (no mangling).
  // Use page.evaluate (browser-context fetch) so the page's route intercepts apply,
  // since stubHtmlServe registers the stub on the page context, not the global request context.
  const { status, body } = await page.evaluate(async (url) => {
    const res = await fetch(url);
    return { status: res.status, body: await res.text() };
  }, href!);
  expect(status).toBe(200);
  expect(body).toContain('한국어 딥 다이브');
  expect(body).toContain('핵심 요약입니다.');
  expect(body).toContain('첫 번째 요점.');
});
