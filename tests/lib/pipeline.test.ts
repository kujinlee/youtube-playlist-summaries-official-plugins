import crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ProgressEvent, Video, VideoMeta, GeminiSummaryResponse } from '../../types';

jest.mock('../../lib/youtube');
jest.mock('../../lib/gemini');
jest.mock('../../lib/pdf');
jest.mock('../../lib/index-store');
jest.mock('../../lib/html-doc/generate');

import { runIngestion, slugify, formatDuration, parseFrontmatterField, reconstructVideo, recoverOrphanedVideos, insertQuickViewCallout, stripQuickViewCallout, writeSummaryDoc } from '../../lib/pipeline';
import * as fsReal from 'fs';
import * as youtube from '../../lib/youtube';
import * as gemini from '../../lib/gemini';
import * as pdf from '../../lib/pdf';
import * as indexStore from '../../lib/index-store';
import * as htmlDocGenerate from '../../lib/html-doc/generate';

const mockFetchPlaylistVideos = jest.mocked(youtube.fetchPlaylistVideos);
const mockFetchTranscriptSegments = jest.mocked(youtube.fetchTranscriptSegments);
const mockDetectLanguage = jest.mocked(youtube.detectLanguage);
const mockGenerateSummary = jest.mocked(gemini.generateSummary);
const mockTranscribeViaGemini = jest.mocked(gemini.transcribeViaGemini);
const mockExtractQuickView = jest.mocked(gemini.extractQuickView);
const mockGeneratePdf = jest.mocked(pdf.generatePdf);
const mockUpsertVideo = jest.mocked(indexStore.upsertVideo);
const mockAssertOutputFolder = jest.mocked(indexStore.assertOutputFolder);
const mockReadIndex = jest.mocked(indexStore.readIndex);
const mockWriteIndex = jest.mocked(indexStore.writeIndex);
const mockRunHtmlDoc = jest.mocked(htmlDocGenerate.runHtmlDoc);

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
    tldr: 'This video explains the topic.',
    takeaways: ['Point one', 'Point two'],
    ...overrides,
  };
}

function makeIndexedVideo(id: string, overrides: Partial<Video> = {}): Video {
  return {
    id,
    title: `Video ${id}`,
    youtubeUrl: `https://youtube.com/watch?v=${id}`,
    language: 'en',
    durationSeconds: 300,
    archived: false,
    ratings: { usefulness: 3, depth: 3, originality: 3, recency: 3, completeness: 3 },
    overallScore: 3,
    summaryMd: `001_video-${id}.md`,
    summaryPdf: `001_video-${id}.pdf`,
    deepDiveMd: null,
    deepDivePdf: null,
    processedAt: new Date().toISOString(),
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
    mockExtractQuickView.mockResolvedValue({ tldr: 'QV tldr', takeaways: ['qa', 'qb'] });
    mockRunHtmlDoc.mockResolvedValue(undefined);
  });

  afterEach(() => {
    fs.rmSync(outputFolder, { recursive: true, force: true });
    jest.clearAllMocks();
    delete process.env.PREGEN_SUMMARY_HTML;
  });

  it('emits start event first and done event last for a successful pipeline', async () => {
    mockFetchPlaylistVideos.mockResolvedValue([makeVideoMeta('vid1'), makeVideoMeta('vid2')]);
    mockFetchTranscriptSegments.mockResolvedValue([{ text: 'transcript', offset: 0, duration: 5 }]);
    mockGenerateSummary.mockResolvedValue(makeSummaryResponse());

    const events: ProgressEvent[] = [];
    await runIngestion(PLAYLIST_URL, outputFolder, (e) => events.push(e));

    expect(events[0]).toMatchObject({ type: 'start', total: 2 });
    expect(events[events.length - 1]).toMatchObject({ type: 'done' });
    expect(events.some((e) => e.type === 'step' && 'videoId' in e && e.videoId === 'vid1')).toBe(true);
    expect(events.some((e) => e.type === 'step' && 'videoId' in e && e.videoId === 'vid2')).toBe(true);
    // Per-video completion event
    expect(events.some((e) => e.type === 'step' && 'step' in e && e.step === 'Saved' && 'videoId' in e && e.videoId === 'vid1')).toBe(true);
    // PDF generation should not be called
    expect(mockGeneratePdf).not.toHaveBeenCalled();
  });

  it('continues to next video when one video fails', async () => {
    mockFetchPlaylistVideos.mockResolvedValue([makeVideoMeta('vid1'), makeVideoMeta('vid2')]);
    mockFetchTranscriptSegments
      .mockRejectedValueOnce(new Error('No transcript available'))
      .mockResolvedValueOnce([{ text: 'transcript', offset: 0, duration: 5 }]);
    mockTranscribeViaGemini.mockRejectedValue(new Error('Gemini unavailable')); // vid1: both sources fail → error; vid2 uses captions so Gemini is never reached
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
    mockFetchTranscriptSegments.mockResolvedValue([{ text: 'transcript', offset: 0, duration: 5 }]);
    mockGenerateSummary.mockResolvedValue(makeSummaryResponse());

    await runIngestion(PLAYLIST_URL, outputFolder, () => {});

    expect(mockUpsertVideo).toHaveBeenCalledTimes(2);
    expect(mockUpsertVideo).toHaveBeenCalledWith(outputFolder, expect.objectContaining({ id: 'vid1' }));
    expect(mockUpsertVideo).toHaveBeenCalledWith(outputFolder, expect.objectContaining({ id: 'vid2' }));
  });

  it('stores overallScore from generateSummary in the index entry', async () => {
    const ratings = { usefulness: 4, depth: 3, originality: 5, recency: 2, completeness: 1 } as const;
    const overallScore = (4 + 3 + 5 + 2 + 1) / 5; // 3
    mockFetchPlaylistVideos.mockResolvedValue([makeVideoMeta('vid1')]);
    mockFetchTranscriptSegments.mockResolvedValue([{ text: 'transcript', offset: 0, duration: 5 }]);
    mockGenerateSummary.mockResolvedValue({ summary: 'S', ratings, overallScore });

    await runIngestion(PLAYLIST_URL, outputFolder, () => {});

    expect(mockUpsertVideo).toHaveBeenCalledWith(
      outputFolder,
      expect.objectContaining({ overallScore }),
    );
  });

  it('stores videoType and audience from generateSummary in the index entry', async () => {
    mockFetchPlaylistVideos.mockResolvedValue([makeVideoMeta('vid1')]);
    mockFetchTranscriptSegments.mockResolvedValue([{ text: 'transcript', offset: 0, duration: 5 }]);
    mockGenerateSummary.mockResolvedValue(
      makeSummaryResponse({ videoType: 'Tutorial', audience: 'Advanced' }),
    );

    await runIngestion(PLAYLIST_URL, outputFolder, () => {});

    expect(mockUpsertVideo).toHaveBeenCalledWith(
      outputFolder,
      expect.objectContaining({ videoType: 'Tutorial', audience: 'Advanced' }),
    );
  });

  it('omits videoType and audience from index entry when generateSummary does not return them', async () => {
    mockFetchPlaylistVideos.mockResolvedValue([makeVideoMeta('vid1')]);
    mockFetchTranscriptSegments.mockResolvedValue([{ text: 'transcript', offset: 0, duration: 5 }]);
    mockGenerateSummary.mockResolvedValue(makeSummaryResponse());

    await runIngestion(PLAYLIST_URL, outputFolder, () => {});

    const call = mockUpsertVideo.mock.calls[0][1];
    expect(call.videoType).toBeUndefined();
    expect(call.audience).toBeUndefined();
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

  it('assigns serialNumber=1 and prefixes filenames for the first ingested video', async () => {
    // Arrange: empty index (default mockReadIndex already returns { videos: [] })
    const meta = { ...makeVideoMeta('vid1'), title: 'Hello World' };
    mockFetchPlaylistVideos.mockResolvedValue([meta]);
    mockFetchTranscriptSegments.mockResolvedValue([{ text: 'transcript', offset: 0, duration: 5 }]);
    mockGenerateSummary.mockResolvedValue(makeSummaryResponse());

    await runIngestion(PLAYLIST_URL, outputFolder, () => {});

    expect(mockUpsertVideo).toHaveBeenCalledWith(
      outputFolder,
      expect.objectContaining({ serialNumber: 1, summaryMd: '001_hello-world.md' }),
    );
  });

  it('continues from max+1 when the index already has serials', async () => {
    // Arrange: seed index with a video that has serialNumber 41
    const existingVid = makeIndexedVideo('vid0', { serialNumber: 41 });
    mockReadIndex.mockReturnValue({ playlistUrl: PLAYLIST_URL, outputFolder, videos: [existingVid] });

    const meta = { ...makeVideoMeta('vid1'), title: 'Hello World' };
    mockFetchPlaylistVideos.mockResolvedValue([makeVideoMeta('vid0'), meta]);
    mockFetchTranscriptSegments.mockResolvedValue([{ text: 'transcript', offset: 0, duration: 5 }]);
    mockGenerateSummary.mockResolvedValue(makeSummaryResponse());

    await runIngestion(PLAYLIST_URL, outputFolder, () => {});

    expect(mockUpsertVideo).toHaveBeenCalledWith(
      outputFolder,
      expect.objectContaining({ serialNumber: 42, summaryMd: '042_hello-world.md' }),
    );
  });

  it('uses serial-prefixed filename for the video', async () => {
    const meta = { ...makeVideoMeta('vid1'), title: 'Hello World' };
    mockFetchPlaylistVideos.mockResolvedValue([meta]);
    mockFetchTranscriptSegments.mockResolvedValue([{ text: 'transcript', offset: 0, duration: 5 }]);
    mockGenerateSummary.mockResolvedValue(makeSummaryResponse());

    await runIngestion(PLAYLIST_URL, outputFolder, () => {});

    expect(mockUpsertVideo).toHaveBeenCalledWith(
      outputFolder,
      expect.objectContaining({
        summaryMd: '001_hello-world.md',
        summaryPdf: null,
      }),
    );
  });

  it('increments serialNumber for each new video within the same run (stateful mock)', async () => {
    // Arrange: stateful in-memory store so the second readIndex call sees the first upserted video.
    const inMemoryVideos: Video[] = [];
    mockUpsertVideo.mockImplementation((_folder: string, video: Video) => {
      const idx = inMemoryVideos.findIndex((v) => v.id === video.id);
      if (idx >= 0) {
        inMemoryVideos[idx] = video;
      } else {
        inMemoryVideos.push(video);
      }
    });
    mockReadIndex.mockImplementation(() => ({
      playlistUrl: PLAYLIST_URL,
      outputFolder,
      videos: [...inMemoryVideos],
    }));

    const meta1 = { ...makeVideoMeta('vid1'), title: 'Alpha Video' };
    const meta2 = { ...makeVideoMeta('vid2'), title: 'Beta Video' };
    mockFetchPlaylistVideos.mockResolvedValue([meta1, meta2]);
    mockFetchTranscriptSegments.mockResolvedValue([{ text: 'transcript', offset: 0, duration: 5 }]);
    mockGenerateSummary.mockResolvedValue(makeSummaryResponse());

    await runIngestion(PLAYLIST_URL, outputFolder, () => {});

    expect(mockUpsertVideo).toHaveBeenCalledWith(
      outputFolder,
      expect.objectContaining({ id: 'vid1', serialNumber: 1, summaryMd: '001_alpha-video.md' }),
    );
    expect(mockUpsertVideo).toHaveBeenCalledWith(
      outputFolder,
      expect.objectContaining({ id: 'vid2', serialNumber: 2, summaryMd: '002_beta-video.md' }),
    );
  });

  it('appends -2 suffix when serial-prefixed slug filename already exists on disk', async () => {
    // Simulate a pre-existing file with the same serial-prefixed slug
    fs.writeFileSync(path.join(outputFolder, '001_hello-world.md'), 'existing content');

    const meta = { ...makeVideoMeta('vid1'), title: 'Hello World' };
    mockFetchPlaylistVideos.mockResolvedValue([meta]);
    mockFetchTranscriptSegments.mockResolvedValue([{ text: 'transcript', offset: 0, duration: 5 }]);
    mockGenerateSummary.mockResolvedValue(makeSummaryResponse());

    await runIngestion(PLAYLIST_URL, outputFolder, () => {});

    expect(mockUpsertVideo).toHaveBeenCalledWith(
      outputFolder,
      expect.objectContaining({
        summaryMd: '001_hello-world-2.md',
        summaryPdf: null,
      }),
    );
  });

  it('writes markdown file starting with YAML frontmatter (--- tags:)', async () => {
    const meta = { ...makeVideoMeta('vid1'), title: 'Test Video', channelTitle: 'Test Channel' };
    mockFetchPlaylistVideos.mockResolvedValue([meta]);
    mockFetchTranscriptSegments.mockResolvedValue([{ text: 'transcript', offset: 0, duration: 5 }]);
    mockGenerateSummary.mockResolvedValue(
      makeSummaryResponse({ videoType: 'Tutorial', audience: 'Beginner', tags: ['ml', 'python'] }),
    );

    await runIngestion(PLAYLIST_URL, outputFolder, () => {});

    const files = fs.readdirSync(outputFolder).filter((f) => f.endsWith('.md'));
    expect(files).toHaveLength(1);
    const content = fs.readFileSync(path.join(outputFolder, files[0]), 'utf-8');
    expect(content).toMatch(/^---\ntags:/);
    expect(content).toMatch(/video_id: "vid1"/);
    expect(content).toMatch(/channel: "Test Channel"/);
    expect(content).toMatch(/lang: EN/);
    expect(content).toMatch(/type: Tutorial/);
    expect(content).toMatch(/audience: Beginner/);
    expect(content).toMatch(/score:/);
  });

  it('omits channel line from frontmatter when channelTitle is absent', async () => {
    const meta = makeVideoMeta('vid1');
    mockFetchPlaylistVideos.mockResolvedValue([meta]);
    mockFetchTranscriptSegments.mockResolvedValue([{ text: 'transcript', offset: 0, duration: 5 }]);
    mockGenerateSummary.mockResolvedValue(makeSummaryResponse());

    await runIngestion(PLAYLIST_URL, outputFolder, () => {});

    const files = fs.readdirSync(outputFolder).filter((f) => f.endsWith('.md'));
    const content = fs.readFileSync(path.join(outputFolder, files[0]), 'utf-8');
    expect(content).not.toMatch(/^channel:/m);
  });

  it('always includes video-summary structural tag in frontmatter', async () => {
    const meta = makeVideoMeta('vid1');
    mockFetchPlaylistVideos.mockResolvedValue([meta]);
    mockFetchTranscriptSegments.mockResolvedValue([{ text: 'transcript', offset: 0, duration: 5 }]);
    mockGenerateSummary.mockResolvedValue(makeSummaryResponse());

    await runIngestion(PLAYLIST_URL, outputFolder, () => {});

    const files = fs.readdirSync(outputFolder).filter((f) => f.endsWith('.md'));
    const content = fs.readFileSync(path.join(outputFolder, files[0]), 'utf-8');
    expect(content).toMatch(/- video-summary/);
  });

  it('stores channel and tags from generateSummary in the index entry', async () => {
    const meta = { ...makeVideoMeta('vid1'), channelTitle: 'MyChannel' };
    mockFetchPlaylistVideos.mockResolvedValue([meta]);
    mockFetchTranscriptSegments.mockResolvedValue([{ text: 'transcript', offset: 0, duration: 5 }]);
    mockGenerateSummary.mockResolvedValue(makeSummaryResponse({ tags: ['react', 'hooks'] }));

    await runIngestion(PLAYLIST_URL, outputFolder, () => {});

    expect(mockUpsertVideo).toHaveBeenCalledWith(
      outputFolder,
      expect.objectContaining({ channel: 'MyChannel', tags: ['react', 'hooks'] }),
    );
  });

  it('auto-archives and flags a video removed from the current playlist', async () => {
    const vid1 = makeIndexedVideo('vid1');
    const vid2 = makeIndexedVideo('vid2'); // not removedFromPlaylist, not archived
    mockReadIndex.mockReturnValue({ playlistUrl: PLAYLIST_URL, outputFolder, videos: [vid1, vid2] });
    mockFetchPlaylistVideos.mockResolvedValue([makeVideoMeta('vid1')]); // vid2 gone from playlist

    await runIngestion(PLAYLIST_URL, outputFolder, () => {});

    expect(mockUpsertVideo).toHaveBeenCalledWith(
      outputFolder,
      expect.objectContaining({ id: 'vid2', archived: true, removedFromPlaylist: true }),
    );
    expect(mockUpsertVideo).not.toHaveBeenCalledWith(
      outputFolder,
      expect.objectContaining({ id: 'vid1', removedFromPlaylist: true }),
    );
  });

  it('does not re-archive a removed video the user has manually un-archived', async () => {
    const vid1 = makeIndexedVideo('vid1');
    // User un-archived vid2 (archived:false) but it's still gone from the playlist (removedFromPlaylist:true)
    const vid2 = makeIndexedVideo('vid2', { archived: false, removedFromPlaylist: true });
    mockReadIndex.mockReturnValue({ playlistUrl: PLAYLIST_URL, outputFolder, videos: [vid1, vid2] });
    mockFetchPlaylistVideos.mockResolvedValue([makeVideoMeta('vid1')]); // vid2 still not in playlist

    await runIngestion(PLAYLIST_URL, outputFolder, () => {});

    expect(mockUpsertVideo).not.toHaveBeenCalledWith(
      outputFolder,
      expect.objectContaining({ id: 'vid2', archived: true }),
    );
  });

  it('un-archives AND clears the flag when an auto-archived video returns to the playlist', async () => {
    const vid1 = makeIndexedVideo('vid1');
    // Auto-archived earlier (archived + removedFromPlaylist), now back in the playlist.
    const vid2 = makeIndexedVideo('vid2', { archived: true, removedFromPlaylist: true });
    mockReadIndex.mockReturnValue({ playlistUrl: PLAYLIST_URL, outputFolder, videos: [vid1, vid2] });
    mockFetchPlaylistVideos.mockResolvedValue([makeVideoMeta('vid1'), makeVideoMeta('vid2')]); // vid2 is back

    await runIngestion(PLAYLIST_URL, outputFolder, () => {});

    // Returning to the playlist must restore visibility, not just clear the flag.
    expect(mockUpsertVideo).toHaveBeenCalledWith(
      outputFolder,
      expect.objectContaining({ id: 'vid2', archived: false, removedFromPlaylist: false }),
    );
  });

  it('stamps 1-based playlistIndex on new videos based on playlist order', async () => {
    mockFetchPlaylistVideos.mockResolvedValue([makeVideoMeta('vid1'), makeVideoMeta('vid2'), makeVideoMeta('vid3')]);
    mockFetchTranscriptSegments.mockResolvedValue([{ text: 'transcript', offset: 0, duration: 5 }]);
    mockGenerateSummary.mockResolvedValue(makeSummaryResponse());

    await runIngestion(PLAYLIST_URL, outputFolder, () => {});

    expect(mockUpsertVideo).toHaveBeenCalledWith(
      outputFolder,
      expect.objectContaining({ id: 'vid1', playlistIndex: 1 }),
    );
    expect(mockUpsertVideo).toHaveBeenCalledWith(
      outputFolder,
      expect.objectContaining({ id: 'vid2', playlistIndex: 2 }),
    );
    expect(mockUpsertVideo).toHaveBeenCalledWith(
      outputFolder,
      expect.objectContaining({ id: 'vid3', playlistIndex: 3 }),
    );
  });

  it('stamps playlistIndex on already-indexed videos via reconciliation writeIndex call', async () => {
    const existingVid1 = makeIndexedVideo('vid1');
    const existingVid2 = makeIndexedVideo('vid2');
    mockReadIndex.mockReturnValue({
      playlistUrl: PLAYLIST_URL,
      outputFolder,
      videos: [existingVid1, existingVid2],
    });
    mockFetchPlaylistVideos.mockResolvedValue([makeVideoMeta('vid1'), makeVideoMeta('vid2')]);

    await runIngestion(PLAYLIST_URL, outputFolder, () => {});

    // Already-indexed: upsertVideo not called for processing (only potentially for removed-reconciliation)
    // writeIndex must be called at the end with both videos having playlistIndex set
    const lastWriteCall = mockWriteIndex.mock.calls[mockWriteIndex.mock.calls.length - 1];
    const writtenVideos: Video[] = lastWriteCall[1].videos;
    expect(writtenVideos).toContainEqual(expect.objectContaining({ id: 'vid1', playlistIndex: 1 }));
    expect(writtenVideos).toContainEqual(expect.objectContaining({ id: 'vid2', playlistIndex: 2 }));
  });

  it('preserves existing playlistIndex for videos no longer in the playlist', async () => {
    const existingVid1 = makeIndexedVideo('vid1', { playlistIndex: 1 });
    const removedVid2 = makeIndexedVideo('vid2', { playlistIndex: 2, archived: true, removedFromPlaylist: true });
    mockReadIndex.mockReturnValue({
      playlistUrl: PLAYLIST_URL,
      outputFolder,
      videos: [existingVid1, removedVid2],
    });
    // vid2 no longer in playlist
    mockFetchPlaylistVideos.mockResolvedValue([makeVideoMeta('vid1')]);

    await runIngestion(PLAYLIST_URL, outputFolder, () => {});

    const lastWriteCall = mockWriteIndex.mock.calls[mockWriteIndex.mock.calls.length - 1];
    const writtenVideos: Video[] = lastWriteCall[1].videos;
    // vid2 is not in metas, so its existing playlistIndex=2 is preserved
    const vid2Written = writtenVideos.find((v) => v.id === 'vid2');
    expect(vid2Written?.playlistIndex).toBe(2);
  });

  it('does not create a -2.md file when the same videoId appears twice in the playlist', async () => {
    // YouTube API can return duplicates (same video added to a playlist twice).
    // The second occurrence must be detected as already-processed within the same run.
    const meta = makeVideoMeta('vid1');
    mockFetchPlaylistVideos.mockResolvedValue([meta, meta]); // same video twice
    mockFetchTranscriptSegments.mockResolvedValue([{ text: 'transcript', offset: 0, duration: 5 }]);
    mockGenerateSummary.mockResolvedValue(makeSummaryResponse());

    await runIngestion(PLAYLIST_URL, outputFolder, () => {});

    const mdFiles = fs.readdirSync(outputFolder).filter((f) => f.endsWith('.md'));
    expect(mdFiles).toHaveLength(1);
    expect(mdFiles[0]).not.toMatch(/-2\.md$/);
    // upsertVideo called exactly once — second occurrence skipped
    expect(mockUpsertVideo).toHaveBeenCalledTimes(1);
  });

  it('stamps videoPublishedAt and addedToPlaylistAt on new videos from VideoMeta', async () => {
    const meta = {
      ...makeVideoMeta('vid1'),
      videoPublishedAt: '2024-11-12T14:30:00Z',
      addedToPlaylistAt: '2025-01-03T09:00:00Z',
    };
    mockFetchPlaylistVideos.mockResolvedValue([meta]);
    mockFetchTranscriptSegments.mockResolvedValue([{ text: 'transcript', offset: 0, duration: 5 }]);
    mockGenerateSummary.mockResolvedValue(makeSummaryResponse());

    await runIngestion(PLAYLIST_URL, outputFolder, () => {});

    expect(mockUpsertVideo).toHaveBeenCalledWith(
      outputFolder,
      expect.objectContaining({
        id: 'vid1',
        videoPublishedAt: '2024-11-12T14:30:00Z',
        addedToPlaylistAt: '2025-01-03T09:00:00Z',
      }),
    );
  });

  it('backfills dates on already-indexed videos via reconciliation writeIndex call', async () => {
    const existingVid = makeIndexedVideo('vid1'); // no dates
    mockReadIndex.mockReturnValue({ playlistUrl: PLAYLIST_URL, outputFolder, videos: [existingVid] });

    const meta = {
      ...makeVideoMeta('vid1'),
      videoPublishedAt: '2024-11-12T14:30:00Z',
      addedToPlaylistAt: '2025-01-03T09:00:00Z',
    };
    mockFetchPlaylistVideos.mockResolvedValue([meta]);

    await runIngestion(PLAYLIST_URL, outputFolder, () => {});

    const lastWriteCall = mockWriteIndex.mock.calls[mockWriteIndex.mock.calls.length - 1];
    const writtenVideos: Video[] = lastWriteCall[1].videos;
    expect(writtenVideos).toContainEqual(
      expect.objectContaining({
        id: 'vid1',
        videoPublishedAt: '2024-11-12T14:30:00Z',
        addedToPlaylistAt: '2025-01-03T09:00:00Z',
      }),
    );
  });

  it('preserves existing dates for already-indexed videos on re-sync', async () => {
    const existingVid = makeIndexedVideo('vid1', {
      videoPublishedAt: '2024-11-12T14:30:00Z',
      addedToPlaylistAt: '2025-01-03T09:00:00Z',
    });
    mockReadIndex.mockReturnValue({ playlistUrl: PLAYLIST_URL, outputFolder, videos: [existingVid] });

    // Re-sync provides different dates (shouldn't matter — existing values win)
    const meta = {
      ...makeVideoMeta('vid1'),
      videoPublishedAt: '2024-12-01T00:00:00Z',
      addedToPlaylistAt: '2025-02-01T00:00:00Z',
    };
    mockFetchPlaylistVideos.mockResolvedValue([meta]);

    await runIngestion(PLAYLIST_URL, outputFolder, () => {});

    const lastWriteCall = mockWriteIndex.mock.calls[mockWriteIndex.mock.calls.length - 1];
    const writtenVideos: Video[] = lastWriteCall[1].videos;
    const written = writtenVideos.find((v) => v.id === 'vid1');
    // Original values preserved — ?? ensures write-once semantics
    expect(written?.videoPublishedAt).toBe('2024-11-12T14:30:00Z');
    expect(written?.addedToPlaylistAt).toBe('2025-01-03T09:00:00Z');
  });

  it('emits cancelled (not done) and stops processing when AbortSignal fires between videos', async () => {
    const controller = new AbortController();
    mockFetchPlaylistVideos.mockResolvedValue([makeVideoMeta('vid1'), makeVideoMeta('vid2')]);
    mockFetchTranscriptSegments.mockResolvedValue([{ text: 'transcript', offset: 0, duration: 5 }]);
    mockGenerateSummary.mockResolvedValue(makeSummaryResponse());

    const events: ProgressEvent[] = [];
    await runIngestion(
      PLAYLIST_URL,
      outputFolder,
      (e) => {
        events.push(e);
        // Abort as soon as vid1 is fully saved — loop should detect it before starting vid2
        if (e.type === 'step' && 'step' in e && e.step === 'Saved') controller.abort();
      },
      controller.signal,
    );

    expect(events.some((e) => e.type === 'cancelled')).toBe(true);
    expect(events.some((e) => e.type === 'done')).toBe(false);
    // vid2 must not have been processed
    expect(mockUpsertVideo).toHaveBeenCalledTimes(1);
    expect(mockUpsertVideo).toHaveBeenCalledWith(outputFolder, expect.objectContaining({ id: 'vid1' }));
  });

  it('stores tldr and takeaways from generateSummary in the index entry', async () => {
    mockFetchPlaylistVideos.mockResolvedValue([makeVideoMeta('vid1')]);
    mockFetchTranscriptSegments.mockResolvedValue([{ text: 'transcript', offset: 0, duration: 5 }]);
    mockGenerateSummary.mockResolvedValue({
      summary: 'body',
      ratings: { usefulness: 4, depth: 4, originality: 4, recency: 4, completeness: 4 },
      overallScore: 4,
      tldr: 'This video teaches agents.',
      takeaways: ['Agents use tools', 'Memory is key'],
    });

    await runIngestion(PLAYLIST_URL, outputFolder, jest.fn());

    expect(mockUpsertVideo).toHaveBeenCalledWith(
      outputFolder,
      expect.objectContaining({
        tldr: 'This video teaches agents.',
        takeaways: ['Agents use tools', 'Memory is key'],
      }),
    );
  });

  it('fetches transcript segments and passes them with videoId to generateSummary', async () => {
    mockFetchPlaylistVideos.mockResolvedValue([makeVideoMeta('vid1')]);
    mockFetchTranscriptSegments.mockResolvedValue([{ text: 'hello world', offset: 0, duration: 5 }]);
    mockDetectLanguage.mockReturnValue('en');
    mockGenerateSummary.mockResolvedValue(makeSummaryResponse());

    const events: ProgressEvent[] = [];
    await runIngestion(PLAYLIST_URL, outputFolder, (e) => events.push(e));

    expect(mockFetchTranscriptSegments).toHaveBeenCalledWith('vid1');
    expect(mockGenerateSummary).toHaveBeenCalledWith(
      [{ text: 'hello world', offset: 0, duration: 5 }],
      'en',
      'vid1',
    );
  });

  it('writes Quick Reference callout in markdown when tldr is returned', async () => {
    mockFetchPlaylistVideos.mockResolvedValue([makeVideoMeta('vid1')]);
    mockFetchTranscriptSegments.mockResolvedValue([{ text: 'transcript', offset: 0, duration: 5 }]);
    mockGenerateSummary.mockResolvedValue({
      summary: 'body',
      ratings: { usefulness: 4, depth: 4, originality: 4, recency: 4, completeness: 4 },
      overallScore: 4,
      tldr: 'This video explains X.',
      takeaways: ['Point one'],
      tags: ['ai'],
    });

    await runIngestion(PLAYLIST_URL, outputFolder, jest.fn());

    const files = fs.readdirSync(outputFolder).filter((f: string) => f.endsWith('.md'));
    const content = fs.readFileSync(path.join(outputFolder, files[0]), 'utf-8');
    expect(content).toContain('> [!summary] Quick Reference');
    expect(content).toContain('> **TL;DR:** This video explains X.');
  });

  it('persists DERIVED tldr/takeaways to the index when generateSummary omits them', async () => {
    mockFetchPlaylistVideos.mockResolvedValue([makeVideoMeta('vid1')]);
    mockFetchTranscriptSegments.mockResolvedValue([{ text: 't', offset: 0, duration: 5 }]);
    mockGenerateSummary.mockResolvedValue(makeSummaryResponse({ tldr: undefined, takeaways: undefined }));
    mockExtractQuickView.mockResolvedValue({ tldr: 'Derived.', takeaways: ['d1', 'd2'] });
    await runIngestion(PLAYLIST_URL, outputFolder, () => {});
    expect(mockUpsertVideo).toHaveBeenCalledWith(
      outputFolder,
      expect.objectContaining({ id: 'vid1', tldr: 'Derived.', takeaways: ['d1', 'd2'] }),
    );
  });

  // --- New-items progress ---

  describe('new-items progress', () => {
    it('counts only new (not-yet-indexed) videos in progress totals', async () => {
      // Arrange: index already has video 'a'; playlist returns [a, b, c] (b, c are new).
      const indexedA = makeIndexedVideo('a');
      mockReadIndex.mockReturnValue({ playlistUrl: PLAYLIST_URL, outputFolder, videos: [indexedA] });
      mockFetchPlaylistVideos.mockResolvedValue([
        makeVideoMeta('a'),
        makeVideoMeta('b'),
        makeVideoMeta('c'),
      ]);
      mockFetchTranscriptSegments.mockResolvedValue([{ text: 'transcript', offset: 0, duration: 5 }]);
      mockGenerateSummary.mockResolvedValue(makeSummaryResponse());

      const events: ProgressEvent[] = [];
      await runIngestion('https://playlist', outputFolder, (e) => events.push(e));

      const start = events.find((e) => e.type === 'start');
      expect(start).toMatchObject({ type: 'start', total: 2 }); // 2 new, not 3

      const steps = events.filter((e) => e.type === 'step');
      // No skip step for the already-indexed video:
      expect(steps.some((s) => s.type === 'step' && 'step' in s && s.step === 'Already processed — skipped')).toBe(false);
      // New videos carry new-basis current/total + title:
      const saved = steps.filter((s) => s.type === 'step' && 'step' in s && s.step === 'Saved') as Array<Extract<ProgressEvent, { type: 'step' }>>;
      expect(saved.map((s) => s.current)).toEqual([1, 2]);
      expect(saved.every((s) => s.total === 2)).toBe(true);
      expect(saved.every((s) => typeof s.title === 'string' && s.title.length > 0)).toBe(true);
    });

    it('stores playlistIndex as the playlist position, not the new-items counter', async () => {
      // Playlist [a(indexed), b(new)] → b is new #1 but at playlist position 2.
      const indexedA = makeIndexedVideo('a');
      mockReadIndex.mockReturnValue({ playlistUrl: PLAYLIST_URL, outputFolder, videos: [indexedA] });
      mockFetchPlaylistVideos.mockResolvedValue([makeVideoMeta('a'), makeVideoMeta('b')]);
      mockFetchTranscriptSegments.mockResolvedValue([{ text: 'transcript', offset: 0, duration: 5 }]);
      mockGenerateSummary.mockResolvedValue(makeSummaryResponse());

      await runIngestion('https://playlist', outputFolder, () => {});

      // b is the only new video; upsertVideo called once for it with playlistIndex=2 (position), not 1 (new-index)
      expect(mockUpsertVideo).toHaveBeenCalledWith(
        outputFolder,
        expect.objectContaining({ id: 'b', playlistIndex: 2 }),
      );
    });

    it('emits done with total 0 when there are no new videos', async () => {
      // Index already contains every playlist id.
      const indexedA = makeIndexedVideo('a');
      const indexedB = makeIndexedVideo('b');
      mockReadIndex.mockReturnValue({ playlistUrl: PLAYLIST_URL, outputFolder, videos: [indexedA, indexedB] });
      mockFetchPlaylistVideos.mockResolvedValue([makeVideoMeta('a'), makeVideoMeta('b')]);

      const events: ProgressEvent[] = [];
      await runIngestion('https://playlist', outputFolder, (e) => events.push(e));

      expect(events.filter((e) => e.type === 'step')).toHaveLength(0);
      expect(events.find((e) => e.type === 'done')).toMatchObject({ type: 'done', total: 0 });
    });
  });

  // ── playlistIndex tracks current playlist position ──

  function lastWrittenVideos(): Video[] {
    const calls = mockWriteIndex.mock.calls;
    return calls[calls.length - 1][1].videos;
  }

  describe('playlistIndex tracks current playlist position', () => {
    it('re-derives a stale in-playlist index to its current position', async () => {
      const stale = makeIndexedVideo('vidA', { playlistIndex: 1 }); // frozen at 1
      const others = ['vidW', 'vidX', 'vidY', 'vidZ'].map((id) => makeIndexedVideo(id));
      mockReadIndex.mockReturnValue({ playlistUrl: PLAYLIST_URL, outputFolder, videos: [...others, stale] });
      // playlist now places vidA at position 5
      mockFetchPlaylistVideos.mockResolvedValue(
        ['vidW', 'vidX', 'vidY', 'vidZ', 'vidA'].map((id) => makeVideoMeta(id)),
      );
      await runIngestion(PLAYLIST_URL, outputFolder, () => {});
      expect(lastWrittenVideos().find((v) => v.id === 'vidA')?.playlistIndex).toBe(5);
    });

    it('resolves a collision (two videos frozen at 1) to distinct current positions', async () => {
      const a = makeIndexedVideo('vidA', { playlistIndex: 1 });
      const b = makeIndexedVideo('vidB', { playlistIndex: 1 });
      mockReadIndex.mockReturnValue({ playlistUrl: PLAYLIST_URL, outputFolder, videos: [a, b] });
      mockFetchPlaylistVideos.mockResolvedValue([makeVideoMeta('vidB'), makeVideoMeta('vidA')]); // B@1, A@2
      await runIngestion(PLAYLIST_URL, outputFolder, () => {});
      const w = lastWrittenVideos();
      expect(w.find((v) => v.id === 'vidB')?.playlistIndex).toBe(1);
      expect(w.find((v) => v.id === 'vidA')?.playlistIndex).toBe(2);
    });

    it('un-archives (via reconcile upsert) AND re-numbers a removed video that returns', async () => {
      const d = makeIndexedVideo('vidD', { playlistIndex: 9, archived: true, removedFromPlaylist: true });
      const others = ['vidW', 'vidX', 'vidY'].map((id) => makeIndexedVideo(id));
      mockReadIndex.mockReturnValue({ playlistUrl: PLAYLIST_URL, outputFolder, videos: [...others, d] });
      // D reappears at position 4
      mockFetchPlaylistVideos.mockResolvedValue(
        ['vidW', 'vidX', 'vidY', 'vidD'].map((id) => makeVideoMeta(id)),
      );
      await runIngestion(PLAYLIST_URL, outputFolder, () => {});
      // index-store is mocked, so the reconcile un-archive is observable only at the upsert call
      // (the re-stamp pass re-reads the mocked seeded array). Mirror the existing :332 test.
      expect(mockUpsertVideo).toHaveBeenCalledWith(
        outputFolder,
        expect.objectContaining({ id: 'vidD', archived: false, removedFromPlaylist: false }),
      );
      // playlistIndex is re-derived by the final writeIndex re-stamp pass (vidD is in positionMap)
      expect(lastWrittenVideos().find((v) => v.id === 'vidD')?.playlistIndex).toBe(4);
    });

    it('re-numbers an archived-but-still-in-playlist video (kept archived)', async () => {
      const e = makeIndexedVideo('vidE', { playlistIndex: 1, archived: true, removedFromPlaylist: false });
      const others = ['vidU', 'vidV', 'vidW', 'vidX', 'vidY'].map((id) => makeIndexedVideo(id));
      mockReadIndex.mockReturnValue({ playlistUrl: PLAYLIST_URL, outputFolder, videos: [...others, e] });
      mockFetchPlaylistVideos.mockResolvedValue(
        ['vidU', 'vidV', 'vidW', 'vidX', 'vidY', 'vidE'].map((id) => makeVideoMeta(id)), // E@6
      );
      await runIngestion(PLAYLIST_URL, outputFolder, () => {});
      const ew = lastWrittenVideos().find((v) => v.id === 'vidE');
      expect(ew?.playlistIndex).toBe(6);
      expect(ew?.archived).toBe(true);
    });

    it('preserves stable fields while re-deriving playlistIndex', async () => {
      const a = makeIndexedVideo('vidA', { playlistIndex: 1, videoPublishedAt: '2020-01-01T00:00:00Z', addedToPlaylistAt: '2021-01-01T00:00:00Z' });
      mockReadIndex.mockReturnValue({ playlistUrl: PLAYLIST_URL, outputFolder, videos: [makeIndexedVideo('vidB'), a] });
      mockFetchPlaylistVideos.mockResolvedValue([makeVideoMeta('vidB'), makeVideoMeta('vidA')]); // A@2
      await runIngestion(PLAYLIST_URL, outputFolder, () => {});
      const aw = lastWrittenVideos().find((v) => v.id === 'vidA');
      expect(aw?.playlistIndex).toBe(2);
      expect(aw?.videoPublishedAt).toBe('2020-01-01T00:00:00Z'); // write-once preserved
      expect(aw?.addedToPlaylistAt).toBe('2021-01-01T00:00:00Z');
    });

    it('does not crash on an empty playlist and keeps existing indices', async () => {
      const a = makeIndexedVideo('vidA', { playlistIndex: 7 });
      mockReadIndex.mockReturnValue({ playlistUrl: PLAYLIST_URL, outputFolder, videos: [a] });
      mockFetchPlaylistVideos.mockResolvedValue([]);
      await expect(runIngestion(PLAYLIST_URL, outputFolder, () => {})).resolves.toBeUndefined();
      expect(lastWrittenVideos().find((v) => v.id === 'vidA')?.playlistIndex).toBe(7);
    });
  });

  describe('summary HTML pre-generation', () => {
    it('calls runHtmlDoc once per new video with (videoId, outputFolder, noop)', async () => {
      mockFetchPlaylistVideos.mockResolvedValue([makeVideoMeta('vid1'), makeVideoMeta('vid2')]);
      mockFetchTranscriptSegments.mockResolvedValue([{ text: 'transcript', offset: 0, duration: 5 }]);
      mockGenerateSummary.mockResolvedValue(makeSummaryResponse());

      await runIngestion(PLAYLIST_URL, outputFolder, () => {});

      expect(mockRunHtmlDoc).toHaveBeenCalledTimes(2);
      expect(mockRunHtmlDoc).toHaveBeenCalledWith('vid1', outputFolder, expect.any(Function));
      expect(mockRunHtmlDoc).toHaveBeenCalledWith('vid2', outputFolder, expect.any(Function));
    });

    it('emits a "Generating HTML doc…" step before "Saved" for each new video', async () => {
      mockFetchPlaylistVideos.mockResolvedValue([makeVideoMeta('vid1')]);
      mockFetchTranscriptSegments.mockResolvedValue([{ text: 'transcript', offset: 0, duration: 5 }]);
      mockGenerateSummary.mockResolvedValue(makeSummaryResponse());

      const events: ProgressEvent[] = [];
      await runIngestion(PLAYLIST_URL, outputFolder, (e) => events.push(e));

      const steps = events
        .filter((e): e is Extract<ProgressEvent, { type: 'step' }> => e.type === 'step' && 'videoId' in e && e.videoId === 'vid1')
        .map((e) => ('step' in e ? e.step : ''));
      const genIdx = steps.indexOf('Generating HTML doc…');
      const savedIdx = steps.indexOf('Saved');
      expect(genIdx).toBeGreaterThanOrEqual(0);
      expect(savedIdx).toBeGreaterThan(genIdx);
    });

    it('passes a no-op progress callback to runHtmlDoc (no internal-progress leak)', async () => {
      mockFetchPlaylistVideos.mockResolvedValue([makeVideoMeta('vid1')]);
      mockFetchTranscriptSegments.mockResolvedValue([{ text: 'transcript', offset: 0, duration: 5 }]);
      mockGenerateSummary.mockResolvedValue(makeSummaryResponse());
      // The mocked runHtmlDoc captures the onProgress it is GIVEN and fires a sentinel on it. If the
      // pipeline passed the real ingest callback (not a no-op), the sentinel would surface on the
      // ingest stream. Asserting call-count + distinct-callback + sentinel-absence together closes the
      // false-green hole where this test could pass even if runHtmlDoc were never called.
      let received: ((e: ProgressEvent) => void) | undefined;
      mockRunHtmlDoc.mockImplementation(async (_id, _folder, onProgress) => {
        received = onProgress;
        onProgress({ type: 'step', step: '__SENTINEL__', current: 1, total: 3, videoId: 'vid1', title: 'x' } as ProgressEvent);
      });

      const events: ProgressEvent[] = [];
      const outer = (e: ProgressEvent) => events.push(e);
      await runIngestion(PLAYLIST_URL, outputFolder, outer);

      expect(mockRunHtmlDoc).toHaveBeenCalledTimes(1);               // it actually ran (no false green)
      expect(received).toBeDefined();
      expect(received).not.toBe(outer);                              // pipeline passed its own no-op, not the ingest callback
      expect(events.some((e) => 'step' in e && e.step === '__SENTINEL__')).toBe(false); // sentinel never leaked
    });

    it('is best-effort: a runHtmlDoc failure does not fail the video or abort the batch', async () => {
      mockFetchPlaylistVideos.mockResolvedValue([makeVideoMeta('vid1'), makeVideoMeta('vid2')]);
      mockFetchTranscriptSegments.mockResolvedValue([{ text: 'transcript', offset: 0, duration: 5 }]);
      mockGenerateSummary.mockResolvedValue(makeSummaryResponse());
      mockRunHtmlDoc.mockRejectedValueOnce(new Error('Gemini transform failed')); // vid1 fails, vid2 ok

      const events: ProgressEvent[] = [];
      await runIngestion(PLAYLIST_URL, outputFolder, (e) => events.push(e));

      // Both videos still ingested; no 'error' event from the failed pre-gen.
      expect(mockUpsertVideo).toHaveBeenCalledWith(outputFolder, expect.objectContaining({ id: 'vid1' }));
      expect(mockUpsertVideo).toHaveBeenCalledWith(outputFolder, expect.objectContaining({ id: 'vid2' }));
      expect(events.some((e) => e.type === 'error')).toBe(false);
      // Non-fatal deferred note emitted for vid1.
      expect(events.some((e) => e.type === 'step' && 'step' in e && e.step === 'HTML doc deferred (will generate on open)' && 'videoId' in e && e.videoId === 'vid1')).toBe(true);
      // Batch still completes.
      expect(events[events.length - 1]).toMatchObject({ type: 'done' });
    });

    it('does not call runHtmlDoc when PREGEN_SUMMARY_HTML=off', async () => {
      process.env.PREGEN_SUMMARY_HTML = 'off';
      mockFetchPlaylistVideos.mockResolvedValue([makeVideoMeta('vid1')]);
      mockFetchTranscriptSegments.mockResolvedValue([{ text: 'transcript', offset: 0, duration: 5 }]);
      mockGenerateSummary.mockResolvedValue(makeSummaryResponse());

      const events: ProgressEvent[] = [];
      await runIngestion(PLAYLIST_URL, outputFolder, (e) => events.push(e));

      expect(mockRunHtmlDoc).not.toHaveBeenCalled();
      expect(events.some((e) => e.type === 'step' && 'step' in e && e.step === 'Generating HTML doc…')).toBe(false);
      // Video still ingested normally.
      expect(mockUpsertVideo).toHaveBeenCalledWith(outputFolder, expect.objectContaining({ id: 'vid1' }));
    });
  });
});

describe('slugify', () => {
  it('lowercases and replaces spaces/punctuation with hyphens', () => {
    expect(slugify('Hello World!')).toBe('hello-world');
  });

  it('handles Unicode letters (Korean)', () => {
    expect(slugify('안녕 World')).toBe('안녕-world');
  });

  it('truncates to 60 characters', () => {
    expect(slugify('A'.repeat(80))).toHaveLength(60);
  });

  it('strips leading/trailing hyphens', () => {
    expect(slugify('  hello  ')).toBe('hello');
  });
});

describe('formatDuration', () => {
  it('formats seconds-only as M:SS', () => {
    expect(formatDuration(45)).toBe('0:45');
  });

  it('formats minutes and seconds as M:SS', () => {
    expect(formatDuration(300)).toBe('5:00');
  });

  it('formats hours as H:MM:SS', () => {
    expect(formatDuration(3661)).toBe('1:01:01');
  });
});

// ── Shared sample .md content for parseFrontmatterField / reconstructVideo ──
const SAMPLE_MD = `---
tags:
  - video-summary
  - en
video_id: "testVidAbc1"
channel: "Test Channel"
lang: EN
type: Analysis
audience: Intermediate
score: 4.6
---

# Test Video Title

**Channel:** Test Channel | **Duration:** 14:05 | **URL:** https://www.youtube.com/watch?v=testVidAbc1

---

## 1. Section One

Content here.
`;

describe('parseFrontmatterField', () => {
  it('extracts a quoted field', () => {
    expect(parseFrontmatterField(SAMPLE_MD, 'video_id')).toBe('testVidAbc1');
  });

  it('extracts an unquoted field', () => {
    expect(parseFrontmatterField(SAMPLE_MD, 'lang')).toBe('EN');
  });

  it('extracts a numeric field', () => {
    expect(parseFrontmatterField(SAMPLE_MD, 'score')).toBe('4.6');
  });

  it('extracts a quoted field with spaces', () => {
    expect(parseFrontmatterField(SAMPLE_MD, 'channel')).toBe('Test Channel');
  });

  it('returns null for a missing field', () => {
    expect(parseFrontmatterField(SAMPLE_MD, 'nonexistent')).toBeNull();
  });
});

describe('reconstructVideo', () => {
  let tempDir: string;
  let mdPath: string;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `reconstruct-${crypto.randomUUID()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    mdPath = path.join(tempDir, '001_test-video-title.md');
    fs.writeFileSync(mdPath, SAMPLE_MD, 'utf-8');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns a Video with correct id, title, language, overallScore', () => {
    const video = reconstructVideo(SAMPLE_MD, '001_test-video-title.md', mdPath);
    expect(video).not.toBeNull();
    expect(video!.id).toBe('testVidAbc1');
    expect(video!.title).toBe('Test Video Title');
    expect(video!.language).toBe('en');
    expect(video!.overallScore).toBe(4.6);
  });

  it('sets videoType and audience from frontmatter', () => {
    const video = reconstructVideo(SAMPLE_MD, '001_test-video-title.md', mdPath);
    expect(video!.videoType).toBe('Analysis');
    expect(video!.audience).toBe('Intermediate');
  });

  it('parses youtubeUrl from metadata line', () => {
    const video = reconstructVideo(SAMPLE_MD, '001_test-video-title.md', mdPath);
    expect(video!.youtubeUrl).toBe('https://www.youtube.com/watch?v=testVidAbc1');
  });

  it('parses durationSeconds from metadata line', () => {
    const video = reconstructVideo(SAMPLE_MD, '001_test-video-title.md', mdPath);
    expect(video!.durationSeconds).toBe(14 * 60 + 5); // 14:05 = 845
  });

  it('sets summaryMd to the filename', () => {
    const video = reconstructVideo(SAMPLE_MD, '001_test-video-title.md', mdPath);
    expect(video!.summaryMd).toBe('001_test-video-title.md');
  });

  it('sets summaryPdf to pdfs/-prefixed path when PDF exists in pdfs/ subfolder', () => {
    const pdfsDir = path.join(tempDir, 'pdfs');
    fs.mkdirSync(pdfsDir, { recursive: true });
    fs.writeFileSync(path.join(pdfsDir, '001_test-video-title.pdf'), '%PDF');
    const video = reconstructVideo(SAMPLE_MD, '001_test-video-title.md', mdPath);
    expect(video!.summaryPdf).toBe('pdfs/001_test-video-title.pdf');
  });

  it('sets summaryPdf to null when PDF is absent from pdfs/ subfolder', () => {
    // No PDF file created — neither at root nor in pdfs/
    const video = reconstructVideo(SAMPLE_MD, '001_test-video-title.md', mdPath);
    expect(video!.summaryPdf).toBeNull();
  });

  it('returns null when video_id is missing from frontmatter', () => {
    const noId = SAMPLE_MD.replace(/video_id:.*\n/, '');
    const video = reconstructVideo(noId, '001_test-video-title.md', mdPath);
    expect(video).toBeNull();
  });

  it('all ratings equal Math.round(overallScore) clamped to 1–5', () => {
    const video = reconstructVideo(SAMPLE_MD, '001_test-video-title.md', mdPath);
    const r = Math.max(1, Math.min(5, Math.round(4.6))); // 5
    expect(video!.ratings).toEqual({ usefulness: r, depth: r, originality: r, recency: r, completeness: r });
  });

  it('reconstructVideo adopts the NNN_ serial from a prefixed filename', () => {
    const file = '007_some-slug.md';
    const mdPath2 = path.join(tempDir, file);
    fs.writeFileSync(mdPath2, SAMPLE_MD, 'utf-8');
    const video = reconstructVideo(SAMPLE_MD, file, mdPath2);
    expect(video?.serialNumber).toBe(7);
  });

  it('reconstructVideo leaves serialNumber undefined for an unprefixed filename', () => {
    const file = 'some-slug.md';
    const mdPath2 = path.join(tempDir, file);
    fs.writeFileSync(mdPath2, SAMPLE_MD, 'utf-8');
    const video = reconstructVideo(SAMPLE_MD, file, mdPath2);
    expect(video?.serialNumber).toBeUndefined();
  });
});

describe('recoverOrphanedVideos', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `recover-${crypto.randomUUID()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    mockAssertOutputFolder.mockImplementation(() => {});
    mockUpsertVideo.mockImplementation(() => {});
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    jest.clearAllMocks();
  });

  it('upserts any orphaned video with a valid video_id in frontmatter', () => {
    fs.writeFileSync(path.join(tempDir, '001_test-video.md'), SAMPLE_MD, 'utf-8');
    mockReadIndex.mockReturnValue({ playlistUrl: '', outputFolder: tempDir, videos: [] });

    recoverOrphanedVideos(tempDir);

    expect(mockUpsertVideo).toHaveBeenCalledTimes(1);
    expect(mockUpsertVideo).toHaveBeenCalledWith(tempDir, expect.objectContaining({ id: 'testVidAbc1' }));
  });

  it('does not upsert a video already in the index', () => {
    fs.writeFileSync(path.join(tempDir, '001_test-video.md'), SAMPLE_MD, 'utf-8');
    mockReadIndex.mockReturnValue({
      playlistUrl: '',
      outputFolder: tempDir,
      videos: [{ id: 'testVidAbc1' } as never],
    });

    recoverOrphanedVideos(tempDir);

    expect(mockUpsertVideo).not.toHaveBeenCalled();
  });

  it('ignores .md files with no video_id in frontmatter', () => {
    const noId = SAMPLE_MD.replace('video_id: "testVidAbc1"', '');
    fs.writeFileSync(path.join(tempDir, '001_test-video.md'), noId, 'utf-8');
    mockReadIndex.mockReturnValue({ playlistUrl: '', outputFolder: tempDir, videos: [] });

    recoverOrphanedVideos(tempDir);

    expect(mockUpsertVideo).not.toHaveBeenCalled();
  });

  it('ignores deep-dive .md files', () => {
    fs.writeFileSync(path.join(tempDir, 'testVidAbc1-deep-dive.md'), SAMPLE_MD, 'utf-8');
    mockReadIndex.mockReturnValue({ playlistUrl: '', outputFolder: tempDir, videos: [] });

    recoverOrphanedVideos(tempDir);

    expect(mockUpsertVideo).not.toHaveBeenCalled();
  });
});

describe('insertQuickViewCallout', () => {
  const baseMd = [
    '---',
    'tags:',
    '  - video-summary',
    'video_id: "abc123XYZ01"',
    'lang: EN',
    'score: 4.2',
    '---',
    '',
    '# Test Video',
    '',
    '**Channel:** Test | **Duration:** 5:00 | **URL:** https://www.youtube.com/watch?v=abc123XYZ01',
    '',
    '---',
    '',
    '## 1. Section',
    '',
    'Content here.',
    '',
    '## Conclusion',
    '',
    'Done.',
  ].join('\n');

  it('inserts callout between metadata line and first horizontal rule', () => {
    const result = insertQuickViewCallout(
      baseMd,
      'This video teaches testing.',
      ['Write tests first', 'Red before green'],
      ['tdd', 'testing'],
    );
    expect(result).toContain('> [!summary] Quick Reference');
    expect(result).toContain('> **TL;DR:** This video teaches testing.');
    expect(result).toContain('> - Write tests first');
    expect(result).toContain('> - Red before green');
    expect(result).toContain('> **Concepts:** tdd · testing');
    // Main body still present after the callout
    expect(result).toContain('## 1. Section');
  });

  it('omits Concepts line when tags array is empty', () => {
    const result = insertQuickViewCallout(baseMd, 'This video teaches X.', ['Point one'], []);
    expect(result).not.toContain('**Concepts:**');
  });

  it('is idempotent — does not double-insert callout', () => {
    const once = insertQuickViewCallout(baseMd, 'This video teaches X.', ['Point'], ['tag']);
    const twice = insertQuickViewCallout(once, 'This video teaches X.', ['Point'], ['tag']);
    const matches = (twice.match(/> \[!summary\] Quick Reference/g) ?? []).length;
    expect(matches).toBe(1);
  });

  it('returns content unchanged when first horizontal rule is not found', () => {
    const noRule = '# Title\n\nsome content';
    const result = insertQuickViewCallout(noRule, 'tldr', ['pt'], ['t']);
    expect(result).toBe(noRule);
  });
});

describe('stripQuickViewCallout', () => {
  // Build a realistic md with callout already inserted
  const baseWithCallout = insertQuickViewCallout(
    '# Title\n\n**URL:** https://example.com\n\n---\n\n## 1. Section\nContent here.',
    'This video teaches X.',
    ['Point one', 'Point two'],
    ['tag1', 'tag2'],
  );

  it('removes the callout block from content that has one', () => {
    const stripped = stripQuickViewCallout(baseWithCallout);
    expect(stripped).not.toContain('> [!summary] Quick Reference');
    expect(stripped).not.toContain('TL;DR');
    expect(stripped).not.toContain('Key Takeaways');
  });

  it('preserves content before and after the callout', () => {
    const stripped = stripQuickViewCallout(baseWithCallout);
    expect(stripped).toContain('# Title');
    expect(stripped).toContain('**URL:** https://example.com');
    expect(stripped).toContain('## 1. Section');
    expect(stripped).toContain('Content here.');
  });

  it('returns content unchanged when no callout is present', () => {
    const noCallout = '# Title\n\n**URL:** https://example.com\n\n---\n\n## 1. Section\nContent.';
    expect(stripQuickViewCallout(noCallout)).toBe(noCallout);
  });

  it('strip + insert is a clean round-trip — callout appears exactly once', () => {
    const stripped = stripQuickViewCallout(baseWithCallout);
    const reinserted = insertQuickViewCallout(stripped, 'Updated TL;DR.', ['New point'], ['newtag']);
    const matches = (reinserted.match(/> \[!summary\] Quick Reference/g) ?? []).length;
    expect(matches).toBe(1);
    expect(reinserted).toContain('Updated TL;DR.');
    expect(reinserted).not.toContain('This video teaches X.');
  });
});

describe('writeSummaryDoc', () => {
  let outputFolder: string;

  beforeEach(() => {
    outputFolder = path.join(os.tmpdir(), `pipeline-wsd-test-${crypto.randomUUID()}`);
    fs.mkdirSync(outputFolder, { recursive: true });
    mockDetectLanguage.mockReturnValue('en');
    mockGeneratePdf.mockResolvedValue(undefined);
    mockExtractQuickView.mockResolvedValue({ tldr: 'QV tldr', takeaways: ['qa', 'qb'] });
    mockFetchTranscriptSegments.mockResolvedValue([{ text: 't', offset: 0, duration: 5 }]);
  });

  afterEach(() => {
    fs.rmSync(outputFolder, { recursive: true, force: true });
    jest.clearAllMocks();
  });

  it('writes <baseName>.md with the generated summary and returns AI fields; writes NO pdf', async () => {
    mockFetchTranscriptSegments.mockResolvedValue([{ text: 'hello world', offset: 0, duration: 5 }]);
    mockDetectLanguage.mockReturnValue('en');
    mockGenerateSummary.mockResolvedValue(makeSummaryResponse({ summary: '## 1. A\n▶ [0:00–0:05](u)\nbody' }));

    const result = await writeSummaryDoc({
      videoId: 'vid11111111', title: 'T', youtubeUrl: 'https://youtu.be/x',
      channel: 'Chan', durationSeconds: 5, outputFolder, baseName: 'my-base',
    });

    expect(result.summaryMd).toBe('my-base.md');
    expect(result.language).toBe('en');
    expect(result.ratings).toBeDefined();
    const md = fsReal.readFileSync(`${outputFolder}/my-base.md`, 'utf-8');
    expect(md).toContain('# T');
    expect(md).toContain('## 1. A');
    expect(md).toContain('▶ [0:00–0:05]');
    expect(mockGeneratePdf).not.toHaveBeenCalled();
    expect(mockGenerateSummary).toHaveBeenCalledWith(
      [{ text: 'hello world', offset: 0, duration: 5 }], 'en', 'vid11111111',
    );
  });

  it('falls back to Gemini transcription when captions are unavailable', async () => {
    mockFetchTranscriptSegments.mockRejectedValueOnce(new Error('Transcript is disabled on this video'));
    mockTranscribeViaGemini.mockResolvedValueOnce([{ text: 'gemini transcript', offset: 0, duration: 5 }]);
    mockGenerateSummary.mockResolvedValue(makeSummaryResponse({ summary: 'From Gemini fallback' }));

    await writeSummaryDoc({
      videoId: 'vidGated11',
      title: 'Gated Video',
      youtubeUrl: 'https://youtube.com/watch?v=vidGated',
      durationSeconds: 300,
      outputFolder,            // from the describe('writeSummaryDoc') beforeEach fixture
      baseName: 'gated-video',
    });

    expect(mockTranscribeViaGemini).toHaveBeenCalledWith('https://youtube.com/watch?v=vidGated', 'vidGated11', 300);
    expect(mockGenerateSummary).toHaveBeenCalled();
    const md = fsReal.readFileSync(`${outputFolder}/gated-video.md`, 'utf-8');
    expect(md).toContain('From Gemini fallback');
  });

  // — Quick Reference fallback (Issue 2) —
  const qrInput = () => ({ videoId: 'vidQR', title: 'T', youtubeUrl: 'https://youtu.be/x', channel: 'C', durationSeconds: 300, outputFolder, baseName: 'doc' });
  const qrRead = () => fsReal.readFileSync(`${outputFolder}/doc.md`, 'utf-8');

  it('QR: both present → no extractQuickView call, callout from generateSummary values', async () => {
    mockGenerateSummary.mockResolvedValue(makeSummaryResponse({ tldr: 'This video does X.', takeaways: ['a', 'b'] }));
    const r = await writeSummaryDoc(qrInput());
    expect(mockExtractQuickView).not.toHaveBeenCalled();
    expect(qrRead()).toContain('> **TL;DR:** This video does X.');
    expect(r.tldr).toBe('This video does X.');
  });

  it('QR: neither present → extractQuickView(baseContent) fallback inserts callout', async () => {
    mockGenerateSummary.mockResolvedValue(makeSummaryResponse({ tldr: undefined, takeaways: undefined }));
    mockExtractQuickView.mockResolvedValue({ tldr: 'Derived tldr.', takeaways: ['d1', 'd2'] });
    const r = await writeSummaryDoc(qrInput());
    expect(mockExtractQuickView).toHaveBeenCalledTimes(1);
    const arg = mockExtractQuickView.mock.calls[0][0] as string;
    expect(arg).toContain('video_id: "vidQR"'); // baseContent = full md (frontmatter present)
    expect(arg).toContain('# T');
    expect(qrRead()).toContain('> **TL;DR:** Derived tldr.');
    expect(r.tldr).toBe('Derived tldr.');
    expect(r.takeaways).toEqual(['d1', 'd2']);
  });

  it('QR: only tldr present → fallback derives both (partial discarded)', async () => {
    mockGenerateSummary.mockResolvedValue(makeSummaryResponse({ tldr: 'partial only', takeaways: undefined }));
    mockExtractQuickView.mockResolvedValue({ tldr: 'Derived.', takeaways: ['d1'] });
    const r = await writeSummaryDoc(qrInput());
    expect(mockExtractQuickView).toHaveBeenCalledTimes(1);
    expect(qrRead()).toContain('> **TL;DR:** Derived.');
    expect(r.tldr).toBe('Derived.'); // partial 'partial only' discarded
  });

  it('QR: extractQuickView throws → graceful (md written without callout, no throw, undefined values)', async () => {
    mockGenerateSummary.mockResolvedValue(makeSummaryResponse({ tldr: undefined, takeaways: undefined }));
    mockExtractQuickView.mockRejectedValue(new Error('qv failed'));
    const r = await writeSummaryDoc(qrInput());
    expect(qrRead()).not.toContain('> [!summary] Quick Reference');
    expect(qrRead()).toContain('# T'); // file still written
    expect(r.tldr).toBeUndefined();
    expect(r.takeaways).toBeUndefined();
  });
});
