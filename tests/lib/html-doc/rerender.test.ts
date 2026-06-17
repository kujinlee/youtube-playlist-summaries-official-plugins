import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { reRenderSummaryHtml } from '../../../lib/html-doc/rerender';
import { writeModelEnvelope } from '../../../lib/html-doc/model-store';
import * as gemini from '../../../lib/gemini';

jest.mock('../../../lib/gemini');

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

---

## 1. First
First section prose.
---
## Conclusion
Wrap up.
`;

const MODEL = {
  sections: [
    { lead: 'Lead one.', bullets: [{ label: 'A', text: 'a' }, { label: 'B', text: 'b' }, { label: 'C', text: 'c' }] },
    { lead: 'Lead two.', bullets: [{ label: 'D', text: 'd' }, { label: 'E', text: 'e' }, { label: 'F', text: 'f' }] },
  ],
};
// SUMMARY_MD parses to two sections whose titles (ordinal stripped) are 'First' and 'Conclusion'.
const SECTIONS = ['First', 'Conclusion'];
function envelope(model = MODEL, sourceSections = SECTIONS) {
  return { sourceMd: 'a-title.md', generatedAt: 'now', sourceSections, model };
}

let dir: string;
function writeIndex(videos: unknown[]) {
  fs.writeFileSync(
    path.join(dir, 'playlist-index.json'),
    JSON.stringify({ playlistUrl: 'https://x.test/p', outputFolder: dir, videos }, null, 2),
  );
}
function baseVideo(overrides: Record<string, unknown> = {}) {
  return {
    id: VIDEO_ID, title: 'A Title', youtubeUrl: 'https://youtu.be/x', language: 'en',
    durationSeconds: 60, archived: false,
    ratings: { usefulness: 4, depth: 4, originality: 4, recency: 4, completeness: 4 },
    overallScore: 4, summaryMd: 'a-title.md', summaryPdf: null, deepDiveMd: null,
    deepDivePdf: null, summaryHtml: 'htmls/a-title.html', processedAt: '2026-06-09T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  dir = path.join(os.homedir(), `.tmp-rerender-${crypto.randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'a-title.md'), SUMMARY_MD);
  writeIndex([baseVideo()]);
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('reRenderSummaryHtml', () => {
  it('re-renders from the cached model without calling Gemini', () => {
    writeModelEnvelope(dir, 'a-title', envelope());
    const res = reRenderSummaryHtml(VIDEO_ID, dir);
    expect(res).toEqual({ status: 'rerendered', htmlPath: 'htmls/a-title.html' });
    const html = fs.readFileSync(path.join(dir, 'htmls', 'a-title.html'), 'utf-8');
    expect(html).toContain('Lead one.');
    expect(html).toContain('id="theme-toggle"'); // current renderer applied
    expect(gemini.generateMagazineModel as jest.Mock).not.toHaveBeenCalled();
  });

  it('skips when no model file exists', () => {
    expect(reRenderSummaryHtml(VIDEO_ID, dir)).toEqual({ status: 'skipped-no-model' });
    expect(fs.existsSync(path.join(dir, 'htmls', 'a-title.html'))).toBe(false);
  });

  it('skips when the video has no summaryMd', () => {
    writeIndex([baseVideo({ summaryMd: null })]);
    expect(reRenderSummaryHtml(VIDEO_ID, dir)).toEqual({ status: 'skipped-no-model' });
  });

  it('skips when the video has no summaryHtml (nothing existing to refresh)', () => {
    writeModelEnvelope(dir, 'a-title', envelope());
    writeIndex([baseVideo({ summaryHtml: null })]);
    expect(reRenderSummaryHtml(VIDEO_ID, dir)).toEqual({ status: 'skipped-no-model' });
    expect(fs.existsSync(path.join(dir, 'htmls', 'a-title.html'))).toBe(false);
  });

  it('skips when the .md is missing on disk', () => {
    writeModelEnvelope(dir, 'a-title', envelope());
    fs.rmSync(path.join(dir, 'a-title.md'));
    expect(reRenderSummaryHtml(VIDEO_ID, dir)).toEqual({ status: 'skipped-no-md' });
  });

  it('skips when the .md is present but unparseable', () => {
    writeModelEnvelope(dir, 'a-title', envelope());
    fs.writeFileSync(path.join(dir, 'a-title.md'), '# Title only, no ## sections\n');
    expect(reRenderSummaryHtml(VIDEO_ID, dir)).toEqual({ status: 'skipped-unparseable' });
    expect(fs.existsSync(path.join(dir, 'htmls', 'a-title.html'))).toBe(false);
  });

  it('skips on section-TITLE drift between .md and model', () => {
    writeModelEnvelope(dir, 'a-title', envelope(MODEL, ['First', 'Renamed Conclusion']));
    expect(reRenderSummaryHtml(VIDEO_ID, dir)).toEqual({
      status: 'skipped-drift',
      mdSections: ['First', 'Conclusion'],
      modelSections: ['First', 'Renamed Conclusion'],
    });
    expect(fs.existsSync(path.join(dir, 'htmls', 'a-title.html'))).toBe(false);
  });

  it('skips an unknown video id', () => {
    expect(reRenderSummaryHtml('nope99', dir)).toEqual({ status: 'skipped-no-model' });
  });
});
