import fs from 'fs';
import os from 'os';
import path from 'path';

jest.mock('../../lib/pdf/generate-doc-pdf', () => ({ generateDocPdf: jest.fn(async () => {}) }));
jest.mock('../../lib/html-doc/build-doc-html', () => ({ buildDocHtml: jest.fn(async () => ({ ok: true, html: '<html></html>' })) }));

import { POST } from '../../app/api/videos/[id]/pdf/route';
import { generateDocPdf } from '../../lib/pdf/generate-doc-pdf';
import { buildDocHtml } from '../../lib/html-doc/build-doc-html';
import { subscribeJob, _resetJobRegistry } from '../../lib/job-registry';
import type { ProgressEvent } from '../../types';

const mockGen = generateDocPdf as jest.Mock;
const mockBuild = buildDocHtml as jest.Mock;

const VIDEO_ID = 'vidpdf001';
let dir: string;

function video(extra: Record<string, unknown> = {}) {
  return {
    id: VIDEO_ID, title: 'T', youtubeUrl: 'https://youtu.be/x', language: 'en',
    durationSeconds: 60, archived: false,
    ratings: { usefulness: 4, depth: 4, originality: 4, recency: 4, completeness: 4 },
    overallScore: 4, summaryMd: 'raw/275_x.md', summaryHtml: 'htmls/275_x.html',
    digDeeperMd: 'raw/275_x-dig-deeper.md', processedAt: '2026-06-09T00:00:00.000Z', ...extra,
  };
}
function writeIndex(videos: unknown[]) {
  fs.writeFileSync(path.join(dir, 'playlist-index.json'),
    JSON.stringify({ playlistUrl: 'https://x.test/p', outputFolder: dir, videos }));
}
function req(body: unknown) {
  return new Request(`http://localhost/api/videos/${VIDEO_ID}/pdf`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}
const ctx = { params: Promise.resolve({ id: VIDEO_ID }) };
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  jest.clearAllMocks();
  _resetJobRegistry();
  mockBuild.mockResolvedValue({ ok: true, html: '<html></html>' });
  mockGen.mockResolvedValue(undefined);
  dir = fs.mkdtempSync(path.join(os.homedir(), '.tmp-pdfroute-'));
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

it('400s without outputFolder', async () => {
  expect((await POST(req({ type: 'summary' }), ctx)).status).toBe(400);
});

it('400s on an unsupported type', async () => {
  writeIndex([video()]);
  expect((await POST(req({ outputFolder: dir, type: 'bogus' }), ctx)).status).toBe(400);
  expect((await POST(req({ outputFolder: dir }), ctx)).status).toBe(400);
});

it('404s when the video is not in the index', async () => {
  writeIndex([]);
  expect((await POST(req({ outputFolder: dir, type: 'summary' }), ctx)).status).toBe(404);
});

it('returns a jobId and builds the summary doc', async () => {
  writeIndex([video()]);
  const json = await (await POST(req({ outputFolder: dir, type: 'summary' }), ctx)).json();
  expect(typeof json.jobId).toBe('string');
  expect(mockBuild).toHaveBeenCalledWith(expect.objectContaining({ id: VIDEO_ID }), dir, 'summary');
});

it('maps an unavailable doc to 404', async () => {
  writeIndex([video()]);
  mockBuild.mockResolvedValueOnce({ ok: false, reason: 'missing-html' });
  expect((await POST(req({ outputFolder: dir, type: 'summary' }), ctx)).status).toBe(404);
  expect(mockGen).not.toHaveBeenCalled();
});

it('emits a done event with the saved filename in log', async () => {
  writeIndex([video()]);
  const { jobId } = await (await POST(req({ outputFolder: dir, type: 'summary' }), ctx)).json();
  const events: ProgressEvent[] = [];
  subscribeJob(jobId, (e) => events.push(e));
  await flush();
  const done = events.find((e) => e.type === 'done');
  expect(done).toBeDefined();
  expect((done as { log?: string }).log).toBe('275_x.pdf');
});

it('dig-deeper done log uses the -dig-deeper.pdf name', async () => {
  writeIndex([video()]);
  const { jobId } = await (await POST(req({ outputFolder: dir, type: 'dig-deeper' }), ctx)).json();
  const events: ProgressEvent[] = [];
  subscribeJob(jobId, (e) => events.push(e));
  await flush();
  const done = events.find((e) => e.type === 'done') as { log?: string } | undefined;
  expect(done?.log).toBe('275_x-dig-deeper.pdf');
});

it('two concurrent same-doc POSTs create ONE job (no check-then-create race)', async () => {
  writeIndex([video()]);
  mockGen.mockReturnValue(new Promise(() => {})); // never resolves → job stays active
  const [r1, r2] = await Promise.all([
    POST(req({ outputFolder: dir, type: 'summary' }), ctx),
    POST(req({ outputFolder: dir, type: 'summary' }), ctx),
  ]);
  const [j1, j2] = [await r1.json(), await r2.json()];
  expect(j1.jobId).toBe(j2.jobId);        // second joined the first, not a second job
  expect(mockGen).toHaveBeenCalledTimes(1); // only one chromium render kicked off
});

it('releases the lock when the build is unavailable (404), leaving no stuck job', async () => {
  writeIndex([video()]);
  mockBuild.mockResolvedValueOnce({ ok: false, reason: 'missing-html' });
  expect((await POST(req({ outputFolder: dir, type: 'summary' }), ctx)).status).toBe(404);
  // lock freed → a subsequent (now-ok) POST starts a real job
  const ok = await (await POST(req({ outputFolder: dir, type: 'summary' }), ctx)).json();
  expect(typeof ok.jobId).toBe('string');
});

it('on generateDocPdf failure emits error AND releases the lock (next POST gets a new job)', async () => {
  writeIndex([video()]);
  mockGen.mockRejectedValueOnce(new Error('boom'));
  const first = await (await POST(req({ outputFolder: dir, type: 'summary' }), ctx)).json();
  const events: ProgressEvent[] = [];
  subscribeJob(first.jobId, (e) => events.push(e));
  await flush();
  expect(events.some((e) => e.type === 'error')).toBe(true);
  // lock released → a fresh POST starts a new job, not a 409/joined id
  const second = await (await POST(req({ outputFolder: dir, type: 'summary' }), ctx)).json();
  expect(second.jobId).not.toBe(first.jobId);
});
