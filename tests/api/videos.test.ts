jest.mock('../../lib/index-store');

import { GET } from '../../app/api/videos/route';
import * as indexStore from '../../lib/index-store';
import type { Video, PlaylistIndex } from '../../types';

const mockReadIndex = jest.mocked(indexStore.readIndex);
const mockAssertOutputFolder = jest.mocked(indexStore.assertOutputFolder);

function makeVideo(id: string, overallScore: number, title = `Video ${id}`): Video {
  return {
    id,
    title,
    youtubeUrl: `https://youtube.com/watch?v=${id}`,
    language: 'en',
    durationSeconds: 300,
    archived: false,
    ratings: { usefulness: 3, depth: 3, originality: 3, recency: 3, completeness: 3 },
    overallScore,
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

  it('includes playlistUrl from index in the response', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.playlistUrl).toBe('https://youtube.com/playlist?list=PLtest');
  });
});
