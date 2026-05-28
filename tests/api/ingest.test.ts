jest.mock('../../lib/pipeline');
jest.mock('../../lib/index-store');
jest.mock('../../lib/job-registry');

import { POST } from '../../app/api/ingest/route';
import { GET as GET_STREAM } from '../../app/api/ingest/stream/route';
import * as jobRegistry from '../../lib/job-registry';
import * as indexStore from '../../lib/index-store';
import * as pipeline from '../../lib/pipeline';

const mockCreateJob = jest.mocked(jobRegistry.createJob);
const mockDeleteJob = jest.mocked(jobRegistry.deleteJob);
const mockEmitJobEvent = jest.mocked(jobRegistry.emitJobEvent);
const mockSubscribeJob = jest.mocked(jobRegistry.subscribeJob);
const mockResetJobRegistry = jest.mocked(jobRegistry._resetJobRegistry);
const mockIsIngestionRunning = jest.mocked(jobRegistry.isIngestionRunning);
const mockAssertOutputFolder = jest.mocked(indexStore.assertOutputFolder);
const mockRunIngestion = jest.mocked(pipeline.runIngestion);

import type { ProgressEvent } from '../../types';

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
    mockDeleteJob.mockImplementation(() => {});
    mockEmitJobEvent.mockImplementation(() => {});
    mockResetJobRegistry.mockImplementation(() => {});
    mockIsIngestionRunning.mockReturnValue(false); // default: no active job
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

  it('returns 409 when ingestion is already running for the same outputFolder', async () => {
    mockIsIngestionRunning.mockReturnValue(true);
    const res = await postIngest({ playlistUrl: PLAYLIST_URL, outputFolder: OUTPUT_FOLDER });
    expect(res.status).toBe(409);
  });

  it('does not delete the job when a per-video error is emitted (videoId present)', async () => {
    let capturedCallback: ((event: ProgressEvent) => void) | undefined;
    mockRunIngestion.mockImplementation(async (_url, _folder, onProgress) => {
      capturedCallback = onProgress;
    });

    await postIngest({ playlistUrl: PLAYLIST_URL, outputFolder: OUTPUT_FOLDER });
    capturedCallback?.({ type: 'error', videoId: 'vid1', title: 'Video 1', log: 'transcript unavailable' });

    expect(mockDeleteJob).not.toHaveBeenCalled();
  });

  it('deletes the job when a fatal pipeline error is emitted (no videoId)', async () => {
    let capturedCallback: ((event: ProgressEvent) => void) | undefined;
    mockRunIngestion.mockImplementation(async (_url, _folder, onProgress) => {
      capturedCallback = onProgress;
    });

    await postIngest({ playlistUrl: PLAYLIST_URL, outputFolder: OUTPUT_FOLDER });
    capturedCallback?.({ type: 'error', log: 'YOUTUBE_API_KEY is not set' });

    expect(mockDeleteJob).toHaveBeenCalled();
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

  it('does not unsubscribe after a per-video error (stream stays open)', async () => {
    // unsubscribe() being called is the signal that the stream controller was closed.
    // A per-video error (videoId present) must NOT trigger it.
    const unsubscribeFn = jest.fn();
    let emit: (event: ProgressEvent) => void = () => {};
    mockSubscribeJob.mockImplementation((_jobId, listener) => {
      emit = listener;
      return unsubscribeFn;
    });

    await GET_STREAM(new Request('http://localhost/api/ingest/stream?jobId=job1'));

    emit({ type: 'error', videoId: 'vid1', title: 'V1', log: 'no transcript' });
    expect(unsubscribeFn).not.toHaveBeenCalled();
  });

  it('unsubscribes (closes stream) on a done event', async () => {
    const unsubscribeFn = jest.fn();
    let emit: (event: ProgressEvent) => void = () => {};
    mockSubscribeJob.mockImplementation((_jobId, listener) => {
      emit = listener;
      return unsubscribeFn;
    });

    await GET_STREAM(new Request('http://localhost/api/ingest/stream?jobId=job2'));

    emit({ type: 'done' });
    expect(unsubscribeFn).toHaveBeenCalled();
  });

  it('unsubscribes (closes stream) on a fatal error (no videoId)', async () => {
    const unsubscribeFn = jest.fn();
    let emit: (event: ProgressEvent) => void = () => {};
    mockSubscribeJob.mockImplementation((_jobId, listener) => {
      emit = listener;
      return unsubscribeFn;
    });

    await GET_STREAM(new Request('http://localhost/api/ingest/stream?jobId=job3'));

    emit({ type: 'error', log: 'YOUTUBE_API_KEY is not set' });
    expect(unsubscribeFn).toHaveBeenCalled();
  });
});
