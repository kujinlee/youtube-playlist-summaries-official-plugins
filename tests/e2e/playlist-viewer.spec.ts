import { expect, test } from '@playwright/test';
import type { Video } from '@/types';

// ---------------------------------------------------------------------------
// Shared fixture data
// ---------------------------------------------------------------------------

const OUTPUT_FOLDER = '/tmp/test-out';

const BASE_RATINGS = {
  usefulness: 4 as const,
  depth: 3 as const,
  originality: 4 as const,
  recency: 5 as const,
  completeness: 3 as const,
};

function makeVideo(overrides: Partial<Video> = {}): Video {
  return {
    id: 'vid-1',
    title: 'Test Video',
    youtubeUrl: 'https://www.youtube.com/watch?v=vid-1',
    language: 'en',
    durationSeconds: 600,
    archived: false,
    ratings: BASE_RATINGS,
    overallScore: 3.8,
    summaryMd: 'summary',
    summaryPdf: 'summary.pdf',
    deepDiveMd: null,
    deepDivePdf: null,
    processedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// SSE helper — each event must be a single data: field (no id: or event:)
// ---------------------------------------------------------------------------

function sseBody(...events: object[]): string {
  return events.map((e) => `data: ${JSON.stringify(e)}\n`).join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Route setup helpers
// ---------------------------------------------------------------------------

async function stubSettings(page: import('@playwright/test').Page, outputFolder = OUTPUT_FOLDER) {
  await page.route('**/api/settings', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ outputFolder }) }),
  );
}

async function stubVideos(page: import('@playwright/test').Page, videos: Video[]) {
  // Pattern includes trailing ** so query params (?outputFolder=…) are matched
  await page.route('**/api/videos**', (route) => {
    if (route.request().method() !== 'GET') { route.continue(); return; }
    // Only match the /api/videos endpoint, not deeper paths like /api/videos/*/archive
    if (route.request().url().includes('/api/videos/')) { route.continue(); return; }
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ videos }) });
  });
}

async function stubIngestStream(
  page: import('@playwright/test').Page,
  events: object[],
) {
  // Use ** to match the full URL including ?jobId=… query param
  await page.route('**/api/ingest/stream**', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      body: sseBody(...events),
    }),
  );
}

async function stubDeepDive(
  page: import('@playwright/test').Page,
  videoId: string,
  jobId = 'dd-1',
) {
  await page.route(`**/api/videos/${videoId}/deep-dive`, (route) => {
    if (route.request().url().includes('/deep-dive/')) { route.continue(); return; }
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jobId }) });
  });
}

async function stubDeepDiveStream(
  page: import('@playwright/test').Page,
  videoId: string,
  events: object[],
) {
  // Use ** to match the full URL including ?jobId=… query param
  await page.route(`**/api/videos/${videoId}/deep-dive/stream**`, (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      body: sseBody(...events),
    }),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('playlist viewer', () => {
  // Behavior 1: page loads with empty state
  test('page loads: header form visible, no video list', async ({ page }) => {
    await stubSettings(page, '');
    await page.route('**/api/videos**', (route) => {
      if (route.request().method() !== 'GET' || route.request().url().includes('/api/videos/')) {
        route.continue(); return;
      }
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ videos: [] }) });
    });

    await page.goto('/');

    await expect(page.getByPlaceholder('Playlist URL')).toBeVisible();
    await expect(page.getByPlaceholder('Output folder')).toBeVisible();
    await expect(page.getByRole('button', { name: /fetch/i })).toBeVisible();
    await expect(page.getByRole('list', { name: /video list/i })).not.toBeVisible();
  });

  // Behaviors 2 & 3: ingest flow — progress bar appears then video list populated on done
  test('ingest: progress bar shown then video list populated on done', async ({ page }) => {
    const video = makeVideo();

    await stubSettings(page);
    // Use an explicit flag keyed on the ingest POST, not a request counter.
    // A request counter is unsafe under React StrictMode's double-invoke of useEffect,
    // which calls fetchVideos twice on mount before any user action.
    let ingestPostDone = false;
    await page.route('**/api/ingest', (route) => {
      if (route.request().url().includes('/api/ingest/')) { route.continue(); return; }
      ingestPostDone = true;
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jobId: 'job-1' }) });
    });
    await page.route('**/api/videos**', (route) => {
      if (route.request().method() !== 'GET' || route.request().url().includes('/api/videos/')) {
        route.continue(); return;
      }
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ videos: ingestPostDone ? [video] : [] }),
      });
    });
    await stubIngestStream(page, [
      { type: 'step', step: 'Fetching playlist', current: 1, total: 3 },
      { type: 'done' },
    ]);

    await page.goto('/');

    // Fill form and submit
    await page.getByPlaceholder('Playlist URL').fill('https://youtube.com/playlist?list=PL123');
    await page.getByPlaceholder('Output folder').fill(OUTPUT_FOLDER);
    await page.getByRole('button', { name: /fetch/i }).click();

    // Progress bar appears immediately on submit (before SSE fires)
    await expect(page.getByRole('progressbar')).toBeVisible();

    // After done: video list populated, progress hidden
    await expect(page.getByRole('table', { name: /video list/i })).toBeVisible();
    await expect(page.getByText('Test Video')).toBeVisible();
    await expect(page.getByRole('progressbar')).not.toBeVisible();
  });

  // Behavior 4: sort by OVR
  test('sort by OVR: refetches with sortColumn=overall', async ({ page }) => {
    const video = makeVideo();

    await stubSettings(page);
    const sortedUrls: string[] = [];
    await page.route('**/api/videos**', (route) => {
      if (route.request().method() !== 'GET' || route.request().url().includes('/api/videos/')) {
        route.continue(); return;
      }
      const url = route.request().url();
      if (url.includes('sortColumn=')) sortedUrls.push(url);
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ videos: [video] }) });
    });

    await page.goto('/');
    await expect(page.getByText('Test Video')).toBeVisible();

    await Promise.all([
      page.waitForResponse((resp) => resp.url().includes('sortColumn=overall') && resp.status() === 200),
      page.getByRole('button', { name: /overall/i }).click(),
    ]);

    expect(sortedUrls.some((u) => u.includes('sortColumn=overall'))).toBe(true);
  });

  // Behavior 5: deep dive status bar opens, shows progress, reaches done state
  test('deep dive: status bar opens, shows progress, then done state', async ({ page }) => {
    const video = makeVideo({ id: 'vid-1' });

    await stubSettings(page);
    await stubVideos(page, [video]);
    await stubDeepDive(page, 'vid-1');
    await stubDeepDiveStream(page, 'vid-1', [
      { type: 'step', step: 'Generating deep dive', current: 1, total: 1 },
      { type: 'done' },
    ]);

    await page.goto('/');
    await expect(page.getByText('Test Video')).toBeVisible();

    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('button', { name: /deep dive/i }).click();

    // Status bar mounts in running state — progressbar visible before SSE done arrives
    await expect(page.getByRole('progressbar')).toBeVisible();

    // Done state: status bar shows ✓ Done
    await expect(page.getByRole('status', { name: /deep dive progress/i })).toContainText('✓ Done');
  });

  // Behavior 6: status bar shows the triggered video's title
  test('deep dive: status bar shows the triggered video title', async ({ page }) => {
    const video = makeVideo({ id: 'vid-1', title: 'My Specific Video' });

    await stubSettings(page);
    await stubVideos(page, [video]);
    await stubDeepDive(page, 'vid-1');
    await stubDeepDiveStream(page, 'vid-1', [
      { type: 'step', step: 'Fetching transcript', current: 1, total: 2 },
    ]);

    await page.goto('/');
    await expect(page.getByText('My Specific Video')).toBeVisible();

    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('button', { name: /deep dive/i }).click();

    await expect(page.getByRole('status', { name: /deep dive progress/i }))
      .toContainText('My Specific Video');
  });

  // Behavior 7: status bar is non-blocking — video table stays interactive
  test('deep dive: video table stays interactive while status bar is running', async ({ page }) => {
    const video1 = makeVideo({ id: 'vid-1', title: 'Video One' });
    const video2 = makeVideo({ id: 'vid-2', title: 'Video Two' });

    await stubSettings(page);
    await stubVideos(page, [video1, video2]);
    await stubDeepDive(page, 'vid-1');
    // Stream stays open: only a step event, no done — keeps bar in running state
    await stubDeepDiveStream(page, 'vid-1', [
      { type: 'step', step: 'Working…', current: 1, total: 5 },
    ]);

    await page.goto('/');
    await expect(page.getByText('Video One')).toBeVisible();

    // Start deep dive on video 1
    await page.getByRole('button', { name: 'Menu' }).first().click();
    await page.getByRole('button', { name: /deep dive/i }).click();
    // Close the dropdown so it doesn't block clicks on video 2's row
    await page.keyboard.press('Escape');

    // Status bar is running — confirm it's present and NOT a dialog
    await expect(page.getByRole('status', { name: /deep dive progress/i })).toBeVisible();
    await expect(page.getByRole('dialog')).not.toBeVisible().catch(() => {
      // dialog may not exist at all, which is correct
    });
    expect(await page.locator('[role="dialog"]').count()).toBe(0);

    // Video table is still interactive: can open a menu on video 2 while bar runs
    await page.getByRole('button', { name: 'Menu' }).last().click();
    await expect(page.getByRole('menu')).toBeVisible();
  });

  // Behavior 8: ✕ dismiss closes the bar mid-run and triggers video list refetch
  test('deep dive: dismiss button closes status bar and refetches videos', async ({ page }) => {
    const video = makeVideo({ id: 'vid-1' });

    await stubSettings(page);
    await stubVideos(page, [video]);
    await stubDeepDive(page, 'vid-1');
    await stubDeepDiveStream(page, 'vid-1', [
      { type: 'step', step: 'Working…', current: 1, total: 5 },
    ]);

    const videoGetUrls: string[] = [];
    await page.route('**/api/videos**', (route) => {
      if (route.request().method() !== 'GET' || route.request().url().includes('/api/videos/')) {
        route.fallback(); return;
      }
      videoGetUrls.push(route.request().url());
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ videos: [video] }) });
    });

    await page.goto('/');
    await expect(page.getByText('Test Video')).toBeVisible();
    const callsBefore = videoGetUrls.length;

    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('button', { name: /deep dive/i }).click();
    await expect(page.getByRole('status', { name: /deep dive progress/i })).toBeVisible();

    await page.getByRole('button', { name: /dismiss/i }).click();

    // Status bar gone
    await expect(page.getByRole('status', { name: /deep dive progress/i })).not.toBeVisible();
    // Refetch triggered
    expect(videoGetUrls.length).toBeGreaterThan(callsBefore);
  });

  // Behavior 9: error state shows message and Show/Hide Logs toggle
  test('deep dive: error state shows message and log toggle', async ({ page }) => {
    const video = makeVideo({ id: 'vid-1' });

    await stubSettings(page);
    await stubVideos(page, [video]);
    await stubDeepDive(page, 'vid-1');
    await stubDeepDiveStream(page, 'vid-1', [
      { type: 'error', log: 'Gemini API quota exceeded' },
    ]);

    await page.goto('/');
    await expect(page.getByText('Test Video')).toBeVisible();

    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('button', { name: /deep dive/i }).click();

    // Error message visible in status bar
    await expect(page.getByRole('status', { name: /deep dive progress/i }))
      .toContainText('Gemini API quota exceeded');

    // Show Logs button present, log panel hidden by default
    const showLogsBtn = page.getByRole('button', { name: /show logs/i });
    await expect(showLogsBtn).toBeVisible();
    await expect(page.getByRole('region', { name: /logs/i })).not.toBeVisible();

    // Click Show Logs — panel expands
    await showLogsBtn.click();
    await expect(page.getByRole('region', { name: /logs/i })).toBeVisible();
    await expect(page.getByRole('region', { name: /logs/i }))
      .toContainText('Gemini API quota exceeded');

    // Click Hide Logs — panel collapses
    await page.getByRole('button', { name: /hide logs/i }).click();
    await expect(page.getByRole('region', { name: /logs/i })).not.toBeVisible();

    // Status bar still present (error does NOT auto-dismiss)
    await expect(page.getByRole('status', { name: /deep dive progress/i })).toBeVisible();
  });

  // Behavior 10: auto-dismiss — bar disappears after done without user action
  test('deep dive: status bar auto-dismisses after done without user action', async ({ page }) => {
    const video = makeVideo({ id: 'vid-1' });

    await stubSettings(page);
    await stubVideos(page, [video]);
    await stubDeepDive(page, 'vid-1');
    await stubDeepDiveStream(page, 'vid-1', [
      { type: 'done' },
    ]);

    await page.goto('/');
    await expect(page.getByText('Test Video')).toBeVisible();

    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('button', { name: /deep dive/i }).click();

    // Bar reaches done state
    await expect(page.getByRole('status', { name: /deep dive progress/i }))
      .toContainText('✓ Done');

    // Bar disappears on its own within 5s (auto-dismiss timer is 3s)
    await expect(page.getByRole('status', { name: /deep dive progress/i }))
      .not.toBeVisible({ timeout: 5000 });
  });

  // Behavior 7: archive action greys row
  test('archive: row gets opacity-50 class when Show Archive is checked', async ({ page }) => {
    const video = makeVideo({ id: 'vid-1' });
    const archivedVideo = makeVideo({ id: 'vid-1', archived: true });

    await stubSettings(page);
    let archived = false;
    let archiveRequestBody: Record<string, unknown> | null = null;
    await page.route('**/api/videos**', (route) => {
      if (route.request().method() !== 'GET' || route.request().url().includes('/api/videos/')) {
        route.continue(); return;
      }
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ videos: archived ? [archivedVideo] : [video] }),
      });
    });
    await page.route('**/api/videos/vid-1/archive', (route) => {
      archiveRequestBody = route.request().postDataJSON() as Record<string, unknown>;
      archived = true;
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });

    await page.goto('/');
    await expect(page.getByText('Test Video')).toBeVisible();

    // Check "Show Archive" so archived rows stay visible after archive action
    await page.getByLabel(/show archive/i).check();

    // Open menu and click Archive
    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('button', { name: 'Archive' }).click();

    // Row should have opacity-40 class (greyed) — table row, not list item
    const row = page.locator('tbody tr').first();
    await expect(row).toHaveClass(/opacity-40/);

    // Verify archive POST body contained correct action and outputFolder
    expect(archiveRequestBody).toMatchObject({ action: 'archive', outputFolder: OUTPUT_FOLDER });
  });

  // Behavior 8: View Summary PDF link points to correct PDF URL
  test('View Summary PDF: link href points to PDF API route', async ({ page }) => {
    const video = makeVideo({ id: 'vid-1', summaryPdf: 'summary.pdf' });

    await stubSettings(page);
    await stubVideos(page, [video]);

    await page.goto('/');
    await expect(page.getByText('Test Video')).toBeVisible();

    // Open menu and inspect link href
    await page.getByRole('button', { name: 'Menu' }).click();

    const pdfLink = page.getByRole('link', { name: /view summary pdf/i });
    const href = await pdfLink.getAttribute('href');
    const url = new URL(href!, 'http://localhost');
    expect(url.pathname).toBe('/api/pdf/vid-1');
    expect(url.searchParams.get('outputFolder')).toBe(OUTPUT_FOLDER);
    expect(url.searchParams.get('type')).toBe('summary');
  });

  // Behavior 9: Obsidian link has correct scheme, vault, and file params
  test('Obsidian link href has correct obsidian:// URI with vault and file', async ({ page }) => {
    const video = makeVideo({ id: 'vid-1' });

    await stubSettings(page);
    await stubVideos(page, [video]);

    await page.goto('/');
    await expect(page.getByText('Test Video')).toBeVisible();

    await page.getByRole('button', { name: 'Menu' }).click();

    const obsidianLink = page.getByRole('link', { name: 'Open in Obsidian' });
    const href = await obsidianLink.getAttribute('href');
    const url = new URL(href!);
    expect(url.protocol).toBe('obsidian:');
    // vault= is the basename of the output folder (Obsidian matches by vault name, not full path)
    expect(url.searchParams.get('vault')).toBe('test-out');
    // summaryMd is 'summary' (no .md) → file param is 'summary', not the raw video id
    expect(url.searchParams.get('file')).toBe('summary');
  });

  // Edge case: settings API failure — page still loads with empty folder
  test('settings API failure: page loads, folder field is empty', async ({ page }) => {
    await page.route('**/api/settings', (route) => route.fulfill({ status: 500 }));
    await page.route('**/api/videos**', (route) => {
      if (route.request().method() !== 'GET' || route.request().url().includes('/api/videos/')) {
        route.continue(); return;
      }
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ videos: [] }) });
    });

    await page.goto('/');
    // Wait for settings request to complete before asserting fallback
    await page.waitForResponse('**/api/settings');

    await expect(page.getByPlaceholder('Playlist URL')).toBeVisible();
    await expect(page.getByPlaceholder('Output folder')).toHaveValue('');
  });

  // Edge case: ingest POST failure — error message shown, no stream opened
  test('ingest POST failure: error message shown, no progress bar', async ({ page }) => {
    await stubSettings(page);
    await page.route('**/api/videos**', (route) => {
      if (route.request().method() !== 'GET' || route.request().url().includes('/api/videos/')) {
        route.continue(); return;
      }
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ videos: [] }) });
    });
    await page.route('**/api/ingest', (route) => {
      if (route.request().url().includes('/api/ingest/')) { route.continue(); return; }
      route.fulfill({ status: 500 });
    });
    // Assert no SSE stream is opened after a failed POST
    let streamOpened = false;
    await page.route('**/api/ingest/stream**', () => { streamOpened = true; });

    await page.goto('/');
    await page.getByPlaceholder('Playlist URL').fill('https://youtube.com/playlist?list=PL123');
    await page.getByRole('button', { name: /fetch/i }).click();

    await expect(page.locator('[role="alert"]').filter({ hasText: /error/i })).toBeVisible();
    await expect(page.getByRole('progressbar')).not.toBeVisible();
    expect(streamOpened).toBe(false);
  });
});
