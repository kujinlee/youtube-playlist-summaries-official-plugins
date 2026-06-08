import { detectLanguage, fetchPlaylistVideos, fetchTranscript } from '../../lib/youtube';
import { google } from 'googleapis';
import { YoutubeTranscript } from 'youtube-transcript';

jest.mock('googleapis', () => ({
  google: { youtube: jest.fn() },
}));

jest.mock('youtube-transcript', () => ({
  YoutubeTranscript: { fetchTranscript: jest.fn() },
}));

const mockPlaylistItemsList = jest.fn();
const mockVideosList = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (google.youtube as jest.Mock).mockReturnValue({
    playlistItems: { list: mockPlaylistItemsList },
    videos: { list: mockVideosList },
  });
});

describe('fetchPlaylistVideos', () => {
  it('returns correct VideoMeta shape', async () => {
    mockPlaylistItemsList.mockResolvedValue({
      data: { items: [{ contentDetails: { videoId: 'abc12345678' } }], nextPageToken: null },
    });
    mockVideosList.mockResolvedValue({
      data: {
        items: [{
          id: 'abc12345678',
          snippet: { title: 'Test Video', channelTitle: 'Test Channel' },
          contentDetails: { duration: 'PT5M' },
        }],
      },
    });

    const result = await fetchPlaylistVideos(
      'https://www.youtube.com/playlist?list=PLtest123',
      'fake-api-key',
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      videoId: 'abc12345678',
      title: 'Test Video',
      channelTitle: 'Test Channel',
      youtubeUrl: 'https://www.youtube.com/watch?v=abc12345678',
      durationSeconds: 300,
    });
  });

  it('omits channelTitle when snippet has none', async () => {
    mockPlaylistItemsList.mockResolvedValue({
      data: { items: [{ contentDetails: { videoId: 'abc12345678' } }], nextPageToken: null },
    });
    mockVideosList.mockResolvedValue({
      data: {
        items: [{
          id: 'abc12345678',
          snippet: { title: 'Test Video' },
          contentDetails: { duration: 'PT5M' },
        }],
      },
    });

    const result = await fetchPlaylistVideos(
      'https://www.youtube.com/playlist?list=PLtest123',
      'fake-api-key',
    );

    expect(result[0].channelTitle).toBeUndefined();
  });

  it('preserves playlist order even when videos.list returns items out of order', async () => {
    mockPlaylistItemsList.mockResolvedValue({
      data: {
        items: [
          { contentDetails: { videoId: 'first111111' } },
          { contentDetails: { videoId: 'second11111' } },
          { contentDetails: { videoId: 'third111111' } },
        ],
        nextPageToken: null,
      },
    });
    // API returns them reversed
    mockVideosList.mockResolvedValue({
      data: {
        items: [
          { id: 'third111111', snippet: { title: 'Third' }, contentDetails: { duration: 'PT1M' } },
          { id: 'first111111', snippet: { title: 'First' }, contentDetails: { duration: 'PT1M' } },
          { id: 'second11111', snippet: { title: 'Second' }, contentDetails: { duration: 'PT1M' } },
        ],
      },
    });

    const result = await fetchPlaylistVideos(
      'https://www.youtube.com/playlist?list=PLtest123',
      'fake-api-key',
    );

    expect(result.map((v) => v.videoId)).toEqual(['first111111', 'second11111', 'third111111']);
    expect(result.map((v) => v.title)).toEqual(['First', 'Second', 'Third']);
  });

  it('parses ISO 8601 duration PT1H23M45S to 5025 seconds', async () => {
    mockPlaylistItemsList.mockResolvedValue({
      data: { items: [{ contentDetails: { videoId: 'vid111111111' } }], nextPageToken: null },
    });
    mockVideosList.mockResolvedValue({
      data: {
        items: [{
          id: 'vid111111111',
          snippet: { title: 'Long Video' },
          contentDetails: { duration: 'PT1H23M45S' },
        }],
      },
    });

    const result = await fetchPlaylistVideos(
      'https://www.youtube.com/playlist?list=PLtest123',
      'fake-api-key',
    );

    expect(result[0].durationSeconds).toBe(5025);
  });

  it('fetches all pages when nextPageToken is present', async () => {
    mockPlaylistItemsList
      .mockResolvedValueOnce({
        data: { items: [{ contentDetails: { videoId: 'vid111111111' } }], nextPageToken: 'page2' },
      })
      .mockResolvedValueOnce({
        data: { items: [{ contentDetails: { videoId: 'vid222222222' } }], nextPageToken: null },
      });
    mockVideosList.mockResolvedValue({
      data: {
        items: [
          { id: 'vid111111111', snippet: { title: 'Video 1' }, contentDetails: { duration: 'PT1M' } },
          { id: 'vid222222222', snippet: { title: 'Video 2' }, contentDetails: { duration: 'PT2M' } },
        ],
      },
    });

    const result = await fetchPlaylistVideos(
      'https://www.youtube.com/playlist?list=PLtest123',
      'fake-api-key',
    );

    expect(mockPlaylistItemsList).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(2);
  });

  it('calls videos.list in batches of 50 for large playlists with correct IDs per batch', async () => {
    const videoIds = Array.from({ length: 51 }, (_, i) => `vid${String(i).padStart(10, '0')}`);
    mockPlaylistItemsList.mockResolvedValue({
      data: {
        items: videoIds.map((id) => ({ contentDetails: { videoId: id } })),
        nextPageToken: null,
      },
    });
    mockVideosList.mockResolvedValue({ data: { items: [] } });

    await fetchPlaylistVideos('https://www.youtube.com/playlist?list=PLtest123', 'fake-api-key');

    expect(mockVideosList).toHaveBeenCalledTimes(2);
    expect(mockVideosList.mock.calls[0][0].id).toHaveLength(50);
    expect(mockVideosList.mock.calls[1][0].id).toHaveLength(1);
    expect(mockVideosList.mock.calls[1][0].id[0]).toBe(videoIds[50]);
  });

  it('throws when playlist URL has no list param', async () => {
    await expect(
      fetchPlaylistVideos('https://www.youtube.com/watch?v=abc', 'fake-api-key'),
    ).rejects.toThrow('No playlist ID found in URL');
  });

  it('throws when playlist URL is malformed', async () => {
    await expect(
      fetchPlaylistVideos('not-a-url', 'fake-api-key'),
    ).rejects.toThrow('Invalid playlist URL');
  });

  it('captures addedToPlaylistAt from playlistItems snippet.publishedAt', async () => {
    mockPlaylistItemsList.mockResolvedValue({
      data: {
        items: [{
          contentDetails: { videoId: 'abc12345678' },
          snippet: { publishedAt: '2025-01-03T09:00:00Z' },
        }],
        nextPageToken: null,
      },
    });
    mockVideosList.mockResolvedValue({
      data: {
        items: [{
          id: 'abc12345678',
          snippet: { title: 'Test Video' },
          contentDetails: { duration: 'PT5M' },
        }],
      },
    });

    const result = await fetchPlaylistVideos(
      'https://www.youtube.com/playlist?list=PLtest123',
      'fake-api-key',
    );

    expect(result[0].addedToPlaylistAt).toBe('2025-01-03T09:00:00Z');
  });

  it('captures videoPublishedAt from videos snippet.publishedAt', async () => {
    mockPlaylistItemsList.mockResolvedValue({
      data: {
        items: [{ contentDetails: { videoId: 'abc12345678' } }],
        nextPageToken: null,
      },
    });
    mockVideosList.mockResolvedValue({
      data: {
        items: [{
          id: 'abc12345678',
          snippet: { title: 'Test Video', publishedAt: '2024-11-12T14:30:00Z' },
          contentDetails: { duration: 'PT5M' },
        }],
      },
    });

    const result = await fetchPlaylistVideos(
      'https://www.youtube.com/playlist?list=PLtest123',
      'fake-api-key',
    );

    expect(result[0].videoPublishedAt).toBe('2024-11-12T14:30:00Z');
  });

  it('returns undefined for both dates when snippet fields are absent', async () => {
    mockPlaylistItemsList.mockResolvedValue({
      data: {
        items: [{ contentDetails: { videoId: 'abc12345678' } }],
        nextPageToken: null,
      },
    });
    mockVideosList.mockResolvedValue({
      data: {
        items: [{
          id: 'abc12345678',
          snippet: { title: 'Test Video' },
          contentDetails: { duration: 'PT5M' },
        }],
      },
    });

    const result = await fetchPlaylistVideos(
      'https://www.youtube.com/playlist?list=PLtest123',
      'fake-api-key',
    );

    expect(result[0].videoPublishedAt).toBeUndefined();
    expect(result[0].addedToPlaylistAt).toBeUndefined();
  });
});

describe('fetchTranscript', () => {
  it('returns joined transcript text from segments', async () => {
    (YoutubeTranscript.fetchTranscript as jest.Mock).mockResolvedValue([
      { text: 'Hello', duration: 1000, offset: 0 },
      { text: 'world', duration: 1000, offset: 1000 },
    ]);

    const result = await fetchTranscript('abc12345678');

    expect(result).toBe('Hello world');
  });

  it('throws with wrapped message when transcript fetch fails', async () => {
    const cause = new Error('Transcript disabled');
    (YoutubeTranscript.fetchTranscript as jest.Mock).mockRejectedValue(cause);

    const err = await fetchTranscript('abc12345678').catch((e) => e);
    expect(err.message).toBe('Failed to fetch transcript for video abc12345678: Transcript disabled');
    expect(err.cause).toBe(cause);
  });

  it('handles non-Error rejections from transcript library', async () => {
    (YoutubeTranscript.fetchTranscript as jest.Mock).mockRejectedValue('network timeout');

    await expect(fetchTranscript('abc12345678')).rejects.toThrow(
      'Failed to fetch transcript for video abc12345678: network timeout',
    );
  });
});

describe('detectLanguage', () => {
  it('returns ko for Korean text', () => {
    expect(detectLanguage('안녕하세요 반갑습니다 오늘 날씨가 좋네요')).toBe('ko');
  });

  it('returns en for English text', () => {
    expect(detectLanguage('Hello world this is an English sentence')).toBe('en');
  });

  it('returns en for empty string', () => {
    expect(detectLanguage('')).toBe('en');
  });

  it('returns en for mixed text below Korean threshold', () => {
    // One Korean word in a long English sentence — well below 10% ratio
    expect(detectLanguage('This is a long English sentence with one Korean word 안녕 at the end')).toBe('en');
  });
});
