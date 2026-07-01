// tests/e2e/playlist-picker.spec.ts
import { test, expect } from '@playwright/test';

test('pick a recent playlist fills the URL field and Fetch fires ingestion', async ({ page }) => {
  // Provide a root so the resolve-folder debounce has a non-empty root to work with
  await page.route('**/api/settings**', (r) => r.fulfill({ json: { outputFolder: '/home/x/data/a/raw', baseOutputFolder: '/home/x/data' } }));
  await page.route('**/api/videos**', (r) => r.fulfill({ json: { videos: [], playlistUrl: '', playlistTitle: '' } }));
  await page.route('**/api/playlists/recent**', (r) => r.fulfill({ json: { playlists: [
    { id: 'PLa', title: 'Building with Claude', url: 'https://youtube.com/playlist?list=PLa', source: 'recent', meta: { videoCount: 114 } },
    { id: 'PLb', title: 'No Title Playlist', url: 'https://youtube.com/playlist?list=PLb', source: 'recent', meta: {} }, // null-title fixture (slug fell back server-side)
  ] } }));
  // resolve-folder so the Fetch button enables; capture the ingest POST body
  await page.route('**/api/resolve-folder**', (r) => r.fulfill({ json: { root: '/home/x/data', outputFolder: '/home/x/data/a/raw' } }));
  let ingestBody: Record<string, unknown> | null = null;
  await page.route('**/api/ingest', async (r) => { ingestBody = r.request().postDataJSON(); await r.fulfill({ json: { jobId: 'j1' } }); });

  await page.goto('/');
  const input = page.getByPlaceholder(/Paste a playlist URL/);
  // Wait for settings to load (root field populated) before focusing the picker
  await expect(page.getByPlaceholder(/Root output folder/)).toHaveValue('/home/x/data', { timeout: 5000 });
  await input.focus();
  await expect(page.getByText('Building with Claude')).toBeVisible({ timeout: 5000 });
  await page.getByText('Building with Claude').click();
  await expect(input).toHaveValue('https://youtube.com/playlist?list=PLa');

  // Wait for the resolve-folder debounce to settle and Fetch button to become enabled
  const fetchBtn = page.getByRole('button', { name: /Fetch & Summarize/ });
  await expect(fetchBtn).toBeEnabled({ timeout: 3000 });
  await fetchBtn.click();
  await expect.poll(() => ingestBody?.playlistUrl, { timeout: 5000 }).toBe('https://youtube.com/playlist?list=PLa');
});

test('browse a channel and pick a playlist fills the URL field', async ({ page }) => {
  await page.route('**/api/settings**', (r) => r.fulfill({ json: { outputFolder: '/home/x/data/a/raw', baseOutputFolder: '/home/x/data' } }));
  await page.route('**/api/videos**', (r) => r.fulfill({ json: { videos: [], playlistUrl: '', playlistTitle: '' } }));
  await page.route('**/api/playlists/recent**', (r) => r.fulfill({ json: { playlists: [] } }));
  await page.route('**/api/playlists/channel**', (r) => r.fulfill({ json: { channelTitle: 'Anthropic', playlists: [
    { id: 'PLc', title: 'Research Talks', url: 'https://youtube.com/playlist?list=PLc', source: 'channel', meta: { videoCount: 31 } },
  ] } }));
  await page.goto('/');
  await page.getByPlaceholder(/Paste a playlist URL/).focus();
  await page.getByText(/Browse a channel/i).click();
  await page.getByPlaceholder(/@channel/).fill('@Anthropic');
  await page.getByText('Go').click();
  await page.getByText('Research Talks').click();
  await expect(page.getByPlaceholder(/Paste a playlist URL/)).toHaveValue('https://youtube.com/playlist?list=PLc');
});
