# Codex Adversarial Review — Orphaned `/api/playlist-info` Route Removal

**Date:** 2026-06-08
**Model:** gpt-5.5 (`scripts/codex-frontier-model.py`)
**Mode:** `--fresh`
**Branch:** master (staged diff)

## Change under review

Dead-code sweep following the Header auto-suggest removal (commit `f7a36f4`), which
left `app/api/playlist-info/route.ts` as the sole production caller of
`fetchPlaylistTitle`.

- Deleted `app/api/playlist-info/route.ts` (the route)
- Deleted `tests/api/playlist-info.test.ts` (route test)
- Removed `fetchPlaylistTitle` from `lib/youtube.ts`
- Removed `fetchPlaylistTitle` import, the `mockPlaylistsList` jest mock + its wiring,
  and the `describe('fetchPlaylistTitle')` block from `tests/lib/youtube.test.ts`
- **Kept** `tests/components/Header.test.tsx:207` — negative-assertion regression guard
  (`does NOT fetch /api/playlist-info`)

Pre-review verification: full suite 574/574 green; `tsc --noEmit` clean.

## Review mandate

1. Remaining production reference to `/api/playlist-info` or `fetchPlaylistTitle`
   (dynamic fetch strings, route registered elsewhere, runtime URL construction)?
2. Could the kept Header guard now pass for the wrong reason (404 masking a regression)?
3. Dead-code side effects (now-unused imports, helpers, empty dir)?
4. Anything making the deletion unsafe to ship?

## Findings

**No ship-blocking issues found.**

What Codex checked:

- No remaining production/test reference to `fetchPlaylistTitle`, `playlistTitle`,
  `playlists.list`, or `/api/playlist-info` except the kept negative test at
  `tests/components/Header.test.tsx:207`.
- No `app/api/playlist-info` directory remains in the working tree or staged index.
- `google` is **still needed** in `lib/youtube.ts` by `fetchPlaylistVideos`, so removing
  `fetchPlaylistTitle` did not orphan that import.
- Header regression guard is **not** masked by the deleted route: it mocks `global.fetch`
  to resolve successfully, then asserts no fetch call at all. A reintroduced auto-suggest
  fetch would fail the test before any 404 behavior mattered.
- No rewrite/middleware/config route reference to `/api/playlist-info`.
- `git diff --staged --check` passed.

**Non-blocking note:** old docs (`docs/superpowers/plans/*`, `docs/superpowers/specs/*`,
prior `docs/reviews/task-autosuggest-removal-*`) still mention `/api/playlist-info` as
historical/planned behavior. No code path depends on them; left as historical record.

## Disposition

No High/P1 or Important findings to address. Deletion is safe to ship. Proceeding to commit.
