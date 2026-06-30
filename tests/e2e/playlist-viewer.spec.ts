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

  // Fill the header form and submit an ingest. Shared by the two ingest tests below.
  async function submitIngest(page: import('@playwright/test').Page) {
    await page.getByPlaceholder('Playlist URL').fill('https://youtube.com/playlist?list=PL123');
    await page.getByPlaceholder('Output folder').fill(OUTPUT_FOLDER);
    await page.getByRole('button', { name: /fetch/i }).click();
  }

  // Behavior 2: progress bar shows while an ingest is running.
  // The stream is held OPEN (never fulfilled) so the running state persists — asserting the
  // transient bar against an instantly-completing [step, done] stream is racy (the bar mounts
  // and is torn down by `done` before Playwright can observe it).
  test('ingest: progress bar shown while running', async ({ page }) => {
    await stubSettings(page);
    await page.route('**/api/videos**', (route) => {
      if (route.request().method() !== 'GET' || route.request().url().includes('/api/videos/')) {
        route.continue(); return;
      }
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ videos: [] }) });
    });
    await page.route('**/api/ingest', (route) => {
      if (route.request().url().includes('/api/ingest/')) { route.continue(); return; }
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jobId: 'job-1' }) });
    });
    // Hold the SSE connection open: ingest.status stays 'running' (no done, no close→onerror),
    // so the progress bar is stably visible for the assertion.
    await page.route('**/api/ingest/stream**', () => { /* intentionally never fulfilled */ });

    await page.goto('/');
    await submitIngest(page);

    // Running state: progress bar + Cancel control are visible
    await expect(page.getByRole('progressbar')).toBeVisible();
    await expect(page.getByRole('button', { name: /cancel ingestion/i })).toBeVisible();
  });

  // Behavior 3: on `done`, the video list populates and the progress bar is gone.
  // Asserts the stable end state (not the transient running bar — see the test above).
  test('ingest: video list populated and progress hidden after done', async ({ page }) => {
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
    await submitIngest(page);

    // After done: video list populated, progress bar gone
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

  // Behavior 7: archive action greys row
  test('archive: archived row cells get opacity-40 when Show Archive is checked', async ({ page }) => {
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

    // Dimming is applied per-CELL, not on the <tr>: opacity on the row creates a CSS
    // stacking context that makes the absolutely-positioned VideoMenu unclickable
    // (see components/VideoRow.tsx `cellDim`). The first <td> is the expand-toggle
    // (undimmed); assert on a dimmed content cell — the Overall score cell.
    const scoreCell = page.locator('tbody tr').first().locator('td[aria-label="Overall"]');
    await expect(scoreCell).toHaveClass(/opacity-40/);

    // Verify archive POST body contained correct action and outputFolder
    expect(archiveRequestBody).toMatchObject({ action: 'archive', outputFolder: OUTPUT_FOLDER });
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

// ---------------------------------------------------------------------------
// Quick-view feature — VideoQuickView expand/collapse + backfill
// ---------------------------------------------------------------------------

test.describe('quick-view — row expand / collapse', () => {
  // Helper: stub the per-video quick-view endpoint
  async function stubQuickView(
    page: import('@playwright/test').Page,
    videoId: string,
    body: object,
    status = 200,
  ) {
    await page.route(`**/api/videos/${videoId}/quick-view**`, (route) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
      }),
    );
  }

  // Scenario #11: pre-loaded tldr → card appears immediately, no fetch
  test('expand with pre-loaded tldr shows card immediately without fetch', async ({ page }) => {
    const video = makeVideo({
      id: 'vid-ql',
      title: 'Quick View Video',
      summaryMd: 'summary.md',
      tldr: 'This video teaches RAG pipelines.',
      takeaways: ['Chunk documents first', 'Embed then retrieve'],
      tags: ['rag', 'llm'],
    });

    let fetchCalled = false;
    await stubSettings(page);
    await stubVideos(page, [video]);
    await page.route('**/api/videos/vid-ql/quick-view**', () => { fetchCalled = true; });

    await page.goto('/');
    await expect(page.getByText('Quick View Video')).toBeVisible();

    await page.getByRole('button', { name: /expand/i }).click();

    // Card content appears immediately
    await expect(page.getByText('This video teaches RAG pipelines.')).toBeVisible();
    await expect(page.getByText('Chunk documents first')).toBeVisible();
    // Use exact:true — Playwright text match is case-insensitive substring by default,
    // so 'rag' would also match the tldr paragraph that contains 'RAG'.
    await expect(page.getByText('rag', { exact: true })).toBeVisible();

    // No loading spinner, no fetch
    expect(fetchCalled).toBe(false);
    await expect(page.getByRole('status')).not.toBeVisible();
  });

  // Scenario #12: no tldr → loading → card after fetch
  test('expand without tldr shows loading then card after successful fetch', async ({ page }) => {
    const video = makeVideo({
      id: 'vid-ql2',
      title: 'Unfilled Video',
      summaryMd: 'summary.md',
      // no tldr/takeaways
    });

    await stubSettings(page);
    await stubVideos(page, [video]);
    await stubQuickView(page, 'vid-ql2', {
      tldr: 'This video explains embeddings.',
      takeaways: ['Embeddings capture meaning'],
      tags: ['nlp'],
    });

    await page.goto('/');
    await expect(page.getByText('Unfilled Video')).toBeVisible();

    await page.getByRole('button', { name: /expand/i }).click();

    // Card appears after fetch resolves
    await expect(page.getByText('This video explains embeddings.')).toBeVisible();
    await expect(page.getByText('Embeddings capture meaning')).toBeVisible();
    await expect(page.getByText('nlp')).toBeVisible();
  });

  // Scenario #13: no tldr → fetch fails → error state
  test('expand without tldr shows error alert when fetch fails', async ({ page }) => {
    const video = makeVideo({
      id: 'vid-ql3',
      title: 'No Summary Video',
      summaryMd: null,
      // no tldr
    });

    await stubSettings(page);
    await stubVideos(page, [video]);
    await stubQuickView(page, 'vid-ql3', { error: 'not found' }, 404);

    await page.goto('/');
    await expect(page.getByText('No Summary Video')).toBeVisible();

    await page.getByRole('button', { name: /expand/i }).click();

    // Next.js always renders a hidden role="alert" route-announcer div; filter by text.
    const alert = page.getByRole('alert').filter({ hasText: /not yet generated/i });
    await expect(alert).toBeVisible();
  });

  // Scenario #14: collapse via chevron click
  test('clicking chevron again collapses the expanded card', async ({ page }) => {
    const video = makeVideo({
      id: 'vid-ql4',
      tldr: 'This video demonstrates agents.',
      takeaways: ['Agents plan before acting'],
      tags: ['agents'],
    });

    await stubSettings(page);
    await stubVideos(page, [video]);

    await page.goto('/');
    await expect(page.getByText('Test Video')).toBeVisible();

    const chevron = page.getByRole('button', { name: /expand/i });
    await chevron.click();
    await expect(page.getByText('This video demonstrates agents.')).toBeVisible();

    // Click chevron again to collapse
    await page.getByRole('button', { name: /collapse/i }).click();
    await expect(page.getByText('This video demonstrates agents.')).not.toBeVisible();
  });

  // Scenario #15: collapse via title cell click
  test('clicking title cell collapses the expanded card', async ({ page }) => {
    const video = makeVideo({
      id: 'vid-ql5',
      title: 'Title Toggle Video',
      tldr: 'This video covers LangChain.',
      takeaways: ['LangChain chains prompts'],
      tags: ['langchain'],
    });

    await stubSettings(page);
    await stubVideos(page, [video]);

    await page.goto('/');
    await expect(page.getByText('Title Toggle Video')).toBeVisible();

    // Expand via chevron
    await page.getByRole('button', { name: /expand/i }).click();
    await expect(page.getByText('This video covers LangChain.')).toBeVisible();

    // Collapse via title cell click
    await page.getByText('Title Toggle Video').click();
    await expect(page.getByText('This video covers LangChain.')).not.toBeVisible();
  });
});

test.describe('quick-view — backfill banner', () => {
  // Helper: stub the backfill SSE stream
  async function stubBackfillStream(
    page: import('@playwright/test').Page,
    events: object[],
  ) {
    await page.route('**/api/quick-view/backfill**', (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
        body: sseBody(...events),
      }),
    );
  }

  // Scenario #16: banner visible when eligible videos exist
  test('backfill banner visible when videos have summaryMd but no tldr', async ({ page }) => {
    const video = makeVideo({ id: 'vid-bf1', summaryMd: 'summary.md' /* no tldr */ });

    await stubSettings(page);
    await stubVideos(page, [video]);

    await page.goto('/');
    await expect(page.getByText('Test Video')).toBeVisible();

    await expect(page.getByText(/missing quick reference/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /generate all/i })).toBeVisible();
  });

  // Scenario #17: banner not visible when all videos have tldr
  test('backfill banner absent when all videos have tldr', async ({ page }) => {
    const video = makeVideo({
      id: 'vid-bf2',
      tldr: 'This video explains X.',
      takeaways: ['Point one'],
      tags: ['ai'],
    });

    await stubSettings(page);
    await stubVideos(page, [video]);

    await page.goto('/');
    await expect(page.getByText('Test Video')).toBeVisible();

    await expect(page.getByText(/missing quick reference/i)).not.toBeVisible();
  });

  // Scenario #18: dismiss banner (✕) hides it without calling backfill endpoint
  test('dismissing banner (✕) hides it and does not start backfill', async ({ page }) => {
    const video = makeVideo({ id: 'vid-bf3', summaryMd: 'summary.md' });

    let backfillCalled = false;
    await stubSettings(page);
    await stubVideos(page, [video]);
    await page.route('**/api/quick-view/backfill**', () => { backfillCalled = true; });

    await page.goto('/');
    await expect(page.getByText(/missing quick reference/i)).toBeVisible();

    await page.getByRole('button', { name: /dismiss backfill/i }).click();

    await expect(page.getByText(/missing quick reference/i)).not.toBeVisible();
    expect(backfillCalled).toBe(false);
  });

  // Scenario #19: Generate all → overlay opens → SSE progress events shown
  test('Generate all opens overlay and shows SSE progress', async ({ page }) => {
    const video = makeVideo({ id: 'vid-bf4', title: 'RAG Video', summaryMd: 'summary.md' });

    await stubSettings(page);
    await stubVideos(page, [video]);
    await stubBackfillStream(page, [
      { type: 'start', total: 1 },
      { type: 'step', videoId: 'vid-bf4', title: 'RAG Video', step: 'done', current: 1, total: 1 },
      { type: 'done', total: 1, succeeded: 1, failed: 0 },
    ]);

    await page.goto('/');
    await expect(page.getByText(/missing quick reference/i)).toBeVisible();

    await page.getByRole('button', { name: /generate all/i }).click();

    // Overlay dialog appears
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('progressbar')).toBeVisible();

    // Video title appears in the log
    await expect(page.getByRole('dialog')).toContainText('RAG Video');
  });

  // Scenario #20: Dismiss enabled after done; click closes overlay and refetches videos
  test('Dismiss enabled after done event; closes overlay and refetches videos', async ({ page }) => {
    const video = makeVideo({ id: 'vid-bf5', summaryMd: 'summary.md' });
    const updatedVideo = makeVideo({ id: 'vid-bf5', tldr: 'This video teaches X.', takeaways: [], tags: [] });

    await stubSettings(page);
    let refetchCount = 0;
    await page.route('**/api/videos**', (route) => {
      if (route.request().method() !== 'GET' || route.request().url().includes('/api/videos/')) {
        route.continue(); return;
      }
      refetchCount++;
      const videos = refetchCount > 1 ? [updatedVideo] : [video];
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ videos }) });
    });
    await stubBackfillStream(page, [
      { type: 'start', total: 1 },
      { type: 'done', total: 1, succeeded: 1, failed: 0 },
    ]);

    await page.goto('/');
    await page.getByRole('button', { name: /generate all/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Dismiss becomes enabled after done
    const dismissBtn = page.getByRole('dialog').getByRole('button', { name: /dismiss/i });
    await expect(dismissBtn).not.toBeDisabled();

    const callsBefore = refetchCount;
    await dismissBtn.click();

    // Overlay closes
    await expect(page.getByRole('dialog')).not.toBeVisible();
    // Video list refetched
    expect(refetchCount).toBeGreaterThan(callsBefore);
  });

  // Scenario #21: Escape key dismisses overlay after done
  // Note: "Escape while running does nothing" is covered by BackfillOverlay.test.tsx
  // (component layer). Playwright SSE stubs deliver body atomically so the stream
  // EOF triggers onerror immediately, making a stable "running" state untestable at E2E.
  test('Escape key dismisses overlay after done event', async ({ page }) => {
    const video = makeVideo({ id: 'vid-bf6', summaryMd: 'summary.md' });

    await stubSettings(page);
    await stubVideos(page, [video]);
    await page.route('**/api/quick-view/backfill**', (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
        body: sseBody(
          { type: 'start', total: 1 },
          { type: 'done', total: 1, succeeded: 1, failed: 0 },
        ),
      }),
    );

    await page.goto('/');
    await page.getByRole('button', { name: /generate all/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Wait for done state (Dismiss enabled)
    await expect(
      page.getByRole('dialog').getByRole('button', { name: /dismiss/i }),
    ).not.toBeDisabled();

    // Escape closes the overlay
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });

  // Scenario #22: SSE drop → error state shown, Dismiss enabled
  test('SSE connection drop shows error state and enables Dismiss', async ({ page }) => {
    const video = makeVideo({ id: 'vid-bf7', summaryMd: 'summary.md' });

    await stubSettings(page);
    await stubVideos(page, [video]);

    // Abort the stream to simulate a connection drop
    await page.route('**/api/quick-view/backfill**', (route) => route.abort());

    await page.goto('/');
    await page.getByRole('button', { name: /generate all/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Error alert visible inside the dialog (scoped to avoid Next.js route-announcer)
    await expect(page.getByRole('alert').filter({ hasText: /connection lost/i })).toBeVisible();
    await expect(page.getByRole('dialog').getByRole('button', { name: /dismiss/i })).not.toBeDisabled();
  });
});
