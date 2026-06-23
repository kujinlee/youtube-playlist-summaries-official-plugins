# Deep-Dive Transcript Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deep-dive docs get ▶ timestamps even when YouTube captions are gated, by sourcing the transcript through the captions→Gemini cascade instead of captions-only.

**Architecture:** Swap `fetchTranscriptSegments(videoId)` → `resolveTranscriptSegments(videoId, youtubeUrl, durationSeconds)` in `lib/deep-dive/write-doc.ts`, keeping the existing `try/catch` so a total failure still degrades to the video-only path. Tests stay at the project's standard boundary (mock `lib/youtube` + `lib/gemini`, run the real resolver), with a default `transcribeViaGemini` stub so the resolver path is always defined.

**Tech Stack:** TypeScript, Jest (SWC transform), `@google/generative-ai`.

## Global Constraints

- **Mock boundary:** tests mock `lib/youtube` + `lib/gemini` and run the **REAL** `resolveTranscriptSegments` (in `lib/transcript-source.ts`, unmocked). Do NOT `jest.mock` transcript-source.
- **Undefined-safe:** any test file that runs the real `writeDeepDiveDoc`/`resolveTranscriptSegments` with `lib/gemini` mocked MUST stub `transcribeViaGemini` (default in `beforeEach`); an auto-mock returns `undefined`, and the resolver does `segments.length` on it → `TypeError`.
- **Graceful floor preserved:** when the resolver throws (captions AND Gemini both fail/empty), `segments` stays `null` → existing video-only path runs. The ONLY remaining no-▶ case.
- **Cost:** net-new cost on a gated video = one `transcribeViaGemini` flash call; captioned videos (≥1 segment) make no extra call.
- **No version bump / no mass regen** in this branch.
- **Gate:** `npx tsc --noEmit` clean AND full `npm test` green before commit. Dual review.

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `lib/deep-dive/write-doc.ts` | Source the transcript via the resolver (captions→Gemini) | Modify (import + ~line 42) |
| `tests/lib/deep-dive/write-doc.test.ts` | Cover the fallback behavior at the youtube+gemini boundary | Modify |
| `tests/lib/deep-dive/ensure-integration.test.ts` | Real-write-doc integration — must stub `transcribeViaGemini` | Modify (beforeEach) |

**Not affected (verified):** `ensure.test.ts` mocks `lib/deep-dive/write-doc` (writeDeepDiveDoc never runs real); `tests/api/deep-dive-post.test.ts` mocks `lib/deep-dive/ensure`; `deep-dive-html-pipeline.test.ts` does not run real write-doc with caption mocks. No change needed in those.

---

## Task 1: Deep-dive sources transcript via the cascade resolver

**Files:**
- Modify: `lib/deep-dive/write-doc.ts` (import line 4; transcript fetch lines 41-43)
- Test: `tests/lib/deep-dive/write-doc.test.ts` (handles ~line 18; beforeEach 57-63; tests at :70, :103, :116)
- Test: `tests/lib/deep-dive/ensure-integration.test.ts` (handles ~line 23; beforeEach 66-72)

**Interfaces:**
- Consumes: `resolveTranscriptSegments(videoId: string, youtubeUrl: string, durationSeconds: number): Promise<{ segments: TranscriptSegment[]; source: 'captions' | 'gemini' }>` from `../transcript-source`; the real resolver calls `transcribeViaGemini(youtubeUrl, videoId, durationSeconds)` from `../gemini`.
- Produces: no signature change to `writeDeepDiveDoc`.

- [ ] **Step 1: Add the `transcribeViaGemini` handle, a Gemini-segments fixture, and a DEFAULT stub**

In `tests/lib/deep-dive/write-doc.test.ts`, after line 18 add:

```ts
const mockTranscribeViaGemini = jest.mocked(gemini.transcribeViaGemini);
```

After the `SEGMENTS` constant (line 23) add:

```ts
const GEMINI_SEGMENTS: TranscriptSegment[] = [{ text: 'gemini transcript', offset: 0, duration: 30 }];
```

In `beforeEach` (after line 62, `mockFetchTranscriptSegments.mockResolvedValue(SEGMENTS)`) add a default so the resolver's Gemini branch is never `undefined`:

```ts
    mockTranscribeViaGemini.mockResolvedValue([]); // default: no Gemini transcript → resolver throws → video-only, unless a test overrides
```

(`TranscriptSegment` is already imported at line 6; do not duplicate the import.)

- [ ] **Step 2: Flip `:103` and `:116` to fallback-with-▶, and add the floor test**

Replace the `:103` test ("video-only path when transcript fetch fails…") with:

```ts
it('captions gated (fetch throws) → Gemini fallback → combined path with ▶', async () => {
  mockFetchTranscriptSegments.mockRejectedValueOnce(new Error('no captions'));
  mockTranscribeViaGemini.mockResolvedValueOnce(GEMINI_SEGMENTS);

  await writeDeepDiveDoc(makeVideo(), outputFolder, () => {});

  expect(mockTranscribeViaGemini).toHaveBeenCalledWith(YOUTUBE_URL, VIDEO_ID, 300);
  expect(mockGenerateDeepDiveCombined).toHaveBeenCalledWith(YOUTUBE_URL, GEMINI_SEGMENTS, 'en', VIDEO_ID);
  expect(mockGenerateDeepDive).not.toHaveBeenCalled();
  const content = fs.readFileSync(path.join(outputFolder, `${SUMMARY_BASE}-deep-dive.md`), 'utf-8');
  expect(content).toContain('▶ [0:00]');
});
```

Replace the `:116` test ("video-only path when transcript is empty ([])…") with:

```ts
it('captions empty ([]) → Gemini fallback → combined path with ▶', async () => {
  mockFetchTranscriptSegments.mockResolvedValueOnce([]);
  mockTranscribeViaGemini.mockResolvedValueOnce(GEMINI_SEGMENTS);

  await writeDeepDiveDoc(makeVideo(), outputFolder, () => {});

  expect(mockTranscribeViaGemini).toHaveBeenCalledWith(YOUTUBE_URL, VIDEO_ID, 300);
  expect(mockGenerateDeepDiveCombined).toHaveBeenCalledWith(YOUTUBE_URL, GEMINI_SEGMENTS, 'en', VIDEO_ID);
  expect(mockGenerateDeepDive).not.toHaveBeenCalled();
  const content = fs.readFileSync(path.join(outputFolder, `${SUMMARY_BASE}-deep-dive.md`), 'utf-8');
  expect(content).toContain('▶ [0:00]');
});
```

Add a NEW floor test immediately after:

```ts
it('captions AND Gemini both fail → video-only path, no ▶ (graceful floor)', async () => {
  mockFetchTranscriptSegments.mockRejectedValueOnce(new Error('no captions'));
  mockTranscribeViaGemini.mockRejectedValueOnce(new Error('gemini transcribe failed'));

  await writeDeepDiveDoc(makeVideo(), outputFolder, () => {});

  expect(mockGenerateDeepDive).toHaveBeenCalledWith(YOUTUBE_URL, 'en');
  expect(mockGenerateDeepDiveCombined).not.toHaveBeenCalled();
  expect(mockGenerateDeepDiveFromTranscript).not.toHaveBeenCalled();
  const content = fs.readFileSync(path.join(outputFolder, `${SUMMARY_BASE}-deep-dive.md`), 'utf-8');
  expect(content).toContain('Video-only analysis');
  expect(content).not.toContain('▶');
});
```

**No edits to `:168`/`:180`:** with the Step-1 default (`transcribeViaGemini` → `[]`), a caption rejection now flows captions-throw → Gemini-empty → resolver throws → `segments=null` → video-only — exactly what those tests already assert. They pass unchanged under both old and new code.

- [ ] **Step 3: Strengthen the combined-path test (`:70`) — prove no extra cost on captioned videos**

In the `:70` test, after line 76 (`expect(mockGenerateDeepDive).not.toHaveBeenCalled();`) add:

```ts
    expect(mockTranscribeViaGemini).not.toHaveBeenCalled();
```

(Captions succeed via `beforeEach` → resolver returns them → Gemini transcribe never called. The existing `expect(mockFetchTranscriptSegments).toHaveBeenCalledWith(VIDEO_ID)` still holds — the real resolver calls it.)

- [ ] **Step 4: Make `ensure-integration.test.ts` undefined-safe (B1)**

This test runs the REAL `writeDeepDiveDoc` with `lib/gemini` mocked but never stubs `transcribeViaGemini`. After the swap its empty-captions case would route into the resolver's Gemini branch (`undefined.length` → throw). Make the video-only intent explicit.

After line 23 (`const mockFetchTranscript = jest.mocked(youtube.fetchTranscriptSegments);`) add:

```ts
const mockTranscribeViaGemini = jest.mocked(gemini.transcribeViaGemini);
```

In its `beforeEach` (lines 66-72), replace the comment + add the stub:

```ts
    // No captions AND no Gemini transcript → write-doc falls to the video-only Gemini path.
    mockFetchTranscript.mockResolvedValue([]);
    mockTranscribeViaGemini.mockResolvedValue([]);
    mockGenerateDeepDive.mockResolvedValue('### **1. Overview**\n\nDeep dive body content.\n');
```

- [ ] **Step 5: Run the two test files to verify the RED is precisely the flipped tests**

Run: `npx jest tests/lib/deep-dive/write-doc.test.ts tests/lib/deep-dive/ensure-integration.test.ts`
Expected: FAIL — **only** the two flipped tests (`captions gated → … with ▶` and `captions empty ([]) → … with ▶`) fail, because current `write-doc.ts` uses captions-only `fetchTranscriptSegments`: on caption throw/empty it goes straight to video-only, so `generateDeepDiveCombined` is NOT called and no ▶ is written. **Everything else is GREEN already** — the floor test (current code: caption reject → video-only, transcribe never called), `:168`/`:180`, the `:70` strengthening, and `ensure-integration` (the new stub is unused under current code) all pass before the fix. (This is the accurate RED prediction: 2 tests red, the rest green.)

- [ ] **Step 6: Implement the swap in `lib/deep-dive/write-doc.ts`**

Replace the import on line 4 (remove the `fetchTranscriptSegments` import — it is this file's only use of it):

```ts
import { resolveTranscriptSegments } from '../transcript-source';
```

Replace the transcript fetch (lines 41-43):

```ts
  let segments: TranscriptSegment[] | null = null;
  try {
    const resolved = await resolveTranscriptSegments(videoId, video.youtubeUrl, video.durationSeconds);
    segments = resolved.segments;
  } catch (e) { errors.push(`transcript fetch: ${msg(e)}`); }
```

Everything else (the `segments !== null && segments.length > 0` guard, the combined→transcript-only→video-only cascade, filename, frontmatter, HTML invalidation) is unchanged.

- [ ] **Step 7: Run both test files to verify GREEN**

Run: `npx jest tests/lib/deep-dive/write-doc.test.ts tests/lib/deep-dive/ensure-integration.test.ts`
Expected: PASS — all tests green, including the two flipped fallback tests and the floor test.

- [ ] **Step 8: Typecheck + full suite**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean; full suite green (no regressions in `pipeline.test.ts`, `transcript-source.test.ts`, `ensure*.test.ts`, `tests/api/deep-dive-*`, deep-dive E2E).

- [ ] **Step 9: Commit**

```bash
git add lib/deep-dive/write-doc.ts tests/lib/deep-dive/write-doc.test.ts tests/lib/deep-dive/ensure-integration.test.ts
git commit -m "fix(deep-dive): source transcript via captions→Gemini resolver so gated videos get ▶ timestamps"
```

---

## Task 2: Verification — repair + prove on a real gated doc

**Goal:** Prove the fix end-to-end on a real video whose deep-dive currently has no ▶ but whose captions are available, AND repair that user-visible doc. (Not a code change; an evidence step. Requires the dev server running and `GEMINI_API_KEY`.)

- [ ] **Step 1: Record the before-state**

Run: `grep -c '▶' "<DATA>/agentic-ai-claude-code/raw/software-fundamentals-matter-more-than-ever-matt-pocock-deep-dive.md"`
(`<DATA>` = the resolved `OUTPUT_FOLDER`.) Expected: `0` (the reported symptom).

- [ ] **Step 2: Force a regeneration through the running app**

`v4F1gFy-hqg`'s stored `deepDiveVersion` is already current, so `ensureDeepDiveHtml` would no-op. Temporarily set its `deepDiveVersion` to `{ "major": 1, "minor": 0 }` in `<DATA>/agentic-ai-claude-code/raw/playlist-index.json` (PRE_FEATURE → `needsRegenerate` true), then:

```bash
curl -s -X POST "http://localhost:3000/api/videos/v4F1gFy-hqg/deep-dive" \
  -H 'Content-Type: application/json' \
  -d '{"outputFolder":"<DATA>/agentic-ai-claude-code/raw"}'
```

Stream `GET /api/ingest/stream?jobId=<id>` until `done`. (The `updateVideoFields` on success re-stamps the version to current.)

- [ ] **Step 3: Assert ▶ timestamps now present**

Run: `grep -c '▶' "<DATA>/agentic-ai-claude-code/raw/software-fundamentals-matter-more-than-ever-matt-pocock-deep-dive.md"`
Expected: `> 0` — ▶ timestamps restored. This is the end-to-end proof and repairs the doc the user saw.

- [ ] **Step 4: Record the corpus-wide open question for the user** (do NOT mass-regenerate). Note in the PR which other deep-dives are ▶-less with available captions, and ask whether to run a targeted repair across the corpus.

---

## Self-Review (completed during planning; re-done after adversarial rework)

**Spec coverage:**
- Swap → Task 1 Step 6 ✓
- Graceful video-only floor (resolver throws → catch → null) → Step 6 + floor test Step 2 ✓
- B1 (`ensure-integration.test.ts` stub) → Task 1 Step 4 ✓ (was the missing high-risk surface)
- B2 (default `transcribeViaGemini` stub) → Task 1 Step 1 ✓
- H1 (empty `[]` triggers Gemini) → flipped `:116` Step 2 ✓
- H3 (all affected tests) → `:103`/`:116` flipped (Step 2); `:168`/`:180` covered by the Step-1 default (no edit needed); `:70` strengthened (Step 3) ✓
- H2 (keep combined) → Step 6 leaves cascade order unchanged ✓
- Cost discipline (captioned → no transcribe) → `:70` assertion Step 3 ✓
- Verification repair of a real doc (M3) → Task 2 ✓
- RED prediction accuracy (review H1/H2) → Step 5 states precisely 2 red, rest green ✓

**Placeholder scan:** none — every code step carries exact code; `<DATA>` in Task 2 is an explicit operator substitution, not a code placeholder.

**Type consistency:** `resolveTranscriptSegments(videoId, youtubeUrl, durationSeconds)` matches its definition; `transcribeViaGemini(YOUTUBE_URL, VIDEO_ID, 300)` assertion matches its real `(youtubeUrl, videoId, durationSeconds)` order; `makeVideo()` sets `durationSeconds: 300`; `GEMINI_SEGMENTS: TranscriptSegment[]`.
