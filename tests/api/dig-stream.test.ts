/**
 * Tests for GET /api/videos/[id]/dig/[sectionId]/stream
 *
 * This is an SSE subscription-only route that mirrors the deep-dive stream route.
 * The [sectionId] segment is in the path but doesn't affect the SSE logic.
 */

import { GET } from '../../app/api/videos/[id]/dig/[sectionId]/stream/route';
import { createJob, emitJobEvent, _resetJobRegistry } from '../../lib/job-registry';

const ctx = { params: Promise.resolve({ id: 'v', sectionId: '60' }) };

beforeEach(() => _resetJobRegistry());

it('400s without a jobId', async () => {
  const res = await GET(new Request('http://localhost/s'), ctx);
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.error).toMatch(/jobId/i);
});

it('404s for an unknown jobId', async () => {
  const res = await GET(new Request('http://localhost/s?jobId=nope'), ctx);
  expect(res.status).toBe(404);
  const body = await res.json();
  expect(body.error).toMatch(/not found/i);
});

it('streams SSE events for a known jobId and closes on done', async () => {
  createJob('jDig1');
  emitJobEvent('jDig1', { type: 'step', step: 'Generating dig deeper…', current: 1, total: 3 });
  emitJobEvent('jDig1', { type: 'done' });

  const res = await GET(new Request('http://localhost/s?jobId=jDig1'), ctx);
  expect(res.status).toBe(200);
  expect(res.headers.get('Content-Type')).toContain('text/event-stream');

  const text = await res.text();
  expect(text).toContain('"type":"step"');
  expect(text).toContain('"type":"done"');
});

it('streams SSE events and closes on error', async () => {
  createJob('jDig2');
  emitJobEvent('jDig2', { type: 'error', log: 'Gemini failed' });

  const res = await GET(new Request('http://localhost/s?jobId=jDig2'), ctx);
  expect(res.status).toBe(200);

  const text = await res.text();
  expect(text).toContain('"type":"error"');
  expect(text).toContain('Gemini failed');
});
