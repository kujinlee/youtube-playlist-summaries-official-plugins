import crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ProgressEvent, VideoMeta, GeminiSummaryResponse } from '../../types';

jest.mock('../../lib/youtube');
jest.mock('../../lib/gemini');
jest.mock('../../lib/pdf');
jest.mock('../../lib/index-store');

import { runIngestion } from '../../lib/pipeline';
import * as youtube from '../../lib/youtube';
import * as gemini from '../../lib/gemini';
import * as pdf from '../../lib/pdf';
import * as indexStore from '../../lib/index-store';

const mockFetchPlaylistVideos = jest.mocked(youtube.fetchPlaylistVideos);
const mockFetchTranscript = jest.mocked(youtube.fetchTranscript);
const mockDetectLanguage = jest.mocked(youtube.detectLanguage);
const mockGenerateSummary = jest.mocked(gemini.generateSummary);
const mockGeneratePdf = jest.mocked(pdf.generatePdf);
const mockUpsertVideo = jest.mocked(indexStore.upsertVideo);
const mockAssertOutputFolder = jest.mocked(indexStore.assertOutputFolder);
const mockReadIndex = jest.mocked(indexStore.readIndex);
const mockWriteIndex = jest.mocked(indexStore.writeIndex);

const PLAYLIST_URL = 'https://youtube.com/playlist?list=PLtest';

// Use os.tmpdir() — assertOutputFolder is mocked so homedir restriction doesn't apply
function makeTempDir(): string {
  const dir = path.join(os.tmpdir(), `pipeline-test-${crypto.randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function makeVideoMeta(id: string): VideoMeta {
  return {
    videoId: id,
    title: `Video ${id}`,
    youtubeUrl: `https://youtube.com/watch?v=${id}`,
    durationSeconds: 300,
  };
}

function makeSummaryResponse(overrides: Partial<GeminiSummaryResponse> = {}): GeminiSummaryResponse {
  return {
    summary: 'A great summary',
    ratings: { usefulness: 3, depth: 3, originality: 3, recency: 3, completeness: 3 },
    overallScore: 3,
    ...overrides,
  };
}

describe('runIngestion', () => {
  let outputFolder: string;

  beforeEach(() => {
    outputFolder = makeTempDir();
    process.env.YOUTUBE_API_KEY = 'test-key';

    mockAssertOutputFolder.mockImplementation(() => {});
    mockDetectLanguage.mockReturnValue('en');
    mockGeneratePdf.mockResolvedValue(undefined);
    mockUpsertVideo.mockImplementation(() => {});
    mockReadIndex.mockReturnValue({ playlistUrl: '', outputFolder, videos: [] });
    mockWriteIndex.mockImplementation(() => {});
  });

  afterEach(() => {
    fs.rmSync(outputFolder, { recursive: true, force: true });
    jest.clearAllMocks();
  });

  it('emits start event first and done event last for a successful pipeline', async () => {
    mockFetchPlaylistVideos.mockResolvedValue([makeVideoMeta('vid1'), makeVideoMeta('vid2')]);
    mockFetchTranscript.mockResolvedValue('transcript');
    mockGenerateSummary.mockResolvedValue(makeSummaryResponse());

    const events: ProgressEvent[] = [];
    await runIngestion(PLAYLIST_URL, outputFolder, (e) => events.push(e));

    expect(events[0]).toMatchObject({ type: 'start', total: 2 });
    expect(events[events.length - 1]).toMatchObject({ type: 'done' });
    expect(events.some((e) => e.type === 'step' && 'videoId' in e && e.videoId === 'vid1')).toBe(true);
    expect(events.some((e) => e.type === 'step' && 'videoId' in e && e.videoId === 'vid2')).toBe(true);
    // Per-video completion event
    expect(events.some((e) => e.type === 'step' && 'step' in e && e.step === 'Saved' && 'videoId' in e && e.videoId === 'vid1')).toBe(true);
  });

  it('continues to next video when one video fails', async () => {
    mockFetchPlaylistVideos.mockResolvedValue([makeVideoMeta('vid1'), makeVideoMeta('vid2')]);
    mockFetchTranscript
      .mockRejectedValueOnce(new Error('No transcript available'))
      .mockResolvedValueOnce('transcript');
    mockGenerateSummary.mockResolvedValue(makeSummaryResponse());

    const events: ProgressEvent[] = [];
    await runIngestion(PLAYLIST_URL, outputFolder, (e) => events.push(e));

    const errorEvents = events.filter((e) => e.type === 'error');
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0]).toMatchObject({ type: 'error', videoId: 'vid1' });

    expect(mockUpsertVideo).toHaveBeenCalledTimes(1);
    expect(mockUpsertVideo).toHaveBeenCalledWith(outputFolder, expect.objectContaining({ id: 'vid2' }));
    expect(events[events.length - 1]).toMatchObject({ type: 'done' });
  });

  it('upserts all successfully processed videos to the index', async () => {
    mockFetchPlaylistVideos.mockResolvedValue([makeVideoMeta('vid1'), makeVideoMeta('vid2')]);
    mockFetchTranscript.mockResolvedValue('transcript');
    mockGenerateSummary.mockResolvedValue(makeSummaryResponse());

    await runIngestion(PLAYLIST_URL, outputFolder, () => {});

    expect(mockUpsertVideo).toHaveBeenCalledTimes(2);
    expect(mockUpsertVideo).toHaveBeenCalledWith(outputFolder, expect.objectContaining({ id: 'vid1' }));
    expect(mockUpsertVideo).toHaveBeenCalledWith(outputFolder, expect.objectContaining({ id: 'vid2' }));
  });

  it('stores overallScore from generateSummary in the index entry', async () => {
    const ratings = { usefulness: 4, depth: 3, originality: 5, recency: 2, completeness: 1 };
    const overallScore = (4 + 3 + 5 + 2 + 1) / 5; // 3
    mockFetchPlaylistVideos.mockResolvedValue([makeVideoMeta('vid1')]);
    mockFetchTranscript.mockResolvedValue('transcript');
    mockGenerateSummary.mockResolvedValue({ summary: 'S', ratings, overallScore });

    await runIngestion(PLAYLIST_URL, outputFolder, () => {});

    expect(mockUpsertVideo).toHaveBeenCalledWith(
      outputFolder,
      expect.objectContaining({ overallScore }),
    );
  });

  it('stamps playlistUrl into the index before processing videos', async () => {
    mockFetchPlaylistVideos.mockResolvedValue([]);
    mockReadIndex.mockReturnValue({ playlistUrl: '', outputFolder, videos: [] });

    await runIngestion(PLAYLIST_URL, outputFolder, () => {});

    expect(mockWriteIndex).toHaveBeenCalledWith(
      outputFolder,
      expect.objectContaining({ playlistUrl: PLAYLIST_URL }),
    );
  });
});
