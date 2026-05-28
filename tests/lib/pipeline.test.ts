import crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ProgressEvent, Video, VideoMeta, GeminiSummaryResponse } from '../../types';

jest.mock('../../lib/youtube');
jest.mock('../../lib/gemini');
jest.mock('../../lib/pdf');
jest.mock('../../lib/index-store');

import { runIngestion, slugify, formatDuration, parseFrontmatterField, reconstructVideo, recoverOrphanedVideos, migrateToSlugFilenames } from '../../lib/pipeline';
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
    const ratings = { usefulness: 4, depth: 3, originality: 5, recency: 2, completeness: 1 } as const;
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

  it('stores videoType and audience from generateSummary in the index entry', async () => {
    mockFetchPlaylistVideos.mockResolvedValue([makeVideoMeta('vid1')]);
    mockFetchTranscript.mockResolvedValue('transcript');
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
    mockFetchTranscript.mockResolvedValue('transcript');
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

  it('uses slug-only filename (no rank prefix) for the video', async () => {
    const meta = { ...makeVideoMeta('vid1'), title: 'Hello World' };
    mockFetchPlaylistVideos.mockResolvedValue([meta]);
    mockFetchTranscript.mockResolvedValue('transcript');
    mockGenerateSummary.mockResolvedValue(makeSummaryResponse());

    await runIngestion(PLAYLIST_URL, outputFolder, () => {});

    expect(mockUpsertVideo).toHaveBeenCalledWith(
      outputFolder,
      expect.objectContaining({
        summaryMd: 'hello-world.md',
        summaryPdf: 'hello-world.pdf',
      }),
    );
  });

  it('appends -2 suffix when slug filename already exists on disk', async () => {
    // Simulate a pre-existing file with the same slug (e.g. from a prior video with the same title)
    fs.writeFileSync(path.join(outputFolder, 'hello-world.md'), 'existing content');

    const meta = { ...makeVideoMeta('vid1'), title: 'Hello World' };
    mockFetchPlaylistVideos.mockResolvedValue([meta]);
    mockFetchTranscript.mockResolvedValue('transcript');
    mockGenerateSummary.mockResolvedValue(makeSummaryResponse());

    await runIngestion(PLAYLIST_URL, outputFolder, () => {});

    expect(mockUpsertVideo).toHaveBeenCalledWith(
      outputFolder,
      expect.objectContaining({
        summaryMd: 'hello-world-2.md',
        summaryPdf: 'hello-world-2.pdf',
      }),
    );
  });

  it('writes markdown file starting with YAML frontmatter (--- tags:)', async () => {
    const meta = { ...makeVideoMeta('vid1'), title: 'Test Video', channelTitle: 'Test Channel' };
    mockFetchPlaylistVideos.mockResolvedValue([meta]);
    mockFetchTranscript.mockResolvedValue('transcript');
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
    mockFetchTranscript.mockResolvedValue('transcript');
    mockGenerateSummary.mockResolvedValue(makeSummaryResponse());

    await runIngestion(PLAYLIST_URL, outputFolder, () => {});

    const files = fs.readdirSync(outputFolder).filter((f) => f.endsWith('.md'));
    const content = fs.readFileSync(path.join(outputFolder, files[0]), 'utf-8');
    expect(content).not.toMatch(/^channel:/m);
  });

  it('always includes video-summary structural tag in frontmatter', async () => {
    const meta = makeVideoMeta('vid1');
    mockFetchPlaylistVideos.mockResolvedValue([meta]);
    mockFetchTranscript.mockResolvedValue('transcript');
    mockGenerateSummary.mockResolvedValue(makeSummaryResponse());

    await runIngestion(PLAYLIST_URL, outputFolder, () => {});

    const files = fs.readdirSync(outputFolder).filter((f) => f.endsWith('.md'));
    const content = fs.readFileSync(path.join(outputFolder, files[0]), 'utf-8');
    expect(content).toMatch(/- video-summary/);
  });

  it('stores channel and tags from generateSummary in the index entry', async () => {
    const meta = { ...makeVideoMeta('vid1'), channelTitle: 'MyChannel' };
    mockFetchPlaylistVideos.mockResolvedValue([meta]);
    mockFetchTranscript.mockResolvedValue('transcript');
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

  it('clears removedFromPlaylist flag when a video returns to the playlist', async () => {
    const vid1 = makeIndexedVideo('vid1');
    const vid2 = makeIndexedVideo('vid2', { archived: true, removedFromPlaylist: true });
    mockReadIndex.mockReturnValue({ playlistUrl: PLAYLIST_URL, outputFolder, videos: [vid1, vid2] });
    mockFetchPlaylistVideos.mockResolvedValue([makeVideoMeta('vid1'), makeVideoMeta('vid2')]); // vid2 is back

    await runIngestion(PLAYLIST_URL, outputFolder, () => {});

    expect(mockUpsertVideo).toHaveBeenCalledWith(
      outputFolder,
      expect.objectContaining({ id: 'vid2', removedFromPlaylist: false }),
    );
  });

  it('stamps 1-based playlistIndex on new videos based on playlist order', async () => {
    mockFetchPlaylistVideos.mockResolvedValue([makeVideoMeta('vid1'), makeVideoMeta('vid2'), makeVideoMeta('vid3')]);
    mockFetchTranscript.mockResolvedValue('transcript');
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
    mockFetchTranscript.mockResolvedValue('transcript');
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
    mockFetchTranscript.mockResolvedValue('transcript');
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
    mockFetchTranscript.mockResolvedValue('transcript');
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

  it('sets summaryPdf to the .pdf filename when the file exists', () => {
    const pdfPath = path.join(tempDir, '001_test-video-title.pdf');
    fs.writeFileSync(pdfPath, '%PDF');
    const video = reconstructVideo(SAMPLE_MD, '001_test-video-title.md', mdPath);
    expect(video!.summaryPdf).toBe('001_test-video-title.pdf');
  });

  it('sets summaryPdf to null when the .pdf file is absent', () => {
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

describe('migrateToSlugFilenames', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `migrate-${crypto.randomUUID()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    mockAssertOutputFolder.mockImplementation(() => {});
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    jest.clearAllMocks();
  });

  function makeVideoInIndex(overrides: Partial<Video> = {}): Video {
    return makeIndexedVideo('vid1', { summaryMd: '001_test-video.md', summaryPdf: '001_test-video.pdf', ...overrides });
  }

  it('renames prefixed md and pdf files on disk and updates index', () => {
    fs.writeFileSync(path.join(tempDir, '001_test-video.md'), 'content');
    fs.writeFileSync(path.join(tempDir, '001_test-video.pdf'), 'pdf');
    mockReadIndex.mockReturnValue({ playlistUrl: '', outputFolder: tempDir, videos: [makeVideoInIndex()] });

    migrateToSlugFilenames(tempDir);

    expect(fs.existsSync(path.join(tempDir, 'test-video.md'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, 'test-video.pdf'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, '001_test-video.md'))).toBe(false);
    expect(mockWriteIndex).toHaveBeenCalledWith(
      tempDir,
      expect.objectContaining({
        videos: expect.arrayContaining([expect.objectContaining({ summaryMd: 'test-video.md', summaryPdf: 'test-video.pdf' })]),
      }),
    );
  });

  it('also migrates prefixed deep-dive filenames', () => {
    const video = makeVideoInIndex({ deepDiveMd: '001_test-video-deep-dive.md', deepDivePdf: '001_test-video-deep-dive.pdf' });
    fs.writeFileSync(path.join(tempDir, '001_test-video-deep-dive.md'), 'dd');
    mockReadIndex.mockReturnValue({ playlistUrl: '', outputFolder: tempDir, videos: [video] });

    migrateToSlugFilenames(tempDir);

    expect(fs.existsSync(path.join(tempDir, 'test-video-deep-dive.md'))).toBe(true);
    expect(mockWriteIndex).toHaveBeenCalledWith(
      tempDir,
      expect.objectContaining({
        videos: expect.arrayContaining([expect.objectContaining({ deepDiveMd: 'test-video-deep-dive.md' })]),
      }),
    );
  });

  it('skips files already using slug-only names', () => {
    const video = makeVideoInIndex({ summaryMd: 'test-video.md', summaryPdf: 'test-video.pdf' });
    mockReadIndex.mockReturnValue({ playlistUrl: '', outputFolder: tempDir, videos: [video] });

    migrateToSlugFilenames(tempDir);

    expect(mockWriteIndex).not.toHaveBeenCalled();
  });

  it('does not rename if source file does not exist on disk', () => {
    mockReadIndex.mockReturnValue({ playlistUrl: '', outputFolder: tempDir, videos: [makeVideoInIndex()] });

    migrateToSlugFilenames(tempDir);

    // File doesn't exist on disk — index still gets updated with new name
    expect(mockWriteIndex).toHaveBeenCalledWith(
      tempDir,
      expect.objectContaining({
        videos: expect.arrayContaining([expect.objectContaining({ summaryMd: 'test-video.md' })]),
      }),
    );
    expect(fs.existsSync(path.join(tempDir, 'test-video.md'))).toBe(false);
  });
});
