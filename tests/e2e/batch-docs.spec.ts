import { test, expect } from '@playwright/test';
import type { Video } from '../../types';

const OUTPUT_FOLDER = '/home/u/p';
function v(id: string, over: Partial<Video> = {}): Video {
  return {
    id, title: `T${id}`, youtubeUrl: `https://youtu.be/${id}`, language: 'en', durationSeconds: 1,
    archived: false, ratings: { usefulness: 3, depth: 3, originality: 3, recency: 3, completeness: 3 },
    overallScore: 3, summaryMd: `${id}.md`,
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

test('summary-dig mode posts mode:summary-dig after confirm', async ({ page }) => {
  await page.route('**/api/settings', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ outputFolder: OUTPUT_FOLDER }) }));
  await page.route('**/api/videos**', (route) => {
    if (route.request().method() !== 'GET' || route.request().url().includes('/api/videos/')) return route.continue();
    // 'a' has a CURRENT summary HTML but was NEVER dug → must still be eligible in summary-dig mode.
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      videos: [v('a', { summaryHtml: 'a.html', docVersion: { major: 3, minor: 3 }, digDeeperMd: null })],
    }) });
  });
  let postedBody: any = null;
  await page.route('**/api/videos/batch-docs', (route) => {
    if (route.request().url().includes('/stream') || route.request().url().includes('/cancel')) return route.continue();
    postedBody = route.request().postDataJSON();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jobId: 'jd1' }) });
  });
  await page.route('**/api/videos/batch-docs/stream**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/event-stream', body:
      `data: ${JSON.stringify({ type: 'done', succeeded: 1, failed: 0 })}\n\n` }));

  page.on('dialog', (d) => d.accept()); // accept the cost-confirm
  await page.goto('/');
  // Individually select video 'a' (its row checkbox is always enabled since it has summaryMd).
  // This makes selectedCount > 0 so BulkActionBar renders.
  await page.getByRole('row', { name: /Ta/ }).getByRole('checkbox').check();
  // Switch to summary-dig mode — BulkActionBar is now visible.
  await page.getByText('Summary + Dig-deeper').click();
  await page.getByRole('button', { name: /Generate docs/ }).click();
  await expect(page.getByText(/generated/)).toBeVisible();
  expect(postedBody).toMatchObject({ mode: 'summary-dig', videoIds: ['a'] });
});
