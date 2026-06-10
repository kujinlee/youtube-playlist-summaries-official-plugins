import fs from 'fs';
import os from 'os';
import path from 'path';
import { GET } from '../../app/api/html/[id]/route';

let dir: string;
const VIDEO_ID = 'vid12345';

function video(extra: Record<string, unknown> = {}) {
  return {
    id: VIDEO_ID, title: 'T', youtubeUrl: 'https://youtu.be/x', language: 'en',
    durationSeconds: 60, archived: false,
    ratings: { usefulness: 4, depth: 4, originality: 4, recency: 4, completeness: 4 },
    overallScore: 4, summaryMd: 'a.md', summaryPdf: null, deepDiveMd: null, deepDivePdf: null,
    summaryHtml: null, processedAt: '2026-06-09T00:00:00.000Z', ...extra,
  };
}
function writeIndex(v: unknown) {
  fs.writeFileSync(path.join(dir, 'playlist-index.json'),
    JSON.stringify({ playlistUrl: 'https://x.test/p', outputFolder: dir, videos: [v] }));
}
function url(extra = '') {
  return new Request(`http://localhost/api/html/${VIDEO_ID}?outputFolder=${encodeURIComponent(dir)}&type=summary${extra}`);
}
const ctx = { params: Promise.resolve({ id: VIDEO_ID }) };

// Must be under homedir — assertOutputFolder (not mocked) enforces this on macOS
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.homedir(), '.tmp-htmlserve-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

it('400s without outputFolder', async () => {
  const res = await GET(new Request(`http://localhost/api/html/${VIDEO_ID}`), ctx);
  expect(res.status).toBe(400);
});

it('400s when type is missing or not summary', async () => {
  writeIndex(video({ summaryHtml: 'htmls/a.html' }));
  const base = `http://localhost/api/html/${VIDEO_ID}?outputFolder=${encodeURIComponent(dir)}`;
  expect((await GET(new Request(base), ctx)).status).toBe(400);                       // missing type
  expect((await GET(new Request(`${base}&type=deep-dive`), ctx)).status).toBe(400);   // unsupported type
});

it('404s on a path-traversal summaryHtml value (Codex BLOCKING)', async () => {
  writeIndex(video({ summaryHtml: '../../../../etc/passwd' }));
  const res = await GET(url(), ctx);
  expect([400, 404]).toContain(res.status); // never 200
  expect(res.status).not.toBe(200);
});

it('404s when summaryHtml is unset', async () => {
  writeIndex(video({ summaryHtml: null }));
  const res = await GET(url(), ctx);
  expect(res.status).toBe(404);
});

it('404s when the file is missing on disk', async () => {
  writeIndex(video({ summaryHtml: 'htmls/a.html' }));
  const res = await GET(url(), ctx);
  expect(res.status).toBe(404);
});

it('serves the cached HTML with text/html', async () => {
  fs.mkdirSync(path.join(dir, 'htmls'));
  fs.writeFileSync(path.join(dir, 'htmls', 'a.html'), '<!DOCTYPE html><title>ok</title>');
  writeIndex(video({ summaryHtml: 'htmls/a.html' }));
  const res = await GET(url(), ctx);
  expect(res.status).toBe(200);
  expect(res.headers.get('Content-Type')).toMatch(/text\/html/);
  expect(await res.text()).toContain('<title>ok</title>');
});
