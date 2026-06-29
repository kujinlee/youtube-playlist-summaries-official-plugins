# PR2 (dig sub-headings) Task 2 — Codex Adversarial Review

**Diff:** ab4747e..86caa84. Model: frontier (--fresh, Codex online). **Outcome: APPROVE — 0 Blocking/High/Medium.**

1. Specificity — `.dg .dug h3` (0,2,1) beats `.dg h3` (0,1,1), placed after in source; targets only h3 inside `.dug`, leaving orphan title untouched.
2. Orphan-body visibility — `.dug` hide rules scoped to `section[data-dug="true"]`; orphan section is `section.dg-orphans` (no data-dug) → new wrapper never hidden.
3. PR1 interaction — captions are `figcaption.dig-cap`; new CSS targets `h3` only. No collision.
4. Test quality — both non-vacuous (fail if wrap or rule removed). Optional note: a DOM-parser structural assertion would be marginally stronger than regex, but current regexes are meaningful. → defer.
5. Scope — only render-dig-deeper.ts + its test; no generate.ts, no version bump.

No fixes required.
