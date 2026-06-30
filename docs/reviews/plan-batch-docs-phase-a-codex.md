# Batch-docs Phase A plan — Codex adversarial review

**Model:** gpt-5.5 (Codex online, no fallback). **Target:** `docs/superpowers/plans/2026-06-29-batch-docs-phase-a.md` + spec + the existing files it mirrors.

**Verdict: 0 Blocking, 3 High, 2 Medium — all addressed in the plan (commit below). Cleared to implement (AFK: Codex review substitutes for user approval).**

## Findings + resolutions

### HIGH
- **H1 — no cancel path; ✕ left an orphan job.** Spec dismissal table requires ✕-while-running to abort the job; the plan's close only cleared UI. **Fixed:** added `POST /api/videos/batch-docs/cancel` (calls `cancelJob`) + `BatchDocStatusBar` ✕ POSTs cancel while running; tests AA-cancel + H1.
- **H2 — no incremental row refresh during the batch.** Spec requires rows to flip as each item completes. **Fixed:** `onProgressEvent` callback on the status bar → page `handleBatchProgress` calls `fetchVideos` on each step/error (race-guarded by `fetchSeqRef`); test H2.
- **H3 — active-batch rows had no ⏳ / live checkboxes.** Spec requires ⏳ + disabled checkbox on rows being processed; the scalar `busyVideoId` can't represent a set. **Fixed:** batch state is `{jobId, videoIds:Set}`; `activeBatchVideoIds` threaded to `VideoList`→`VideoRow`, reusing the existing `busy` prop for ⏳ and `disabled={!selectable||busy}` on the checkbox; test H3.

### MEDIUM
- **M1 — VideoRow new props shown required, contradicting the tsc-green-standalone intent.** **Fixed:** made them optional-with-defaults (guards any standalone `VideoRow` render too).
- **M2 — `mode:'summary-dig'` silently accepted as summary in Phase A.** **Fixed:** route returns 400 for `'summary-dig'` until Phase B.

## Verified CLEAN by Codex (independent)
1. Import depths in the new route files (4-up POST, 5-up stream/cancel) — match the dir depth.
2. Stream closure: keeps open on per-video `{error, videoId}`, closes on done/cancelled/error-without-videoId (mirrors ingest). No off-by-one.
3. Dedup key `${outputFolder}::batch-docs` — 409s a second batch, no collision with ingestion (raw folder) or single html-doc (`folder::videoId`); releaseJobLock + deferred deleteJob correct.
4. Abort test LA6 — valid (abort set in first ensure mock; 2nd iteration's top-of-loop check sees it; ensure called once).
5. Column count 16→17 — correct (checkbox added before chevron; VideoRow cells + thead + QuickView colSpan).
6. Select-all toggle + indeterminate ref logic — correct; CA3 asserts the needing subset.
7. E2E POST-vs-/stream mock disambiguation — handled (`if url.includes('/stream') continue` + separate stream mock).
8. ProgressEvent schema — no `step` emitted with `total:0` (loop body only runs when work.length>0); `start` uses nonnegative total.

## Cross-check with my own pre-review
My independent checks (import depths, TOTAL_COLUMNS) agreed with Codex's CLEAN on areas 1 and 5. The 3 High were spec-fidelity gaps I under-specified (dismissal/refresh/busy), now closed against the spec's own tables.
