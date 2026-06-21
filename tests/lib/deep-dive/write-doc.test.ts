import crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ProgressEvent, Video } from '../../../types';
import type { TranscriptSegment } from '../../../lib/transcript-timestamps';

jest.mock('../../../lib/gemini');
jest.mock('../../../lib/youtube');

import { writeDeepDiveDoc } from '../../../lib/deep-dive/write-doc';
import * as gemini from '../../../lib/gemini';
import * as youtube from '../../../lib/youtube';

const mockGenerateDeepDive = jest.mocked(gemini.generateDeepDive);
const mockGenerateDeepDiveFromTranscript = jest.mocked(gemini.generateDeepDiveFromTranscript);
const mockGenerateDeepDiveCombined = jest.mocked(gemini.generateDeepDiveCombined);
const mockFetchTranscriptSegments = jest.mocked(youtube.fetchTranscriptSegments);

const VIDEO_ID = 'testVideoId1';
const YOUTUBE_URL = `https://youtube.com/watch?v=${VIDEO_ID}`;
const SUMMARY_BASE = '001_test-video';
const SEGMENTS: TranscriptSegment[] = [{ text: 'transcript text', offset: 0, duration: 30 }];

// The combined/transcript generators return a body that already has resolved ▶ timestamp lines.
const COMBINED_BODY = '# Deep Dive (combined)\n\n## 1. Topic\n▶ [0:00](https://youtu.be/x?t=0)\n\nCombined analysis.';
const VIDEO_BODY = '# Deep Dive (video)\n\n## 1. Topic\n\nVideo-only analysis with no timestamps.';

function makeTempDir(): string {
  const dir = path.join(os.tmpdir(), `write-doc-test-${crypto.randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function makeVideo(overrides: Partial<Video> = {}): Video {
  return {
    id: VIDEO_ID,
    title: 'Test Video',
    youtubeUrl: YOUTUBE_URL,
    language: 'en',
    durationSeconds: 300,
    archived: false,
    ratings: { usefulness: 3, depth: 3, originality: 3, recency: 3, completeness: 3 },
    overallScore: 3,
    summaryMd: `${SUMMARY_BASE}.md`,
    summaryPdf: `${SUMMARY_BASE}.pdf`,
    deepDiveMd: null,
    deepDivePdf: null,
    processedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('writeDeepDiveDoc', () => {
  let outputFolder: string;

  beforeEach(() => {
    outputFolder = makeTempDir();
    mockGenerateDeepDiveCombined.mockResolvedValue(COMBINED_BODY);
    mockGenerateDeepDiveFromTranscript.mockResolvedValue('# Deep Dive (transcript)\n\n## 1. T\n▶ [0:00](u)\n\nTranscript fallback.');
    mockGenerateDeepDive.mockResolvedValue(VIDEO_BODY);
    mockFetchTranscriptSegments.mockResolvedValue(SEGMENTS);
  });

  afterEach(() => {
    fs.rmSync(outputFolder, { recursive: true, force: true });
    jest.clearAllMocks();
  });

  it('combined path: writes the .md with the resolved ▶ body, returns deepDiveMd, no pdf', async () => {
    const result = await writeDeepDiveDoc(makeVideo(), outputFolder, () => {});

    expect(mockFetchTranscriptSegments).toHaveBeenCalledWith(VIDEO_ID);
    expect(mockGenerateDeepDiveCombined).toHaveBeenCalledWith(YOUTUBE_URL, SEGMENTS, 'en', VIDEO_ID);
    expect(mockGenerateDeepDiveFromTranscript).not.toHaveBeenCalled();
    expect(mockGenerateDeepDive).not.toHaveBeenCalled();

    expect(result).toEqual({ deepDiveMd: `${SUMMARY_BASE}-deep-dive.md` });
    expect('deepDivePdf' in result).toBe(false);

    const content = fs.readFileSync(path.join(outputFolder, `${SUMMARY_BASE}-deep-dive.md`), 'utf-8');
    expect(content).toContain('▶ [0:00]');
    expect(content).toContain('Combined analysis.');
  });

  it('no pdf file is written and the pdfs/ folder is not created', async () => {
    await writeDeepDiveDoc(makeVideo(), outputFolder, () => {});
    expect(fs.existsSync(path.join(outputFolder, 'pdfs'))).toBe(false);
    expect(fs.existsSync(path.join(outputFolder, 'pdfs', `${SUMMARY_BASE}-deep-dive.pdf`))).toBe(false);
  });

  it('transcript-only fallback when combined throws', async () => {
    mockGenerateDeepDiveCombined.mockRejectedValueOnce(new Error('combined failed'));

    await writeDeepDiveDoc(makeVideo(), outputFolder, () => {});

    expect(mockGenerateDeepDiveFromTranscript).toHaveBeenCalledWith(SEGMENTS, 'en', VIDEO_ID);
    expect(mockGenerateDeepDive).not.toHaveBeenCalled();
    const content = fs.readFileSync(path.join(outputFolder, `${SUMMARY_BASE}-deep-dive.md`), 'utf-8');
    expect(content).toContain('Transcript fallback.');
  });

  it('video-only path when transcript fetch fails: no segments passed, no ▶ tokens', async () => {
    mockFetchTranscriptSegments.mockRejectedValueOnce(new Error('no captions'));

    await writeDeepDiveDoc(makeVideo(), outputFolder, () => {});

    expect(mockGenerateDeepDive).toHaveBeenCalledWith(YOUTUBE_URL, 'en');
    expect(mockGenerateDeepDiveCombined).not.toHaveBeenCalled();
    expect(mockGenerateDeepDiveFromTranscript).not.toHaveBeenCalled();
    const content = fs.readFileSync(path.join(outputFolder, `${SUMMARY_BASE}-deep-dive.md`), 'utf-8');
    expect(content).toContain('Video-only analysis');
    expect(content).not.toContain('▶');
  });

  it('all paths fail → throws with all error messages', async () => {
    mockGenerateDeepDiveCombined.mockRejectedValueOnce(new Error('errCombined'));
    mockGenerateDeepDiveFromTranscript.mockRejectedValueOnce(new Error('errTranscript'));
    mockGenerateDeepDive.mockRejectedValueOnce(new Error('errVideo'));

    let caught: Error | undefined;
    try {
      await writeDeepDiveDoc(makeVideo(), outputFolder, () => {});
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).toBeDefined();
    expect(caught!.message).toContain('errCombined');
    expect(caught!.message).toContain('errTranscript');
    expect(caught!.message).toContain('errVideo');
    expect(fs.existsSync(path.join(outputFolder, `${SUMMARY_BASE}-deep-dive.md`))).toBe(false);
  });

  it('emits only step events — never start or done', async () => {
    const events: ProgressEvent[] = [];
    await writeDeepDiveDoc(makeVideo(), outputFolder, (e) => events.push(e));

    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.type === 'step')).toBe(true);
    expect(events.some((e) => e.type === 'start')).toBe(false);
    expect(events.some((e) => e.type === 'done')).toBe(false);
  });

  it('base uses summaryMd (minus .md) for the filename', async () => {
    const result = await writeDeepDiveDoc(makeVideo({ summaryMd: 'rank-007_my-vid.md' }), outputFolder, () => {});
    expect(result.deepDiveMd).toBe('rank-007_my-vid-deep-dive.md');
    expect(fs.existsSync(path.join(outputFolder, 'rank-007_my-vid-deep-dive.md'))).toBe(true);
  });

  it('summaryMd null → base = video.id → writes <id>-deep-dive.md', async () => {
    const result = await writeDeepDiveDoc(makeVideo({ summaryMd: null }), outputFolder, () => {});
    expect(result.deepDiveMd).toBe(`${VIDEO_ID}-deep-dive.md`);
    expect(fs.existsSync(path.join(outputFolder, `${VIDEO_ID}-deep-dive.md`))).toBe(true);
  });

  it('writes YAML frontmatter, H1 (Deep Dive) title, and metadata line', async () => {
    await writeDeepDiveDoc(makeVideo(), outputFolder, () => {});
    const content = fs.readFileSync(path.join(outputFolder, `${SUMMARY_BASE}-deep-dive.md`), 'utf-8');
    expect(content).toMatch(/^---\ntags:/);
    expect(content).toMatch(new RegExp(`video_id: "${VIDEO_ID}"`));
    expect(content).toMatch(/lang: EN/);
    expect(content).toMatch(/^# Test Video \(Deep Dive\)$/m);
    expect(content).toMatch(/\*\*Duration:\*\*/);
    expect(content).toMatch(/\*\*URL:\*\*/);
  });

  it('invalidates a stale cached deep-dive HTML for the same base', async () => {
    const htmlsDir = path.join(outputFolder, 'htmls');
    fs.mkdirSync(htmlsDir, { recursive: true });
    const stalePath = path.join(htmlsDir, `${SUMMARY_BASE}-deep-dive.html`);
    fs.writeFileSync(stalePath, '<html>old</html>', 'utf-8');

    await writeDeepDiveDoc(makeVideo(), outputFolder, () => {});

    expect(fs.existsSync(stalePath)).toBe(false);
  });
});
