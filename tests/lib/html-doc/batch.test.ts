jest.mock('../../../lib/index-store');
jest.mock('../../../lib/html-doc/ensure');
jest.mock('../../../lib/dig/dig-section');
jest.mock('../../../lib/html-doc/parse');
jest.mock('../../../lib/dig/companion-doc');
jest.mock('node:fs/promises');

import * as indexStore from '../../../lib/index-store';
import * as ensureMod from '../../../lib/html-doc/ensure';
import * as digMod from '../../../lib/dig/dig-section';
import * as parseMod from '../../../lib/html-doc/parse';
import * as companion from '../../../lib/dig/companion-doc';
import fs from 'node:fs/promises';
import { runBatchDocs } from '../../../lib/html-doc/batch';
import { DIG_GENERATOR_VERSION } from '../../../lib/dig/generate';
import type { ProgressEvent, Video } from '../../../types';

const mockDig = jest.mocked(digMod.digSection);

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

function digReady() {
  mockDig.mockResolvedValue(undefined);
  jest.mocked(fs.readFile).mockResolvedValue('md' as any);
  jest.mocked(parseMod.parseSummaryMarkdown).mockReturnValue({
    sections: [
      { title: 'A', timeRange: { startSec: 10 } },
      { title: 'B', timeRange: { startSec: 20 } },
    ],
  } as any);
  jest.mocked(companion.parseDugSections).mockReturnValue([]); // nothing dug yet
}

describe('runBatchDocs (mode summary-dig)', () => {
  beforeEach(digReady);

  it('LB3: per video, summary (if needed) then each missing section dug, flat counter', async () => {
    indexWith([v('x', { summaryHtml: null, summaryMd: 'x.md', digDeeperMd: null })]);
    const events: ProgressEvent[] = [];
    await runBatchDocs(['x'], 'summary-dig', OF, (e) => events.push(e));
    // total = 1 summary + 2 sections = 3
    expect(events[0]).toMatchObject({ type: 'start', total: 3 });
    expect(mockDig.mock.calls.map((c) => c[1])).toEqual([10, 20]); // both sections dug
    expect(events.filter((e) => e.type === 'step').map((e: any) => e.step)).toEqual([
      'Generating HTML doc…', 'Digging "A"…', 'Digging "B"…',
    ]);
    expect(events[events.length - 1]).toMatchObject({ type: 'done', succeeded: 3, failed: 0 });
  });

  it('LB2: skips sections already dug at the current version', async () => {
    indexWith([v('x', { summaryHtml: 'x.html', docVersion: { major: 3, minor: 3 }, summaryMd: 'x.md', digDeeperMd: 'x-dig-deeper.md' })]);
    jest.mocked(companion.parseDugSections).mockReturnValue([
      { sectionId: 10, startSec: 10, title: 'A', bodyMarkdown: '', generatedAt: '', genVersion: DIG_GENERATOR_VERSION }, // current → skip
    ] as any);
    const events: ProgressEvent[] = [];
    await runBatchDocs(['x'], 'summary-dig', OF, (e) => events.push(e));
    expect(events[0]).toMatchObject({ type: 'start', total: 1 }); // summary current (skipped); only section 20 needs dig
    expect(mockDig.mock.calls.map((c) => c[1])).toEqual([20]);
  });

  it('LB4: dig best-effort — one section fails, rest continue', async () => {
    indexWith([v('x', { summaryHtml: 'x.html', docVersion: { major: 3, minor: 3 }, summaryMd: 'x.md', digDeeperMd: null })]);
    mockDig.mockRejectedValueOnce(new Error('yt-dlp boom'));
    const events: ProgressEvent[] = [];
    await runBatchDocs(['x'], 'summary-dig', OF, (e) => events.push(e));
    expect(events.some((e) => e.type === 'error' && 'videoId' in e && e.videoId === 'x')).toBe(true);
    expect(mockDig).toHaveBeenCalledTimes(2);
    expect(events[events.length - 1]).toMatchObject({ type: 'done', succeeded: 1, failed: 1 });
  });

  it('LB5: a video with no timestamped sections contributes 0 dig items', async () => {
    indexWith([v('x', { summaryHtml: 'x.html', docVersion: { major: 3, minor: 3 }, summaryMd: 'x.md' })]);
    jest.mocked(parseMod.parseSummaryMarkdown).mockReturnValue({ sections: [{ title: 'A', timeRange: null }] } as any);
    const events: ProgressEvent[] = [];
    await runBatchDocs(['x'], 'summary-dig', OF, (e) => events.push(e));
    expect(events[0]).toMatchObject({ type: 'start', total: 0 });
    expect(mockDig).not.toHaveBeenCalled();
  });

  it('LB6 (Blocking): a dig that EMITS error (not throws) counts as failed, not success', async () => {
    indexWith([v('x', { summaryHtml: 'x.html', docVersion: { major: 3, minor: 3 }, summaryMd: 'x.md', digDeeperMd: null })]);
    jest.mocked(parseMod.parseSummaryMarkdown).mockReturnValue({ sections: [{ title: 'A', timeRange: { startSec: 10 } }] } as any);
    // digSection resolves but emits an error event (its real failure mode) — must NOT count as success.
    mockDig.mockImplementation(async (_v, _s, _of, _sig, emit) => { emit({ type: 'error', log: 'no window' }); });
    const events: ProgressEvent[] = [];
    await runBatchDocs(['x'], 'summary-dig', OF, (e) => events.push(e));
    expect(events.some((e) => e.type === 'error' && 'videoId' in e && e.videoId === 'x')).toBe(true);
    expect(events[events.length - 1]).toMatchObject({ type: 'done', succeeded: 0, failed: 1 });
  });

  it('LB7 (High): a video whose summary parse throws contributes 0 dig and the batch continues', async () => {
    indexWith([
      v('bad', { summaryHtml: 'bad.html', docVersion: { major: 3, minor: 3 }, summaryMd: 'bad.md', digDeeperMd: null }),
      v('ok', { summaryHtml: 'ok.html', docVersion: { major: 3, minor: 3 }, summaryMd: 'ok.md', digDeeperMd: null }),
    ]);
    jest.mocked(parseMod.parseSummaryMarkdown)
      .mockImplementationOnce(() => { throw new Error('no ## sections'); }) // 'bad' parse throws
      .mockReturnValue({ sections: [{ title: 'A', timeRange: { startSec: 10 } }] } as any); // 'ok'
    const events: ProgressEvent[] = [];
    await runBatchDocs(['bad', 'ok'], 'summary-dig', OF, (e) => events.push(e));
    // 'bad' contributes 0 dig items (parse swallowed); 'ok' contributes section 10. No batch rejection.
    expect(mockDig.mock.calls.map((c) => c[0])).toEqual(['ok']);
    expect(events.some((e) => e.type === 'done')).toBe(true);
  });
});
