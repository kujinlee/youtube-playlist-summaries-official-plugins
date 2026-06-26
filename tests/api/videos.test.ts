jest.mock('../../lib/index-store');

import { GET } from '../../app/api/videos/route';
import * as indexStore from '../../lib/index-store';
import type { Video, PlaylistIndex } from '../../types';

const mockReadIndex = jest.mocked(indexStore.readIndex);
const mockAssertOutputFolder = jest.mocked(indexStore.assertOutputFolder);

function makeVideo(id: string, overallScore: number, title = `Video ${id}`, personalScore?: number): Video {
  return {
    id,
    title,
    youtubeUrl: `https://youtube.com/watch?v=${id}`,
    language: 'en',
    durationSeconds: 300,
    archived: false,
    ratings: { usefulness: 3, depth: 3, originality: 3, recency: 3, completeness: 3 },
    overallScore,
    personalScore,
    summaryMd: `${id}.md`,
    summaryPdf: `${id}.pdf`,
    deepDiveMd: null,
    deepDivePdf: null,
    processedAt: new Date().toISOString(),
  };
}

function makeIndex(videos: Video[]): PlaylistIndex {
  return { playlistUrl: 'https://youtube.com/playlist?list=PLtest', outputFolder: '/tmp/out', videos };
}

const OUTPUT_FOLDER = '/tmp/out';

function get(params: Record<string, string> = {}) {
  const query = new URLSearchParams({ outputFolder: OUTPUT_FOLDER, ...params }).toString();
  return GET(new Request(`http://localhost/api/videos?${query}`));
}

describe('GET /api/videos', () => {
  beforeEach(() => {
    mockAssertOutputFolder.mockImplementation(() => {});
    mockReadIndex.mockReturnValue(makeIndex([
      makeVideo('vid1', 4, 'Beta'),
      makeVideo('vid2', 2, 'Alpha'),
      makeVideo('vid3', 5, 'Gamma'),
    ]));
  });

  afterEach(() => jest.clearAllMocks());

  it('returns 200 with videos array', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.videos)).toBe(true);
    expect(body.videos).toHaveLength(3);
  });

  it('sorts by name ascending by default', async () => {
    const res = await get({ sortColumn: 'name', sortOrder: 'asc' });
    const { videos } = await res.json();
    expect(videos.map((v: Video) => v.title)).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('sorts by name descending', async () => {
    const res = await get({ sortColumn: 'name', sortOrder: 'desc' });
    const { videos } = await res.json();
    expect(videos.map((v: Video) => v.title)).toEqual(['Gamma', 'Beta', 'Alpha']);
  });

  it('sorts by overallScore ascending', async () => {
    const res = await get({ sortColumn: 'overall', sortOrder: 'asc' });
    const { videos } = await res.json();
    expect(videos.map((v: Video) => v.overallScore)).toEqual([2, 4, 5]);
  });

  it('sorts by overallScore descending', async () => {
    const res = await get({ sortColumn: 'overall', sortOrder: 'desc' });
    const { videos } = await res.json();
    expect(videos.map((v: Video) => v.overallScore)).toEqual([5, 4, 2]);
  });

  it('returns 400 when outputFolder is missing', async () => {
    const res = await GET(new Request('http://localhost/api/videos'));
    expect(res.status).toBe(400);
  });

  it('sorts by serialNumber ascending', async () => {
    mockReadIndex.mockReturnValue(makeIndex([
      { ...makeVideo('vid1', 4, 'Beta'), serialNumber: 3 },
      { ...makeVideo('vid2', 2, 'Alpha'), serialNumber: 1 },
      { ...makeVideo('vid3', 5, 'Gamma'), serialNumber: 2 },
    ]));
    const res = await get({ sortColumn: 'serialNumber', sortOrder: 'asc' });
    const { videos } = await res.json();
    expect(videos.map((v: Video) => v.id)).toEqual(['vid2', 'vid3', 'vid1']);
  });

  it('sorts by serialNumber descending', async () => {
    mockReadIndex.mockReturnValue(makeIndex([
      { ...makeVideo('vid1', 4, 'Beta'), serialNumber: 3 },
      { ...makeVideo('vid2', 2, 'Alpha'), serialNumber: 1 },
      { ...makeVideo('vid3', 5, 'Gamma'), serialNumber: 2 },
    ]));
    const res = await get({ sortColumn: 'serialNumber', sortOrder: 'desc' });
    const { videos } = await res.json();
    expect(videos.map((v: Video) => v.id)).toEqual(['vid1', 'vid3', 'vid2']);
  });

  it('falls back to name sort for an unrecognized sortColumn (e.g. a stale playlistIndex)', async () => {
    mockReadIndex.mockReturnValue(makeIndex([
      { ...makeVideo('vid1', 4, 'Charlie') },
      { ...makeVideo('vid2', 2, 'Alpha') },
      { ...makeVideo('vid3', 5, 'Bravo') },
    ]));
    const res = await get({ sortColumn: 'playlistIndex', sortOrder: 'asc' });
    const { videos } = await res.json();
    // 'playlistIndex' is no longer a valid column → guard falls back to name (title) sort
    expect(videos.map((v: Video) => v.title)).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });

  it('sorts videos without a serialNumber to the bottom regardless of direction', async () => {
    const withNoSerial = { ...makeVideo('vid2', 2, 'Alpha') };
    delete (withNoSerial as { serialNumber?: number }).serialNumber;
    mockReadIndex.mockReturnValue(makeIndex([
      { ...makeVideo('vid1', 4, 'Beta'), serialNumber: 2 },
      withNoSerial,
      { ...makeVideo('vid3', 5, 'Gamma'), serialNumber: 1 },
    ]));
    const asc = await (await get({ sortColumn: 'serialNumber', sortOrder: 'asc' })).json();
    expect(asc.videos.map((v: Video) => v.id)).toEqual(['vid3', 'vid1', 'vid2']);
    const desc = await (await get({ sortColumn: 'serialNumber', sortOrder: 'desc' })).json();
    expect(desc.videos.map((v: Video) => v.id)).toEqual(['vid1', 'vid3', 'vid2']);
  });

  it('includes playlistUrl from index in the response', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.playlistUrl).toBe('https://youtube.com/playlist?list=PLtest');
  });

  describe('sort by videoPublishedAt', () => {
    it('sorts by videoPublishedAt ascending (oldest first)', async () => {
      mockReadIndex.mockReturnValue(makeIndex([
        { ...makeVideo('vid1', 3), videoPublishedAt: '2025-03-01T00:00:00.000Z' },
        { ...makeVideo('vid2', 3), videoPublishedAt: '2024-11-12T00:00:00.000Z' },
        { ...makeVideo('vid3', 3), videoPublishedAt: '2025-01-20T00:00:00.000Z' },
      ]));
      const res = await get({ sortColumn: 'videoPublishedAt', sortOrder: 'asc' });
      const { videos } = await res.json();
      expect(videos.map((v: Video) => v.id)).toEqual(['vid2', 'vid3', 'vid1']);
    });

    it('sorts by videoPublishedAt descending (newest first)', async () => {
      mockReadIndex.mockReturnValue(makeIndex([
        { ...makeVideo('vid1', 3), videoPublishedAt: '2025-03-01T00:00:00.000Z' },
        { ...makeVideo('vid2', 3), videoPublishedAt: '2024-11-12T00:00:00.000Z' },
        { ...makeVideo('vid3', 3), videoPublishedAt: '2025-01-20T00:00:00.000Z' },
      ]));
      const res = await get({ sortColumn: 'videoPublishedAt', sortOrder: 'desc' });
      const { videos } = await res.json();
      expect(videos.map((v: Video) => v.id)).toEqual(['vid1', 'vid3', 'vid2']);
    });

    it('sorts videos with missing videoPublishedAt to the bottom (asc)', async () => {
      mockReadIndex.mockReturnValue(makeIndex([
        { ...makeVideo('vid1', 3), videoPublishedAt: '2025-01-01T00:00:00.000Z' },
        { ...makeVideo('vid2', 3) }, // no date
        { ...makeVideo('vid3', 3), videoPublishedAt: '2024-06-01T00:00:00.000Z' },
      ]));
      const res = await get({ sortColumn: 'videoPublishedAt', sortOrder: 'asc' });
      const { videos } = await res.json();
      expect(videos.map((v: Video) => v.id)).toEqual(['vid3', 'vid1', 'vid2']);
    });

    it('sorts videos with missing videoPublishedAt to the bottom (desc)', async () => {
      mockReadIndex.mockReturnValue(makeIndex([
        { ...makeVideo('vid1', 3), videoPublishedAt: '2025-01-01T00:00:00.000Z' },
        { ...makeVideo('vid2', 3) }, // no date
        { ...makeVideo('vid3', 3), videoPublishedAt: '2024-06-01T00:00:00.000Z' },
      ]));
      const res = await get({ sortColumn: 'videoPublishedAt', sortOrder: 'desc' });
      const { videos } = await res.json();
      expect(videos.map((v: Video) => v.id)).toEqual(['vid1', 'vid3', 'vid2']);
    });
  });

  describe('sort by addedToPlaylistAt', () => {
    it('sorts by addedToPlaylistAt descending (newest first)', async () => {
      mockReadIndex.mockReturnValue(makeIndex([
        { ...makeVideo('vid1', 3), addedToPlaylistAt: '2025-04-01T00:00:00.000Z' },
        { ...makeVideo('vid2', 3), addedToPlaylistAt: '2025-01-15T00:00:00.000Z' },
        { ...makeVideo('vid3', 3), addedToPlaylistAt: '2025-06-10T00:00:00.000Z' },
      ]));
      const res = await get({ sortColumn: 'addedToPlaylistAt', sortOrder: 'desc' });
      const { videos } = await res.json();
      expect(videos.map((v: Video) => v.id)).toEqual(['vid3', 'vid1', 'vid2']);
    });

    it('sorts videos with missing addedToPlaylistAt to the bottom (desc)', async () => {
      mockReadIndex.mockReturnValue(makeIndex([
        { ...makeVideo('vid1', 3), addedToPlaylistAt: '2025-04-01T00:00:00.000Z' },
        { ...makeVideo('vid2', 3) }, // no date
      ]));
      const res = await get({ sortColumn: 'addedToPlaylistAt', sortOrder: 'desc' });
      const { videos } = await res.json();
      expect(videos.map((v: Video) => v.id)).toEqual(['vid1', 'vid2']);
    });
  });

  describe('sort by personalScore', () => {
    beforeEach(() => {
      mockReadIndex.mockReturnValue(makeIndex([
        makeVideo('v1', 3, 'Alpha', 5),
        makeVideo('v2', 3, 'Beta',  2),
        makeVideo('v3', 3, 'Gamma', undefined), // unscored
      ]));
    });

    it('sorts personalScore descending: scored videos high→low, unscored last', async () => {
      const res = await get({ sortColumn: 'personalScore', sortOrder: 'desc' });
      const { videos } = await res.json();
      expect(videos.map((v: Video) => v.id)).toEqual(['v1', 'v2', 'v3']);
    });

    it('sorts personalScore ascending: scored videos low→high, unscored last', async () => {
      const res = await get({ sortColumn: 'personalScore', sortOrder: 'asc' });
      const { videos } = await res.json();
      expect(videos.map((v: Video) => v.id)).toEqual(['v2', 'v1', 'v3']);
    });

    it('two unscored videos maintain stable order (both return 0)', async () => {
      mockReadIndex.mockReturnValue(makeIndex([
        makeVideo('v1', 3, 'Alpha', undefined),
        makeVideo('v2', 3, 'Beta',  undefined),
      ]));
      const res = await get({ sortColumn: 'personalScore', sortOrder: 'asc' });
      const { videos } = await res.json();
      expect(videos.map((v: Video) => v.id)).toEqual(['v1', 'v2']); // stable: unchanged
    });
  });
});
