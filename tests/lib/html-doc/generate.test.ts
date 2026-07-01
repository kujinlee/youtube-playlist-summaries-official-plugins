import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runHtmlDoc } from '../../../lib/html-doc/generate';
import * as gemini from '../../../lib/gemini';
import { updateVideoFields } from '../../../lib/index-store';
import type { ProgressEvent } from '../../../types';

jest.mock('../../../lib/gemini');
// Wrap index-store so updateVideoFields calls through by default but can be forced to throw.
jest.mock('../../../lib/index-store', () => {
  const actual = jest.requireActual('../../../lib/index-store');
  return { __esModule: true, ...actual, updateVideoFields: jest.fn(actual.updateVideoFields) };
});
const mockTransform = gemini.generateMagazineModel as jest.Mock;
const mockUpdate = updateVideoFields as jest.Mock;

// Must be under homedir — assertOutputFolder (not mocked) enforces this
let dir: string;
const VIDEO_ID = 'vid12345';

const SUMMARY_MD = `---
video_id: "vid12345"
lang: EN
score: 4
---

# A Title

**Channel:** Chan | **Duration:** 1:00 | **URL:** https://youtu.be/x

> [!summary] Quick Reference
> **TL;DR:** Core idea.
>
> **Key Takeaways:**
> - One.
>
> **Concepts:** a · b

---

## 1. First
First section prose.
---
## Conclusion
Wrap up.
`;

function writeIndex(videos: unknown[]) {
  fs.writeFileSync(
    path.join(dir, 'playlist-index.json'),
    JSON.stringify({ playlistUrl: 'https://x.test/p', outputFolder: dir, videos }, null, 2),
  );
}

function baseVideo() {
  return {
    id: VIDEO_ID, title: 'A Title', youtubeUrl: 'https://youtu.be/x', language: 'en',
    durationSeconds: 60, archived: false,
    ratings: { usefulness: 4, depth: 4, originality: 4, recency: 4, completeness: 4 },
    overallScore: 4, summaryMd: 'a-title.md',
    summaryHtml: null, processedAt: '2026-06-09T00:00:00.000Z',
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  dir = path.join(os.homedir(), `.tmp-htmldoc-test-${crypto.randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'a-title.md'), SUMMARY_MD);
  writeIndex([baseVideo()]);
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

it('transforms, writes htmls/<base>.html, and records summaryHtml', async () => {
  mockTransform.mockResolvedValueOnce({
    sections: [
      { lead: 'Lead one.', bullets: [{ label: 'L', text: 't' }, { label: 'M', text: 'u' }, { label: 'N', text: 'v' }] },
      { lead: 'Lead two.', bullets: [{ label: 'O', text: 'w' }, { label: 'P', text: 'x' }, { label: 'Q', text: 'y' }] },
    ],
  });
  const events: ProgressEvent[] = [];
  await runHtmlDoc(VIDEO_ID, dir, (e) => events.push(e));

  const htmlPath = path.join(dir, 'htmls', 'a-title.html');
  expect(fs.existsSync(htmlPath)).toBe(true);
  expect(fs.readFileSync(htmlPath, 'utf-8')).toContain('Lead one.');

  const idx = JSON.parse(fs.readFileSync(path.join(dir, 'playlist-index.json'), 'utf-8'));
  expect(idx.videos[0].summaryHtml).toBe('htmls/a-title.html');
  expect(events.at(-1)).toEqual({ type: 'done' });
});

it('writes nothing and leaves index untouched when the transform fails', async () => {
  mockTransform.mockRejectedValueOnce(new Error('boom'));
  await expect(runHtmlDoc(VIDEO_ID, dir, () => {})).rejects.toThrow(/boom/);

  expect(fs.existsSync(path.join(dir, 'htmls', 'a-title.html'))).toBe(false);
  const idx = JSON.parse(fs.readFileSync(path.join(dir, 'playlist-index.json'), 'utf-8'));
  expect(idx.videos[0].summaryHtml).toBeNull();
});

it('throws when summaryMd is missing', async () => {
  writeIndex([{ ...baseVideo(), summaryMd: null }]);
  await expect(runHtmlDoc(VIDEO_ID, dir, () => {})).rejects.toThrow(/source note|summaryMd/i);
});

it('removes the orphan HTML file when the index update fails', async () => {
  mockTransform.mockResolvedValueOnce({
    sections: [
      { lead: 'L1', bullets: [{ label: 'A', text: 'a' }, { label: 'B', text: 'b' }, { label: 'C', text: 'c' }] },
      { lead: 'L2', bullets: [{ label: 'D', text: 'd' }, { label: 'E', text: 'e' }, { label: 'F', text: 'f' }] },
    ],
  });
  mockUpdate.mockImplementationOnce(() => { throw new Error('index write failed'); });

  await expect(runHtmlDoc(VIDEO_ID, dir, () => {})).rejects.toThrow(/index write failed/);
  expect(fs.existsSync(path.join(dir, 'htmls', 'a-title.html'))).toBe(false); // cleaned up, no orphan
});

it('persists the magazine model envelope to models/<base>.json', async () => {
  const model = {
    sections: [
      { lead: 'Lead one.', bullets: [{ label: 'L', text: 't' }, { label: 'M', text: 'u' }, { label: 'N', text: 'v' }] },
      { lead: 'Lead two.', bullets: [{ label: 'O', text: 'w' }, { label: 'P', text: 'x' }, { label: 'Q', text: 'y' }] },
    ],
  };
  mockTransform.mockResolvedValueOnce(model);
  await runHtmlDoc(VIDEO_ID, dir, () => {});

  const modelPath = path.join(dir, 'models', 'a-title.json');
  expect(fs.existsSync(modelPath)).toBe(true);
  const envelope = JSON.parse(fs.readFileSync(modelPath, 'utf-8'));
  expect(envelope.sourceMd).toBe('a-title.md');
  expect(typeof envelope.generatedAt).toBe('string');
  // SUMMARY_MD has sections "## 1. First" and "## Conclusion"; titles have the ordinal stripped.
  expect(envelope.sourceSections).toEqual(['First', 'Conclusion']);
  expect(envelope.model).toEqual(model);
});

it('does not write a model envelope when the transform fails', async () => {
  mockTransform.mockRejectedValueOnce(new Error('boom'));
  await expect(runHtmlDoc(VIDEO_ID, dir, () => {})).rejects.toThrow(/boom/);
  expect(fs.existsSync(path.join(dir, 'models', 'a-title.json'))).toBe(false);
});
