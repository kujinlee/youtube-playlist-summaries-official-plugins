# Codex Adversarial Review — Slide Image-Size Control Plan

**Date:** 2026-06-29
**Model:** gpt-5.5 (fresh session)
**Target:** `docs/superpowers/plans/2026-06-29-dig-slide-size-control.md`
**Outcome:** 2 Blocking, 2 High, 3 Medium, 1 Low — all ACCEPTED. Q1/Q2/Q4/topbar-count confirmed non-issues.

---

## Blocking — ACCEPTED

**PB1 — Sanitizer defaults missing/empty storage to 50%, not 100% (real bug).**
`localStorage.getItem` returns `null` when unset; `Number(null) === 0` and `Number('') === 0`, so the locked sanitizer snaps `0` → clamps to `50`. First-ever load would render at 50%, and E2E S2 (+ from "100") would actually step from 50.
Fix: guard null/'' first, in the single shared sanitizer:
```js
function s(raw){if(raw==null||raw===''){return 100;}var n=Number(raw);if(!Number.isFinite(n)){return 100;}n=Math.round(n/10)*10;return Math.min(150,Math.max(50,n));}
```

**PB2 — S7 print E2E queries `figure.dig-slide-crop` but the fixture passes no cropMap → only an uncropped `<img>` is emitted.**
Fix: in `buildHtml()` build a `Map<absPath, CropBox|null>` with a crop box for the asset and pass it as `cropMap`, so a cropped figure exists. Also assert the uncropped `img.dig-slide` print `max-height`.

## High — ACCEPTED

**PH1 — S3 doesn't prove "no flash."** `page.reload()` resolves after the body script already set the var, so S3 passes even if the head script is missing/late.
Fix: keep the unit assertion (head script before `<style>`), and add E2E instrumentation: `addInitScript` wrapping `CSSStyleDeclaration.prototype.setProperty` to record the first `--dig-slide-scale` set with `document.readyState` and whether `.dg-size-range` exists; assert the first set happens before the control exists (proves the head path ran).

**PH2 — S7 width assertion can pass vacuously** if the column is already < 540px.
Fix: set an explicit wide viewport; assert the figure width is `> 541` at saved 150% before print, then `<= 541` after `emulateMedia({media:'print'})`. (`toBeHidden()` for `.dg-size` is correctly detected.)

## Medium — ACCEPTED

**PM1 — Sanitizer duplicated across two inline scripts (drift trap; caused PB1's double-fix surface).**
Fix: define one TS const `DIG_SLIDE_SANITIZE_JS = "function s(raw){…}"` and interpolate into both `SIZE_HEAD_SCRIPT` and `sizeScript`. Tests stay behavioral, not a third copy.

**PM2 — S5 only tests `999`.** Make it table-driven: `999→150`, `-1→50`, `44→50`, `"120px"→100`, `""→100`, missing→100.

**PM3 — Blocked-storage test (S6) can pass without storage actually blocked.** Set a marker after the override and assert it; assert `localStorage.getItem` throws from page context; verify no uncaught page errors.

## Low — ACCEPTED

**PL1 — Minus glyph (U+2212) not asserted** — a unit test could pass with ASCII `-`. Add `expect(html).toContain('aria-label="Smaller slides">−</button>')` (U+2212).

## Confirmed non-issues
- Q1 exact CSS substrings match Step 3's emitted strings character-for-character.
- Q2 existing `max-height:300px` assertion (post-#41 test ~:846) still passes once the print override is added (it contains the literal).
- Q4 trimmed computed custom-property values match `'0.5'`/`'1.2'`/`'1'`.
- Existing topbar tests don't count buttons → adding the control won't break them.
