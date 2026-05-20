# Task 7 — Archive Manager: Codex Adversarial Review

**Verdict:** Two P1 security issues fixed; P2 findings addressed or documented

---

## P1 Findings (Fixed)

**P1-1: `outputFolder` used for filesystem writes before validation**
`mkdir` and `rename` executed before `assertOutputFolder` reached via `updateVideoFields`. Path traversal possible before rejection.
*Fix:* `assertOutputFolder(outputFolder)` called at start of both functions before any filesystem operation.

**P1-2: `videoId` interpolated into paths before validation**
`filePairs()` constructed move paths before `assertVideoId` called. A `videoId` like `../other` could move files outside video namespace.
*Fix:* `assertVideoId(videoId)` called at start of both functions. Both `assertOutputFolder` and `assertVideoId` exported from `index-store.ts` for reuse.

---

## P2 Findings

**P2-1: `rename` silently overwrites existing destination files (addressed)**
POSIX `rename` replaces destination atomically. If both root and `archived/` contain the same file, archive/unarchive would silently destroy the destination.
*Fix:* `moveIfExists` now catches `EEXIST` and skips (no-clobber semantics).

**P2-2: Partial move failure leaves files and index inconsistent (accepted risk)**
If one rename succeeds and a later one fails, files are split between root and `archived/` with index not updated. Full rollback would require tracking moves and reversing on error.
*Resolution:* Accepted as a known limitation. The API layer should surface errors; recovery requires manual inspection. Full transactional rollback deferred to a future hardening pass.

**P2-3: Concurrent archive/unarchive can split files (accepted risk)**
No per-video lock. Concurrent calls can interleave file-by-file moves producing mixed state.
*Resolution:* Accepted. The application has no concurrent archive operations in the current design (single-user, SSE-serialized). Deferred to future hardening if multi-user support is added.

**P2-4: `archived/` symlink not rejected (fixed)**
If `archived/` is a symlink to another directory, renames resolve through it.
*Fix:* `ensureArchiveDir` calls `lstat` after `mkdir` and throws if the path is not a real directory (symlink rejection).
