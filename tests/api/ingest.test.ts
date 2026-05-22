jest.mock('../../lib/pipeline');
jest.mock('../../lib/index-store');
jest.mock('../../lib/job-registry');

import { POST } from '../../app/api/ingest/route';
import { GET as GET_STREAM } from '../../app/api/ingest/stream/route';
import * as jobRegistry from '../../lib/job-registry';
import * as indexStore from '../../lib/index-store';
import * as pipeline from '../../lib/pipeline';

const mockCreateJob = jest.mocked(jobRegistry.createJob);
const mockEmitJobEvent = jest.mocked(jobRegistry.emitJobEvent);
const mockSubscribeJob = jest.mocked(jobRegistry.subscribeJob);
const mockResetJobRegistry = jest.mocked(jobRegistry._resetJobRegistry);
const mockAssertOutputFolder = jest.mocked(indexStore.assertOutputFolder);
const mockRunIngestion = jest.mocked(pipeline.runIngestion);

const OUTPUT_FOLDER = '/tmp/out';
const PLAYLIST_URL = 'https://youtube.com/playlist?list=PLtest';

function postIngest(body: object) {
  return POST(new Request('http://localhost/api/ingest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

describe('POST /api/ingest', () => {
  beforeEach(() => {
    mockAssertOutputFolder.mockImplementation(() => {});
    mockCreateJob.mockImplementation(() => {});
    mockEmitJobEvent.mockImplementation(() => {});
    mockResetJobRegistry.mockImplementation(() => {});
    mockRunIngestion.mockResolvedValue(undefined);
  });

  afterEach(() => jest.clearAllMocks());

  it('returns 200 with a non-empty jobId', async () => {
    const res = await postIngest({ playlistUrl: PLAYLIST_URL, outputFolder: OUTPUT_FOLDER });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.jobId).toBe('string');
    expect(body.jobId.length).toBeGreaterThan(0);
  });

  it('returns 400 when playlistUrl is missing', async () => {
    const res = await postIngest({ outputFolder: OUTPUT_FOLDER });
    expect(res.status).toBe(400);
  });

  it('returns 400 when outputFolder is missing', async () => {
    const res = await postIngest({ playlistUrl: PLAYLIST_URL });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/ingest/stream', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns 404 for unknown jobId', async () => {
    mockSubscribeJob.mockReturnValue(null);
    const res = await GET_STREAM(new Request('http://localhost/api/ingest/stream?jobId=unknown'));
    expect(res.status).toBe(404);
  });

  it('returns 400 when jobId param is missing', async () => {
    const res = await GET_STREAM(new Request('http://localhost/api/ingest/stream'));
    expect(res.status).toBe(400);
  });

  it('returns 200 with text/event-stream for known jobId', async () => {
    mockSubscribeJob.mockImplementation((_jobId, _listener) => () => {});

    const res = await GET_STREAM(new Request('http://localhost/api/ingest/stream?jobId=known-job'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');
  });
});
