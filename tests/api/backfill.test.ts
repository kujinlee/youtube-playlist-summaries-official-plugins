jest.mock('../../lib/index-store');
jest.mock('../../lib/gemini');
jest.mock('../../lib/pipeline');
jest.mock('../../lib/pdf');
// Suppress youtube module-init side effects (GoogleApis registration) that
// would fail in the Jest JSDOM environment without a real network context.
jest.mock('../../lib/youtube');

// Mock fs.promises methods while keeping all other fs exports intact
// (googleapis-common uses fs.readFile at module init via util.promisify)
jest.mock('fs', () => {
  const actual = jest.requireActual<typeof import('fs')>('fs');
  return {
    ...actual,
    promises: {
      ...actual.promises,
      readFile: jest.fn(),
      writeFile: jest.fn(),
    },
  };
});

import { GET } from '../../app/api/quick-view/backfill/route';
import * as indexStore from '../../lib/index-store';
import * as gemini from '../../lib/gemini';
import * as pipeline from '../../lib/pipeline';
import * as pdfLib from '../../lib/pdf';
import fs from 'fs';

const mockReadIndex = jest.mocked(indexStore.readIndex);
const mockAssertOutputFolder = jest.mocked(indexStore.assertOutputFolder);
const mockUpdateVideoFields = jest.mocked(indexStore.updateVideoFields);
const mockExtractQuickView = jest.mocked(gemini.extractQuickView);
const mockInsertQuickViewCallout = jest.mocked(pipeline.insertQuickViewCallout);
const mockGeneratePdf = jest.mocked(pdfLib.generatePdf);
const mockReadFile = fs.promises.readFile as jest.Mock;
const mockWriteFile = fs.promises.writeFile as jest.Mock;

const OUTPUT_FOLDER = '/tmp/out';

const eligibleVideo = {
  id: 'vid1111111',
  title: 'Test Video',
  summaryMd: 'test.md',
  summaryPdf: 'pdfs/test.pdf',
  tldr: undefined,
  tags: ['ai'],
} as any;

async function collectSSEEvents(response: Response): Promise<any[]> {
  const text = await response.text();
  return text
    .split('\n\n')
    .filter((chunk) => chunk.startsWith('data: '))
    .map((chunk) => JSON.parse(chunk.slice(6)));
}

function getBackfill(outputFolder: string) {
  return GET(new Request(`http://localhost/api/quick-view/backfill?outputFolder=${encodeURIComponent(outputFolder)}`));
}

describe('GET /api/quick-view/backfill', () => {
  beforeEach(() => {
    mockAssertOutputFolder.mockImplementation(() => {});
    mockUpdateVideoFields.mockImplementation(() => {});
    mockExtractQuickView.mockResolvedValue({ tldr: 'This video explains X.', takeaways: ['Point one'] });
    mockInsertQuickViewCallout.mockReturnValue('updated md content');
    mockGeneratePdf.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue('original md content');
    mockWriteFile.mockResolvedValue(undefined);
    mockReadIndex.mockReturnValue({
      playlistUrl: '',
      outputFolder: OUTPUT_FOLDER,
      videos: [eligibleVideo],
    });
  });
  afterEach(() => jest.clearAllMocks());

  it('returns 400 when outputFolder is missing', async () => {
    const res = await GET(new Request('http://localhost/api/quick-view/backfill'));
    expect(res.status).toBe(400);
  });

  it('returns 400 when assertOutputFolder throws', async () => {
    mockAssertOutputFolder.mockImplementationOnce(() => {
      throw new Error('path traversal');
    });
    const res = await getBackfill(OUTPUT_FOLDER);
    expect(res.status).toBe(400);
  });

  it('emits start event with total count', async () => {
    const res = await getBackfill(OUTPUT_FOLDER);
    const events = await collectSSEEvents(res);
    expect(events[0]).toEqual({ type: 'start', total: 1 });
  });

  it('emits step event for successful video', async () => {
    const res = await getBackfill(OUTPUT_FOLDER);
    const events = await collectSSEEvents(res);
    const step = events.find((e) => e.type === 'step');
    expect(step).toMatchObject({ type: 'step', videoId: 'vid1111111', title: 'Test Video', step: 'done', current: 1, total: 1 });
  });

  it('emits done event at end with succeeded count', async () => {
    const res = await getBackfill(OUTPUT_FOLDER);
    const events = await collectSSEEvents(res);
    const done = events.find((e) => e.type === 'done');
    expect(done).toMatchObject({ type: 'done', succeeded: 1, failed: 0 });
  });

  it('emits error event and continues when a video fails', async () => {
    mockExtractQuickView
      .mockRejectedValueOnce(new Error('Gemini timeout'))
      .mockResolvedValue({ tldr: 'This video explains Y.', takeaways: ['Point two'] });
    mockReadIndex.mockReturnValue({
      playlistUrl: '', outputFolder: OUTPUT_FOLDER,
      videos: [eligibleVideo, { ...eligibleVideo, id: 'vid2222222', title: 'Second' }],
    });
    const res = await getBackfill(OUTPUT_FOLDER);
    const events = await collectSSEEvents(res);
    expect(events.some((e) => e.type === 'error' && e.videoId === 'vid1111111')).toBe(true);
    expect(events.some((e) => e.type === 'step' && e.videoId === 'vid2222222')).toBe(true);
    const done = events.find((e) => e.type === 'done');
    expect(done).toMatchObject({ succeeded: 1, failed: 1 });
  });

  it('skips videos that already have tldr', async () => {
    mockReadIndex.mockReturnValue({
      playlistUrl: '', outputFolder: OUTPUT_FOLDER,
      videos: [{ ...eligibleVideo, tldr: 'Already done.' }],
    });
    const res = await getBackfill(OUTPUT_FOLDER);
    const events = await collectSSEEvents(res);
    expect(events[0]).toMatchObject({ type: 'start', total: 0 });
    expect(mockExtractQuickView).not.toHaveBeenCalled();
  });

  it('skips PDF regeneration when summaryPdf is null', async () => {
    mockReadIndex.mockReturnValue({
      playlistUrl: '', outputFolder: OUTPUT_FOLDER,
      videos: [{ ...eligibleVideo, summaryPdf: null }],
    });
    await getBackfill(OUTPUT_FOLDER);
    expect(mockGeneratePdf).not.toHaveBeenCalled();
  });
});
