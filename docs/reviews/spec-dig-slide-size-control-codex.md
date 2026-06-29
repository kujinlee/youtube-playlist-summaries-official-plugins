# Codex Adversarial Review — Slide Image-Size Control Spec

**Date:** 2026-06-29
**Model:** gpt-5.5 (fresh session)
**Target:** `docs/superpowers/specs/2026-06-29-dig-slide-size-control-design.md`
**Outcome:** Completed. 1 Blocking (rejected — false positive, with evidence), 2 High, 4 Medium, 2 Low — all others addressed.

---

## Blocking — REJECTED (false positive)

**"Static delivery claim is false; existing rendered HTML won't gain the change."**
Codex assumed dig-deeper docs are stored HTML files. **They are not.** The dig-deeper route branch (`app/api/html/[id]/route.ts:195`) is **live-rendered per GET**: `serveHtml(renderDigDeeperDoc({ summary, envelope, dug, mdPath, … }))`, reading the companion `.md` fresh each request. (Contrast the very next branch — deep-dive — which serves a *stored* `video.deepDiveHtml` file.) So there is no already-rendered artifact to go stale; every page load re-runs the renderer. The "applies on next load, no re-dig, no version bump" claim is correct — and is precisely why PR #38 (image sizing) and #41 (auto-crop) shipped render-only.
**Action:** keep the claim; sharpen the spec wording to state the live-render mechanism explicitly so the point isn't mistaken again.

## High — ACCEPTED

**H1 — FOUC: saved size flashes at 100% before the persisted value applies.** The `var(--dig-slide-scale,1)` fallback only guarantees the *default*, not the user's saved 50%/150%. A body-end script paints 100% first, then jumps.
Fix: add a tiny **head script** (next to `THEME_HEAD_SCRIPT`) that reads+sanitizes `digSlideScale` and sets `--dig-slide-scale` on `documentElement` before first paint. The body script only syncs the control and handles events.

**H2 — Print inherits the reader's scale; control not hidden in print.** Scaled rules apply globally; a saved 150% inflates printed slides.
Fix: `@media print{.dg-size{display:none!important}.dg img.dig-slide{max-height:300px}.dg figure.dig-slide-crop{width:min(100%,540px)}}`; add a print assertion.

## Medium — ACCEPTED

**M1 — Reset affordance is a non-focusable `<span>`.** Make it `<button class="dg-size-val" type="button" aria-label="Reset slide image size to 100%">`; test Tab+Enter/Space.
**M2 — "Works regardless of script order" underspecified.** Specify: pre-paint var is set by the head script; the body `sizeScript` is placed after `${bodyHtml}` and guards on control presence (or uses document-level delegation). Drop the vague claim.
**M3 — Mobile topbar overflow.** `.dg-topbar{flex-wrap:wrap}` + compact `.dg-size` (bounded range width, fixed-size buttons, non-clipping readout).
**M4 — Storage sanitization imprecise.** Define one sanitizer used by all paths: `n=Number(raw); if(!Number.isFinite(n))return 100; n=Math.round(n/10)*10; return Math.min(150,Math.max(50,n));`

## Low — ACCEPTED

**L1 — No test for blocked localStorage.** Add a test stubbing get/set to throw → control inits at 100, still operable, no throw.
**L2 — Clamp only tested high side.** Add stored `-1`→50, `44`→50, malformed→100, missing→100.
