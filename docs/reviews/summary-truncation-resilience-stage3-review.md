# Stage 3 Dual Review — Re-summarize Menu

**Branch:** `feat/resummarize-menu-stage3` · **Date:** 2026-06-30 · No Blocking/Critical. Wiring confirmed correct end-to-end by both reviewers. Findings addressed.

## Codex — no Blocking/High; 1 MEDIUM + LOWs
- **MEDIUM — force joins active non-force job (mislabel).** Dismissing a running html-doc bar clears `busyVideoId` → Re-summarize becomes enabled → clicking joins the old (non-force) job and mislabels it "Re-summarize" with no re-summarize run. → route now **409s a force POST while any job is live** (force must not silently join); non-force still joins. Client (`handleResummarize`) already no-ops on `!res.ok` → no misleading bar.
- **LOW — optional-default no-op masks future wiring.** → added a `VideoRow` test that clicks through the menu and asserts `onResummarize` fires (covers the VideoRow→VideoMenu thread). Kept optional-with-default (onToggleSelect precedent).
- **LOW — my Re-summarize E2E fixture used stale `{2,0}`.** → `{3,3}` (genuinely current).
- INFO: wiring correct; label casing change harmless (case-insensitive queries); stale-fixture fix legitimate; E2E genuinely proves `force:true`.

## Claude — no Critical; 3 Important
1. **force-joins-active silent no-op** (conf 85) — same as Codex MEDIUM. → 409 fix.
2. **onResummarize optional-default swallows omissions; VideoRow uncovered** (conf 80) → VideoRow prop-thread test added.
3. **Done-link text "View HTML doc" regardless of label** (conf 82) → link text now derives from label ("View result ↗" when custom).

## Verification
tsc clean; 1377 jest + 6 html-doc E2E green.
