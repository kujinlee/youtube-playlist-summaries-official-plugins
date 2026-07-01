# Codex Adversarial Review — Plan: Non-Blocking Expand-All

**Date:** 2026-07-01
**Target:** `docs/superpowers/plans/2026-07-01-dig-expand-all-nonblocking.md` + spec
**Reviewer:** Codex (fresh session)

## Blocking
None.

## High
1. **E7 flakiness — bar auto-closes before assertions.** E2's mocked POST/SSE/re-GET completes
   ~immediately, so the progress bar can dismiss before `boundingBox()`/scroll assertions run.
   **Fix:** E7 owns its stubs and holds a section in-flight via delayed SSE / delayed HTML re-GET
   until geometry + scroll assertions complete. → **Applied:** use `stubExpandAllRoutes({ reGetDelayMs })`.
2. **E7 scroll fixture may not exceed viewport.** `makeExpandAllHtml` renders short prose; wheel-scroll
   assertion can fail even when the bar is correctly non-blocking.
   **Fix:** small viewport + assert `scrollHeight > innerHeight` precondition. → **Applied.**

## Medium
3. **Spec/plan `display` contradiction.** Spec says `#_dg-ea-prog[data-open]{display:flex}`; plan uses
   `display:block`. `._dg-bar` owns flex layout, so container is `block`. → **Applied:** spec corrected to `display:block`.
4. **Failure text overflow.** Inline failure text with no wrap/shrink can push Cancel off-screen.
   **Fix:** `._dg-bar{flex-wrap:wrap}`, `#_dg-ea-prog-msg{min-width:0}`, `button{flex:0 0 auto}`. → **Applied to plan CSS.**
5. **Behavior 11 (click-through) untested.** Add an E2E assertion clicking a content control above the
   bar during an in-flight batch. → **Applied:** folded into E7.

## Low (confirmations / accepted)
6–9. Splitting the CSS selector, `<p>`→`<span>`, `._dg-box`→`._dg-bar`, and the copy change do **not**
   break existing tests (IDs/`[data-open]` only; `of 3` substring preserved). Matches independent verification.
8. `._dg-bar button` restores `._dg-box button` styles; only intentional diff is font-size `.85rem` vs `.88rem`.
10. **Z-index toast overlap.** AI toast (9600) can visually overlap the bottom bar (9000) if triggered
   during a batch. **Decision:** accept toast-over-bar — the toast is transient (~seconds) and correctly
   renders above; no suppression logic added. Noted in spec.
