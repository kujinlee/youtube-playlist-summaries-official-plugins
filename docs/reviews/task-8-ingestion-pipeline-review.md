# Task 8 — Ingestion Pipeline: Claude Code Review

**Verdict:** One Critical issue fixed; three improvements made during review

---

## Strengths

- Minimal orchestration: pipeline delegates entirely to lib layer, no business logic reimplemented
- Correct error resilience: per-video try/catch continues to next video and emits `error` event
- `assertVideoId` called before any file path construction (defense-in-depth)
- `YOUTUBE_API_KEY` guard placed before I/O-bound `assertOutputFolder` (cheap-guard-first ordering)
- All 5 tests passing (56 total in suite)

---

## Issues Found and Resolved

### Critical (fixed)

**1. `playlistUrl` never written — index always stored `''`**
`readIndex` returns `{ playlistUrl: '' }` for a new index. `upsertVideo` reads-then-writes per video, carrying the empty string forward and silently violating the `z.string().url()` schema on every write.
*Fix:* Added `readIndex` + `writeIndex` stamp before the loop to write the real `playlistUrl` before any `upsertVideo` call. Added a new test `'stamps playlistUrl into the index before processing videos'` to verify this.

### Important (fixed)

**2. Test temp dirs under `os.homedir()` instead of `os.tmpdir()`**
Since `assertOutputFolder` is mocked in pipeline tests, the homedir restriction doesn't apply. A crashed test would leave orphaned dirs in the home directory rather than the OS temp location.
*Fix:* Changed `makeTempDir()` to use `os.tmpdir()`.

### Minor (fixed)

**3. No per-video completion step event**
After `upsertVideo`, no `step` event was emitted. Callers (API/SSE layer) could not distinguish a video completing successfully from a video being mid-processing.
*Fix:* Added `onProgress({ type: 'step', ..., step: 'Saved', ... })` after `upsertVideo`. Verified in sequence test.
