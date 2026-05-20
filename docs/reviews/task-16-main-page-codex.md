# Task 16: Main Page Integration — Codex Adversarial Review

## Critical

**[C1] Settings outputFolder never reaches Header's local input**
Header initializes `outputFolder` state from prop once (`useState(defaultOutputFolder)`); async settings load arrives after mount — Header keeps empty folder. Tests never catch this because they don't assert POST body.
Fix: Add `useEffect(() => setOutputFolder(defaultOutputFolder), [defaultOutputFolder])` to Header.tsx. Add test asserting POST body contains the settings-derived folder.

**[C2] User-selected ingest folder not adopted by page state**
`handleIngest(playlistUrl, folder)` uses submitted `folder` for the POST and done-path refetch but never calls `setOutputFolder(folder)`. Later sort, archive, deep-dive POSTs use stale page `outputFolder`.
Fix: Call `setOutputFolder(folder)` at ingest start.

**[C3] Per-video ingest error terminates stream too early**
Page closes ES on any `{ type: 'error' }`. But `runIngestion` emits `error` per video and continues, then emits `done`. UI disconnects early and misses later successes plus final refresh.
Fix: Don't close ES or mark terminal on error events; accumulate errors inline; only close on `done`.

**[C4] Fast job race — done before EventSource subscribes** (server-side)
POST resolves; job finishes before EventSource opens → 404 or missed terminal event.
Deferred: requires server-side event buffering. Log as known limitation.

**[C5] Unmount during POST creates EventSource after cleanup**
Cleanup only closes `ingestESRef.current`. If unmounted during POST, when POST resolves it creates a new EventSource and calls setIngest on unmounted component.
Fix: Track mounted state with a ref; bail out after each await if unmounted.

## Important

**[I4] Stale fetch responses can overwrite newer video state**
No abort controller or request sequence check — slow mount fetch can clobber a later sort/archive refetch.
Fix: Monotonically increasing request ID; only apply the latest response.

**[I5] Archive during ingest can race with file writes** (HYPOTHESIS)
`handleArchive` remains active during ingest. Concurrent archive can race with index writes.
Deferred: server API should serialize; no client-side fix needed.

**[I6] Deep-dive POST has no pending or failure UI**
While POST is in flight, no loading state; non-OK/network failures silently ignored.
Deferred: UX enhancement beyond acceptance criteria.

**[I7] Ingest progress step text not aria-live**
Changing step text not in an `aria-live` region; screen readers won't announce updates.
Fix: Add `aria-live="polite"` or `role="status"` to progress section.

**[I8-I10] Test gaps**
- mockFetch always returns ok:true, prevents non-OK coverage
- Tests don't verify request body (outputFolder, playlistUrl)
- SSE URL assertion is substring-only; doesn't check jobId encoding

## Low

**[L1] Closed ES not cleared from ref** — ingestESRef.current never nulled on terminal states.

**[L2] NaN if data.total === 0** — division without zero guard.

## Verdict

Not robust for production. Beyond the three known issues (stale sort, POST-fail test, double-submit), page has folder-state bugs (C1, C2), incorrect per-video error handling (C3), unmount leak (C5), and stale fetch overwrites (I4). Tests pass happy-path wiring but miss request bodies, timing, non-OK responses, and concurrent interactions.
