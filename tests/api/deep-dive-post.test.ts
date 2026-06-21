import { POST } from '../../app/api/videos/[id]/deep-dive/route';
import { GET as GET_STREAM } from '../../app/api/videos/[id]/deep-dive/stream/route';
import * as ensure from '../../lib/deep-dive/ensure';
import * as indexStore from '../../lib/index-store';
import * as jobRegistry from '../../lib/job-registry';
import { _resetJobRegistry } from '../../lib/job-registry';

jest.mock('../../lib/deep-dive/ensure');
jest.mock('../../lib/index-store');

const mockEnsure = ensure.ensureDeepDiveHtml as jest.Mock;
const mockAssertOutputFolder = jest.mocked(indexStore.assertOutputFolder);
const mockAssertVideoId = jest.mocked(indexStore.assertVideoId);

const HOME = (process.env.HOME ?? '/tmp') + '/playlist';
const VIDEO_ID = 'vid12345';

function req(videoId: string, body: unknown) {
  return new Request(`http://localhost/api/videos/${videoId}/deep-dive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
function ctx(videoId: string) {
  return { params: Promise.resolve({ id: videoId }) };
}

function post(videoId: string, body: unknown) {
  return POST(req(videoId, body), ctx(videoId));
}

beforeEach(() => {
  jest.clearAllMocks();
  _resetJobRegistry();
  mockAssertOutputFolder.mockImplementation(() => {});
  mockAssertVideoId.mockImplementation(() => {});
  mockEnsure.mockResolvedValue(undefined);
});

// ── POST: 400 validation ─────────────────────────────────────────────────────

describe('POST /api/videos/[id]/deep-dive — validation', () => {
  it('400 when outputFolder is missing', async () => {
    const res = await post(VIDEO_ID, {});
    expect(res.status).toBe(400);
  });

  it('400 when outputFolder is null', async () => {
    const res = await post(VIDEO_ID, { outputFolder: null });
    expect(res.status).toBe(400);
  });

  it('400 on assertOutputFolder throwing (e.g. outside home)', async () => {
    mockAssertOutputFolder.mockImplementation(() => { throw new Error('outside home'); });
    const res = await post(VIDEO_ID, { outputFolder: '/etc' });
    expect(res.status).toBe(400);
  });

  it('400 on assertVideoId throwing (invalid videoId)', async () => {
    mockAssertVideoId.mockImplementation(() => { throw new Error('invalid videoId'); });
    const res = await post('../etc/passwd', { outputFolder: HOME });
    expect(res.status).toBe(400);
  });
});

// ── POST: happy path ─────────────────────────────────────────────────────────

describe('POST /api/videos/[id]/deep-dive — happy path', () => {
  it('drives ensureDeepDiveHtml and returns a non-empty jobId', async () => {
    const res = await post(VIDEO_ID, { outputFolder: HOME });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.jobId).toBe('string');
    expect(body.jobId.length).toBeGreaterThan(0);
    expect(mockEnsure).toHaveBeenCalledWith(VIDEO_ID, HOME, expect.any(Function));
  });

  it('returns the SAME jobId for a concurrent duplicate submit (guard prevents second run)', async () => {
    mockEnsure.mockReturnValue(new Promise(() => {})); // hangs → job stays active
    const first = await (await post(VIDEO_ID, { outputFolder: HOME })).json();
    const second = await (await post(VIDEO_ID, { outputFolder: HOME })).json();
    expect(second.jobId).toBe(first.jobId);
    expect(mockEnsure).toHaveBeenCalledTimes(1);
  });

  it('two different videos in the same folder each get their own jobId', async () => {
    mockEnsure.mockReturnValue(new Promise(() => {})); // both hang
    const rawA = await post('videoA', { outputFolder: HOME });
    expect(rawA.status).toBe(200);
    const resA = await rawA.json();
    const rawB = await post('videoB', { outputFolder: HOME });
    expect(rawB.status).toBe(200);
    const resB = await rawB.json();
    expect(resA.jobId).not.toBe(resB.jobId);
    expect(mockEnsure).toHaveBeenCalledTimes(2);
  });
});

// ── GET /stream ───────────────────────────────────────────────────────────────

describe('GET /api/videos/[id]/deep-dive/stream', () => {
  function streamReq(jobId?: string) {
    const url = jobId
      ? `http://localhost/api/videos/${VIDEO_ID}/deep-dive/stream?jobId=${jobId}`
      : `http://localhost/api/videos/${VIDEO_ID}/deep-dive/stream`;
    return new Request(url);
  }
  const streamCtx = { params: Promise.resolve({ id: VIDEO_ID }) };

  it('400 when jobId param is missing', async () => {
    const res = await GET_STREAM(streamReq(), streamCtx);
    expect(res.status).toBe(400);
  });

  it('404 for an unknown jobId', async () => {
    const res = await GET_STREAM(streamReq('unknown-job-id'), streamCtx);
    expect(res.status).toBe(404);
  });

  it('200 with text/event-stream for a live job', async () => {
    // Seed the registry directly so the stream route finds the job
    const jobId = 'known-job-id-abc';
    jobRegistry.createJob(jobId, `${HOME}::${VIDEO_ID}`);

    const res = await GET_STREAM(streamReq(jobId), streamCtx);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');
  });
});
