# PR1 (dig captions) Task 3 — Codex Adversarial Review

**Diff:** 48f6e3e..acb0ac7. Model: frontier (--fresh, Codex online). **Outcome: 6/6 PASS — no findings.**

1. C6 vacuousness: PASS — `#_dg-zoom-cap` exists; C6 toggles off then asserts that node hidden; removing the `dg-hide-caps` check → caption visible → C6 fails. Non-vacuous.
2. HTML injection: PASS — `cap.textContent=txt||''`, no innerHTML.
3. Open/close: PASS — open conditioned on non-empty text AND `!dg-hide-caps`; close() clears textContent + sets display:none (no stale bleed).
4. DOM order / click-to-close: PASS — insertBefore(im,cap) + flex column; any click while open closes.
5. Empty caption: PASS — falsy txt → textContent '' + display none.
6. Render-only: PASS — only render-dig-deeper.ts + captions E2E; no generate.ts, no version bump.

No fixes required. (Claude review Minor — `.dg-zoom-cap` initial display:none for explicitness — tracked for final fix wave.)
