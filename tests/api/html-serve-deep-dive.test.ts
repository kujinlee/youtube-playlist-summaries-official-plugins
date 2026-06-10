import fs from 'fs';
import os from 'os';
import path from 'path';
import { GET } from '../../app/api/html/[id]/route';

let dir: string;
const VIDEO_ID = 'vidDD1234';
const DD_MD = `---\nvideo_id: "vidDD1234"\nlang: EN\n---\n\n# T (Deep Dive)\n\n---\n\n### **1. Overview**\nBody.\n`;

function writeIndex(v: Record<string, unknown>) {
  fs.writeFileSync(path.join(dir, 'playlist-index.json'),
    JSON.stringify({ playlistUrl: 'https://x.test/p', outputFolder: dir, videos: [v] }));
}
function video(extra: Record<string, unknown> = {}) {
  return {
    id: VIDEO_ID, title: 'T', youtubeUrl: 'https://youtu.be/x', language: 'en',
    durationSeconds: 60, archived: false,
    ratings: { usefulness: 4, depth: 4, originality: 4, recency: 4, completeness: 4 },
    overallScore: 4, summaryMd: 'a.md', summaryPdf: null,
    deepDiveMd: 'a-deep-dive.md', deepDivePdf: null, summaryHtml: null,
    processedAt: '2026-06-09T00:00:00.000Z', ...extra,
  };
}
const ctx = { params: Promise.resolve({ id: VIDEO_ID }) };
const ddReq = () => new Request(
  `http://localhost/api/html/${VIDEO_ID}?outputFolder=${encodeURIComponent(dir)}&type=deep-dive`);

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.homedir(), '.tmp-ddserve-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

it('lazily generates and serves the deep-dive HTML when not cached', async () => {
  fs.writeFileSync(path.join(dir, 'a-deep-dive.md'), DD_MD);
  writeIndex(video());
  const res = await GET(ddReq(), ctx);
  expect(res.status).toBe(200);
  expect(res.headers.get('Content-Type')).toMatch(/text\/html/);
  expect(await res.text()).toContain('T (Deep Dive)');
  expect(fs.existsSync(path.join(dir, 'htmls', 'a-deep-dive.html'))).toBe(true); // cached
});

it('serves the cached deep-dive HTML when present', async () => {
  fs.mkdirSync(path.join(dir, 'htmls'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'htmls', 'a-deep-dive.html'), '<!DOCTYPE html><title>cached</title>');
  fs.writeFileSync(path.join(dir, 'a-deep-dive.md'), DD_MD);
  writeIndex(video());
  expect(await (await GET(ddReq(), ctx)).text()).toContain('cached');
});

it('404s when the video has no deepDiveMd', async () => {
  writeIndex(video({ deepDiveMd: null }));
  expect((await GET(ddReq(), ctx)).status).toBe(404);
});

it('serves a deep-dive HTML whose filename has a Korean slug (B-1)', async () => {
  writeIndex(video({ deepDiveMd: '모든-곳에-구글-deep-dive.md' }));
  fs.writeFileSync(path.join(dir, '모든-곳에-구글-deep-dive.md'), DD_MD);
  const res = await GET(ddReq(), ctx);
  expect(res.status).toBe(200); // unicode regex admits the KO filename
});
