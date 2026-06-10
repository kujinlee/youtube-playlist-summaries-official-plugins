import { GET } from '../../app/api/videos/[id]/html-doc/stream/route';
import { createJob, emitJobEvent, _resetJobRegistry } from '../../lib/job-registry';

const ctx = { params: Promise.resolve({ id: 'v' }) };
beforeEach(() => _resetJobRegistry());

it('400s without a jobId', async () => {
  expect((await GET(new Request('http://localhost/s'), ctx)).status).toBe(400);
});

it('404s for an unknown jobId', async () => {
  expect((await GET(new Request('http://localhost/s?jobId=nope'), ctx)).status).toBe(404);
});

it('replays buffered terminal events to a late subscriber (Codex BLOCKING)', async () => {
  createJob('jX');
  emitJobEvent('jX', { type: 'step', step: 'Rendering HTML…', current: 3, total: 3 });
  emitJobEvent('jX', { type: 'done' }); // job finished BEFORE the client subscribes

  const res = await GET(new Request('http://localhost/s?jobId=jX'), ctx);
  expect(res.status).toBe(200);
  const text = await res.text(); // stream closes after the replayed terminal event
  expect(text).toContain('"type":"step"');
  expect(text).toContain('"type":"done"');
});
