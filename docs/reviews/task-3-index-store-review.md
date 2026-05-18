# Task 3 — Index Store: Claude Code Review

**Verdict:** Not ready to merge (before fixes) → Ready after fixes applied

---

## Strengths

- Correct core logic — all four functions implement exactly what the plan specifies. `readIndex` returns an empty index on `ENOENT` and re-throws every other error. `writeIndex` does the temp-then-rename atomic write. `upsertVideo` and `updateVideoFields` correctly read-modify-write and use spread for non-destructive partial update.
- Clean, minimal code — private `indexPath` helper eliminates path-construction duplication without over-abstracting. 48 lines, no dead code.
- Tests exercise real filesystem I/O — no mocking; real files written to `os.homedir()/.test-index-store-<timestamp>`. Cleanup via `afterAll` correct.
- All five tests passed.
- Round-trip test covers every field via `makeVideo` helper with full `Video` shape.

---

## Issues Found and Resolved

### Critical (fixed)

**Filesystem safety rules absent from `lib/index-store.ts`**

The design-spec (Filesystem Safety section) explicitly places path-traversal prevention and videoId validation in `lib/index-store.ts`. Neither rule was implemented — a caller could pass `outputFolder = '../../../../etc'` and `writeIndex` would write there.

*Fix applied:* Added `assertOutputFolder` (resolves path, rejects anything outside `os.homedir()`, throws `{ statusCode: 400 }`) and `assertVideoId` (validates against `/^[A-Za-z0-9_-]{1,20}$/`, throws `{ statusCode: 400 }`). Called at the top of every exported function.

---

### Important (fixed)

**1. No tests for security validations**
Three new tests added: `readIndex` rejects `/etc`, `upsertVideo` rejects `id: '../passwd'`, `updateVideoFields` rejects `id: '../passwd'`.

**2. `updateVideoFields` silently no-ops on missing video**
Changed to throw `Error('Video not found in index: <id>')` so callers detect state machine divergence.

**3. JSON parse errors re-thrown without file path context**
Now wrapped: `throw new Error('Failed to read <filePath>: <original message>', { cause: err })`.

**4. `playlistUrl: ''` in empty default violates Zod URL constraint downstream**
Noted as a schema design decision: the empty default is an uninitialised sentinel, not a real URL. Zod validation is applied at API boundaries, not internally in `readIndex`. Left as-is with the understanding that no consumer should `PlaylistIndexSchema.parse()` on a freshly-initialised index before ingestion sets the URL.

---

### Minor (fixed)

**`.tmp` file not cleaned up on `renameSync` failure**
Added try/finally in `writeIndex` to `unlinkSync` the `.tmp` on error.

**Test dir used `Date.now()` — collision risk**
Changed to `crypto.randomUUID()`.

---

## Final State

- 9 tests, all passing
- Full suite: 12 tests, 0 failures
