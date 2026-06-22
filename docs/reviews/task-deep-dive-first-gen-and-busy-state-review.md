# Code Review — Deep-Dive First-Gen + Busy-State Fixes (Claude)

**Branch:** `fix/deep-dive-first-gen-and-busy-state`
**Reviewer:** Claude (general-purpose subagent, read-only)
**Date:** 2026-06-21

## Scope

Two bug fixes:
1. **First-ever "Deep Dive doc" generation always failed** with `deep dive not available: video has no deepDiveMd`. `runDeepDiveHtml` re-read the index for `deepDiveMd` before `ensureDeepDiveHtml` had stamped it. Fix: optional `deepDiveMd` param on `runDeepDiveHtml` (falls back to index when omitted); `ensure.ts` passes the freshly-written filename at the two post-`writeDeepDiveDoc` call sites.
2. **Both menu items stuck on ⏳ after a job error.** `busyVideoId` was derived from status-bar-object existence; the error bar stays open, so ⏳ never cleared. Fix: explicit `busyVideoId` state set on start, cleared on close OR on terminal error; `onError` callback added to both status bars.

## Strengths

- Fix #1 is minimal and correct. `const md = deepDiveMd ?? video.deepDiveMd` is the smallest change that breaks the chicken-and-egg dependency. The third call site (md-present-but-no-html branch) correctly does NOT pass the override.
- The atomic-stamp invariant is preserved — still exactly one `updateVideoFields` per branch, after the render resolves. The override changes *what filename is read*, not *when the index is written*.
- No new path-traversal surface. The override originates only server-side in `writeDeepDiveDoc` (derived from `video.summaryMd ?? video.id`), never from a request param. The lazy serve route still calls with no override → goes through the route's path-containment guard.
- Fix #2 is the right diagnosis. `onErrorRef` mirrors the existing `onCloseRef` pattern; `onError` fires on both terminal paths (SSE `error` + `es.onerror`), with the `terminal` guard preventing double-fire.
- Tests cover the new behavior precisely (fire-on-error, fire-on-connection-lost, negative assertions for done/step; override test uses the exact first-gen condition).

## Issues

### Critical
None.

### Important
None.

### Minor
1. **`ensure.test.ts` mocks `runDeepDiveHtml`, so the seam that *was* the bug stays untested.** The updated assertion is a mock-argument check, not behavior. Real-path coverage exists in `generate-deep-dive.test.ts` (override renders when index has none), but nothing wires the two real modules together. Recommend one integration test exercising real `ensure.ts` → real `runDeepDiveHtml` (mocking only the Gemini/transcript boundary) for the first-gen path. **→ Addressed: added integration test.**
2. **`busyVideoId` is a single scalar; concurrent jobs on different rows clobber each other.** Pre-existing limitation (old `??` logic had the same single-value constraint). Edge case only — one status bar is realistically open at a time. If multi-row concurrency ever becomes a goal, make it a `Set`.
3. **`onError` clears `busyVideoId` unconditionally, even if it belonged to the other job.** Harmless today (single scalar / single bar). **→ Addressed: added a comment documenting the single-active-job assumption.**
4. **`HtmlDocStatusBar` error state has no `log` field / "Show Logs" parity differs from `DeepDiveStatusBar`.** Pre-existing, unrelated. No action.

## Assessment

**Ready to merge?** Yes (Minor #1 follow-up recommended and applied).

**Reasoning:** Both fixes are correct, minimal, and preserve the stated invariants; no new path-traversal surface; `onError` wiring has no double-fire or stale-closure flaw. The only substantive gap was test architecture (the bug-prone seam stayed mock-isolated), addressed with an integration test. 915/915 jest green, clean `tsc`.
