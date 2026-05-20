# Task 7 — Archive Manager: Claude Code Review

**Verdict:** Two Important issues fixed; one Minor test gap addressed

---

## Strengths

- Minimal implementation: 28 lines, does exactly what the plan requires
- Security delegated correctly — `assertOutputFolder` and `assertVideoId` reached via `updateVideoFields`, no reimplementation
- Real filesystem tests under homedir, UUID temp dirs, unconditional `afterEach` cleanup
- All four plan requirements covered plus bonus test for missing `archived/` directory creation

---

## Issues Found and Resolved

### Important (fixed)

**1. `async` functions with sync internals**
Both functions declared `async` but used only `*Sync` fs calls. Creates false expectation of non-blocking I/O.
*Fix:* Switched to `fs.promises.rename` and `fs.promises.mkdir`. `moveIfExists` helper catches `ENOENT` (file absent = no-op) and wraps other errors with `{ cause }`.

**2. `updateVideoFields` throws when video not in index — not a no-op**
Plan requires "no-op if file doesn't exist (no error thrown)" but `updateVideoFields` throws `Video not found in index` when video is absent from index. Would surface as 500 errors at API layer.
*Fix:* Added `updateIndexIfKnown` wrapper that catches the "not found" error and returns silently. Covers both archive and unarchive.

### Minor (fixed)

**3. Missing test: videoId absent from index**
No test verified the no-op behavior for unknown video IDs.
*Fix:* Added two tests — one for `archiveVideo` and one for `unarchiveVideo` — both confirming no throw when video not in index.
