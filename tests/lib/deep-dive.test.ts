import crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ProgressEvent, Video, PlaylistIndex } from '../../types';
import type { TranscriptSegment } from '../../lib/transcript-timestamps';

jest.mock('../../lib/gemini');
jest.mock('../../lib/youtube');
jest.mock('../../lib/index-store');
jest.mock('../../lib/pdf');

import { runDeepDive } from '../../lib/deep-dive';
import * as gemini from '../../lib/gemini';
import * as youtube from '../../lib/youtube';
import * as indexStore from '../../lib/index-store';
import * as pdf from '../../lib/pdf';

const mockGenerateDeepDive = jest.mocked(gemini.generateDeepDive);
const mockGenerateDeepDiveFromTranscript = jest.mocked(gemini.generateDeepDiveFromTranscript);
const mockGenerateDeepDiveCombined = jest.mocked(gemini.generateDeepDiveCombined);
const mockFetchTranscriptSegments = jest.mocked(youtube.fetchTranscriptSegments);
const mockReadIndex = jest.mocked(indexStore.readIndex);
const mockUpdateVideoFields = jest.mocked(indexStore.updateVideoFields);
const mockAssertOutputFolder = jest.mocked(indexStore.assertOutputFolder);
const mockAssertVideoId = jest.mocked(indexStore.assertVideoId);
const mockGeneratePdf = jest.mocked(pdf.generatePdf);

const VIDEO_ID = 'testVideoId1';
const YOUTUBE_URL = `https://youtube.com/watch?v=${VIDEO_ID}`;
const SEGMENTS: TranscriptSegment[] = [
  { text: 'transcript text', offset: 0, duration: 30 },
];

function makeTempDir(): string {
  const dir = path.join(os.tmpdir(), `deep-dive-test-${crypto.randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const SUMMARY_BASE = '001_test-video';

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

function makeIndex(outputFolder: string): PlaylistIndex {
  return {
    playlistUrl: 'https://youtube.com/playlist?list=PLtest',
    outputFolder,
    videos: [makeVideo()],
  };
}

describe('runDeepDive', () => {
  let outputFolder: string;

  beforeEach(() => {
    outputFolder = makeTempDir();

    mockAssertOutputFolder.mockImplementation(() => {});
    mockAssertVideoId.mockImplementation(() => {});
    mockReadIndex.mockReturnValue(makeIndex(outputFolder));
    mockUpdateVideoFields.mockImplementation(() => {});
    mockGenerateDeepDiveCombined.mockResolvedValue('# Deep Dive (combined)\n\nCombined analysis here.');
    mockGenerateDeepDive.mockResolvedValue('# Deep Dive\n\nDetailed analysis here.');
    mockGenerateDeepDiveFromTranscript.mockResolvedValue('# Deep Dive (transcript)\n\nFallback analysis.');
    mockFetchTranscriptSegments.mockResolvedValue(SEGMENTS);
    mockGeneratePdf.mockResolvedValue(undefined);
  });

  afterEach(() => {
    fs.rmSync(outputFolder, { recursive: true, force: true });
    jest.clearAllMocks();
  });

  it('emits start event first and done event last', async () => {
    const events: ProgressEvent[] = [];
    await runDeepDive(VIDEO_ID, outputFolder, (e) => events.push(e));

    expect(events[0]).toMatchObject({ type: 'start' });
    expect(events[events.length - 1]).toMatchObject({ type: 'done' });
  });

  it('emits at least one step event between start and done', async () => {
    const events: ProgressEvent[] = [];
    await runDeepDive(VIDEO_ID, outputFolder, (e) => events.push(e));

    const stepEvents = events.filter((e) => e.type === 'step');
    expect(stepEvents.length).toBeGreaterThan(0);
  });

  // ── Routing rows ─────────────────────────────────────────────────────────────

  it('row 1 — transcript + combined succeed → combined used, transcript-only and video NOT called', async () => {
    await runDeepDive(VIDEO_ID, outputFolder, () => {});

    expect(mockFetchTranscriptSegments).toHaveBeenCalledWith(VIDEO_ID);
    expect(mockGenerateDeepDiveCombined).toHaveBeenCalled();
    expect(mockGenerateDeepDiveFromTranscript).not.toHaveBeenCalled();
    expect(mockGenerateDeepDive).not.toHaveBeenCalled();
  });

  it('row 2 — combined fails, transcript-only succeeds → falls back to generateDeepDiveFromTranscript', async () => {
    mockGenerateDeepDiveCombined.mockRejectedValueOnce(new Error('combined failed'));

    await runDeepDive(VIDEO_ID, outputFolder, () => {});

    expect(mockFetchTranscriptSegments).toHaveBeenCalledWith(VIDEO_ID);
    expect(mockGenerateDeepDiveCombined).toHaveBeenCalled();
    expect(mockGenerateDeepDiveFromTranscript).toHaveBeenCalledWith(SEGMENTS, 'en', VIDEO_ID);
    expect(mockGenerateDeepDive).not.toHaveBeenCalled();
  });

  it('row 3 — combined + transcript-only fail, video-only succeeds → falls back to generateDeepDive', async () => {
    mockGenerateDeepDiveCombined.mockRejectedValueOnce(new Error('too large'));
    mockGenerateDeepDiveFromTranscript.mockRejectedValueOnce(new Error('still too large'));

    await runDeepDive(VIDEO_ID, outputFolder, () => {});

    expect(mockGenerateDeepDive).toHaveBeenCalledWith(YOUTUBE_URL, 'en');
  });

  it('row 4 — all three generators fail → throws with all three error messages', async () => {
    mockGenerateDeepDiveCombined.mockRejectedValueOnce(new Error('errCombined'));
    mockGenerateDeepDiveFromTranscript.mockRejectedValueOnce(new Error('errTranscript'));
    mockGenerateDeepDive.mockRejectedValueOnce(new Error('errVideo'));

    let caught: Error | undefined;
    try {
      await runDeepDive(VIDEO_ID, outputFolder, () => {});
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).toBeDefined();
    expect(caught!.message).toContain('errCombined');
    expect(caught!.message).toContain('errTranscript');
    expect(caught!.message).toContain('errVideo');
  });

  it('row 5 — no transcript (fetch throws) → video-only used directly, combined not called', async () => {
    mockFetchTranscriptSegments.mockRejectedValueOnce(new Error('no captions'));

    await runDeepDive(VIDEO_ID, outputFolder, () => {});

    expect(mockGenerateDeepDive).toHaveBeenCalledWith(YOUTUBE_URL, 'en');
    expect(mockGenerateDeepDiveCombined).not.toHaveBeenCalled();
    expect(mockGenerateDeepDiveFromTranscript).not.toHaveBeenCalled();
  });

  it('row 6 — no transcript and video-only also fails → throws with both errors', async () => {
    mockFetchTranscriptSegments.mockRejectedValueOnce(new Error('no captions'));
    mockGenerateDeepDive.mockRejectedValueOnce(new Error('video quota exceeded'));

    let err: unknown;
    try { await runDeepDive(VIDEO_ID, outputFolder, () => {}); } catch (e) { err = e; }
    expect(String((err as Error).message)).toContain('no captions');
    expect(String((err as Error).message)).toContain('video quota exceeded');
  });

  // ── Progress step assertions ──────────────────────────────────────────────────

  it('emits transcript fetch step with current=1, total=3', async () => {
    const events: ProgressEvent[] = [];
    await runDeepDive(VIDEO_ID, outputFolder, (e) => events.push(e));

    const transcriptStep = events.find(
      (e) => e.type === 'step' && 'step' in e && e.step.includes('transcript'),
    );
    expect(transcriptStep).toMatchObject({ type: 'step', current: 1, total: 3 });
  });

  it('emits generation step with current=2, total=3', async () => {
    const events: ProgressEvent[] = [];
    await runDeepDive(VIDEO_ID, outputFolder, (e) => events.push(e));

    const genStep = events.find(
      (e) => e.type === 'step' && 'step' in e && e.step.includes('Generating'),
    );
    expect(genStep).toMatchObject({ type: 'step', current: 2, total: 3 });
  });

  it('emits PDF step with current=3, total=3', async () => {
    const events: ProgressEvent[] = [];
    await runDeepDive(VIDEO_ID, outputFolder, (e) => events.push(e));

    const pdfStep = events.find((e) => e.type === 'step' && 'step' in e && e.step.includes('PDF'));
    expect(pdfStep).toMatchObject({ type: 'step', current: 3, total: 3 });
  });

  it('surfaces the chosen mode in a step on the combined happy path', async () => {
    const events: ProgressEvent[] = [];
    await runDeepDive(VIDEO_ID, outputFolder, (e) => events.push(e));

    const modeStep = events.find(
      (e) => e.type === 'step' && 'step' in e && e.step.includes('(combined)'),
    );
    expect(modeStep).toBeDefined();
  });

  it('surfaces the chosen mode in a step on the no-transcript → video path', async () => {
    mockFetchTranscriptSegments.mockRejectedValueOnce(new Error('no captions'));

    const events: ProgressEvent[] = [];
    await runDeepDive(VIDEO_ID, outputFolder, (e) => events.push(e));

    const modeStep = events.find(
      (e) => e.type === 'step' && 'step' in e && e.step.includes('(video)'),
    );
    expect(modeStep).toBeDefined();
  });

  // ── Index update ──────────────────────────────────────────────────────────────

  it('updates index with deepDiveMd and deepDivePdf after success', async () => {
    await runDeepDive(VIDEO_ID, outputFolder, () => {});

    expect(mockUpdateVideoFields).toHaveBeenCalledWith(
      outputFolder,
      VIDEO_ID,
      expect.objectContaining({
        deepDiveMd: `${SUMMARY_BASE}-deep-dive.md`,
        deepDivePdf: `pdfs/${SUMMARY_BASE}-deep-dive.pdf`,
      }),
    );
  });

  it('updates index with deepDiveMd and deepDivePdf after transcript-only fallback', async () => {
    mockGenerateDeepDiveCombined.mockRejectedValueOnce(new Error('combined failed'));

    await runDeepDive(VIDEO_ID, outputFolder, () => {});

    expect(mockUpdateVideoFields).toHaveBeenCalledWith(
      outputFolder,
      VIDEO_ID,
      expect.objectContaining({
        deepDiveMd: `${SUMMARY_BASE}-deep-dive.md`,
        deepDivePdf: `pdfs/${SUMMARY_BASE}-deep-dive.pdf`,
      }),
    );
  });

  // ── Guard rails ───────────────────────────────────────────────────────────────

  it('throws when videoId is not found in the index', async () => {
    mockReadIndex.mockReturnValue({ ...makeIndex(outputFolder), videos: [] });

    await expect(runDeepDive(VIDEO_ID, outputFolder, () => {})).rejects.toThrow(
      `Video not found in index: ${VIDEO_ID}`,
    );
  });

  // ── Written MD file ───────────────────────────────────────────────────────────

  it('written MD file has YAML frontmatter with video_id and lang', async () => {
    await runDeepDive(VIDEO_ID, outputFolder, () => {});

    const content = fs.readFileSync(path.join(outputFolder, `${SUMMARY_BASE}-deep-dive.md`), 'utf-8');
    expect(content).toMatch(/^---\ntags:/);
    expect(content).toMatch(new RegExp(`video_id: "${VIDEO_ID}"`));
    expect(content).toMatch(/lang: EN/);
  });

  it('written MD file H1 is the video title with (Deep Dive) suffix', async () => {
    await runDeepDive(VIDEO_ID, outputFolder, () => {});

    const content = fs.readFileSync(path.join(outputFolder, `${SUMMARY_BASE}-deep-dive.md`), 'utf-8');
    expect(content).toMatch(/^# Test Video \(Deep Dive\)$/m);
  });

  it('written MD file has metadata line with Duration and URL', async () => {
    await runDeepDive(VIDEO_ID, outputFolder, () => {});

    const content = fs.readFileSync(path.join(outputFolder, `${SUMMARY_BASE}-deep-dive.md`), 'utf-8');
    expect(content).toMatch(/\*\*Duration:\*\*/);
    expect(content).toMatch(/\*\*URL:\*\*/);
  });

  it('strips Gemini-generated leading H1 from the body', async () => {
    mockGenerateDeepDiveCombined.mockResolvedValueOnce('# Gemini Generated Title\n\nActual body content.');

    await runDeepDive(VIDEO_ID, outputFolder, () => {});

    const content = fs.readFileSync(path.join(outputFolder, `${SUMMARY_BASE}-deep-dive.md`), 'utf-8');
    expect(content).not.toMatch(/# Gemini Generated Title/);
    expect(content).toContain('Actual body content.');
  });

  it('falls back to videoId base when summaryMd is null', async () => {
    mockReadIndex.mockReturnValue({
      ...makeIndex(outputFolder),
      videos: [makeVideo({ summaryMd: null })],
    });

    await runDeepDive(VIDEO_ID, outputFolder, () => {});

    expect(mockUpdateVideoFields).toHaveBeenCalledWith(
      outputFolder,
      VIDEO_ID,
      expect.objectContaining({
        deepDiveMd: `${VIDEO_ID}-deep-dive.md`,
        deepDivePdf: `pdfs/${VIDEO_ID}-deep-dive.pdf`,
      }),
    );
  });
});
