import { expect, test } from '@playwright/test';
import type { Video } from '@/types';

// E2E for the auto-PDF export: row menu → POST /pdf → non-blocking PdfStatusBar → "Saved pdfs/<file>".
// The PDF generator is NOT exercised here (no real chromium) — the POST + stream are stubbed.

const OUTPUT_FOLDER = '/tmp/test-pdf-export';

const BASE_RATINGS = { usefulness: 4 as const, depth: 3 as const, originality: 4 as const, recency: 5 as const, completeness: 3 as const };

function makeVideo(overrides: Partial<Video> = {}): Video {
  return {
    id: 'vid-pdf1',
    title: 'Deep Dive into LLMs',
    youtubeUrl: 'https://www.youtube.com/watch?v=vid-pdf1',
    language: 'en',
    durationSeconds: 600,
    archived: false,
    ratings: BASE_RATINGS,
    overallScore: 3.8,
    summaryMd: 'deep-dive-into-llms.md',
    summaryHtml: 'htmls/deep-dive-into-llms.html',
    processedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function sseBody(...events: object[]): string {
  return events.map((e) => `data: ${JSON.stringify(e)}\n`).join('\n') + '\n';
}

async function stubSettings(page: import('@playwright/test').Page) {
  await page.route('**/api/settings', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ outputFolder: OUTPUT_FOLDER }) }),
  );
}
async function stubVideos(page: import('@playwright/test').Page, videos: Video[]) {
  await page.route('**/api/videos**', (route) => {
    if (route.request().method() !== 'GET') { route.continue(); return; }
    if (route.request().url().includes('/api/videos/')) { route.continue(); return; }
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ videos }) });
  });
}
async function stubPdfPost(page: import('@playwright/test').Page, videoId: string, jobId = 'pdf-job-1') {
  await page.route(`**/api/videos/${videoId}/pdf`, (route) => {
    if (route.request().url().includes('/pdf/')) { route.continue(); return; } // let /pdf/stream through
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jobId }) });
  });
}
async function stubPdfStream(page: import('@playwright/test').Page, videoId: string, events: object[]) {
  await page.route(`**/api/videos/${videoId}/pdf/stream**`, (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      body: sseBody(...events),
    }),
  );
}

test('Save summary PDF: menu → status bar → Saved pdfs/<file>', async ({ page }) => {
  const video = makeVideo();
  await stubSettings(page);
  await stubVideos(page, [video]);
  await stubPdfPost(page, video.id);
  await stubPdfStream(page, video.id, [
    { type: 'start' },
    { type: 'step', step: 'Rendering PDF…', current: 1, total: 1 },
    { type: 'done', current: 1, total: 1, log: 'deep-dive-into-llms.pdf' },
  ]);

  await page.goto('/');
  await expect(page.getByText('Deep Dive into LLMs')).toBeVisible();

  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: /^Save summary PDF$/i }).click();

  const bar = page.getByRole('status', { name: /save pdf progress/i });
  await expect(bar).toBeVisible();
  await expect(bar.getByText(/Saved pdfs\/deep-dive-into-llms\.pdf/)).toBeVisible();
  // It is a plain saved-to-disk report — no view link.
  await expect(bar.getByRole('link')).toHaveCount(0);
});

test('Save dig-deeper PDF appears only when a dig-deeper doc exists and reports its filename', async ({ page }) => {
  const video = makeVideo({ id: 'vid-pdf2', digDeeperMd: 'deep-dive-into-llms-dig-deeper.md' });
  await stubSettings(page);
  await stubVideos(page, [video]);
  await stubPdfPost(page, video.id, 'pdf-job-2');
  await stubPdfStream(page, video.id, [
    { type: 'start' },
    { type: 'step', step: 'Rendering PDF…', current: 1, total: 1 },
    { type: 'done', current: 1, total: 1, log: 'deep-dive-into-llms-dig-deeper.pdf' },
  ]);

  await page.goto('/');
  await expect(page.getByText('Deep Dive into LLMs')).toBeVisible();

  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: /^Save dig-deeper PDF$/i }).click();

  const bar = page.getByRole('status', { name: /save pdf progress/i });
  await expect(bar).toBeVisible();
  await expect(bar.getByText(/Saved pdfs\/deep-dive-into-llms-dig-deeper\.pdf/)).toBeVisible();
});
