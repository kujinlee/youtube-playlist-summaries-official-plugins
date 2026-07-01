# Claude Code Review — Non-Blocking Expand-All (final diff)

**Date:** 2026-07-01
**Branch:** `feat/dig-expand-all-nonblocking` vs `master`
**Reviewer:** Claude (pr-review-toolkit code-reviewer)

## Verdict
No high-confidence material issues. Change is correct, well-scoped, matches the approved design.

## Verified
- **CSS specificity** — `._dg-bar button` fully replaces `._dg-box button` base styles for
  `#_dg-ea-cancel-prog`; the ID rule `#_dg-ea-cancel-dlg,#_dg-ea-cancel-prog{background:none;color:var(--meta)}`
  is container-independent and still applies. `._dg-box` now used only by the confirm dialog. Only
  intentional diff: cancel font-size `.85rem` (was `.88rem`) + `flex:0 0 auto`.
- **Dark mode** — bar uses `--card`/`--ink`/`--rule`, defined for both light and dark palettes
  (`theme.ts:9-29`, emitted for `[data-theme="dark"]` and `prefers-color-scheme:dark`).
- **Existing E1–E6** — preserved selectors `#_dg-ea-prog[data-open]`, `#_dg-ea-prog-msg`;
  `toBeVisible()` holds (`display:block` with content); `toContainText('of 3')` (spec.ts:1516) still
  matches new copy. No test hard-codes the old copy. 162 unit tests pass; full suite 1428 pass.
- **Accessibility** — `role="status"` preserved on `#_dg-ea-prog`; appropriate for a live progress region.
- **E7 coverage** — genuinely exercises non-blocking behavior: bottom-pinned + short bounding box (a),
  page scroll via wheel + `expect.poll(scrollY)` (c), content-not-intercepted via top-bar hover (d).
  `reGetDelayMs:1500` + small viewport are sound.

## Minor (below threshold, not actioned)
- E7 (d) uses `.hover()` not `.click()`-with-effect. Hover proves the pointer reaches the element
  (the load-bearing assertion), so acceptable — slightly weaker than click-and-assert. (~30 confidence)
