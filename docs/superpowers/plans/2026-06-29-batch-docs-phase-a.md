# Batch docs — Phase A (summary HTML) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Select videos with checkboxes and batch-generate their summary HTML docs (skipping up-to-date ones) with non-blocking N-of-M progress.

**Architecture:** A backend `runBatchDocs` loops `ensureHtmlDoc` over the videos that need work (sequential, best-effort, abortable), exposed via a `POST /api/videos/batch-docs` (+ SSE stream) modeled on the ingestion job pattern. The frontend adds a checkbox column + select-all-needing to `VideoList`/`VideoRow`, a `BulkActionBar`, and a non-blocking `BatchDocStatusBar`, wired in `app/page.tsx`. Designed mode-aware (`mode: 'summary'`) so Phase B adds dig without reworking the contract.

**Tech Stack:** TypeScript, Next.js (app router, route handlers), React client components, jest + ts-jest (SWC — no typecheck in jest; `tsc --noEmit` is the type gate), @testing-library/react, Playwright E2E. SSE via `lib/job-registry.ts`.

## Global Constraints

- **Endpoint/lib/component names (verbatim):** lib `runBatchDocs` in `lib/html-doc/batch.ts`; routes `app/api/videos/batch-docs/route.ts` + `app/api/videos/batch-docs/stream/route.ts`; components `components/BulkActionBar.tsx`, `components/BatchDocStatusBar.tsx`.
- **Mode type:** `type BatchMode = 'summary' | 'summary-dig'`. Phase A implements only `'summary'`; `runBatchDocs` must accept the param and (Phase A) treat any non-`'summary'` as summary-only is **out of scope** — Phase A only needs `'summary'`, but the signature includes `mode` so Phase B is additive.
- **Backend-authoritative skip:** the client may send videoIds that are already current; `runBatchDocs`'s pre-pass filters to those that need work. Skip predicate (shared helper): `summaryNeedsWork(v) = !!v.summaryMd && (!v.summaryHtml || isOlder(v.docVersion ?? {major:1,minor:0}, CURRENT_DOC_VERSION))`.
- **Best-effort:** a per-video `ensureHtmlDoc` failure must emit `{type:'error', videoId}` (non-fatal), increment `failed`, and continue. Never abort the batch.
- **Progress isolation:** pass a no-op `() => {}` as `ensureHtmlDoc`'s `onProgress` so its internal 1-of-3 sub-steps never reach the batch stream.
- **Stream closure (non-fatal per-video errors):** the batch stream closes ONLY on `done`, `cancelled`, or an `error` WITHOUT a `videoId` (mirror `app/api/ingest/stream/route.ts`). A per-video `{type:'error', videoId}` keeps the stream open.
- **One batch per folder:** dedup key `${outputFolder}::batch-docs` via `getActiveJob`; second POST returns 409.
- **No `ProgressEvent` schema change; no version bump.**

---

## File Structure

| File | New/Mod | Responsibility |
|---|---|---|
| `lib/html-doc/eligibility.ts` | new | `summaryNeedsWork(video)` + `summarySelectable(video)` — shared by backend pre-pass and frontend selection |
| `lib/html-doc/batch.ts` | new | `runBatchDocs(videoIds, mode, outputFolder, onProgress, signal)` |
| `app/api/videos/batch-docs/route.ts` | new | POST: validate, 409 dedup, create job, run `runBatchDocs` in background, return `{jobId}` |
| `app/api/videos/batch-docs/stream/route.ts` | new | GET SSE: subscribe, non-fatal per-video error closure |
| `components/VideoList.tsx` | mod | checkbox column + header select-all-needing; thread selection props |
| `components/VideoRow.tsx` | mod | leading checkbox cell; `selected`/`selectable`/`onToggleSelect` props |
| `components/BulkActionBar.tsx` | new | counts + Generate/Clear (no mode toggle in Phase A) |
| `components/BatchDocStatusBar.tsx` | new | non-blocking SSE status bar, step X of N |
| `app/page.tsx` | mod | selection `Set` + batch-job state, handlers, render bar+toolbar, incremental refresh |

Task order: 1 helper+lib → 2 routes → 3 VideoList/VideoRow selection → 4 BulkActionBar → 5 BatchDocStatusBar → 6 page wiring + E2E. Each ends with an independently testable deliverable.

---

## Task 1: `summaryNeedsWork` helper + `runBatchDocs` (mode summary)

**Files:**
- Create: `lib/html-doc/eligibility.ts`, `lib/html-doc/batch.ts`
- Test: `tests/lib/html-doc/batch.test.ts`

**Interfaces:**
- Consumes: `ensureHtmlDoc(videoId, outputFolder, onProgress) : Promise<void>` (`lib/html-doc/ensure.ts`); `readIndex(outputFolder)` (`lib/index-store`); `isOlder`, `CURRENT_DOC_VERSION` (`lib/doc-version`); `assertOutputFolder`, `assertVideoId` (`lib/index-store`); `ProgressEvent` (`types`).
- Produces:
  - `summaryNeedsWork(v: Video): boolean`, `summarySelectable(v: Video): boolean` (`lib/html-doc/eligibility.ts`).
  - `type BatchMode = 'summary' | 'summary-dig'` and `runBatchDocs(videoIds: string[], mode: BatchMode, outputFolder: string, onProgress: (e: ProgressEvent) => void, signal?: AbortSignal): Promise<void>` (`lib/html-doc/batch.ts`).

- [ ] **Step 1: Write the eligibility helper test**

Create `tests/lib/html-doc/eligibility.test.ts`:

```typescript
import { summaryNeedsWork, summarySelectable } from '../../../lib/html-doc/eligibility';
import type { Video } from '../../../types';

function v(over: Partial<Video> = {}): Video {
  return {
    id: 'x', title: 'T', youtubeUrl: 'https://youtu.be/x', language: 'en',
    durationSeconds: 1, archived: false,
    ratings: { usefulness: 3, depth: 3, originality: 3, recency: 3, completeness: 3 },
    overallScore: 3, summaryMd: '1_t.md', summaryPdf: null, deepDiveMd: null, deepDivePdf: null,
    summaryHtml: null, processedAt: '2026-06-29T00:00:00.000Z', docVersion: { major: 3, minor: 3 },
    ...over,
  } as Video;
}

describe('summary eligibility', () => {
  it('selectable iff summaryMd present', () => {
    expect(summarySelectable(v({ summaryMd: '1_t.md' }))).toBe(true);
    expect(summarySelectable(v({ summaryMd: null }))).toBe(false);
  });
  it('needs work when summaryHtml missing', () => {
    expect(summaryNeedsWork(v({ summaryHtml: null }))).toBe(true);
  });
  it('needs work when docVersion older than current', () => {
    expect(summaryNeedsWork(v({ summaryHtml: 'h.html', docVersion: { major: 2, minor: 0 } }))).toBe(true);
  });
  it('no work when current', () => {
    expect(summaryNeedsWork(v({ summaryHtml: 'h.html', docVersion: { major: 3, minor: 3 } }))).toBe(false);
  });
  it('no work when no summaryMd (nothing to generate from)', () => {
    expect(summaryNeedsWork(v({ summaryMd: null, summaryHtml: null }))).toBe(false);
  });
});
```

- [ ] **Step 2: Run it — verify failure**

Run: `npx jest eligibility.test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `lib/html-doc/eligibility.ts`:

```typescript
import { isOlder, CURRENT_DOC_VERSION } from '../doc-version';
import type { Video } from '../../types';

/** A video can be batch-selected only if it has a summary to generate HTML from. */
export function summarySelectable(v: Video): boolean {
  return !!v.summaryMd;
}

/** True when the summary HTML is missing or stale (and there is a summary to build from). */
export function summaryNeedsWork(v: Video): boolean {
  return !!v.summaryMd && (!v.summaryHtml || isOlder(v.docVersion ?? { major: 1, minor: 0 }, CURRENT_DOC_VERSION));
}
```

- [ ] **Step 4: Run it — verify pass**

Run: `npx jest eligibility.test`
Expected: PASS (5).

- [ ] **Step 5: Write the `runBatchDocs` test**

Create `tests/lib/html-doc/batch.test.ts`:

```typescript
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
```

- [ ] **Step 6: Run it — verify failure**

Run: `npx jest batch.test`
Expected: FAIL — `runBatchDocs` not defined.

- [ ] **Step 7: Implement `runBatchDocs`**

Create `lib/html-doc/batch.ts`:

```typescript
import { assertOutputFolder, assertVideoId, readIndex } from '../index-store';
import { ensureHtmlDoc } from './ensure';
import { summaryNeedsWork } from './eligibility';
import type { ProgressEvent } from '../../types';

export type BatchMode = 'summary' | 'summary-dig';

/**
 * Generate docs for the given videos, skipping ones already up-to-date.
 * Sequential + best-effort: a per-item failure emits a non-fatal {type:'error', videoId}
 * and the loop continues. Phase A implements mode 'summary' (summary HTML only).
 */
export async function runBatchDocs(
  videoIds: string[],
  mode: BatchMode,
  outputFolder: string,
  onProgress: (e: ProgressEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  assertOutputFolder(outputFolder);

  // PRE-PASS (cheap, no Gemini): keep only videos whose summary needs work.
  const index = readIndex(outputFolder);
  const byId = new Map(index.videos.map((v) => [v.id, v]));
  const work = videoIds.filter((id) => {
    const v = byId.get(id);
    return v ? summaryNeedsWork(v) : false;
  });

  onProgress({ type: 'start', total: work.length });

  let succeeded = 0;
  let failed = 0;
  for (let i = 0; i < work.length; i++) {
    if (signal?.aborted) {
      onProgress({ type: 'cancelled' });
      return;
    }
    const videoId = work[i];
    const video = byId.get(videoId);
    assertVideoId(videoId);
    onProgress({
      type: 'step', videoId, title: video?.title,
      step: 'Generating HTML doc…', current: i + 1, total: work.length,
    });
    try {
      await ensureHtmlDoc(videoId, outputFolder, () => {}); // no-op: keep its sub-steps off the batch stream
      succeeded++;
    } catch (err) {
      failed++;
      // eslint-disable-next-line no-console
      console.warn(`[batch-docs] ${videoId} failed: ${err instanceof Error ? err.message : String(err)}`);
      onProgress({ type: 'error', videoId, title: video?.title, log: err instanceof Error ? err.message : String(err) });
    }
  }

  onProgress({ type: 'done', succeeded, failed, total: work.length });
}
```

- [ ] **Step 8: Run — verify pass + full lib suite**

Run: `npx jest batch.test eligibility.test` → PASS (6 + 5).
Run: `npx jest lib/html-doc` → all html-doc lib tests green.

- [ ] **Step 9: Typecheck**

Run: `npx tsc --noEmit` → exit 0.

- [ ] **Step 10: Commit**

```bash
git add lib/html-doc/eligibility.ts lib/html-doc/batch.ts tests/lib/html-doc/eligibility.test.ts tests/lib/html-doc/batch.test.ts
git commit -m "feat(batch-docs): runBatchDocs (mode summary) + summary eligibility helper"
```

---

## Task 2: `POST /api/videos/batch-docs` + SSE stream

**Files:**
- Create: `app/api/videos/batch-docs/route.ts`, `app/api/videos/batch-docs/stream/route.ts`, `app/api/videos/batch-docs/cancel/route.ts`
- Test: `tests/api/batch-docs.test.ts`

**Interfaces:**
- Consumes: `runBatchDocs(videoIds, mode, outputFolder, onProgress, signal)` (Task 1); job-registry `createJob, deleteJob, emitJobEvent, getActiveJob, releaseJobLock, getJobSignal, subscribeJob, cancelJob`; `assertOutputFolder` (`lib/index-store`); `logError, errorSummary` (`lib/dev-logger`).
- Produces: `POST /api/videos/batch-docs` body `{ outputFolder: string, videoIds: string[], mode: 'summary' }` (Phase A; `'summary-dig'` → 400) → `{ jobId }` (409 on duplicate batch for folder); `GET /api/videos/batch-docs/stream?jobId=…` → SSE; `POST /api/videos/batch-docs/cancel` body `{ jobId: string }` → `{ cancelled: boolean }` (aborts the job's signal; the loop emits `cancelled` at its next iteration).

- [ ] **Step 1: Write the route tests**

Create `tests/api/batch-docs.test.ts`:

```typescript
jest.mock('../../lib/html-doc/batch');

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
```

> Note: if `assertOutputFolder` rejects `/home/u/p` in the test env, add `jest.mock('../../lib/index-store')` with `assertOutputFolder` as a no-op (mirror the pattern in `tests/lib/pipeline.test.ts`).

- [ ] **Step 2: Run — verify failure**

Run: `npx jest batch-docs.test`
Expected: FAIL — routes not found.

- [ ] **Step 3: Implement the POST route**

Create `app/api/videos/batch-docs/route.ts` (modeled on `app/api/ingest/route.ts` + the html-doc grace cleanup):

```typescript
import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { assertOutputFolder } from '../../../../lib/index-store';
import { runBatchDocs, type BatchMode } from '../../../../lib/html-doc/batch';
import { createJob, deleteJob, emitJobEvent, getActiveJob, releaseJobLock, getJobSignal } from '../../../../lib/job-registry';
import { logError, errorSummary } from '../../../../lib/dev-logger';
import type { ProgressEvent } from '../../../../types';

const GRACE_MS = 15_000;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const outputFolder: unknown = body?.outputFolder;
  const videoIds: unknown = body?.videoIds;
  const mode: BatchMode = body?.mode ?? 'summary';

  if (typeof outputFolder !== 'string' || !outputFolder) {
    return NextResponse.json({ error: 'outputFolder is required' }, { status: 400 });
  }
  if (!Array.isArray(videoIds) || videoIds.length === 0 || !videoIds.every((x) => typeof x === 'string')) {
    return NextResponse.json({ error: 'videoIds[] is required' }, { status: 400 });
  }
  // Phase A supports only 'summary'. Phase B will accept 'summary-dig'. Reject explicitly so a
  // caller does not silently get summary-only behavior for a dig request.
  if (mode !== 'summary') {
    return NextResponse.json({ error: "mode 'summary-dig' is not supported yet" }, { status: 400 });
  }
  try {
    assertOutputFolder(outputFolder);
  } catch {
    return NextResponse.json({ error: 'invalid outputFolder' }, { status: 400 });
  }

  const key = `${outputFolder}::batch-docs`;
  if (getActiveJob(key)) {
    return NextResponse.json({ error: 'A batch is already running for this folder' }, { status: 409 });
  }

  const jobId = crypto.randomUUID();
  createJob(jobId, key);
  let finished = false;
  const signal = getJobSignal(jobId);

  const onTerminal = () => {
    finished = true;
    releaseJobLock(jobId);
    const t = setTimeout(() => deleteJob(jobId), GRACE_MS);
    (t as { unref?: () => void }).unref?.();
  };

  runBatchDocs(videoIds as string[], mode, outputFolder, (event: ProgressEvent) => {
    emitJobEvent(jobId, event);
    const isFatal =
      event.type === 'done' ||
      event.type === 'cancelled' ||
      (event.type === 'error' && !('videoId' in event && event.videoId));
    if (isFatal) onTerminal();
  }, signal).catch((err) => {
    if (finished) return;
    logError(`batch-docs:${outputFolder}`, err);
    emitJobEvent(jobId, { type: 'error', log: errorSummary(err) });
    onTerminal();
  });

  return NextResponse.json({ jobId });
}
```

- [ ] **Step 4: Implement the SSE stream route**

Create `app/api/videos/batch-docs/stream/route.ts` (modeled on `app/api/ingest/stream/route.ts` — non-fatal per-video error closure):

```typescript
import { subscribeJob } from '../../../../../lib/job-registry';
import type { ProgressEvent } from '../../../../../types';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get('jobId');
  if (!jobId) {
    return new Response(JSON.stringify({ error: 'jobId is required' }), { status: 400 });
  }

  let unsubscribe: (() => void) | null = null;
  const stream = new ReadableStream({
    start(controller) {
      unsubscribe = subscribeJob(jobId, (event: ProgressEvent) => {
        controller.enqueue(`data: ${JSON.stringify(event)}\n\n`);
        const isFatal =
          event.type === 'done' ||
          event.type === 'cancelled' ||
          (event.type === 'error' && !('videoId' in event && event.videoId));
        if (isFatal) {
          unsubscribe?.();
          unsubscribe = null;
          controller.close();
        }
      });
      if (!unsubscribe) controller.close();
    },
    cancel() {
      unsubscribe?.();
    },
  });

  if (!unsubscribe) {
    return new Response(JSON.stringify({ error: 'job not found' }), { status: 404 });
  }
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  });
}
```

- [ ] **Step 4b: Implement the cancel route**

Create `app/api/videos/batch-docs/cancel/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { cancelJob } from '../../../../../lib/job-registry';

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const jobId: unknown = body?.jobId;
  if (typeof jobId !== 'string' || !jobId) {
    return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
  }
  const cancelled = cancelJob(jobId); // aborts the job's AbortSignal; runBatchDocs emits 'cancelled' next iter
  return NextResponse.json({ cancelled });
}
```

(`cancel/route.ts` is 5 dirs deep — `app/api/videos/batch-docs/cancel/` — so `../../../../../lib` = 5 ups, same as the stream route.)

- [ ] **Step 5: Run — verify pass**

Run: `npx jest batch-docs.test` → PASS.

- [ ] **Step 6: Typecheck + commit**

Run: `npx tsc --noEmit` → exit 0.
```bash
git add app/api/videos/batch-docs tests/api/batch-docs.test.ts
git commit -m "feat(batch-docs): POST /api/videos/batch-docs + SSE stream + cancel (non-fatal per-video errors)"
```

---

## Task 3: Selection UI — checkbox column in `VideoList` + `VideoRow`

**Files:**
- Modify: `components/VideoList.tsx`, `components/VideoRow.tsx`
- Test: `tests/components/VideoList.selection.test.tsx`

**Interfaces:**
- Consumes: `summaryNeedsWork`, `summarySelectable` (Task 1).
- Produces (new `VideoList` props, all OPTIONAL with defaults so `tsc` stays green before Task 6): `selected?: Set<string>`, `onToggleSelect?: (videoId: string) => void`, `onSelectAllNeeding?: (visible: Video[]) => void`, `activeBatchVideoIds?: Set<string>`. (new `VideoRow` props, also OPTIONAL with defaults — guards any existing standalone `VideoRow` render): `selected?: boolean`, `selectable?: boolean`, `onToggleSelect?: (videoId: string) => void`. (`VideoRow` already has a `busy` prop used for ⏳; the batch reuses it.)

- [ ] **Step 1: Write the component test**

Create `tests/components/VideoList.selection.test.tsx`:

```typescript
/** @jest-environment jsdom */
import { render, screen, fireEvent } from '@testing-library/react';
import VideoList from '../../components/VideoList';
import type { Video } from '../../types';

function v(id: string, over: Partial<Video> = {}): Video {
  return {
    id, title: `T${id}`, youtubeUrl: `https://youtu.be/${id}`, language: 'en', durationSeconds: 1,
    archived: false, ratings: { usefulness: 3, depth: 3, originality: 3, recency: 3, completeness: 3 },
    overallScore: 3, summaryMd: `${id}.md`, summaryPdf: null, deepDiveMd: null, deepDivePdf: null,
    summaryHtml: null, processedAt: '2026-06-29T00:00:00.000Z', docVersion: { major: 3, minor: 3 },
    ...over,
  } as Video;
}

const baseProps = {
  outputFolder: '/p', baseOutputFolder: '/p', showArchive: true,
  onDeepDive: () => {}, onArchive: () => {}, onGenerateHtml: () => {},
  selected: new Set<string>(), onToggleSelect: () => {}, onSelectAllNeeding: () => {},
};

it('CA1: clicking a row checkbox calls onToggleSelect with the videoId', () => {
  const onToggleSelect = jest.fn();
  render(<VideoList {...baseProps} videos={[v('a')]} onToggleSelect={onToggleSelect} />);
  fireEvent.click(screen.getByLabelText('Select Ta'));
  expect(onToggleSelect).toHaveBeenCalledWith('a');
});

it('CA2: a row with no summaryMd has a disabled checkbox', () => {
  render(<VideoList {...baseProps} videos={[v('a', { summaryMd: null })]} />);
  expect(screen.getByLabelText('Select Ta')).toBeDisabled();
});

it('CA3: header select-all calls onSelectAllNeeding with only missing/stale visible rows', () => {
  const onSelectAllNeeding = jest.fn();
  const videos = [
    v('a', { summaryHtml: null }),                                   // needs work
    v('b', { summaryHtml: 'b.html', docVersion: { major: 3, minor: 3 } }), // current
    v('c', { summaryMd: null }),                                     // not selectable
  ];
  render(<VideoList {...baseProps} videos={videos} onSelectAllNeeding={onSelectAllNeeding} />);
  fireEvent.click(screen.getByLabelText('Select all needing generation'));
  const arg = onSelectAllNeeding.mock.calls[0][0] as Video[];
  expect(arg.map((x) => x.id)).toEqual(['a']);
});

it('CA1: header checkbox is checked when all needing rows are selected', () => {
  const videos = [v('a', { summaryHtml: null })];
  render(<VideoList {...baseProps} videos={videos} selected={new Set(['a'])} />);
  expect(screen.getByLabelText('Select all needing generation')).toBeChecked();
});

it('H3: a row in the active batch has a disabled checkbox', () => {
  render(<VideoList {...baseProps} videos={[v('a')]} activeBatchVideoIds={new Set(['a'])} />);
  expect(screen.getByLabelText('Select Ta')).toBeDisabled();
});
```

- [ ] **Step 2: Run — verify failure**

Run: `npx jest VideoList.selection`
Expected: FAIL — props/labels missing.

- [ ] **Step 3: Add the checkbox column to `VideoList`**

In `components/VideoList.tsx`:

(a) Add imports under the existing imports:
```typescript
import { summaryNeedsWork, summarySelectable } from '../lib/html-doc/eligibility';
```

(b) Extend `VideoListProps` (after `onSort?`):
```typescript
  selected?: Set<string>;
  onToggleSelect?: (videoId: string) => void;
  onSelectAllNeeding?: (visible: Video[]) => void;
  activeBatchVideoIds?: Set<string>;
```

(c) Destructure them in the function params with defaults (add to the existing destructure list):
`selected = new Set(), onToggleSelect = noop, onSelectAllNeeding = noop, activeBatchVideoIds = new Set(),`
(the file already defines `const noop = () => {}`).

(d) Compute, right after `const visible = …`:
```typescript
  const needing = visible.filter(summaryNeedsWork);
  const allNeedingSelected = needing.length > 0 && needing.every((x) => selected.has(x.id));
```

(e) In `<thead><tr>`, BEFORE the chevron `<th>`, add the select-all header cell:
```tsx
          <th className="w-8 px-2 py-2">
            <input
              type="checkbox"
              aria-label="Select all needing generation"
              checked={allNeedingSelected}
              ref={(el) => { if (el) el.indeterminate = !allNeedingSelected && needing.some((x) => selected.has(x.id)); }}
              onChange={() => onSelectAllNeeding(visible)}
            />
          </th>
```

(f) Pass new props to each `<VideoRow>` (add to the existing prop list), and CHANGE the existing
`busy={busyVideoId === video.id}` to also reflect active-batch rows:
```tsx
            busy={busyVideoId === video.id || activeBatchVideoIds.has(video.id)}
            selected={selected.has(video.id)}
            selectable={summarySelectable(video)}
            onToggleSelect={onToggleSelect}
```
(Replace the existing `busy={busyVideoId === video.id}` line — do not add a duplicate `busy` prop.)

- [ ] **Step 4: Add the checkbox cell to `VideoRow`**

In `components/VideoRow.tsx`:

(a) Extend `VideoRowProps` (after `onAnnotationChange`) — OPTIONAL with defaults:
```typescript
  selected?: boolean;
  selectable?: boolean;
  onToggleSelect?: (videoId: string) => void;
```

(b) Add to the destructure with defaults: `selected = false, selectable = true, onToggleSelect = () => {},`.

(c) As the FIRST `<td>` inside `<tr>` (before the expand-chevron `<td>`). The checkbox is disabled
when the row is not selectable OR while it is busy (in the active batch — `busy` already drives the
⏳ glyph elsewhere in the row):
```tsx
        <td className="px-2 py-2 w-8">
          <input
            type="checkbox"
            aria-label={`Select ${video.title}`}
            checked={selected}
            disabled={!selectable || busy}
            onChange={() => onToggleSelect(video.id)}
            title={selectable ? undefined : 'No summary to generate from'}
          />
        </td>
```

(d) Bump the colspan constant: `const TOTAL_COLUMNS = 17;` (was 16 — we added the checkbox column; this is used by the expanded `VideoQuickView` row's `colSpan`).

- [ ] **Step 5: Run — verify pass**

Run: `npx jest VideoList.selection` → PASS (4).

- [ ] **Step 6: Typecheck + commit**

Run: `npx tsc --noEmit` → exit 0. (Will error in `app/page.tsx` if it renders `VideoList` without the new required props — Task 6 wires them. If the typecheck fails ONLY on page.tsx missing props, that is expected and resolved in Task 6; note it and proceed. To keep this task green standalone, make the three new `VideoList` props optional with safe defaults: `selected = new Set()`, `onToggleSelect = () => {}`, `onSelectAllNeeding = () => {}` — preferred.)

> Decision: make the three new `VideoList` props **optional with defaults** (as above) so `tsc` stays green before Task 6. Keep `VideoRow`'s new props **required** (VideoList always passes them).

```bash
git add components/VideoList.tsx components/VideoRow.tsx tests/components/VideoList.selection.test.tsx
git commit -m "feat(batch-docs): checkbox column + select-all-needing in VideoList/VideoRow"
```

---

## Task 4: `BulkActionBar`

**Files:**
- Create: `components/BulkActionBar.tsx`
- Test: `tests/components/BulkActionBar.test.tsx`

**Interfaces:**
- Produces: `BulkActionBar` props `{ selectedCount: number, willGenerateCount: number, skipCount: number, onGenerate: () => void, onClear: () => void }`. Renders nothing when `selectedCount === 0`.

- [ ] **Step 1: Write the test**

Create `tests/components/BulkActionBar.test.tsx`:

```typescript
/** @jest-environment jsdom */
import { render, screen, fireEvent } from '@testing-library/react';
import BulkActionBar from '../../components/BulkActionBar';

const base = { selectedCount: 0, willGenerateCount: 0, skipCount: 0, onGenerate: () => {}, onClear: () => {} };

it('renders nothing when nothing is selected', () => {
  const { container } = render(<BulkActionBar {...base} />);
  expect(container).toBeEmptyDOMElement();
});

it('shows the will-generate count and a skip note', () => {
  render(<BulkActionBar {...base} selectedCount={5} willGenerateCount={3} skipCount={2} />);
  expect(screen.getByRole('button', { name: /Generate HTML doc — 3 videos/ })).toBeInTheDocument();
  expect(screen.getByText(/2 already current/)).toBeInTheDocument();
});

it('disables Generate when nothing needs work', () => {
  render(<BulkActionBar {...base} selectedCount={2} willGenerateCount={0} skipCount={2} />);
  expect(screen.getByRole('button', { name: /Generate HTML doc/ })).toBeDisabled();
});

it('calls onGenerate and onClear', () => {
  const onGenerate = jest.fn(), onClear = jest.fn();
  render(<BulkActionBar {...base} selectedCount={2} willGenerateCount={2} onGenerate={onGenerate} onClear={onClear} />);
  fireEvent.click(screen.getByRole('button', { name: /Generate HTML doc/ }));
  fireEvent.click(screen.getByRole('button', { name: /Clear/ }));
  expect(onGenerate).toHaveBeenCalled();
  expect(onClear).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run — verify failure**

Run: `npx jest BulkActionBar` → FAIL (module not found).

- [ ] **Step 3: Implement**

Create `components/BulkActionBar.tsx`:

```tsx
'use client';

interface BulkActionBarProps {
  selectedCount: number;
  willGenerateCount: number;
  skipCount: number;
  onGenerate: () => void;
  onClear: () => void;
}

export default function BulkActionBar({ selectedCount, willGenerateCount, skipCount, onGenerate, onClear }: BulkActionBarProps) {
  if (selectedCount === 0) return null;
  return (
    <div className="flex items-center gap-3 px-3 py-2 mb-2 rounded bg-zinc-900 border border-zinc-800 text-sm">
      <button
        type="button"
        onClick={onGenerate}
        disabled={willGenerateCount === 0}
        className="px-3 py-1 rounded bg-amber-700 text-white disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Generate HTML doc — {willGenerateCount} videos
      </button>
      <button type="button" onClick={onClear} className="px-2 py-1 rounded text-zinc-300 hover:text-white">
        Clear
      </button>
      {skipCount > 0 && (
        <span className="text-zinc-500">({skipCount} already current)</span>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run — verify pass + commit**

Run: `npx jest BulkActionBar` → PASS (4). `npx tsc --noEmit` → 0.
```bash
git add components/BulkActionBar.tsx tests/components/BulkActionBar.test.tsx
git commit -m "feat(batch-docs): BulkActionBar (counts + Generate/Clear)"
```

---

## Task 5: `BatchDocStatusBar`

**Files:**
- Create: `components/BatchDocStatusBar.tsx`
- Test: `tests/components/BatchDocStatusBar.test.tsx`

**Interfaces:**
- Produces: `BatchDocStatusBar` props `{ jobId: string, onClose: () => void, onError?: () => void, onProgressEvent?: (e: ProgressEvent) => void }`. Subscribes to `/api/videos/batch-docs/stream?jobId=…`, renders `step X of N` + failed count + step text; auto-closes 4s after `done`; fires `onProgressEvent` for every parsed event (H2 — lets the page refresh rows as videos complete); the ✕ button, while running, POSTs `/api/videos/batch-docs/cancel` to abort the job (H1) before calling `onClose`.

- [ ] **Step 1: Write the test** (mirrors `tests/components/HtmlDocStatusBar.test.tsx`)

Create `tests/components/BatchDocStatusBar.test.tsx`:

```typescript
/** @jest-environment jsdom */
import { render, screen, act, fireEvent } from '@testing-library/react';
import BatchDocStatusBar from '../../components/BatchDocStatusBar';

class FakeES {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  url: string; static last: FakeES | null = null;
  constructor(url: string) { this.url = url; FakeES.last = this; }
  close() {}
  emit(obj: unknown) { this.onmessage?.({ data: JSON.stringify(obj) } as MessageEvent); }
}

beforeEach(() => { (global as any).EventSource = FakeES as unknown as typeof EventSource; jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

it('subscribes to the batch stream for the given job', () => {
  render(<BatchDocStatusBar jobId="j1" onClose={() => {}} />);
  expect(FakeES.last?.url).toContain('/api/videos/batch-docs/stream?jobId=j1');
});

it('renders step X of N and a failed count', () => {
  render(<BatchDocStatusBar jobId="j1" onClose={() => {}} />);
  act(() => { FakeES.last!.emit({ type: 'step', step: 'Generating HTML doc…', current: 2, total: 5 }); });
  expect(screen.getByText(/step 2 of 5/)).toBeInTheDocument();
  act(() => { FakeES.last!.emit({ type: 'error', videoId: 'a', log: 'x' }); });
  act(() => { FakeES.last!.emit({ type: 'step', step: 'Generating HTML doc…', current: 3, total: 5 }); });
  expect(screen.getByText(/1 failed/)).toBeInTheDocument();
});

it('auto-closes ~4s after done', () => {
  const onClose = jest.fn();
  render(<BatchDocStatusBar jobId="j1" onClose={onClose} />);
  act(() => { FakeES.last!.emit({ type: 'done', succeeded: 4, failed: 1 }); });
  expect(screen.getByText(/4 generated/)).toBeInTheDocument();
  act(() => { jest.advanceTimersByTime(4000); });
  expect(onClose).toHaveBeenCalled();
});

it('H1: ✕ while running POSTs cancel, then closes', () => {
  const onClose = jest.fn();
  const fetchMock = jest.fn().mockResolvedValue({ ok: true });
  (global as any).fetch = fetchMock;
  render(<BatchDocStatusBar jobId="j1" onClose={onClose} />);
  act(() => { FakeES.last!.emit({ type: 'step', step: 'Generating HTML doc…', current: 1, total: 3 }); });
  fireEvent.click(screen.getByLabelText('Close'));
  expect(fetchMock).toHaveBeenCalledWith('/api/videos/batch-docs/cancel', expect.objectContaining({ method: 'POST' }));
  expect(onClose).toHaveBeenCalled();
});

it('H2: fires onProgressEvent for each parsed event', () => {
  const onProgressEvent = jest.fn();
  render(<BatchDocStatusBar jobId="j1" onClose={() => {}} onProgressEvent={onProgressEvent} />);
  act(() => { FakeES.last!.emit({ type: 'step', step: 'Generating HTML doc…', videoId: 'a', current: 1, total: 2 }); });
  expect(onProgressEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'step', videoId: 'a' }));
});
```

- [ ] **Step 2: Run — verify failure** → `npx jest BatchDocStatusBar` FAIL.

- [ ] **Step 3: Implement** (adapt `components/HtmlDocStatusBar.tsx`)

Create `components/BatchDocStatusBar.tsx`:

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import type { ProgressEvent } from '@/types';

interface BatchDocStatusBarProps {
  jobId: string;
  onClose: () => void;
  onError?: () => void;
  onProgressEvent?: (e: ProgressEvent) => void; // H2: page refreshes rows on each event
}

type BarState =
  | { status: 'running'; current: number; total: number; failed: number; step: string }
  | { status: 'done'; succeeded: number; failed: number }
  | { status: 'error'; message: string };

export default function BatchDocStatusBar({ jobId, onClose, onError, onProgressEvent }: BatchDocStatusBarProps) {
  const [state, setState] = useState<BarState>({ status: 'running', current: 0, total: 0, failed: 0, step: '' });
  const onCloseRef = useRef(onClose); onCloseRef.current = onClose;
  const onErrorRef = useRef(onError); onErrorRef.current = onError;
  const onProgressEventRef = useRef(onProgressEvent); onProgressEventRef.current = onProgressEvent;
  const failedRef = useRef(0);
  const statusRef = useRef<BarState['status']>('running');
  statusRef.current = state.status;

  // H1: ✕ while running cancels the backend job (fire-and-forget), then closes the bar.
  const handleClose = () => {
    if (statusRef.current === 'running') {
      fetch('/api/videos/batch-docs/cancel', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jobId }),
      }).catch(() => {});
    }
    onClose();
  };

  useEffect(() => {
    failedRef.current = 0;
    setState({ status: 'running', current: 0, total: 0, failed: 0, step: '' });
    const url = `/api/videos/batch-docs/stream?jobId=${encodeURIComponent(jobId)}`;
    const es = new EventSource(url);
    let terminal = false;
    let doneTimer: ReturnType<typeof setTimeout> | null = null;

    es.onmessage = (event: MessageEvent) => {
      if (terminal) return;
      let data: ProgressEvent;
      try { data = JSON.parse(event.data) as ProgressEvent; } catch { return; }
      onProgressEventRef.current?.(data); // H2: let the page refresh rows as items complete
      if (data.type === 'step') {
        setState({ status: 'running', current: data.current ?? 0, total: data.total ?? 0, failed: failedRef.current, step: data.step });
      } else if (data.type === 'error' && 'videoId' in data && data.videoId) {
        failedRef.current += 1; // non-fatal per-video error
        setState((prev) => prev.status === 'running' ? { ...prev, failed: failedRef.current } : prev);
      } else if (data.type === 'error') {
        terminal = true; setState({ status: 'error', message: data.log }); es.close(); onErrorRef.current?.();
      } else if (data.type === 'done') {
        terminal = true;
        setState({ status: 'done', succeeded: data.succeeded ?? 0, failed: data.failed ?? failedRef.current });
        es.close();
        doneTimer = setTimeout(() => onCloseRef.current(), 4000);
      } else if (data.type === 'cancelled') {
        terminal = true; es.close(); onCloseRef.current();
      }
    };
    es.onerror = () => {
      if (terminal) return;
      terminal = true; setState({ status: 'error', message: 'Connection lost. Please try again.' }); es.close(); onErrorRef.current?.();
    };
    return () => { terminal = true; es.close(); if (doneTimer) clearTimeout(doneTimer); };
  }, [jobId]);

  return (
    <div className="fixed bottom-0 inset-x-0 z-20 bg-zinc-900 border-t border-zinc-800 px-4 py-2 text-sm text-zinc-100">
      <div className="flex items-center gap-3">
        <span className="flex-1">
          {state.status === 'running' && <>Generating — step {state.current} of {state.total}{state.failed > 0 ? ` · ${state.failed} failed` : ''} {state.step && <span className="text-zinc-400">{state.step}</span>}</>}
          {state.status === 'done' && <>✓ {state.succeeded} generated{state.failed > 0 ? `, ${state.failed} failed` : ''}</>}
          {state.status === 'error' && <>✕ {state.message}</>}
        </span>
        <button type="button" aria-label="Close" onClick={handleClose} className="text-zinc-400 hover:text-white">✕</button>
      </div>
      {state.status === 'running' && state.total > 0 && (
        <div className="mt-1 h-1 bg-zinc-800 rounded">
          <div className="h-1 bg-amber-600 rounded" style={{ width: `${Math.min(100, Math.round((state.current / state.total) * 100))}%` }} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run — verify pass + commit**

Run: `npx jest BatchDocStatusBar` → PASS (3). `npx tsc --noEmit` → 0.
```bash
git add components/BatchDocStatusBar.tsx tests/components/BatchDocStatusBar.test.tsx
git commit -m "feat(batch-docs): BatchDocStatusBar (non-blocking N-of-M SSE bar)"
```

---

## Task 6: Wire selection + batch into `app/page.tsx` + E2E

**Files:**
- Modify: `app/page.tsx`
- Test: `tests/e2e/batch-docs.spec.ts`

**Interfaces:**
- Consumes: `summaryNeedsWork`, `summarySelectable` (Task 1); `BulkActionBar` (Task 4); `BatchDocStatusBar` (Task 5); the new `VideoList` selection props (Task 3); `POST /api/videos/batch-docs` (Task 2).

- [ ] **Step 1: Write the E2E test** (route-mocked, mirrors `tests/e2e/html-doc.spec.ts`)

Create `tests/e2e/batch-docs.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';
import type { Video } from '../../types';

const OUTPUT_FOLDER = '/home/u/p';
function v(id: string, over: Partial<Video> = {}): Video {
  return {
    id, title: `T${id}`, youtubeUrl: `https://youtu.be/${id}`, language: 'en', durationSeconds: 1,
    archived: false, ratings: { usefulness: 3, depth: 3, originality: 3, recency: 3, completeness: 3 },
    overallScore: 3, summaryMd: `${id}.md`, summaryPdf: null, deepDiveMd: null, deepDivePdf: null,
    summaryHtml: null, processedAt: '2026-06-29T00:00:00.000Z', docVersion: { major: 3, minor: 3 },
    ...over,
  } as Video;
}

test('batch-generates selected videos and shows N-of-M progress', async ({ page }) => {
  await page.route('**/api/settings', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ outputFolder: OUTPUT_FOLDER }) }));
  await page.route('**/api/videos**', (route) => {
    if (route.request().method() !== 'GET' || route.request().url().includes('/api/videos/')) return route.continue();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ videos: [v('a'), v('b')] }) });
  });
  let postedBody: any = null;
  await page.route('**/api/videos/batch-docs', (route) => {
    if (route.request().url().includes('/stream')) return route.continue();
    postedBody = route.request().postDataJSON();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jobId: 'jb1' }) });
  });
  await page.route('**/api/videos/batch-docs/stream**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/event-stream', body:
      `data: ${JSON.stringify({ type: 'step', step: 'Generating HTML doc…', videoId: 'a', current: 1, total: 2 })}\n\n` +
      `data: ${JSON.stringify({ type: 'done', succeeded: 2, failed: 0 })}\n\n` }));

  await page.goto('/');
  await page.getByLabel('Select all needing generation').check();
  await page.getByRole('button', { name: /Generate HTML doc — 2 videos/ }).click();
  await expect(page.getByText(/generated/)).toBeVisible();
  expect(postedBody).toMatchObject({ outputFolder: OUTPUT_FOLDER, videoIds: ['a', 'b'], mode: 'summary' });
});
```

- [ ] **Step 2: Run — verify failure** → `npx playwright test batch-docs` FAIL (no selection UI / handler).

- [ ] **Step 3: Add selection + batch state and handlers to `app/page.tsx`**

(a) Imports (with the other component imports). Also ensure `ProgressEvent` is imported from
`@/types` (add it to the existing `@/types` import if not already present — used by `handleBatchProgress`):
```typescript
import BulkActionBar from '@/components/BulkActionBar';
import BatchDocStatusBar from '@/components/BatchDocStatusBar';
import { summaryNeedsWork } from '@/lib/html-doc/eligibility';
import type { ProgressEvent } from '@/types';
```
(`summarySelectable` is not needed in the page — `VideoList` computes selectability internally.)

(b) State (near the other `useState` declarations, ~line 44). Batch state carries the videoIds set so
rows can show ⏳ + disabled checkboxes (H3):
```typescript
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchJob, setBatchJob] = useState<{ jobId: string; videoIds: Set<string> } | null>(null);
```

(c) Handlers (near `handleGenerateHtml`):
```typescript
  const toggleSelect = useCallback((videoId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(videoId)) next.delete(videoId); else next.add(videoId);
      return next;
    });
  }, []);

  const selectAllNeeding = useCallback((visible: Video[]) => {
    const needing = visible.filter(summaryNeedsWork).map((x) => x.id);
    setSelected((prev) => {
      const allSel = needing.length > 0 && needing.every((id) => prev.has(id));
      return allSel ? new Set() : new Set(needing); // toggle: clear if all already selected
    });
  }, []);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const handleBatchGenerate = useCallback(async () => {
    const ids = videos.filter((x) => selected.has(x.id) && summaryNeedsWork(x)).map((x) => x.id);
    if (ids.length === 0) return;
    try {
      const res = await fetch('/api/videos/batch-docs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outputFolder, videoIds: ids, mode: 'summary' }),
      });
      if (!res.ok) return;
      const data = await res.json();
      setBatchJob({ jobId: data.jobId, videoIds: new Set(ids) });
    } catch { /* best-effort */ }
  }, [videos, selected, outputFolder]);

  // H2: refresh rows as each item completes (a 'step' means the prior video finished). The
  // fetchSeqRef race guard in fetchVideos dedupes overlapping refreshes.
  const handleBatchProgress = useCallback((e: ProgressEvent) => {
    if (e.type === 'step' || (e.type === 'error' && 'videoId' in e && e.videoId)) {
      const { col, order } = sortRef.current;
      fetchVideos(outputFolder, col, order);
    }
  }, [fetchVideos, outputFolder]);

  const handleBatchClose = useCallback(() => {
    setBatchJob(null);
    setSelected(new Set());
    const { col, order } = sortRef.current;
    fetchVideos(outputFolder, col, order);
  }, [fetchVideos, outputFolder]);
```

(d) Derive counts for the bar (before the return):
```typescript
  const selectedVideos = videos.filter((x) => selected.has(x.id));
  const willGenerateCount = selectedVideos.filter(summaryNeedsWork).length;
  const skipCount = selectedVideos.length - willGenerateCount;
```

(e) Render `BulkActionBar` just above `<VideoList …>`:
```tsx
      <BulkActionBar
        selectedCount={selected.size}
        willGenerateCount={willGenerateCount}
        skipCount={skipCount}
        onGenerate={handleBatchGenerate}
        onClear={clearSelection}
      />
```

(f) Pass the new selection props to `<VideoList …>` (incl. `activeBatchVideoIds` so active rows get
⏳ + disabled checkboxes — H3):
```tsx
        selected={selected}
        onToggleSelect={toggleSelect}
        onSelectAllNeeding={selectAllNeeding}
        activeBatchVideoIds={batchJob?.videoIds ?? EMPTY_SET}
```
where `EMPTY_SET` is a module-level `const EMPTY_SET = new Set<string>();` (stable identity avoids
re-renders) declared above the component.

(g) Render `BatchDocStatusBar` near where `htmlJob` renders `HtmlDocStatusBar` (~line 546), wiring the
incremental-refresh callback (H2):
```tsx
      {batchJob && (
        <BatchDocStatusBar
          jobId={batchJob.jobId}
          onClose={handleBatchClose}
          onProgressEvent={handleBatchProgress}
        />
      )}
```

- [ ] **Step 4: Run — verify pass**

Run: `npx playwright test batch-docs` → PASS.

- [ ] **Step 5: Full suite + typecheck**

Run: `npx tsc --noEmit` → exit 0.
Run: `npm test` → all jest green (note: `pdf.test.ts` may flake under full-suite parallel load; if it fails, re-run `npx jest pdf` isolated to confirm it's the known flake, not a regression).
Run: `npx playwright test` → E2E green.

- [ ] **Step 6: Commit**

```bash
git add app/page.tsx tests/e2e/batch-docs.spec.ts
git commit -m "feat(batch-docs): wire selection + batch generate into the page (+E2E)"
```

---

## Codex plan-review fixes folded in (2026-06-29)

- **H1 (cancel):** added `POST /api/videos/batch-docs/cancel` (Task 2 Step 4b) + ✕-while-running POSTs cancel in `BatchDocStatusBar` (Task 5) + tests (AA-cancel, H1).
- **H2 (incremental refresh):** `onProgressEvent` callback on `BatchDocStatusBar` → page `handleBatchProgress` refreshes rows per step/error (Tasks 5, 6) + test (H2).
- **H3 (active-batch ⏳/disabled):** batch state is `{jobId, videoIds:Set}`; `activeBatchVideoIds` threaded to `VideoList`→`VideoRow`, reusing the existing `busy` prop for ⏳ and disabling the checkbox (Tasks 3, 6) + test (H3).
- **M1:** `VideoRow`'s new props are optional-with-defaults.
- **M2:** Phase A route returns 400 for `mode:'summary-dig'`.

## Self-Review

**Spec coverage (Phase A rows):** LA1–LA7 → Task 1; AA1–AA2 + stream + cancel → Task 2; CA1–CA3 + H3 → Task 3; bar counts → Task 4; status bar + dismissal + H1/H2 → Task 5; CA4–CA5 (run + progress + dismissal) → Task 6. Selection-operations table (toggle/select-all/clear/disabled) → Tasks 3+6. Async non-blocking + dismissal (✕ aborts, auto-close) → Tasks 5. Incremental refresh + active-row ⏳ → Tasks 3/5/6. URL contracts (`POST/GET batch-docs`, cancel) → Task 2. All Phase A spec items mapped. (Mode toggle, dig, cost-confirm, two-level progress = Phase B, not in this plan.)

**Placeholder scan:** every code step shows complete code; commands have expected outputs. The one conditional ("if assertOutputFolder rejects the test path, mock index-store") is a concrete instruction with the exact mock to add, not a placeholder.

**Type consistency:** `runBatchDocs(videoIds, mode, outputFolder, onProgress, signal)` identical in Tasks 1/2/6. `BatchMode` defined in Task 1, imported in Task 2. `summaryNeedsWork`/`summarySelectable` defined Task 1, consumed Tasks 3/6. `BulkActionBar` props (Task 4) match the page render (Task 6). `BatchDocStatusBar` props `{jobId,onClose,onError}` (Task 5) match the page render (Task 6). New `VideoList` props optional-with-defaults (Task 3) so `tsc` stays green until Task 6 supplies them. `TOTAL_COLUMNS` 16→17 noted in Task 3.
