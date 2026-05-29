jest.mock('../../lib/index-store');

import { POST } from '../../app/api/videos/[id]/review/route';
import * as indexStore from '../../lib/index-store';

const mockUpdateVideoFields = jest.mocked(indexStore.updateVideoFields);
const mockAssertOutputFolder = jest.mocked(indexStore.assertOutputFolder);
const mockAssertVideoId     = jest.mocked(indexStore.assertVideoId);

const OUTPUT_FOLDER = '/tmp/out';
const VIDEO_ID      = 'testVideoId1';

function postReview(videoId: string, body: Record<string, unknown>) {
  return POST(
    new Request(`http://localhost/api/videos/${videoId}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: videoId }) },
  );
}

describe('POST /api/videos/[id]/review', () => {
  beforeEach(() => {
    mockAssertOutputFolder.mockImplementation(() => {});
    mockAssertVideoId.mockImplementation(() => {});
    mockUpdateVideoFields.mockImplementation(() => {});
  });

  afterEach(() => jest.clearAllMocks());

  // ── Happy paths ────────────────────────────────────────────────────────────

  it('saves personalScore when provided', async () => {
    const res = await postReview(VIDEO_ID, { outputFolder: OUTPUT_FOLDER, personalScore: 4 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockUpdateVideoFields).toHaveBeenCalledWith(OUTPUT_FOLDER, VIDEO_ID, { personalScore: 4 });
  });

  it('saves personalNote when provided', async () => {
    const res = await postReview(VIDEO_ID, { outputFolder: OUTPUT_FOLDER, personalNote: 'great video' });
    expect(res.status).toBe(200);
    expect(mockUpdateVideoFields).toHaveBeenCalledWith(OUTPUT_FOLDER, VIDEO_ID, { personalNote: 'great video' });
  });

  it('saves both fields when both are provided', async () => {
    const res = await postReview(VIDEO_ID, { outputFolder: OUTPUT_FOLDER, personalScore: 3, personalNote: 'ok' });
    expect(res.status).toBe(200);
    expect(mockUpdateVideoFields).toHaveBeenCalledWith(OUTPUT_FOLDER, VIDEO_ID, { personalScore: 3, personalNote: 'ok' });
  });

  it('deletes personalScore when null is sent (passes undefined to updateVideoFields)', async () => {
    const res = await postReview(VIDEO_ID, { outputFolder: OUTPUT_FOLDER, personalScore: null });
    expect(res.status).toBe(200);
    expect(mockUpdateVideoFields).toHaveBeenCalledWith(OUTPUT_FOLDER, VIDEO_ID, { personalScore: undefined });
  });

  it('deletes personalNote when empty string is sent (passes undefined to updateVideoFields)', async () => {
    const res = await postReview(VIDEO_ID, { outputFolder: OUTPUT_FOLDER, personalNote: '' });
    expect(res.status).toBe(200);
    expect(mockUpdateVideoFields).toHaveBeenCalledWith(OUTPUT_FOLDER, VIDEO_ID, { personalNote: undefined });
  });

  // ── Validation errors ──────────────────────────────────────────────────────

  it('returns 400 when outputFolder is missing', async () => {
    const res = await postReview(VIDEO_ID, { personalScore: 3 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('outputFolder is required');
  });

  it('returns 400 when neither personalScore nor personalNote is present', async () => {
    const res = await postReview(VIDEO_ID, { outputFolder: OUTPUT_FOLDER });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('at least one field required');
  });

  it('returns 400 for personalScore: 0', async () => {
    const res = await postReview(VIDEO_ID, { outputFolder: OUTPUT_FOLDER, personalScore: 0 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('personalScore must be 1–5 or null');
  });

  it('returns 400 for personalScore: 6', async () => {
    const res = await postReview(VIDEO_ID, { outputFolder: OUTPUT_FOLDER, personalScore: 6 });
    expect(res.status).toBe(400);
  });

  it('returns 400 for non-integer personalScore', async () => {
    const res = await postReview(VIDEO_ID, { outputFolder: OUTPUT_FOLDER, personalScore: 3.5 });
    expect(res.status).toBe(400);
  });

  it('returns 400 for personalNote over 500 chars', async () => {
    const res = await postReview(VIDEO_ID, { outputFolder: OUTPUT_FOLDER, personalNote: 'a'.repeat(501) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('personalNote must be 500 characters or fewer');
  });

  // ── Not-found and internal error ───────────────────────────────────────────

  it('returns 404 when video not found in index', async () => {
    mockUpdateVideoFields.mockImplementation(() => {
      throw new Error(`Video not found in index: ${VIDEO_ID}`);
    });
    const res = await postReview(VIDEO_ID, { outputFolder: OUTPUT_FOLDER, personalScore: 3 });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('video not found');
  });

  it('returns 400 for invalid videoId (assertVideoId throws)', async () => {
    mockAssertVideoId.mockImplementation(() => {
      throw Object.assign(new Error('invalid videoId'), { statusCode: 400 });
    });
    const res = await postReview('bad**id', { outputFolder: OUTPUT_FOLDER, personalScore: 3 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid request');
  });

  it('returns 500 when updateVideoFields throws a non-not-found error', async () => {
    mockUpdateVideoFields.mockImplementation(() => {
      throw new Error('disk full');
    });
    const res = await postReview(VIDEO_ID, { outputFolder: OUTPUT_FOLDER, personalScore: 3 });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('internal error');
  });
});
