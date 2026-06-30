import { test, expect } from '@playwright/test';
import type { Video } from '../../types';

const OUTPUT_FOLDER = '/home/u/p';
function v(id: string, over: Partial<Video> = {}): Video {
  return {
    id, title: `T${id}`, youtubeUrl: `https://youtu.be/${id}`, language: 'en', durationSeconds: 1,
    archived: false, ratings: { usefulness: 3, depth: 3, originality: 3, recency: 3, completeness: 3 },
    overallScore: 3, summaryMd: `${id}.md`, summaryPdf: null, deepDiveMd: null, deepDivePdf: null,
    summaryHtml: null, processedAt: '2026-06-29T00:00:00.000Z', docVersion: { major: 3, minor: 3 },
    ...over,
  } as Video;
}

test('batch-generates selected videos and shows N-of-M progress', async ({ page }) => {
  await page.route('**/api/settings', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ outputFolder: OUTPUT_FOLDER }) }));
  await page.route('**/api/videos**', (route) => {
    if (route.request().method() !== 'GET' || route.request().url().includes('/api/videos/')) return route.continue();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ videos: [v('a'), v('b')] }) });
  });
  let postedBody: any = null;
  await page.route('**/api/videos/batch-docs', (route) => {
    if (route.request().url().includes('/stream')) return route.continue();
    postedBody = route.request().postDataJSON();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jobId: 'jb1' }) });
  });
  await page.route('**/api/videos/batch-docs/stream**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/event-stream', body:
      `data: ${JSON.stringify({ type: 'step', step: 'Generating HTML doc…', videoId: 'a', current: 1, total: 2 })}\n\n` +
      `data: ${JSON.stringify({ type: 'done', succeeded: 2, failed: 0 })}\n\n` }));

  await page.goto('/');
  await page.getByLabel('Select all needing generation').check();
  await page.getByRole('button', { name: /Generate HTML doc — 2 videos/ }).click();
  await expect(page.getByText(/generated/)).toBeVisible();
  expect(postedBody).toMatchObject({ outputFolder: OUTPUT_FOLDER, videoIds: ['a', 'b'], mode: 'summary' });
});
