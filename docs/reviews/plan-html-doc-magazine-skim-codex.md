# Codex Adversarial Review — HTML Doc Export (Magazine-Skim) Plan

**Date:** 2026-06-09
**Reviewer:** Codex (gpt-5.x, `--fresh`)
**Target:** `docs/superpowers/plans/2026-06-09-html-doc-magazine-skim.md` (+ spec)
**Mandate:** Adversarial review of the implementation plan only — no code written.

---

**BLOCKING**

- Severity: BLOCKING
- Dimension: 6 (concurrency)
- Location: plan (POST route), `lib/job-registry.ts:16-25`, spec `:200-201`
- Finding: The plan does not implement the required same-video double-submit guard.
- Evidence: Spec says, "if a job for this video is already live, return that `jobId`"; plan calls `createJob(jobId)` with no key and no existing-job lookup.
- Impact: Two jobs for the same video can run concurrently, both spend Gemini calls, and the last finisher overwrites the cached HTML/index state.
- Suggested fix: Add a video-scoped active-job registry key such as `${outputFolder}:${videoId}`, return the existing jobId on duplicate POST, and release it on all terminal paths.

- Severity: BLOCKING
- Dimension: 4e / 5 (late-subscribe)
- Location: plan (POST route), `lib/job-registry.ts:35-45`, `:61-67`
- Finding: The POST route deletes the job immediately on `done`/`error`, so a client that subscribes after a fast job finishes gets `404` instead of buffered terminal events.
- Evidence: Plan does `deleteJob(jobId)` inside the progress callback; registry replay only works while `registry.get(jobId)` exists.
- Impact: The status bar can fail with "job not found" even though generation completed, breaking the auto-open/view flow.
- Suggested fix: Retain completed jobs briefly, or require the client to subscribe before work starts.

- Severity: BLOCKING
- Dimension: 4e (path traversal)
- Location: plan (serve route)
- Finding: The serve route trusts `video.summaryHtml` as a filesystem path without constraining it to `htmls/<base>.html`.
- Evidence: Plan reads `htmlFile = video.summaryHtml` then `path.join(outputFolder, htmlFile)` and `fs.readFileSync(htmlPath)`.
- Impact: A crafted or corrupted index can make `/api/html/<id>` read arbitrary files reachable via path traversal under/near the allowed output folder.
- Suggested fix: Validate `summaryHtml` against a strict relative `htmls/*.html` pattern and verify the resolved path stays inside `path.join(outputFolder, 'htmls')`.

---

**HIGH**

- Severity: HIGH — Dimension 1/5 (migration)
- Finding: `summaryHtml` made required-nullable but no migration/backfill for existing indexes.
- Suggested fix: Make it optional/nullish in the schema, or add an explicit index migration that backfills missing `summaryHtml` to `null`.

- Severity: HIGH — Dimension 4c (contract)
- Finding: Zod guard allows 1-10 bullets per section, not the spec's 3-7.
- Suggested fix: `.min(3).max(7)` and add tests for 2 and 8 bullets.

- Severity: HIGH — Dimension 4e/5 (URL contract)
- Finding: Serve route ignores the required `type=summary` param.
- Suggested fix: Validate `type === 'summary'`; 400 for missing/unsupported.

- Severity: HIGH — Dimension 4d (atomicity)
- Finding: Failure after `renameSync` but before `updateVideoFields` leaves an orphan cached HTML file.
- Suggested fix: Clean up `finalPath` if the index update fails.

- Severity: HIGH — Dimension 2 (task ordering)
- Finding: Task 10 commits a required `VideoMenu` prop before Task 11 threads it through callers, leaving a non-building commit.
- Suggested fix: Thread the prop through all callers in the same task / before the commit.

- Severity: HIGH — Dimension 7e (SSE test gaps)
- Finding: SSE error coverage incomplete — connection-loss, `onerror`, and late-subscribe terminal replay untested.
- Suggested fix: Add tests for `onerror`, emitted terminal `error`, replayed buffered events, late-subscription.

---

**MEDIUM**

- M1 — Dimension 4a: Parser/renderer treats inline markdown (links/bold) in quick-reference text as plain escaped text. Fix or document as plain-text.
- M2 — Dimension 4a/7a: Parser tests lack Korean content and CRLF/frontmatter/callout variants.
- M3 — Dimension 4b/7b: Escaping tests don't assert parsed meta/title/TL;DR/takeaway escaping.
- M4 — Dimension 4b/5: Renderer omits the spec-required `<meta name="source-md" ...>` provenance field.
- M5 — Dimension 7f: Status-bar dismissal paths (manual Dismiss, done auto-clear timer) untested.
- M6 — Dimension 8a: Moving the transform into `lib/gemini.ts` weakens the spec's `lib/html-doc/transform.ts` module boundary; consider a thin wrapper.

---

**LOW**

- L1 — Dimension 8b: `window.open` after async SSE may be popup-blocked; acceptable as best-effort given the fallback anchor. Document it.

---

**Overall Assessment**

The plan covers the broad feature shape but is not implementation-ready as written. The three blocking gaps — missing same-video concurrency lock, early job deletion that breaks late-subscribe, and unconstrained path in the serve route — must be resolved before any task begins. High-severity gaps (Zod bullet-count, `type` validation, orphan-file window, inter-task type propagation break, SSE test coverage) each carry meaningful regression risk. Parser/renderer are directionally sound but under-specified for inline markdown, KO unit tests, and `source-md` provenance. The two noted deviations are mostly acceptable; the transform location warrants a thin wrapper to preserve the spec's module boundary.
