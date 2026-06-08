# Adversarial Review (Codex) — Remove Header output-folder auto-suggest

**Reviewer:** Codex `gpt-5.5` (`codex:rescue`, fresh session)
**Date:** 2026-06-07
**Status:** ✅ Completed (after fixing Codex model config — see `docs/plugins.md`).

> First attempt failed: codex CLI defaulted to the removed `gpt-5.3-codex` model (HTTP 400 on the
> ChatGPT-account auth path). Fixed by setting `model = "gpt-5.5"` in `~/.codex/config.toml` and
> recording the requirement in `docs/plugins.md`.

## Verdict
Original: **NOT SAFE TO COMMIT** — gated on one Medium finding (a pre-existing silent-overwrite
race). **Resolved:** the Medium was fixed (see below) and both Lows addressed/tracked → cleared to commit.

## Findings

### Blocking / High
None. The removal itself is clean — confirmed no surviving `baseOutputFolder` / `debounceRef` /
`slugify` references in Header; `page.tsx` no longer passes `baseOutputFolder` to `<Header>` but
keeps the state wired to `VideoList`; URL auto-fill guard, Browse reset, Sync, submit all intact;
the new regression tests would catch a reintroduced debounced fetch; no new hydration/cleanup issue.

### Medium (1) — settings-sync can overwrite a manually-typed folder
`components/Header.tsx:44-46`. The `setOutputFolder(defaultOutputFolder)` effect fires
unconditionally when `defaultOutputFolder` changes. Since `page.tsx:24` starts `outputFolder=''`
and `/api/settings` resolves asynchronously (`page.tsx:80-95`), a folder typed before settings load
is overwritten when settings land. Same class of silent-overwrite as the bug just removed.
**Recommendation:** guard the sync so a late `defaultOutputFolder` only applies while the folder
field is pristine (mirror the `urlEditedByUser` pattern with a `folderEditedByUser` ref).
**Status:** ✅ FIXED (user approved). Added `folderEditedByUser` ref set on manual edit and Browse;
sync effect now skips when it is true. Covered by two new tests in
`tests/components/Header.test.tsx` ("settings sync vs. manual folder edit"): pristine load still
applies settings; a typed folder survives a late settings resolve. Full suite 584 passing.

### Low (2)
1. `components/Header.tsx:28` — stale comment: says `urlEditedByUser` "resets … on folder change,"
   but the code deliberately does NOT reset on manual folder edit. Fix the comment to prevent a
   future regression that follows stale docs. **Status:** will fix (comment-only).
2. `app/api/playlist-info/route.ts` — orphaned route (no production caller after this change).
   **Status:** tracked follow-up (out of scope for this task).

## Cross-check vs. Claude review
Both agree the removal is clean and complete. Codex additionally surfaced the pre-existing
settings-sync race (Medium) that Claude did not flag.
