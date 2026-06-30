# Pre-generate summary HTML at ingestion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build each new video's summary HTML doc during ingestion (best-effort, opt-out-able) so it opens instantly instead of generating on-demand.

**Architecture:** One additive seam in `runIngestion`'s per-video loop (`lib/pipeline.ts`): after `upsertVideo`, a flag-gated `try/catch` calls `runHtmlDoc(videoId, outputFolder, () => {})` and emits one coarse `'Generating HTML doc…'` SSE step. Nothing else changes — `runHtmlDoc`, `render.ts`, the serve route, and `VideoMenu` are untouched; pre-gen just sets `video.summaryHtml` sooner so the menu's existing "show a link" branch fires.

**Tech Stack:** TypeScript, Next.js, jest + ts-jest (SWC, no typecheck in jest — `tsc --noEmit` is the real type gate), existing `lib/pipeline.ts` SSE `ProgressEvent` model.

## Global Constraints

- **Call `runHtmlDoc` from `./html-doc/generate`, NOT `ensureHtmlDoc`** — `lib/html-doc/ensure.ts:4` imports `writeSummaryDoc` from `../pipeline`, so importing `ensureHtmlDoc` into `pipeline.ts` creates a circular import. `generate.ts` does not import `pipeline.ts`. Effect at ingest is identical (fresh video deterministically hits `runHtmlDoc`).
- **Best-effort, non-negotiable:** pre-gen failure must never fail the video (its `.md` is already written and `upsertVideo` already ran) nor abort the batch. Wrap in `try/catch`.
- **Progress-shape isolation:** pass a no-op `() => {}` as `runHtmlDoc`'s `onProgress`. Its native events (`{type:'start'}`, `current:1,total:3`, `{type:'done'}`) must never reach the ingest stream's `onProgress` (would corrupt the "video N of M" counter).
- **Opt-out flag:** `PREGEN_SUMMARY_HTML` — disabled only when `=== 'off'` (mirrors `DIG_CROP === 'off'`, `lib/dig/slide-crop-map.ts:28`). Default on.
- **No version bump:** do not touch `CURRENT_DOC_VERSION` or `GENERATOR_VERSION`.
- **Insertion point:** between `upsertVideo(...)` / `alreadyIndexed.add(...)` (`lib/pipeline.ts:354–356`) and the existing `'Saved'` step emit (`:358`), so `'Saved'` stays the terminal per-video step.
- **New SSE step string:** `'Generating HTML doc…'` (note the U+2026 ellipsis, matching `'Generating summary…'` at `:320`). Best-effort failure step: `'HTML doc deferred (will generate on open)'`.

---

## File Structure

- **`lib/pipeline.ts`** (modify) — the only production change. Add `import { runHtmlDoc } from './html-doc/generate';` and the flag-gated best-effort pre-gen block in `runIngestion`'s loop.
- **`tests/lib/pipeline.test.ts`** (modify) — add `jest.mock('../../lib/html-doc/generate')`, a `mockRunHtmlDoc` handle defaulting to `mockResolvedValue(undefined)`, and the new behavior tests. Reuses the existing `runIngestion` harness (mocked `youtube`/`gemini`/`pdf`/`index-store`, `makeVideoMeta`, `makeSummaryResponse`, `events` capture).

Task 1 delivers the happy-path pre-gen call + progress isolation + Saved-ordering. Task 2 adds the best-effort `try/catch` and the opt-out flag. A reviewer could accept Task 1 (pre-gen fires and is wired correctly) while rejecting Task 2 (robustness), so they are separate tasks.

---

## Task 1: Pre-gen call + coarse SSE step + progress isolation

**Files:**
- Modify: `lib/pipeline.ts` (import at top; pre-gen block inserted at the loop body, current `:354–358` region)
- Test: `tests/lib/pipeline.test.ts`

**Interfaces:**
- Consumes: `runHtmlDoc(videoId: string, outputFolder: string, onProgress: (e: ProgressEvent) => void): Promise<void>` from `lib/html-doc/generate.ts:11`.
- Produces: no new exported symbols. Observable contract: for each newly-ingested video, `runHtmlDoc` is called once with `(videoId, outputFolder, <noop>)`, and a single `{type:'step', step:'Generating HTML doc…', videoId, current, total}` precedes that video's `'Saved'` step. (Task 2 wraps this in flag + try/catch.)

- [ ] **Step 1: Add the mock + handle for `runHtmlDoc`**

In `tests/lib/pipeline.test.ts`, alongside the other `jest.mock` calls (after `jest.mock('../../lib/index-store')`, `:10`):

```typescript
jest.mock('../../lib/html-doc/generate');
```

Add the import near the other lib imports (with `gemini`, `pdf`, `indexStore`):

```typescript
import * as htmlDocGenerate from '../../lib/html-doc/generate';
```

Add the mock handle alongside the others (near `:26`):

```typescript
const mockRunHtmlDoc = jest.mocked(htmlDocGenerate.runHtmlDoc);
```

In the `runIngestion` `beforeEach` (after `mockExtractQuickView...`, `:92`), default it to succeed:

```typescript
mockRunHtmlDoc.mockResolvedValue(undefined);
```

- [ ] **Step 2: Write the failing tests (happy path + ordering + isolation)**

Add this `describe` block inside the `describe('runIngestion', …)` suite in `tests/lib/pipeline.test.ts`:

```typescript
describe('summary HTML pre-generation', () => {
  it('calls runHtmlDoc once per new video with (videoId, outputFolder, noop)', async () => {
    mockFetchPlaylistVideos.mockResolvedValue([makeVideoMeta('vid1'), makeVideoMeta('vid2')]);
    mockFetchTranscriptSegments.mockResolvedValue([{ text: 'transcript', offset: 0, duration: 5 }]);
    mockGenerateSummary.mockResolvedValue(makeSummaryResponse());

    await runIngestion(PLAYLIST_URL, outputFolder, () => {});

    expect(mockRunHtmlDoc).toHaveBeenCalledTimes(2);
    expect(mockRunHtmlDoc).toHaveBeenCalledWith('vid1', outputFolder, expect.any(Function));
    expect(mockRunHtmlDoc).toHaveBeenCalledWith('vid2', outputFolder, expect.any(Function));
  });

  it('emits a "Generating HTML doc…" step before "Saved" for each new video', async () => {
    mockFetchPlaylistVideos.mockResolvedValue([makeVideoMeta('vid1')]);
    mockFetchTranscriptSegments.mockResolvedValue([{ text: 'transcript', offset: 0, duration: 5 }]);
    mockGenerateSummary.mockResolvedValue(makeSummaryResponse());

    const events: ProgressEvent[] = [];
    await runIngestion(PLAYLIST_URL, outputFolder, (e) => events.push(e));

    const steps = events
      .filter((e): e is Extract<ProgressEvent, { type: 'step' }> => e.type === 'step' && 'videoId' in e && e.videoId === 'vid1')
      .map((e) => ('step' in e ? e.step : ''));
    const genIdx = steps.indexOf('Generating HTML doc…');
    const savedIdx = steps.indexOf('Saved');
    expect(genIdx).toBeGreaterThanOrEqual(0);
    expect(savedIdx).toBeGreaterThan(genIdx);
  });

  it('does not leak runHtmlDoc internal progress onto the ingest stream', async () => {
    mockFetchPlaylistVideos.mockResolvedValue([makeVideoMeta('vid1')]);
    mockFetchTranscriptSegments.mockResolvedValue([{ text: 'transcript', offset: 0, duration: 5 }]);
    mockGenerateSummary.mockResolvedValue(makeSummaryResponse());
    // The mocked runHtmlDoc fires a sentinel on the onProgress it is GIVEN. If the pipeline passed
    // the real ingest onProgress (not a no-op), this sentinel would surface on the ingest stream.
    mockRunHtmlDoc.mockImplementation(async (_id, _folder, onProgress) => {
      onProgress({ type: 'start', total: 3 } as ProgressEvent);
    });

    const events: ProgressEvent[] = [];
    await runIngestion(PLAYLIST_URL, outputFolder, (e) => events.push(e));

    // Ingest stream emits exactly one 'start' (its own, total:2-or-1), never runHtmlDoc's total:3.
    const startEvents = events.filter((e) => e.type === 'start');
    expect(startEvents.every((e) => !('total' in e) || e.total !== 3)).toBe(true);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx jest pipeline.test -t "pre-generation"`
Expected: FAIL — `mockRunHtmlDoc` called 0 times (no pre-gen code yet); `'Generating HTML doc…'` not found in steps.

- [ ] **Step 4: Implement the pre-gen call in the pipeline**

In `lib/pipeline.ts`, add the import near the other lib imports (e.g., after the `index-store` import):

```typescript
import { runHtmlDoc } from './html-doc/generate';
```

In `runIngestion`'s loop, locate the block (current `:354–358`):

```typescript
      // Index updated immediately after md write
      upsertVideo(outputFolder, video);
      // Mark as processed so within-run duplicates (same video appearing twice in the playlist) are skipped.
      alreadyIndexed.add(meta.videoId);

      onProgress({ type: 'step', videoId: meta.videoId, title: meta.title, step: 'Saved', current: newIndex, total: newTotal });
```

Insert the pre-gen call BETWEEN `alreadyIndexed.add(...)` and the `'Saved'` emit:

```typescript
      // Index updated immediately after md write
      upsertVideo(outputFolder, video);
      // Mark as processed so within-run duplicates (same video appearing twice in the playlist) are skipped.
      alreadyIndexed.add(meta.videoId);

      // Pre-generate the summary HTML doc so it opens instantly (no on-demand Gemini wait).
      // runHtmlDoc (NOT ensureHtmlDoc — circular import) is called with a no-op onProgress so its
      // own start/step/done events never corrupt the ingest stream's "video N of M" counter.
      onProgress({ type: 'step', videoId: meta.videoId, title: meta.title, step: 'Generating HTML doc…', current: newIndex, total: newTotal });
      await runHtmlDoc(meta.videoId, outputFolder, () => {});

      onProgress({ type: 'step', videoId: meta.videoId, title: meta.title, step: 'Saved', current: newIndex, total: newTotal });
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest pipeline.test -t "pre-generation"`
Expected: PASS (3 tests).

- [ ] **Step 6: Run the full pipeline suite (no regressions)**

Run: `npx jest pipeline`
Expected: PASS — existing `runIngestion` tests still green (the new `'Generating HTML doc…'` step is additive; existing assertions match on specific steps/videoIds and are unaffected).

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0 (jest uses SWC and does not typecheck — this is the real type gate).

- [ ] **Step 8: Commit**

```bash
git add lib/pipeline.ts tests/lib/pipeline.test.ts
git commit -m "feat(pregen): call runHtmlDoc per new video in ingestion loop + coarse SSE step"
```

---

## Task 2: Best-effort failure handling + opt-out flag

**Files:**
- Modify: `lib/pipeline.ts` (wrap the Task 1 pre-gen call in `try/catch`; gate the whole block on `PREGEN_SUMMARY_HTML !== 'off'`)
- Test: `tests/lib/pipeline.test.ts`

**Interfaces:**
- Consumes: same `runHtmlDoc` signature.
- Produces: observable contract — pre-gen never throws out of the loop; on `runHtmlDoc` rejection the video is still upserted, the batch continues, and a `{type:'step', step:'HTML doc deferred (will generate on open)'}` is emitted; when `PREGEN_SUMMARY_HTML === 'off'`, `runHtmlDoc` is not called and no `'Generating HTML doc…'` step is emitted.

- [ ] **Step 1: Write the failing tests (best-effort + batch-continues + flag-off)**

Add these tests inside the `describe('summary HTML pre-generation', …)` block in `tests/lib/pipeline.test.ts`:

```typescript
  it('is best-effort: a runHtmlDoc failure does not fail the video or abort the batch', async () => {
    mockFetchPlaylistVideos.mockResolvedValue([makeVideoMeta('vid1'), makeVideoMeta('vid2')]);
    mockFetchTranscriptSegments.mockResolvedValue([{ text: 'transcript', offset: 0, duration: 5 }]);
    mockGenerateSummary.mockResolvedValue(makeSummaryResponse());
    mockRunHtmlDoc.mockRejectedValueOnce(new Error('Gemini transform failed')); // vid1 fails, vid2 ok

    const events: ProgressEvent[] = [];
    await runIngestion(PLAYLIST_URL, outputFolder, (e) => events.push(e));

    // Both videos still ingested; no 'error' event from the failed pre-gen.
    expect(mockUpsertVideo).toHaveBeenCalledWith(outputFolder, expect.objectContaining({ id: 'vid1' }));
    expect(mockUpsertVideo).toHaveBeenCalledWith(outputFolder, expect.objectContaining({ id: 'vid2' }));
    expect(events.some((e) => e.type === 'error')).toBe(false);
    // Non-fatal deferred note emitted for vid1.
    expect(events.some((e) => e.type === 'step' && 'step' in e && e.step === 'HTML doc deferred (will generate on open)' && 'videoId' in e && e.videoId === 'vid1')).toBe(true);
    // Batch still completes.
    expect(events[events.length - 1]).toMatchObject({ type: 'done' });
  });

  it('does not call runHtmlDoc when PREGEN_SUMMARY_HTML=off', async () => {
    process.env.PREGEN_SUMMARY_HTML = 'off';
    mockFetchPlaylistVideos.mockResolvedValue([makeVideoMeta('vid1')]);
    mockFetchTranscriptSegments.mockResolvedValue([{ text: 'transcript', offset: 0, duration: 5 }]);
    mockGenerateSummary.mockResolvedValue(makeSummaryResponse());

    const events: ProgressEvent[] = [];
    await runIngestion(PLAYLIST_URL, outputFolder, (e) => events.push(e));

    expect(mockRunHtmlDoc).not.toHaveBeenCalled();
    expect(events.some((e) => e.type === 'step' && 'step' in e && e.step === 'Generating HTML doc…')).toBe(false);
    // Video still ingested normally.
    expect(mockUpsertVideo).toHaveBeenCalledWith(outputFolder, expect.objectContaining({ id: 'vid1' }));
  });
```

Add a cleanup so the flag does not leak across tests — extend the existing `afterEach` in the `runIngestion` suite (`:95`) with:

```typescript
    delete process.env.PREGEN_SUMMARY_HTML;
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest pipeline.test -t "pre-generation"`
Expected: FAIL — the best-effort test fails because the unhandled `runHtmlDoc` rejection currently propagates into the loop's existing `catch` and emits a `{type:'error'}` (so `events.some(error)` is true and the deferred-note assertion fails); the flag-off test fails because `runHtmlDoc` is still called.

- [ ] **Step 3: Implement try/catch + flag gate**

In `lib/pipeline.ts`, replace the Task 1 pre-gen lines:

```typescript
      onProgress({ type: 'step', videoId: meta.videoId, title: meta.title, step: 'Generating HTML doc…', current: newIndex, total: newTotal });
      await runHtmlDoc(meta.videoId, outputFolder, () => {});
```

with the flag-gated, best-effort version:

```typescript
      // Pre-generate the summary HTML doc so it opens instantly (no on-demand Gemini wait).
      // Best-effort: the .md is already written and the video already upserted, so a transform
      // failure must never fail the video or abort the batch — it just defers HTML to on-demand.
      // No-op onProgress keeps runHtmlDoc's own events off the ingest stream. Opt out with
      // PREGEN_SUMMARY_HTML=off (mirrors DIG_CROP=off).
      if (process.env.PREGEN_SUMMARY_HTML !== 'off') {
        onProgress({ type: 'step', videoId: meta.videoId, title: meta.title, step: 'Generating HTML doc…', current: newIndex, total: newTotal });
        try {
          await runHtmlDoc(meta.videoId, outputFolder, () => {});
        } catch {
          onProgress({ type: 'step', videoId: meta.videoId, title: meta.title, step: 'HTML doc deferred (will generate on open)', current: newIndex, total: newTotal });
        }
      }
```

(The Task 1 comment block above this is superseded — replace it with the comment shown here.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest pipeline.test -t "pre-generation"`
Expected: PASS (5 tests total in the block).

- [ ] **Step 5: Run the full pipeline suite (no regressions)**

Run: `npx jest pipeline`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add lib/pipeline.ts tests/lib/pipeline.test.ts
git commit -m "feat(pregen): best-effort try/catch + PREGEN_SUMMARY_HTML opt-out flag"
```

---

## Regression coverage (existing behaviors — no new code, verify not broken)

These spec behaviors (8 already-indexed skip, 10 cancellation) are governed by existing loop guards that the pre-gen block sits *inside*:
- **Already-indexed skip (B8):** the `if (alreadyIndexed.has(meta.videoId)) continue;` guard (`:303`) short-circuits before the pre-gen block, so `runHtmlDoc` is naturally not called for indexed videos. Covered by the existing "upserts all successfully processed videos" / skip tests; the `toHaveBeenCalledTimes(2)` assertion in Task 1 Step 2 already pins the count to *new* videos only.
- **Cancellation (B10):** the `if (signal?.aborted)` check (`:294`) sits at loop top, before the pre-gen block, so an aborted run never reaches pre-gen. Covered by the existing cancellation test.

No extra tasks needed; the full `npx jest pipeline` run in each task's Step 6/5 confirms these.

---

## Self-Review

**Spec coverage:** Behaviors 1,3,4 → Task 1; 5,6,7 → Task 2; 2 folded into B1 (artifact production is `runHtmlDoc`'s own tested contract, asserted via invocation); 8,10 → existing guards (Regression section); 9 → Task 1 ordering test. All covered.

**Placeholder scan:** No TBD/TODO; every code step shows complete code; commands have expected output.

**Type consistency:** `runHtmlDoc(videoId, outputFolder, onProgress)` matches `generate.ts:11`. `ProgressEvent` discriminated-union narrowing (`e.type === 'step' && 'step' in e`) matches the existing test style (`pipeline.test.ts:113`). Flag string `'off'` matches the `DIG_CROP` idiom. Step strings match verbatim between plan and tests.
