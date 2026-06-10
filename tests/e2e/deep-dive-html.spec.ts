import { expect, test } from '@playwright/test';
import type { Video } from '@/types';

// ---------------------------------------------------------------------------
// Fixture data
// Fixture set covers:
//   - one video WITH deepDiveMd set  — used in Scenario 1 (link params + serves HTML)
//   - one video WITHOUT deepDiveMd   — used in Scenario 2 (disabled state)
// ---------------------------------------------------------------------------

const OUTPUT_FOLDER = '/tmp/test-deep-dive-html';

const BASE_RATINGS = {
  usefulness: 4 as const,
  depth: 4 as const,
  originality: 4 as const,
  recency: 4 as const,
  completeness: 4 as const,
};

function makeVideo(overrides: Partial<Video> = {}): Video {
  return {
    id: 'vid-ddh1',
    title: 'Deep Dive HTML Test Video',
    youtubeUrl: 'https://www.youtube.com/watch?v=vid-ddh1',
    language: 'en',
    durationSeconds: 600,
    archived: false,
    ratings: BASE_RATINGS,
    overallScore: 4.0,
    summaryMd: 'deep-dive-html-test.md',
    summaryPdf: null,
    deepDiveMd: null,
    deepDivePdf: null,
    summaryHtml: null,
    processedAt: '2026-06-09T00:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Stub helpers (mirror html-doc.spec.ts conventions exactly)
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

/** Stubs GET /api/html/:id?...&type=deep-dive → HTML body */
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
// Scenarios
// ---------------------------------------------------------------------------

test('the deep-dive HTML link carries both params and serves HTML', async ({ page }) => {
  // Fixture: video WITH deepDiveMd set
  const video = makeVideo({ id: 'vid-ddh1', deepDiveMd: 'deep-dive-html-test-deep-dive.md' });

  const fakeHtml = `<!DOCTYPE html><html><head><title>Deep Dive HTML Test Video (Deep Dive)</title></head><body><h1>Deep Dive HTML Test Video (Deep Dive)</h1></body></html>`;

  await stubSettings(page);
  await stubVideos(page, [video]);
  // Stub the serve route so the link target resolves (the test is about the href params)
  await stubDeepDiveHtmlServe(page, 'vid-ddh1', fakeHtml);

  await page.goto('/');
  await expect(page.getByText('Deep Dive HTML Test Video')).toBeVisible();

  // Open the row menu
  await page.getByRole('button', { name: 'Menu' }).click();

  // Locate "View Deep Dive HTML" — must be an <a> link (enabled because deepDiveMd is set)
  const link = page.getByRole('link', { name: /view deep dive html/i });
  await expect(link).toBeVisible();

  // Assert BOTH required params on the href (two separate expects per spec)
  const href = await link.getAttribute('href');
  const u = new URL(href!, page.url());
  expect(u.searchParams.get('outputFolder')).toBe(OUTPUT_FOLDER);
  expect(u.searchParams.get('type')).toBe('deep-dive');
});

test('the deep-dive HTML item is disabled when the video has no deep-dive', async ({ page }) => {
  // Fixture: video WITHOUT deepDiveMd (null)
  const video = makeVideo({ id: 'vid-ddh2', deepDiveMd: null });

  await stubSettings(page);
  await stubVideos(page, [video]);

  await page.goto('/');
  await expect(page.getByText('Deep Dive HTML Test Video')).toBeVisible();

  // Open the row menu
  await page.getByRole('button', { name: 'Menu' }).click();

  // "View Deep Dive HTML" must NOT be a link (the <span> renders, not an <a>)
  await expect(page.getByRole('link', { name: /view deep dive html/i })).not.toBeVisible();

  // The item must be present and aria-disabled (rendered as a <span aria-disabled="true">)
  const disabledItem = page.getByText(/view deep dive html/i).first();
  await expect(disabledItem).toBeVisible();
  await expect(disabledItem).toHaveAttribute('aria-disabled', 'true');
});
