# Task 3 — Index Store: Codex Adversarial Review

**Verdict:** Not ready to merge — Critical and High findings require fixes

---

## Findings

### Critical

**1. Symlink bypass in `assertOutputFolder` (`lib/index-store.ts:9-16`, `:25-26`)**
`path.resolve()` does not follow symlinks. A path like `$HOME/link-to-etc` passes the homedir prefix check but filesystem operations follow the symlink to outside the home directory. Fix: resolve real path with `fs.realpathSync.native` and enforce the home-directory boundary on the real path.

---

### High

**2. `updateVideoFields` allows `fields.id` to replace the video ID (`lib/index-store.ts:70-79`)**
`fields` is `Partial<Video>` — it can include `id`. The function validates only the lookup `id`, then blindly spreads `fields` including any `id` override. Fix: strip `id` from `fields` before merging.

**3. `writeIndex` bypasses video ID validation entirely (`lib/index-store.ts:44-50`)**
`writeIndex` never validates `index.videos[*].id`. Callers can route around every guard on `upsertVideo` and `updateVideoFields` by constructing an index directly and calling `writeIndex`. Fix: validate every `index.videos[].id` inside `writeIndex`.

**4. Shared `.tmp` filename unsafe under concurrent writers (`lib/index-store.ts:47-50`, `:57-67`, `:70-79`)**
`tmpPath` is always `filePath + '.tmp'`. Two simultaneous `writeIndex` calls can overwrite the same temp file before either `renameSync`. Fix: use a unique temp filename per write (e.g. `crypto.randomUUID()`).

---

### Medium

**5. Atomic write not crash-durable — no fsync (`lib/index-store.ts:49-50`)**
Neither the temp file nor the parent directory is fsynced. For a local dev tool this is acceptable risk.

**6. `playlistUrl: ''` violates the project's own schema (`lib/index-store.ts:38`, `types/index.ts:47-50`)**
The empty sentinel fails `z.string().url()`. Noted as a design decision: Zod validation is applied at API boundaries, not internally. Acceptable as long as no internal consumer parses with `PlaylistIndexSchema`.

**7. ENOENT on missing directory indistinguishable from missing file (`lib/index-store.ts:35-40`)**
`readIndex` returns an empty index for any `ENOENT`, including when the output directory itself doesn't exist. Fix: lstat the directory separately before returning an empty index.

---

### Low

**8. Shared `.tmp` cleanup can delete another writer's temp file (`lib/index-store.ts:51-53`)**
Addressed by fixing finding #4 (unique temp filenames).

**9. Tests miss symlink bypass, `fields.id` mutation, `writeIndex` invalid-ID paths**

**10. No atomic-write or corrupted-file behavior tests**

---

## What Claude's Reviewer Missed

1. Symlink bypass (finding 1) — prefix check is a false sense of security without `realpathSync`
2. `fields.id` override hole in `updateVideoFields` (finding 2)
3. `writeIndex` not validating video IDs (finding 3)
