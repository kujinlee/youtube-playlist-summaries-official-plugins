jest.mock('../../../lib/index-store');
jest.mock('../../../lib/html-doc/ensure');

import * as indexStore from '../../../lib/index-store';
import * as ensureMod from '../../../lib/html-doc/ensure';
import { runBatchDocs } from '../../../lib/html-doc/batch';
import type { ProgressEvent, Video } from '../../../types';

const mockReadIndex = jest.mocked(indexStore.readIndex);
const mockAssertOutputFolder = jest.mocked(indexStore.assertOutputFolder);
const mockAssertVideoId = jest.mocked(indexStore.assertVideoId);
const mockEnsure = jest.mocked(ensureMod.ensureHtmlDoc);

const OF = '/out';

function v(id: string, over: Partial<Video> = {}): Video {
  return {
    id, title: `T${id}`, youtubeUrl: `https://youtu.be/${id}`, language: 'en',
    durationSeconds: 1, archived: false,
    ratings: { usefulness: 3, depth: 3, originality: 3, recency: 3, completeness: 3 },
    overallScore: 3, summaryMd: `${id}.md`, summaryPdf: null, deepDiveMd: null, deepDivePdf: null,
    summaryHtml: null, processedAt: '2026-06-29T00:00:00.000Z', docVersion: { major: 3, minor: 3 },
    ...over,
  } as Video;
}

beforeEach(() => {
  mockAssertOutputFolder.mockImplementation(() => {});
  mockAssertVideoId.mockImplementation(() => {});
  mockEnsure.mockResolvedValue(undefined);
});
afterEach(() => jest.clearAllMocks());

function indexWith(videos: Video[]) {
  mockReadIndex.mockReturnValue({ playlistUrl: '', outputFolder: OF, videos });
}

describe('runBatchDocs (mode summary)', () => {
  it('LA1/LA7: pre-pass skips current; total reflects only videos that need work', async () => {
    indexWith([v('a', { summaryHtml: null }), v('b', { summaryHtml: 'b.html', docVersion: { major: 3, minor: 3 } })]);
    const events: ProgressEvent[] = [];
    await runBatchDocs(['a', 'b'], 'summary', OF, (e) => events.push(e));
    expect(events[0]).toMatchObject({ type: 'start', total: 1 });
    expect(mockEnsure).toHaveBeenCalledTimes(1);
    expect(mockEnsure).toHaveBeenCalledWith('a', OF, expect.any(Function));
    expect(events[events.length - 1]).toMatchObject({ type: 'done', succeeded: 1, failed: 0 });
  });

  it('LA2/LA3: generates each needed video in order with a 1..total counter', async () => {
    indexWith([v('a'), v('b')]);
    const events: ProgressEvent[] = [];
    await runBatchDocs(['a', 'b'], 'summary', OF, (e) => events.push(e));
    const steps = events.filter((e): e is Extract<ProgressEvent, { type: 'step' }> => e.type === 'step');
    expect(steps.map((s) => [s.videoId, s.current, s.total])).toEqual([['a', 1, 2], ['b', 2, 2]]);
    expect(mockEnsure.mock.calls.map((c) => c[0])).toEqual(['a', 'b']);
  });

  it('LA4: does not leak ensureHtmlDoc internal progress', async () => {
    indexWith([v('a')]);
    let received: ((e: ProgressEvent) => void) | undefined;
    mockEnsure.mockImplementation(async (_id, _of, onProgress) => {
      received = onProgress as (e: ProgressEvent) => void;
      received({ type: 'step', step: '__SENTINEL__', current: 1, total: 3 });
    });
    const events: ProgressEvent[] = [];
    const outer = (e: ProgressEvent) => events.push(e);
    await runBatchDocs(['a'], 'summary', OF, outer);
    expect(received).toBeDefined();
    expect(received).not.toBe(outer);
    expect(events.some((e) => 'step' in e && e.step === '__SENTINEL__')).toBe(false);
  });

  it('LA5: best-effort — one failure emits error{videoId} and the batch continues', async () => {
    indexWith([v('a'), v('b')]);
    mockEnsure.mockRejectedValueOnce(new Error('boom')); // a fails, b ok
    const events: ProgressEvent[] = [];
    await runBatchDocs(['a', 'b'], 'summary', OF, (e) => events.push(e));
    expect(events.some((e) => e.type === 'error' && 'videoId' in e && e.videoId === 'a')).toBe(true);
    expect(mockEnsure).toHaveBeenCalledTimes(2);
    expect(events[events.length - 1]).toMatchObject({ type: 'done', succeeded: 1, failed: 1 });
  });

  it('LA6: abort — stops the loop and emits cancelled', async () => {
    indexWith([v('a'), v('b')]);
    const controller = new AbortController();
    mockEnsure.mockImplementationOnce(async () => { controller.abort(); }); // abort after first
    const events: ProgressEvent[] = [];
    await runBatchDocs(['a', 'b'], 'summary', OF, (e) => events.push(e), controller.signal);
    expect(events.some((e) => e.type === 'cancelled')).toBe(true);
    expect(mockEnsure).toHaveBeenCalledTimes(1); // b never started
  });

  it('LA7: empty / all-current → total 0, no ensure calls', async () => {
    indexWith([v('a', { summaryHtml: 'a.html', docVersion: { major: 3, minor: 3 } })]);
    const events: ProgressEvent[] = [];
    await runBatchDocs(['a'], 'summary', OF, (e) => events.push(e));
    expect(events[0]).toMatchObject({ type: 'start', total: 0 });
    expect(mockEnsure).not.toHaveBeenCalled();
    expect(events[events.length - 1]).toMatchObject({ type: 'done', succeeded: 0, failed: 0 });
  });
});
