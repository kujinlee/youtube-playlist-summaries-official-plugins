# Code Review — Remove Header output-folder auto-suggest

**Reviewer:** Claude (superpowers:requesting-code-review, general-purpose subagent)
**Date:** 2026-06-05
**Files:** `components/Header.tsx`, `app/page.tsx`, `tests/components/Header.test.tsx`

## Change summary
Removed the Header `useEffect` that debounced on the playlist URL, fetched `/api/playlist-info`,
and overwrote the output folder with `<baseOutputFolder>/<slugify(title)>`. That silently
clobbered the settings-configured folder and caused an ingest to write to the vault root instead
of the intended folder. Also removed the now-unused `debounceRef`, `slugify` import, and
`baseOutputFolder` prop (from `HeaderProps`, the destructuring, and the `<Header>` call in
`app/page.tsx`). Output folder now derives only from settings (`defaultOutputFolder`), Browse,
and manual typing. URL auto-fill, Browse, manual edit, Sync, and submit are unchanged.

## Verification
- Full jest suite: **582 passed** (was 584; net −2 = 4 obsolete auto-suggest tests removed, 2 added).
- `tsc --noEmit`: clean.

## Findings
- **Critical:** none.
- **Important:** none.
- **Minor (1) — test scaffolding readability.** Reviewer suggested dropping `jest.useFakeTimers()`
  + the fetch mock from the new describe block as "dead scaffolding."
  **Resolution: pushed back (reviewer's suggestion would weaken the tests).** The fake timers +
  full fetch mock are intentional regression-bait: `runAllTimers()` forces any *reintroduced*
  debounced effect to fire, which would flip the folder to `${BASE}/my-playlist` and call `fetch`,
  failing both tests. Removing the scaffolding would make the tests pass even with the bug
  reintroduced. Addressed the readability concern by adding an explanatory comment instead.
- **Minor (2) — orphaned route (accepted, out of scope).** `/api/playlist-info` now has no
  production callers (only its own test). Left in place intentionally; tracked as a follow-up.

## Assessment
**Ready** — correct, complete, no broken references. `baseOutputFolder` state remains wired to
`VideoList`/`VideoMenu` (Obsidian URI) in `page.tsx`; only the Header prop was dropped.

## Follow-ups (not in this change)
1. Remove orphaned `app/api/playlist-info/route.ts` + `tests/api/playlist-info.test.ts` if no
   future use is planned.
2. (Deferred per user) Rename the `raw/` Obsidian vault so the displayed vault name isn't `raw`.
