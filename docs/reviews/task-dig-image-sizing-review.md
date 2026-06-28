# Code Review — Feature 1: Dig Slide Image Sizing + Zoom Lightbox

**Reviewer:** Claude code-review subagent (fresh, full file access)
**Date:** 2026-06-28
**Branch:** `feat/dig-image-sizing` · commit `9bcdf22`

**Verdict: Ship it.** Faithful to plan + spec; tests meaningful; no Critical or Important issues.

## Verified
- **CSS specificity** `.dg img.dig-slide` (0,0,2,1) beats `.dg img` (0,0,1,1) → `max-height:360px` + `margin:2em auto` apply; inherited `height:auto`/`max-width:100%` preserve aspect.
- **Only the success branch** gets `.dig-slide`; missing-slide span, containment-fail `''`, non-asset `<img>` untouched (spec M1). Zoom target `classList.contains('dig-slide')` never widens.
- **Esc coexistence** (spec H1): nav.ts:304 Esc is registered only while the expand-all dialog is open and self-removes; zoom Esc early-returns unless `data-open`, no `stopPropagation` → additive-safe.
- **Stacking** (H2): `.dg-zoom` 9500, close 9501, above 9000 EA overlays.
- **Lightbox JS**: document delegation (covers dynamic digs); backdrop `t===ov` (clicks on centered `<img>` are `t===im` → don't close); `✕` by id; `close()` clears `data-open` + `src`; `getAttribute('alt')` returns already-unescaped value (no double-escape). ES5-plain.
- **No regressions**: render-only, no version bump, no capture/asset code touched; serve path renders fresh.

## Test quality — non-vacuous
jest asserts the full `<img class="dig-slide" src="data:image/jpeg;base64,` form + missing-branch span/no-class; Playwright Z0–Z3 exercise real interactive dismissal (the only place the inline script runs).

## Minor (non-blocking)
1. Missing-asset test comment slightly over-explains; the assertion `not.toContain('<img class="dig-slide"')` is correct/robust (tightened from the plan's weaker `not.toContain('dig-slide')`, which would have been a false-positive trap).
2. Documented plan-drift: lightbox `<img>` built in JS (`createElement`) instead of the plan's static `<img id="_dg-zoom-img">`, to keep the shell free of static `<img>` for the whole-doc image-rule tests. Sound, inline-commented; plan doc not retro-updated.
3. A11y (focus-trap / `aria-hidden` background) deferred — already out-of-scope (LOW-3).
4. `object-fit:contain` + 95vw/95vh caps is correct for "full-res, fit to screen."

Nothing requires changes before merge.
