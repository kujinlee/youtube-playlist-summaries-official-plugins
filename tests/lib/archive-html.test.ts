import fs from 'fs';
import os from 'os';
import path from 'path';
import { archiveVideo } from '../../lib/archive';

let dir: string;
const VIDEO_ID = 'vidAR1234';

function writeIndex(videos: unknown[]) {
  fs.writeFileSync(path.join(dir, 'playlist-index.json'),
    JSON.stringify({ playlistUrl: 'https://x.test/p', outputFolder: dir, videos }, null, 2));
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.homedir(), '.tmp-arhtml-'));
  fs.mkdirSync(path.join(dir, 'htmls'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'a.md'), '# a');
  fs.writeFileSync(path.join(dir, 'a-deep-dive.md'), '# a dd');
  fs.writeFileSync(path.join(dir, 'htmls', 'a.html'), 'summary html');
  fs.writeFileSync(path.join(dir, 'htmls', 'a-deep-dive.html'), 'deep dive html');
  writeIndex([{
    id: VIDEO_ID, title: 'A', youtubeUrl: 'https://youtu.be/x', language: 'en',
    durationSeconds: 60, archived: false,
    ratings: { usefulness: 4, depth: 4, originality: 4, recency: 4, completeness: 4 },
    overallScore: 4, summaryMd: 'a.md', summaryPdf: null,
    deepDiveMd: 'a-deep-dive.md', deepDivePdf: null,
    summaryHtml: 'htmls/a.html', processedAt: '2026-06-09T00:00:00.000Z',
  }]);
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

it('deletes cached summary + deep-dive HTML and clears summaryHtml on archive', async () => {
  await archiveVideo(dir, VIDEO_ID);
  expect(fs.existsSync(path.join(dir, 'htmls', 'a.html'))).toBe(false);
  expect(fs.existsSync(path.join(dir, 'htmls', 'a-deep-dive.html'))).toBe(false);
  const idx = JSON.parse(fs.readFileSync(path.join(dir, 'playlist-index.json'), 'utf-8'));
  expect(idx.videos[0].summaryHtml).toBeNull();
  expect(idx.videos[0].archived).toBe(true);
});
