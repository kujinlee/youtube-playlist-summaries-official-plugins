# Codex Adversarial Review — Non-Blocking Expand-All (final diff)

**Date:** 2026-07-01
**Branch:** `feat/dig-expand-all-nonblocking` vs `master`
**Reviewer:** Codex (fresh session)

**Result:** Blocking 0, High 1, Medium 1, Low 1.

## High — concurrent generation regression (FIXED)
The old full-screen overlay physically blocked clicks during a batch. With the non-blocking bar,
a user could click `.dg-expand-all` again (starting a second `_eaRunBatch`) or click a single
`.dig-trigger`/`.dig-refresh` (starting a concurrent dig) mid-run — the loop only filters
`data-state="loading"`. Behavior regression the overlay masked silently.

**Fix applied** (`lib/html-doc/nav.ts`): added an `_eaRunning` guard flag — set true at
`_eaRunBatch` start, false when the batch completes/cancels. While running:
- `.dg-expand-all` click → ignored (no second dialog/batch).
- `.dig-trigger` / `.dig-refresh` click → ignored (no concurrent manual dig).
- `.dig-toggle` (zero-fetch reading aid) → still allowed.

**Test:** new E2E **E8** (`dig-deeper.spec.ts`) holds section 1 in-flight (`reGetDelayMs:5000`) and
asserts a 2nd expand-all opens no dialog and a manual `.dig-trigger` click fires no extra POST;
the batch still completes with exactly one POST per section in order.

## Medium — live region wraps interactive control (FIXED)
`role="status"` on the outer `#_dg-ea-prog` wrapped the Cancel button, so the live region included
a control.
**Fix applied** (`render-dig-deeper.ts`): outer element is now `role="region"
aria-label="Expand-all progress"`; `role="status" aria-live="polite"` moved to `#_dg-ea-prog-msg`;
`aria-live="polite"` on `#_dg-ea-fail-msg`. New render-string test asserts the separation.

## Low — AI-toast / bar z-index overlap (ACCEPTED, documented)
AI toast (`z-index:9600`, `bottom:1.4rem`) can visually sit above the bar (`z-index:9000`) if
triggered mid-run. **Decision:** accept — the toast is transient (~2.5s) and correctly renders on
top; no suppression logic added. Documented in the spec's Risks section.

## Confirmed clean by Codex
- Updated render tests cover the old combined selector and `inset:0` CSS; no broken assertions.
- E7 geometry check genuinely fails against the old full-screen overlay (real guard).
- Cancel button styling fully restored via `._dg-bar button` + existing ID selector; no conflict.
- No `@media print` regression.
- No Escape/focus-trap on the old progress overlay (confirm dialog keeps its own trap).
