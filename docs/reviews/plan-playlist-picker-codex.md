# Codex Adversarial Review — Playlist Picker Implementation Plan

**Date:** 2026-06-30
**Target:** `docs/superpowers/plans/2026-06-30-playlist-picker.md`
**Reviewer:** Codex (fresh thread), adversarial mandate
**Gate:** Post-Plan Gate (AFK — substitutes for human approval per feedback-afk-autonomy)

---

## Findings + disposition

### Blocking

**B1 — Test location + jest config wrong (all tasks).** Plan co-locates tests beside source and runs
`-c jest.config.js`; repo uses `jest.config.ts` with `testMatch` = `tests/{lib,api,scripts}/**/*.test.ts` +
`tests/components/**/*.test.tsx`. Co-located tests are never discovered. (`jest.config.ts:11-17`, verified.)
→ **FIXED (plan rewritten).** All tests relocated under `tests/{lib,api,components,scripts}/`; run commands use
plain `npx jest <name>`; `git add` paths updated; component tests carry `/** @jest-environment jsdom */`; test
imports use the `@/` alias (moduleNameMapper `^@/(.*)$` → rootDir).

### High

**H1 — recent route contract mismatch (T4/T10/T13).** Spec said bare `200 PlaylistOption[]`; plan returns
`{ playlists }`. → **FIXED.** Standardized on the **wrapped `{ playlists: PlaylistOption[] }`** object (consistent
with the channel route's `{ channelTitle, playlists }`, and extensible for a future `truncated` flag). Spec route
table updated to `{ playlists }`; PlaylistPicker + E2E already read `.playlists`.

**H2 — `parseChannelHandle` accepts non-YouTube URLs / embedded `@`** (`https://evil.example/@Anthropic`, `x@y`).
→ **FIXED (T5 rewritten).** URL forms parsed with `new URL`, host must be YouTube-owned
(`youtube.com`/`www.`/`m.`/`youtu.be`), pathname must match `^/@<handle>$` or `^/channel/UC…$`; non-URL input must
be a bare `@handle`/`handle`/`UC…` with no `/`, space, or extra `@`. Rejection tests added for a non-YouTube host
and an embedded-`@` string.

**H3 — Task 2 fallback-to-id contradicts spec.** Prose said title fetch falls back to the id (would persist a bare
hash); snippet omits. → **FIXED.** Task 2 prose changed to "omit `playlistTitle` on fetch failure"; a failure test
asserts the field is **absent** (never the id).

### Medium

**M1 — recent provider mtime sort unproven / wrong key.** → **FIXED.** Sort by **playlist-folder** mtime
(`fs.statSync(dir)`), and a temp-dir test sets folder mtimes via `fs.utimesSync` and asserts order.

**M2 — providers/backfill readdir before `assertOutputFolder`.** → **FIXED.** `assertOutputFolder(root)` added at
the entry of `listRecentPlaylists` and `backfillPlaylistTitles` (defense-in-depth; ENOENT-within-home still yields
`[]`).

**M3 — Task 7 `500`-on-no-key path untested.** → **FIXED.** Added a test that deletes `process.env.YOUTUBE_API_KEY`
and asserts `500`.

**M4 — Task 11 missing loading / 502 / chip-refill tests.** → **FIXED.** Added loading-state, 502 "Couldn't reach
YouTube" and stored-chip-refill tests.

**M5 — E2E pick-recent doesn't assert Fetch fires.** → **FIXED.** T13 mocks `/api/ingest`, clicks Fetch after
selection, asserts the POST body carries the selected canonical URL.

### Low

**L1 — global fallback chain ends in `id`.** → **FIXED.** Global Constraints chain now `playlistTitle → folder slug
→ "Untitled playlist"`.

**L2 — Task 9 points at a non-existent test path.** → **FIXED.** Task 9 extends the existing
`tests/api/videos.test.ts`.

---

**Outcome:** 1 Blocking + 3 High + 5 Medium + 2 Low — all addressed in the rewritten plan. Gate satisfied to
proceed to implementation (subagent-driven-development).
