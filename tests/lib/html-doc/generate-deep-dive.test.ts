import fs from 'fs';
import os from 'os';
import path from 'path';
import { runDeepDiveHtml, reRenderDeepDiveHtml } from '../../../lib/html-doc/generate-deep-dive';

let dir: string;
const VIDEO_ID = 'vidDD1234';

const DD_MD = `---
video_id: "vidDD1234"
lang: EN
score: 4
---

# A Title (Deep Dive)

**Channel:** Chan | **Duration:** 1:00 | **URL:** https://youtu.be/x

---

### **1. Overview**
Body text.
`;

function writeIndex(videos: unknown[]) {
  fs.writeFileSync(path.join(dir, 'playlist-index.json'),
    JSON.stringify({ playlistUrl: 'https://x.test/p', outputFolder: dir, videos }, null, 2));
}
function baseVideo() {
  return {
    id: VIDEO_ID, title: 'A Title', youtubeUrl: 'https://youtu.be/x', language: 'en',
    durationSeconds: 60, archived: false,
    ratings: { usefulness: 4, depth: 4, originality: 4, recency: 4, completeness: 4 },
    overallScore: 4, summaryMd: 'a-title.md', summaryPdf: null,
    deepDiveMd: 'a-title-deep-dive.md', deepDivePdf: null, summaryHtml: null,
    processedAt: '2026-06-09T00:00:00.000Z',
  };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.homedir(), '.tmp-ddhtml-'));
  fs.writeFileSync(path.join(dir, 'a-title-deep-dive.md'), DD_MD);
  writeIndex([baseVideo()]);
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

it('renders, atomic-writes htmls/<base>.html, and returns the HTML string and rel path', async () => {
  const { html, htmlPath } = await runDeepDiveHtml(VIDEO_ID, dir);
  expect(html).toContain('A Title (Deep Dive)');
  expect(html).toContain('Body text.');
  expect(htmlPath).toBe('htmls/a-title-deep-dive.html');

  const out = path.join(dir, 'htmls', 'a-title-deep-dive.html'); // no doubled -deep-dive
  expect(fs.existsSync(out)).toBe(true);
  expect(fs.readFileSync(out, 'utf-8')).toBe(html);
});

it('does NOT write the index (no deepDiveHtml field, summaryHtml untouched)', async () => {
  await runDeepDiveHtml(VIDEO_ID, dir);
  const idx = JSON.parse(fs.readFileSync(path.join(dir, 'playlist-index.json'), 'utf-8'));
  expect(idx.videos[0].summaryHtml).toBeNull();
  expect('deepDiveHtml' in idx.videos[0]).toBe(false);
});

it('throws when the video has no deepDiveMd', async () => {
  writeIndex([{ ...baseVideo(), deepDiveMd: null }]);
  await expect(runDeepDiveHtml(VIDEO_ID, dir)).rejects.toThrow(/deep dive|deepDiveMd/i);
});

it('reRenderDeepDiveHtml writes html from the .md and returns its rel path', () => {
  // beforeEach already wrote a-title-deep-dive.md and the index with deepDiveMd set
  const res = reRenderDeepDiveHtml(VIDEO_ID, dir);
  expect(res.status).toBe('rerendered');
  if (res.status !== 'rerendered') return; // narrow type
  expect(res.htmlPath).toBe('htmls/a-title-deep-dive.html');
  expect(fs.existsSync(path.join(dir, 'htmls/a-title-deep-dive.html'))).toBe(true);
});

it('reRenderDeepDiveHtml returns skipped-no-md when the video has no deepDiveMd', () => {
  writeIndex([{ ...baseVideo(), deepDiveMd: null }]);
  const res = reRenderDeepDiveHtml(VIDEO_ID, dir);
  expect(res.status).toBe('skipped-no-md');
});

it('reRenderDeepDiveHtml returns skipped-not-eligible when the video is absent', () => {
  writeIndex([]); // no matching video
  const res = reRenderDeepDiveHtml(VIDEO_ID, dir);
  expect(res.status).toBe('skipped-not-eligible');
});
