jest.mock('../../lib/index-store');
jest.mock('../../lib/gemini');
jest.mock('../../lib/pipeline', () => ({
  ...jest.requireActual('../../lib/pipeline'),
  stripQuickViewCallout: jest.fn((s: string) => s),
  insertQuickViewCallout: jest.fn((_md: string, tldr: string, takeaways: string[]) => `CALLOUT:${tldr}:${takeaways.join(',')}`),
}));
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  promises: {
    readFile: jest.fn(),
    writeFile: jest.fn(),
  },
}));

import { POST } from '../../app/api/videos/[id]/regenerate/route';
import * as indexStore from '../../lib/index-store';
import * as gemini from '../../lib/gemini';
import * as fs from 'fs';

const mockReadIndex = jest.mocked(indexStore.readIndex);
const mockAssertOutputFolder = jest.mocked(indexStore.assertOutputFolder);
const mockAssertVideoId = jest.mocked(indexStore.assertVideoId);
const mockUpdateVideoFields = jest.mocked(indexStore.updateVideoFields);
const mockFixSummary = jest.mocked(gemini.fixSummary);
const mockExtractQuickView = jest.mocked(gemini.extractQuickView);
const mockReadFile = jest.mocked(fs.promises.readFile);
const mockWriteFile = jest.mocked(fs.promises.writeFile);

const OUTPUT_FOLDER = '/tmp/out';
const VIDEO_ID = 'testVideoId1';
const SUMMARY_MD = 'test-video.md';
const MD_CONTENT = '# Title\n\n**URL:** https://youtube.com/watch?v=testVideoId1\n\n---\n\n## 1. Intro\nContent.';

function post(videoId: string, body: Record<string, unknown>) {
  return POST(
    new Request('http://localhost/api/videos/test/regenerate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: videoId }) },
  );
}

const baseVideo = {
  id: VIDEO_ID,
  title: 'Test Video',
  summaryMd: SUMMARY_MD,
  tags: ['ai', 'rag'],
  tldr: 'Old TL;DR.',
  takeaways: ['Old point'],
};

const baseIndex = {
  playlistUrl: 'https://youtube.com/playlist?list=PL1',
  outputFolder: OUTPUT_FOLDER,
  videos: [baseVideo],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockAssertOutputFolder.mockImplementation(() => {});
  mockAssertVideoId.mockImplementation(() => {});
  mockReadIndex.mockReturnValue(baseIndex as any);
  mockReadFile.mockResolvedValue(MD_CONTENT as any);
  mockWriteFile.mockResolvedValue(undefined);
  mockFixSummary.mockResolvedValue(MD_CONTENT);
  mockExtractQuickView.mockResolvedValue({
    tldr: 'This video teaches X.',
    takeaways: ['Point one', 'Point two'],
  });
});

describe('POST /api/videos/[id]/regenerate', () => {
  it('returns 400 when outputFolder is missing', async () => {
    const res = await post(VIDEO_ID, {});
    expect(res.status).toBe(400);
  });

  it('returns 400 when videoId is invalid', async () => {
    mockAssertVideoId.mockImplementation(() => { throw new Error('bad id'); });
    const res = await post('bad id!', { outputFolder: OUTPUT_FOLDER });
    expect(res.status).toBe(400);
  });

  it('returns 404 when video is not in index', async () => {
    mockReadIndex.mockReturnValue({ ...baseIndex, videos: [] } as any);
    const res = await post(VIDEO_ID, { outputFolder: OUTPUT_FOLDER });
    expect(res.status).toBe(404);
  });

  it('returns 422 when video has no summaryMd', async () => {
    mockReadIndex.mockReturnValue({
      ...baseIndex,
      videos: [{ ...baseVideo, summaryMd: null }],
    } as any);
    const res = await post(VIDEO_ID, { outputFolder: OUTPUT_FOLDER });
    expect(res.status).toBe(422);
  });

  it('calls fixSummary when corrections are provided', async () => {
    const corrections = "Fix 'Clawcode' → 'Claude Code'";
    await post(VIDEO_ID, { outputFolder: OUTPUT_FOLDER, corrections });
    expect(mockFixSummary).toHaveBeenCalledWith(MD_CONTENT, corrections);
  });

  it('does not call fixSummary when corrections is empty string', async () => {
    await post(VIDEO_ID, { outputFolder: OUTPUT_FOLDER, corrections: '' });
    expect(mockFixSummary).not.toHaveBeenCalled();
  });

  it('does not call fixSummary when corrections is absent', async () => {
    await post(VIDEO_ID, { outputFolder: OUTPUT_FOLDER });
    expect(mockFixSummary).not.toHaveBeenCalled();
  });

  it('saves corrections to index before Gemini call', async () => {
    const corrections = 'Fix spelling';
    await post(VIDEO_ID, { outputFolder: OUTPUT_FOLDER, corrections });
    // updateVideoFields for corrections should be called before fixSummary
    const updateCalls = mockUpdateVideoFields.mock.invocationCallOrder;
    const fixCalls = mockFixSummary.mock.invocationCallOrder;
    expect(updateCalls[0]).toBeLessThan(fixCalls[0]);
  });

  it('returns 200 with new tldr, takeaways on success', async () => {
    const res = await post(VIDEO_ID, { outputFolder: OUTPUT_FOLDER });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tldr).toBe('This video teaches X.');
    expect(body.takeaways).toEqual(['Point one', 'Point two']);
  });

  it('returns 200 and echoes corrections in response', async () => {
    const corrections = 'Fix Clawcode';
    const res = await post(VIDEO_ID, { outputFolder: OUTPUT_FOLDER, corrections });
    const body = await res.json();
    expect(body.corrections).toBe('Fix Clawcode');
  });

  it('updates the index with new tldr and takeaways', async () => {
    await post(VIDEO_ID, { outputFolder: OUTPUT_FOLDER });
    expect(mockUpdateVideoFields).toHaveBeenCalledWith(
      OUTPUT_FOLDER,
      VIDEO_ID,
      expect.objectContaining({ tldr: 'This video teaches X.', takeaways: ['Point one', 'Point two'] }),
    );
  });

  it('returns 500 when Gemini throws', async () => {
    mockExtractQuickView.mockRejectedValueOnce(new Error('Gemini failed'));
    const res = await post(VIDEO_ID, { outputFolder: OUTPUT_FOLDER });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/Gemini failed/);
  });

  it('clears summaryHtml in the index update on success', async () => {
    await post(VIDEO_ID, { outputFolder: OUTPUT_FOLDER });
    expect(mockUpdateVideoFields).toHaveBeenCalledWith(
      OUTPUT_FOLDER,
      VIDEO_ID,
      expect.objectContaining({ summaryHtml: null }),
    );
  });

  it('includes summaryHtml: null in the JSON response on success', async () => {
    const res = await post(VIDEO_ID, { outputFolder: OUTPUT_FOLDER });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(expect.objectContaining({ summaryHtml: null }));
  });
});
