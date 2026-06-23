# Adversarial Plan Review — quick-reference-fallback

**NOTE: Codex at usage limit (until Jul 18 2026); Claude (opus) adversarial review per docs/plugins.md fallback.**

Verdict: **needs-rework** → 2 Blocking (test placement) + High/Medium applied. The production diff (Step 4), the import (non-circular), TS soundness, and transcript-mock boundary are all verified correct; the `makeSummaryResponse` default blast radius is actually SMALLER than feared (no existing assertion breaks — callout-absence is never asserted on a defaulted response, and all index checks use `objectContaining`).

## Applied
- **B1 — duplicate describe + orphaned `it`.** The test file ALREADY has `describe('writeSummaryDoc', …)` at line 1112. → Plan rewritten: add the 4 fallback `it` cases INTO that existing block (reuse its `outputFolder`/`afterEach`); place the ingestion-level `it` INSIDE `describe('runIngestion')` (after the `:561` callout test). No new `writeSummaryDoc` describe; no top-level `it`.
- **B2 — transcript stub gap on merge.** The existing `writeSummaryDoc` `beforeEach` (line 1115) stubs `mockDetectLanguage`+`mockGeneratePdf` but NOT `mockFetchTranscriptSegments` (each test sets its own). → Step 1 now adds `mockFetchTranscriptSegments.mockResolvedValue([...])` AND the defensive `mockExtractQuickView.mockResolvedValue(...)` to that block's `beforeEach`, so the merged-in cases resolve transcripts (existing `:1128`/`:1151` set their own, which override).
- **H2 — defensive extractQuickView default in both beforeEachs.** Added to the `writeSummaryDoc` block's `beforeEach` too (symmetry); Step 6 notes the two existing direct tests `:1130`/`:1153` (now both-present after the default change → no fallback) to eyeball.
- **M2** — `mockExtractQuickView = jest.mocked(gemini.extractQuickView)` goes in module scope (near the other mock handles ~line 22-28), not inside a describe.
- **M3** — Step 3 now labels the "both present → not called" case as already-GREEN at RED stage; cases 2/3/4 + ingestion are the RED ones.

## Verified-correct (reviewer)
- Control-structure diff replaces lines ~68-73 cleanly; `tldr`/`takeaways` in scope (destructured ~47); `outTldr/outTakeaways` types sound; `SummaryDocResult` matches.
- `lib/gemini` does NOT import `lib/pipeline` → adding `extractQuickView` to the line-4 import is non-circular.
- `resolveTranscriptSegments` calls only `fetchTranscriptSegments` (youtube, mocked) + `transcribeViaGemini` (gemini, mocked) → stubbing `mockFetchTranscriptSegments` suffices, no network; `writeSummaryDoc` doesn't call `assertOutputFolder`, so the real-`mkdirSync` temp dir is fine.
- **No existing assertion breaks from the `makeSummaryResponse` default change**: no test asserts callout-absence on a defaulted response; the `strip`/`insert` unit tests use controlled input; every index-entry check uses `objectContaining` (tolerant of the added tldr/takeaways); `:176`/`:183` only assert videoType/audience. Step 6 churn is expected to be ~zero (still run the full suite to confirm).
- L1: `updateVideoFields` exists in `lib/index-store` (migration prose valid). L2: `# T` + `video_id: "vid1"` assertions valid against `baseContent`.
