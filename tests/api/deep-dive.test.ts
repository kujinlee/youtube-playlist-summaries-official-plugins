jest.mock('../../lib/deep-dive');
jest.mock('../../lib/index-store');
jest.mock('../../lib/job-registry');

import { POST } from '../../app/api/videos/[id]/deep-dive/route';
import { GET as GET_STREAM } from '../../app/api/videos/[id]/deep-dive/stream/route';
import * as jobRegistry from '../../lib/job-registry';
import * as indexStore from '../../lib/index-store';
import * as deepDiveLib from '../../lib/deep-dive';

const mockCreateJob = jest.mocked(jobRegistry.createJob);
const mockEmitJobEvent = jest.mocked(jobRegistry.emitJobEvent);
const mockSubscribeJob = jest.mocked(jobRegistry.subscribeJob);
const mockAssertOutputFolder = jest.mocked(indexStore.assertOutputFolder);
const mockAssertVideoId = jest.mocked(indexStore.assertVideoId);
const mockRunDeepDive = jest.mocked(deepDiveLib.runDeepDive);

const OUTPUT_FOLDER = '/tmp/out';
const VIDEO_ID = 'testVideoId1';

function postDeepDive(videoId: string, body: object) {
  return POST(
    new Request(`http://localhost/api/videos/${videoId}/deep-dive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: videoId }) },
  );
}

describe('POST /api/videos/[id]/deep-dive', () => {
  beforeEach(() => {
    mockAssertOutputFolder.mockImplementation(() => {});
    mockAssertVideoId.mockImplementation(() => {});
    mockCreateJob.mockImplementation(() => {});
    mockEmitJobEvent.mockImplementation(() => {});
    mockRunDeepDive.mockResolvedValue(undefined);
  });

  afterEach(() => jest.clearAllMocks());

  it('returns 200 with a non-empty jobId', async () => {
    const res = await postDeepDive(VIDEO_ID, { outputFolder: OUTPUT_FOLDER });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.jobId).toBe('string');
    expect(body.jobId.length).toBeGreaterThan(0);
  });

  it('returns 400 when outputFolder is missing', async () => {
    const res = await postDeepDive(VIDEO_ID, {});
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid videoId', async () => {
    mockAssertVideoId.mockImplementation(() => { throw Object.assign(new Error('invalid'), { statusCode: 400 }); });
    const res = await postDeepDive('../etc/passwd', { outputFolder: OUTPUT_FOLDER });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/videos/[id]/deep-dive/stream', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns 404 for unknown jobId', async () => {
    mockSubscribeJob.mockReturnValue(null);
    const res = await GET_STREAM(
      new Request(`http://localhost/api/videos/${VIDEO_ID}/deep-dive/stream?jobId=unknown`),
      { params: Promise.resolve({ id: VIDEO_ID }) },
    );
    expect(res.status).toBe(404);
  });

  it('returns 400 when jobId param is missing', async () => {
    const res = await GET_STREAM(
      new Request(`http://localhost/api/videos/${VIDEO_ID}/deep-dive/stream`),
      { params: Promise.resolve({ id: VIDEO_ID }) },
    );
    expect(res.status).toBe(400);
  });

  it('returns 200 with text/event-stream for known jobId', async () => {
    mockSubscribeJob.mockImplementation((_jobId, _listener) => () => {});

    const res = await GET_STREAM(
      new Request(`http://localhost/api/videos/${VIDEO_ID}/deep-dive/stream?jobId=known-job`),
      { params: Promise.resolve({ id: VIDEO_ID }) },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');
  });
});
