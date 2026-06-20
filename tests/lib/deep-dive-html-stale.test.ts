import fs from 'fs';
import os from 'os';
import path from 'path';
import { runDeepDive } from '../../lib/deep-dive';

jest.mock('../../lib/gemini', () => ({
  generateDeepDive: jest.fn().mockResolvedValue('# x\n\n### **1. New**\nnew body.'),
  generateDeepDiveFromTranscript: jest.fn(),
  generateDeepDiveCombined: jest.fn().mockResolvedValue('# x\n\n### **1. New**\nnew body.'),
}));
jest.mock('../../lib/pdf', () => ({ generatePdf: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../lib/youtube', () => ({ fetchTranscript: jest.fn().mockResolvedValue('transcript text') }));

let dir: string;
const VIDEO_ID = 'vidDD1234';

function writeIndex(videos: unknown[]) {
  fs.writeFileSync(path.join(dir, 'playlist-index.json'),
    JSON.stringify({ playlistUrl: 'https://x.test/p', outputFolder: dir, videos }, null, 2));
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.homedir(), '.tmp-ddstale-'));
  writeIndex([{
    id: VIDEO_ID, title: 'A', youtubeUrl: 'https://youtu.be/x', language: 'en',
    durationSeconds: 60, archived: false,
    ratings: { usefulness: 4, depth: 4, originality: 4, recency: 4, completeness: 4 },
    overallScore: 4, summaryMd: 'a.md', summaryPdf: null, deepDiveMd: null, deepDivePdf: null,
    summaryHtml: null, processedAt: '2026-06-09T00:00:00.000Z',
  }]);
  // a stale cached deep-dive HTML from a previous run
  fs.mkdirSync(path.join(dir, 'htmls'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'htmls', 'a-deep-dive.html'), '<!DOCTYPE html><title>stale</title>');
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

it('removes the stale cached deep-dive HTML when the deep-dive is regenerated', async () => {
  await runDeepDive(VIDEO_ID, dir, () => {});
  expect(fs.existsSync(path.join(dir, 'htmls', 'a-deep-dive.html'))).toBe(false);
});
