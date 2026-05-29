jest.mock('../../lib/index-store');

import { GET } from '../../app/api/videos/[id]/quick-view/route';
import * as indexStore from '../../lib/index-store';

const mockReadIndex = jest.mocked(indexStore.readIndex);
const mockAssertOutputFolder = jest.mocked(indexStore.assertOutputFolder);
const mockAssertVideoId = jest.mocked(indexStore.assertVideoId);

const OUTPUT_FOLDER = '/tmp/out';
const VIDEO_ID = 'testVideoId1';

function getQuickView(videoId: string, outputFolder: string) {
  return GET(
    new Request(`http://localhost/api/videos/${videoId}/quick-view?outputFolder=${encodeURIComponent(outputFolder)}`),
    { params: Promise.resolve({ id: videoId }) },
  );
}

const baseIndex = {
  playlistUrl: 'https://youtube.com/playlist?list=PL1',
  outputFolder: OUTPUT_FOLDER,
  videos: [],
};

describe('GET /api/videos/[id]/quick-view', () => {
  beforeEach(() => {
    mockAssertOutputFolder.mockImplementation(() => {});
    mockAssertVideoId.mockImplementation(() => {});
  });
  afterEach(() => jest.clearAllMocks());

  it('returns 400 when outputFolder is missing', async () => {
    const res = await GET(
      new Request('http://localhost/api/videos/abc/quick-view'),
      { params: Promise.resolve({ id: 'abc' }) },
    );
    expect(res.status).toBe(400);
  });

  it('returns 404 when video is not in index', async () => {
    mockReadIndex.mockReturnValue({ ...baseIndex, videos: [] });
    const res = await getQuickView(VIDEO_ID, OUTPUT_FOLDER);
    expect(res.status).toBe(404);
  });

  it('returns 404 when video has no summaryMd', async () => {
    mockReadIndex.mockReturnValue({
      ...baseIndex,
      videos: [{ id: VIDEO_ID, summaryMd: null, tldr: undefined } as any],
    });
    const res = await getQuickView(VIDEO_ID, OUTPUT_FOLDER);
    expect(res.status).toBe(404);
  });

  it('returns 404 when video has summaryMd but no tldr', async () => {
    mockReadIndex.mockReturnValue({
      ...baseIndex,
      videos: [{ id: VIDEO_ID, summaryMd: 'test.md', tldr: undefined } as any],
    });
    const res = await getQuickView(VIDEO_ID, OUTPUT_FOLDER);
    expect(res.status).toBe(404);
  });

  it('returns 200 with tldr, takeaways, tags when all present', async () => {
    mockReadIndex.mockReturnValue({
      ...baseIndex,
      videos: [{
        id: VIDEO_ID,
        summaryMd: 'test.md',
        tldr: 'This video explains X.',
        takeaways: ['Point one', 'Point two'],
        tags: ['ai', 'rag'],
      } as any],
    });
    const res = await getQuickView(VIDEO_ID, OUTPUT_FOLDER);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      tldr: 'This video explains X.',
      takeaways: ['Point one', 'Point two'],
      tags: ['ai', 'rag'],
    });
  });

  it('returns empty arrays for missing takeaways/tags', async () => {
    mockReadIndex.mockReturnValue({
      ...baseIndex,
      videos: [{ id: VIDEO_ID, summaryMd: 'test.md', tldr: 'This video explains X.' } as any],
    });
    const res = await getQuickView(VIDEO_ID, OUTPUT_FOLDER);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.takeaways).toEqual([]);
    expect(body.tags).toEqual([]);
  });
});
