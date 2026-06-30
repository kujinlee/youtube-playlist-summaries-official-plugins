jest.mock('../../lib/html-doc/batch');
jest.mock('../../lib/index-store', () => ({
  assertOutputFolder: jest.fn(),
}));

import { POST } from '../../app/api/videos/batch-docs/route';
import { GET } from '../../app/api/videos/batch-docs/stream/route';
import * as batch from '../../lib/html-doc/batch';
import { _resetJobRegistry, createJob, emitJobEvent, getActiveJob, getJobSignal } from '../../lib/job-registry';

const mockRun = jest.mocked(batch.runBatchDocs);
const OF = '/home/u/p'; // assertOutputFolder allows tmp/home; this path is validated by the real fn — mock if needed

beforeEach(() => {
  _resetJobRegistry();
  mockRun.mockResolvedValue(undefined);
});

function post(body: unknown) {
  return POST(new Request('http://localhost/api/videos/batch-docs', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }));
}

it('AA1: returns a jobId and starts runBatchDocs', async () => {
  const res = await post({ outputFolder: OF, videoIds: ['a', 'b'], mode: 'summary' });
  expect(res.status).toBe(200);
  const { jobId } = await res.json();
  expect(typeof jobId).toBe('string');
  expect(mockRun).toHaveBeenCalledWith(['a', 'b'], 'summary', OF, expect.any(Function), expect.anything());
});

it('AA1: 400 without outputFolder or videoIds', async () => {
  expect((await post({ videoIds: ['a'], mode: 'summary' })).status).toBe(400);
  expect((await post({ outputFolder: OF, mode: 'summary' })).status).toBe(400);
});

it('AA2: 409 when a batch is already running for the folder', async () => {
  await post({ outputFolder: OF, videoIds: ['a'], mode: 'summary' });
  // the first POST holds the lock on `${OF}::batch-docs`
  expect(getActiveJob(`${OF}::batch-docs`)).toBeDefined();
  const res2 = await post({ outputFolder: OF, videoIds: ['b'], mode: 'summary' });
  expect(res2.status).toBe(409);
});

it('AA2 stream: 400 without jobId, 404 unknown, replays + non-fatal per-video error keeps open', async () => {
  expect((await GET(new Request('http://localhost/s'))).status).toBe(400);
  expect((await GET(new Request('http://localhost/s?jobId=nope'))).status).toBe(404);

  createJob('jB');
  emitJobEvent('jB', { type: 'step', step: 'Generating HTML doc…', videoId: 'a', current: 1, total: 2 });
  emitJobEvent('jB', { type: 'error', videoId: 'a', log: 'x' }); // non-fatal
  emitJobEvent('jB', { type: 'done', succeeded: 1, failed: 1 }); // terminal
  const res = await GET(new Request('http://localhost/s?jobId=jB'));
  const text = await res.text();
  expect(text).toContain('"type":"step"');
  expect(text).toContain('"type":"error"');
  expect(text).toContain('"type":"done"');
});

it('AA-cancel: cancel aborts the job signal', async () => {
  const { POST: CANCEL } = await import('../../app/api/videos/batch-docs/cancel/route');
  createJob('jC', '/of::batch-docs');
  const signal = getJobSignal('jC');
  const res = await CANCEL(new Request('http://localhost/cancel', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jobId: 'jC' }),
  }));
  expect(res.status).toBe(200);
  expect(signal?.aborted).toBe(true);
});
