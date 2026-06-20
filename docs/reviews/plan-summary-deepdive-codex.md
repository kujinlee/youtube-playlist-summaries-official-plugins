# Codex Adversarial Review — Summary + Deep-Dive Quality Pass (Plan)

**Date:** 2026-06-18 · **Tool:** `codex:rescue --fresh` · **Branch:** feat/summary-deepdive-quality
**Target:** `docs/superpowers/plans/2026-06-18-summary-deepdive-quality.md`

---

## Blocking
- **B1 — Task 1: fence tracking uses char only, not opening length.** `padDividers` stores only the fence char, so ```` ``` ```` could be closed by a ```` ` ```` of different length / wrong marker. Mirror `parse.ts:42-84`: store `{char, minLength}`, close only on same char at length ≥ opening.
- **B2 — Task 5: test assertion contradicts the implementation.** Test asserts `not.toMatch(/critical evaluation/i)`, but the new prompt contains "Do NOT add outside opinion or critical evaluation". Assert absence of the OLD positive directive (`/Include .*critical evaluation/i`) and presence of the new negative guard separately.

## High
- **H1 — Task 1: rewrites non-`---` thematic breaks.** Matches `-{3,}` but pushes a literal `---`, converting `-----`/`---   ` to `---`. Fix: preserve the original divider line (push `lines[i]`), only adjusting surrounding blanks; keep `-{3,}` to stay consistent with `parse.ts:78`.
- **H2 — Task 7: `total:4` is inconsistent.** Only three named steps emitted (transcript, generation, PDF); the index write is silent. Either emit a `current:4` "Updating index…" step or set `total:3`.
- **H3 — Task 7: `tests/lib/deep-dive-html-stale.test.ts` not updated.** It mocks `../../lib/gemini` without `generateDeepDiveCombined`; after the routing rewrite imports that symbol the mock is incomplete. Add it and re-verify stale-HTML deletion on the combined happy path.

## Medium
- **M1 — Task 2: quick-view placement assertion too weak.** Only checks the callout string is present, not that it precedes the first `##`. Assert ordering (callout before `## 1.`) and add a test with a section `---` before the frontmatter divider to confirm `indexOf` still selects the metadata divider.
- **M2 — Task 7: more stale routing assertions exist** (`deep-dive.test.ts:157-173, 222`). Audit ALL cases against the six routing rows, not just the three named.
- **M3 — Task 8: CSS negative assertions incomplete.** Current file uses `--h1,--h2,--hr,--strong`; plan names only two. Assert removal of all four + positive assertions for every replacement token.
- **M4 — Task 8: E2E palette may target wrong element.** `#221d18`/`#e8e2d6` are card/ink, not page bg. Check `body`→`--page`, `.dd`→`--card`, a text element→`--ink` with `toHaveCSS`.

## Low
- **L1 — Task 4: version bump before Tasks 5-8 creates a partial-quality window.** Tolerable for solo on-demand, but call it out / or bump last.
- **L2 — Task 6: SDK gate wording conflates unit and smoke.** Label the unit test "request-shape coverage" and the manual run "SDK acceptance gate".
- **L3 — Task 9: manual criteria subjective.** Record concrete evidence: section count, approx word count, logged routing `mode`, and ≥1 transcript-specific detail that couldn't come from the URL alone.
