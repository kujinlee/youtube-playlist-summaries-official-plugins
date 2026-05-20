# Task 16: Main Page Integration — Claude Code Review

## Strengths

- All 5 wire-ups present: Header→ingest SSE, SortBar→refetch, Show Archive, deep-dive overlay, archive menu.
- Terminal-flag pattern prevents stale EventSource callbacks after re-submission (matches DeepDiveOverlay pattern).
- Unmount cleanup + ingestESRef.close() on new submission both handled.
- fetchVideos on mount correctly sequences settings→videos and uses locally-captured folder (not stale state).
- Accessible markup: aria-label, role="alert", aria-valuenow, labeled checkbox.
- 220/220 tests, tsc clean.

## Issues

### Critical (Must Fix)
None.

### Important (Should Fix)

**[I1] Stale sort state in post-ingest refetch — app/page.tsx lines 107-112**
`handleIngest` closes over `sortColumn`/`sortOrder` at call time. If user changes sort while ingest is running, `handleIngest` gets a new identity but the already-running invocation's `onmessage` still holds the old sort values. The done-path `fetchVideos(folder, sortColumn, sortOrder)` uses stale sort.
Fix: use a `sortRef` that always holds current sort values; read from ref in the done handler; shrink `handleIngest` deps to `[fetchVideos]` only.

**[I2] No test covers "ingest POST fails" edge case**
Plan explicitly lists "Ingest POST fails → error shown inline, no SSE" as an edge case. No test verifies it.
Fix: add test that submits form with `/api/ingest` absent from handlers, asserts error paragraph appears and no EventSource is opened.

**[I3] Header button not disabled during active ingest**
User can click Fetch & Summarize multiple times while ingest is running. During the async gap between old ES close and new ES open, two in-flight POSTs can coexist; only the second ES ends up in `ingestESRef.current`; first ES's `onmessage` can still fire and cause state updates.
Fix: pass `disabled={ingest.status === 'running'}` to Header (requires adding a `disabled` prop to Header).

### Minor (Nice to Have)

**[M1] Dead `'done'` member in `IngestStatus`** — never assigned; `done` path sets `IDLE_INGEST` directly. Remove it.

**[M2] Behavior 5 test title says "hides progress" but doesn't assert it** — add `waitFor(() => expect(screen.queryByLabelText('Ingestion progress')).not.toBeInTheDocument())`.

**[M3] No test for `onerror` (Connection lost) in ingest** — call `ingestES.onerror?.(new Event('error'))` in a dedicated test.

**[M4] `mockFetch` prefix-match is order-sensitive** — `'GET /api/videos'` is prefix of `'GET /api/videos/v1/...'`; could silently mismatch in future tests.

**[M5] `role="progressbar"` redundant on `<progress>`** — implicit ARIA role; established pattern in codebase.

## Recommendations

1. Fix stale sort closure (I1) — correctness bug for long-running ingests.
2. Fix double-submit guard (I3) — race condition with concurrent EventSources.
3. Add ingest POST fails test (I2) — required by plan edge cases.
4. Behavior 5 assertion gap (M2) — test name is misleading without it.
5. Remove dead `'done'` type variant (M1).

## Assessment

**Ready to merge:** No — with fixes (I1–I3).

**Reasoning:** All 13 behaviors implemented and wired correctly. Three Important issues are correctness gaps not caught by tests (stale sort, double-submit race, missing edge case test). None are regressions but all affect production reliability.
