import crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ProgressEvent, Video, PlaylistIndex } from '../../types';

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
const mockFetchTranscript = jest.mocked(youtube.fetchTranscript);
const mockReadIndex = jest.mocked(indexStore.readIndex);
const mockUpdateVideoFields = jest.mocked(indexStore.updateVideoFields);
const mockAssertOutputFolder = jest.mocked(indexStore.assertOutputFolder);
const mockAssertVideoId = jest.mocked(indexStore.assertVideoId);
const mockGeneratePdf = jest.mocked(pdf.generatePdf);

const VIDEO_ID = 'testVideoId1';
const YOUTUBE_URL = `https://youtube.com/watch?v=${VIDEO_ID}`;

function makeTempDir(): string {
  const dir = path.join(os.tmpdir(), `deep-dive-test-${crypto.randomUUID()}`);
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
    summaryMd: `${VIDEO_ID}.md`,
    summaryPdf: `${VIDEO_ID}.pdf`,
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
    mockGenerateDeepDive.mockResolvedValue('# Deep Dive\n\nDetailed analysis here.');
    mockGenerateDeepDiveFromTranscript.mockResolvedValue('# Deep Dive (transcript)\n\nFallback analysis.');
    mockFetchTranscript.mockResolvedValue('transcript text');
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

  it('calls generateDeepDive with youtube URL on happy path and does not fetch transcript', async () => {
    await runDeepDive(VIDEO_ID, outputFolder, () => {});

    expect(mockGenerateDeepDive).toHaveBeenCalledWith(YOUTUBE_URL, 'en');
    expect(mockFetchTranscript).not.toHaveBeenCalled();
  });

  it('emits a step event recording mode: url on url success', async () => {
    const events: ProgressEvent[] = [];
    await runDeepDive(VIDEO_ID, outputFolder, (e) => events.push(e));

    expect(
      events.some((e) => e.type === 'step' && 'step' in e && e.step.includes('mode: url')),
    ).toBe(true);
  });

  it('on Gemini URL failure, fetches transcript and uses transcript-based deep-dive', async () => {
    mockGenerateDeepDive.mockRejectedValueOnce(new Error('Gemini deep-dive failed: URL not supported'));

    await runDeepDive(VIDEO_ID, outputFolder, () => {});

    expect(mockFetchTranscript).toHaveBeenCalledWith(VIDEO_ID);
    expect(mockGenerateDeepDiveFromTranscript).toHaveBeenCalledWith('transcript text', 'en');
  });

  it('emits a step event recording mode: transcript-fallback when fallback is used', async () => {
    mockGenerateDeepDive.mockRejectedValueOnce(new Error('Gemini deep-dive failed: URL not supported'));

    const events: ProgressEvent[] = [];
    await runDeepDive(VIDEO_ID, outputFolder, (e) => events.push(e));

    expect(
      events.some((e) => e.type === 'step' && 'step' in e && e.step.includes('mode: transcript-fallback')),
    ).toBe(true);
  });

  it('updates index with deepDiveMd and deepDivePdf after success', async () => {
    await runDeepDive(VIDEO_ID, outputFolder, () => {});

    expect(mockUpdateVideoFields).toHaveBeenCalledWith(
      outputFolder,
      VIDEO_ID,
      expect.objectContaining({
        deepDiveMd: `${VIDEO_ID}-deep-dive.md`,
        deepDivePdf: `${VIDEO_ID}-deep-dive.pdf`,
      }),
    );
  });

  it('throws when videoId is not found in the index', async () => {
    mockReadIndex.mockReturnValue({ ...makeIndex(outputFolder), videos: [] });

    await expect(runDeepDive(VIDEO_ID, outputFolder, () => {})).rejects.toThrow(
      `Video not found in index: ${VIDEO_ID}`,
    );
  });

  it('wraps both errors when URL and transcript generation both fail', async () => {
    mockGenerateDeepDive.mockRejectedValueOnce(new Error('URL not supported'));
    mockGenerateDeepDiveFromTranscript.mockRejectedValueOnce(new Error('Transcript too long'));

    await expect(runDeepDive(VIDEO_ID, outputFolder, () => {})).rejects.toThrow(
      'URL not supported',
    );
  });

  it('preserves URL error when fetchTranscript fails during fallback', async () => {
    mockGenerateDeepDive.mockRejectedValueOnce(new Error('URL quota exceeded'));
    mockFetchTranscript.mockRejectedValueOnce(new Error('No captions available'));

    await expect(runDeepDive(VIDEO_ID, outputFolder, () => {})).rejects.toThrow(
      'URL quota exceeded',
    );
  });

  it('updates index with deepDiveMd and deepDivePdf after fallback success', async () => {
    mockGenerateDeepDive.mockRejectedValueOnce(new Error('Gemini deep-dive failed: URL not supported'));

    await runDeepDive(VIDEO_ID, outputFolder, () => {});

    expect(mockUpdateVideoFields).toHaveBeenCalledWith(
      outputFolder,
      VIDEO_ID,
      expect.objectContaining({
        deepDiveMd: `${VIDEO_ID}-deep-dive.md`,
        deepDivePdf: `${VIDEO_ID}-deep-dive.pdf`,
      }),
    );
  });
});
