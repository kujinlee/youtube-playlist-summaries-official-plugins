# Codex Adversarial Review — Stage 3 Plan (Re-summarize Menu)

**Date:** 2026-06-30 · **Verdict:** No Blocking/High. Deviation (reuse html-doc + force) is functionally sound. Approve with conditions — folded into plan v2.

## MEDIUM
1. **Status-bar labeling** — `HtmlDocStatusBar` says "HTML Doc" even for Re-summarize (step text does say "Re-summarizing…", but the persistent label/aria don't). → add a lightweight optional `label` prop to `HtmlDocStatusBar` (default "HTML Doc"); the re-summarize path passes "Re-summarize". No new component.
2. **Shared-lock semantics** — a force request while a non-force html-doc job is active returns the existing (non-force) jobId; it does NOT upgrade to force ("join active job"). Acceptable because the menu item is disabled while busy, but must be documented. → documented + accepted; add a backend test.

## LOW/MEDIUM
3. **Dismiss clears busy immediately** — `handleHtmlClose` clears `busyVideoId` + refreshes rows even if the server job is still running (inherited HtmlDocStatusBar behavior). The duplicate-lock prevents a second backend run. → accept (existing behavior, not introduced here).

## Correctness (confirmed)
- `ensureHtmlDoc(id, folder, cb, CURRENT_DOC_VERSION, body?.force===true)` correct; defaults preserve existing behavior.
- `force=true` bypasses the version check (`if (force || needsResummarize(...))`, ensure.ts:39) → re-runs writeSummaryDoc + rebuilds even when current.
- Re-summarize always a button; render only when summaryMd; disable while busy — sensible.

## Test gaps (folded in)
- Add backend test: active non-force job → force POST returns same jobId, no 2nd ensureHtmlDoc call.
- Note reliance on existing html-doc-post 400/path tests.

## Resolution
Plan v2: add `label` prop to HtmlDocStatusBar; document join-active-job; add the join test. AFK: approval via this review.
