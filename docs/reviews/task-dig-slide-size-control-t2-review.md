# Task 2 (dig slide size control E2E) — Claude Code Review

**Diff:** 8ade914..0917f4c (single new file `tests/e2e/dig-slide-size.spec.ts`, 137 lines, 0 deletions; renderer untouched).
**Verdict:** Task quality **Approved**.

## Spec Compliance — ✅
All 13 scenarios present (S1–S7 + S5 6 parametric rows + missing-storage + whitespace `[' ','1']`). cropMap key `path.join(dir,'assets/v/0-0.jpg')` matches renderer's `path.resolve(dirname(mdPath), src)` exactly → real `figure.dig-slide-crop` emitted. `stub`/`scale` type annotations are types-only, no logic change. render-dig-deeper.ts not modified.

## Strengths (non-vacuous verified)
- S3 patches `CSSStyleDeclaration.prototype.setProperty` pre-nav; `__firstScaleSet.hasControl===false` proves the HEAD script ran before the body control parsed (would fail if call moved to body).
- S7 `before>541` is real: at 150% width=min(100%,calc(540*1.5))=min(100%,810px) on 1200px viewport → ~810px; precondition non-vacuous; print override asserts ≤541.
- S5 covers null→100, trim()===''→100 (Codex-H2 fix), clamp, non-numeric, snap-to-10.
- S6 self-proving: verifies override actually throws before asserting default.
- Harness mirrors dig-deeper.spec.ts (page.route fulfill, addInitScript before goto).

## Issues
### Important (informational — reviewer self-downgraded; NO code fix)
- S4 keyboard reset (`:100`): Enter on `<button type="button">` synthesizes click → fires the `click` listener. Tests legitimate button semantics, not a separate keydown handler. Not vacuous in Chromium; practical risk low. Optional: comment clarifying mechanism.
### Minor (→ final triage)
- 13× `mkdtempSync` temp dirs never cleaned (`:29,49`) — accumulates on CI; low priority.
- S2 `'1.1'` string-equality depends on IEEE-754 repr — exact for /100 of multiples-of-10, safe unless step changes.
- `' '` test-name space invisible in reporters — cosmetic.

## Codex
Codex adversarial review dispatched in parallel (--fresh); recorded in `task-dig-slide-size-control-t2-codex.md`.
