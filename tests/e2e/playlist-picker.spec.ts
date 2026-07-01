// tests/e2e/playlist-picker.spec.ts
import { test, expect } from '@playwright/test';

const PLA = 'https://youtube.com/playlist?list=PLa';

test('pick a recent playlist enables Fetch and ingests the picked URL', async ({ page }) => {
  await page.route('**/api/settings**', (r) => r.fulfill({ json: { outputFolder: '/home/x/data/a/raw', baseOutputFolder: '/home/x/data' } }));
  await page.route('**/api/videos**', (r) => r.fulfill({ json: { videos: [], playlistUrl: '', playlistTitle: '' } }));
  await page.route('**/api/playlists/recent**', (r) => r.fulfill({ json: { playlists: [
    { id: 'PLa', title: 'Building with Claude', url: PLA, source: 'recent', meta: { videoCount: 114 } },
  ] } }));
  await page.route('**/api/resolve-folder**', (r) => r.fulfill({ json: { root: '/home/x/data', outputFolder: '/home/x/data/a/raw' } }));
  let ingestBody: Record<string, unknown> | null = null;
  await page.route('**/api/ingest', async (r) => { ingestBody = r.request().postDataJSON(); await r.fulfill({ json: { jobId: 'j1' } }); });

  await page.goto('/');
  await expect(page.getByPlaceholder(/Root output folder/)).toHaveValue('/home/x/data', { timeout: 5000 });
  await page.getByRole('button', { name: /Recent/ }).click();
  await expect(page.getByText('Building with Claude')).toBeVisible({ timeout: 5000 });
  await page.getByText('Building with Claude').click();

  const fetchBtn = page.getByRole('button', { name: /Fetch & Summarize/ });
  await expect(fetchBtn).toBeEnabled({ timeout: 3000 });
  await fetchBtn.click();
  await expect.poll(() => ingestBody?.playlistUrl, { timeout: 5000 }).toBe(PLA);
});

test('add-by-link auto-collapses after a URL resolves', async ({ page }) => {
  await page.route('**/api/settings**', (r) => r.fulfill({ json: { outputFolder: '/home/x/data/a/raw', baseOutputFolder: '/home/x/data' } }));
  await page.route('**/api/videos**', (r) => r.fulfill({ json: { videos: [], playlistUrl: '', playlistTitle: '' } }));
  await page.route('**/api/playlists/recent**', (r) => r.fulfill({ json: { playlists: [] } }));
  await page.route('**/api/resolve-folder**', (r) => r.fulfill({ json: { root: '/home/x/data', outputFolder: '/home/x/data/a/raw' } }));

  await page.goto('/');
  await expect(page.getByPlaceholder(/Root output folder/)).toHaveValue('/home/x/data', { timeout: 5000 });
  // Empty state → disclosure auto-opens once loaded.
  const input = page.getByPlaceholder(/Paste a playlist URL/);
  await expect(input).toBeVisible({ timeout: 5000 });
  await input.fill(PLA);
  // Successful resolve (user-edited) → disclosure collapses.
  await expect(input).toBeHidden({ timeout: 5000 });
});

test('browse a channel and pick a playlist sets the URL', async ({ page }) => {
  await page.route('**/api/settings**', (r) => r.fulfill({ json: { outputFolder: '/home/x/data/a/raw', baseOutputFolder: '/home/x/data' } }));
  await page.route('**/api/videos**', (r) => r.fulfill({ json: { videos: [], playlistUrl: '', playlistTitle: '' } }));
  await page.route('**/api/playlists/recent**', (r) => r.fulfill({ json: { playlists: [] } }));
  await page.route('**/api/playlists/channel**', (r) => r.fulfill({ json: { channelTitle: 'Anthropic', playlists: [
    { id: 'PLc', title: 'Research Talks', url: 'https://youtube.com/playlist?list=PLc', source: 'channel', meta: { videoCount: 31 } },
  ] } }));
  // Fail resolve so the (auto-open) disclosure does NOT collapse — we read the value from it.
  await page.route('**/api/resolve-folder**', (r) => r.fulfill({ status: 400, json: {} }));

  await page.goto('/');
  await expect(page.getByPlaceholder(/Root output folder/)).toHaveValue('/home/x/data', { timeout: 5000 });
  await page.getByRole('button', { name: /Recent/ }).click();
  await page.getByText(/Browse a channel/i).click();
  await page.getByPlaceholder(/@channel/).fill('@Anthropic');
  await page.getByText('Go').click();
  await page.getByText('Research Talks').click();
  // Disclosure is already open (empty state) and resolve failed → stays open; value populated by the pick.
  await expect(page.getByPlaceholder(/Paste a playlist URL/)).toHaveValue('https://youtube.com/playlist?list=PLc');
});
