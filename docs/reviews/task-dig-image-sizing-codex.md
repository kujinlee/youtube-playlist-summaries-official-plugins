# Adversarial Review — Feature 1: Dig Slide Image Sizing + Zoom Lightbox

**Reviewer:** Claude adversarial subagent (fresh, full file access; read render-dig-deeper.ts, nav.ts, both test files).
**Date:** 2026-06-28
**Codex gap:** Codex CLI at usage limit; this Claude adversarial review substitutes (AFK). Re-run Codex pass before merge if access returns.

**Verdict: No Blocking. 2 Medium + 3 Low.** Handler isolation is clean; feature ship-able.

## Verified clean
- **Two separate click listeners:** NAV_SCRIPT binds `.dg` (article); zoom binds `document`. Zoom handler never `preventDefault`/`stopPropagation`; NAV only `preventDefault`s on `.dig-*` `<a>` in the `<h2>`. A slide `<img>` lives in `.dug` (sibling of heading), never a descendant of an interactive `.dig-*` element → no double-fire/swallow.
- **Esc gating:** zoom Esc gated on its own `ov` `data-open`; expand-all Esc (nav.ts:304) touches a different element. No double-close, order-independent.
- **Closed overlay is `display:none`** → cannot intercept page clicks.
- **Security:** `im.src` = trusted server-built base64 data URI; `im.alt` = `esc()`'d at render; DOM property assignment, no injection. No path gives a non-asset img `.dig-slide`.

## Findings + disposition
- **M1 — img lifecycle on re-open:** reviewer self-downgraded (no flash/broken-icon while visible; depends on the `display:none`-when-closed invariant). No code change; invariant holds.
- **M2 — external (non-asset) dug imgs don't zoom / aren't size-capped (undocumented scope).** → **Fixed:** added a comment at the non-asset branch noting external images intentionally keep default sizing and are not zoomable.
- **L1 — non-`.dig-slide` dug imgs get base `.dg img` margin instead of old `2em`.** Acceptable minor visual change; no action.
- **L2 — `@media print` didn't hide `.dg-zoom` (full-screen black overlay would print if printing mid-zoom).** → **Fixed:** `@media print{… .dg-zoom{display:none!important}}` + jest assertion.
- **L3 — `cursor:zoom-out` over the image was misleading (image-click was a no-op); + untested image-click/second-open paths.** → **Fixed:** simplified the click handler so **any click while the overlay is open closes it** (backdrop, image, or ✕) — now matches the `zoom-out` affordance. Added E2E **Z4** (clicking the enlarged image closes).

## Test quality
Z0–Z4 (now incl. image-click) each open-then-assert real dismissal; unit tests assert the success-branch `class="dig-slide"` and the missing-branch absence of `<img class="dig-slide"` (avoiding the always-present-`dig-slide`-in-CSS false-pass trap).

Post-fix: **1430 jest + 5 E2E (Z0–Z4) green, tsc clean.**
