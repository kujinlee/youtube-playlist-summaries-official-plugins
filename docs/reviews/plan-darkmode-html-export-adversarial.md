# Adversarial Plan Review — Dark-Mode HTML Export

**Date:** 2026-06-16
**Plan:** `docs/superpowers/plans/2026-06-16-darkmode-html-export.md`
**Spec:** `docs/superpowers/specs/2026-06-16-darkmode-html-export-design.md`
**Reviewer:** Claude fresh subagent (general-purpose, no authorship context)

> **⚠️ Codex gap:** The dev-process mandates a Codex (`codex:rescue`) adversarial review at the
> plan gate. Codex was **unavailable** — OpenAI usage limit, resets **2026-07-03 23:22**. Per
> `docs/plugins.md` "Code Review" fallback, this Claude-only adversarial review substitutes, and
> the gap is flagged for a **manual Codex adversarial pass before merge** once the limit resets.

---

## Verdict by focus axis

1. **FOUC ordering** — head script before `<style>` is correct; no ordering defect. Residual: transition-fade on dark load (H1).
2. **Specificity / explicit-light-wins** — functionally correct, but by selector *non-match* (`:not([data-theme])`), not cascade weight; fragile and **untested** (M1/MT1).
3. **localStorage on file://** — try/catch sound, no uncaught path (L2). Clean.
4. **E2E correctness** — RGB mapping correct (L3); RED state ill-defined (M3); `@/` runtime import unverified, likely broken (B1); deep-dive untested (M6).
5. **Var collisions** — clean; all three shared vars (`--card`,`--ink`,`--shadow`) present in all four palettes (L1).
6. **No-regression assertions** — insufficient; only a subset of vars checked (H4).

---

## BLOCKING

### B1 — E2E spec uses a runtime `@/` import never proven to resolve under Playwright
The new `tests/e2e/darkmode-html.spec.ts` imports `renderMagazineHtml` from `@/lib/html-doc/render` as a **runtime value**. The only existing E2E `@/` import (`tests/e2e/html-doc.spec.ts:2`) is `import type` — erased at compile time, so it never exercises runtime alias resolution. If Playwright's loader doesn't resolve `@/*`, the whole file throws at import.
**Fix:** Use a relative import (`../../lib/html-doc/render`, `../../lib/html-doc/types`), matching the Jest specs' convention. Guaranteed to resolve.

---

## HIGH

### H1 — Transition-fade contradicts the "FOUC-free" claim on dark load
`themeStyleBlock` emits `body{transition:background .2s,color .2s}` and `.v4`/`.dd` also transition. When the head script applies `data-theme="dark"`, a visible light→dark fade can fire on load for dark users — contradicting spec line 44 ("FOUC-free").
**Fix:** Suppress transitions until after first paint — add `.no-transitions *{transition:none!important}` toggled off on `requestAnimationFrame`, OR drop the `body`/card transition (the toggle still works instantly). Add a behavior row either way.

### H3 — Print does not force a light card (spec violation)
Print rule is only `@media print{body{background:#fff}...}`. In dark override, `.v4`/`.dd` keep `var(--card)` (dark) and `--ink` (pale) → dark card + pale text on white paper. Spec §7/§8 and Phase-4 check (plan line 653) promise a **light card** when printing.
**Fix:** `themeStyleBlock` must emit a print block that re-applies the **light** palette regardless of `data-theme`, e.g. `@media print{:root,[data-theme="dark"],[data-theme="light"]{<light vars>}}` plus the existing `box-shadow:none`. Add an assertion.

### H4 — No-regression assertions are non-exhaustive
Magazine asserts 5/11 vars; deep-dive asserts 4/13. A typo in an unchecked var (`--meta`,`--rule`,`--ghost`,`--li`,`--foot`,`--shadow`; deep-dive `--h1`,`--h3`,`--h4`,`--link`,`--hr`,`--strong`,`--preborder`,`--quote`) changes light mode undetected. Spec line 199 requires *every* light value verified.
**Fix:** Assert every `--key:value` pair for all palette keys in both renderers.

---

## MEDIUM

### M1 / MT1 — Missing test: OS dark + explicit light override (highest-value gap)
Explicit light wins only because `:root:not([data-theme])` stops matching once `data-theme="light"` is set — correctness hinges entirely on the `:not()`. No test guards this. A future edit dropping `:not` would silently let system-dark override explicit-light.
**Fix:** Add behavior #29 + E2E: `emulateMedia({colorScheme:'dark'})`, toggle to light, assert `LIGHT_BG` and `data-theme="light"`.

### M3 — Task 4 RED state is ill-defined
Step 2 says "FAIL only if Tasks 2–3 not done; if run after Task 3 it should PASS" — contradictory as a TDD gate. Since Tasks 1–3 commit first, Task 4 is GREEN on first run (a confirmation layer, acceptable per the project's "E2E = No for strict TDD" policy).
**Fix:** State plainly that Task 4 is a confirmation/E2E layer, expected GREEN after Task 3; to see a meaningful RED, run it after Task 1, before Task 2.

### M4 — E2E fixture shape unverified against `types.ts`
The hand-written `ParsedSummary`/`MagazineModel` fixture isn't cross-checked against the real type.
**Fix:** Reuse the exact fixture object from `tests/lib/html-doc/render.test.ts` (copy verbatim) to guarantee type-correctness.

### M6 — Deep-dive has no E2E coverage
Task 4 only serves `renderMagazineHtml`. Deep-dive uses a different palette/card class and the print-light-card (H3) is deep-dive-specific.
**Fix:** Add one deep-dive E2E case (system dark → `rgb(15, 17, 21)`), or explicitly note deep-dive runtime is Phase-4 manual only.

---

## LOW (verified clean — no action)

- **L1 — Var collisions:** all four palettes define `card`/`ink`/`shadow`; every structural `var(--…)` is defined in both palettes. Clean.
- **L2 — localStorage try/catch:** no uncaught throw path, including property-access-throws privacy modes. Clean.
- **L3 — RGB mapping:** `#eef0f3`→`rgb(238, 240, 243)`, `#1a1714`→`rgb(26, 23, 20)` correct; Playwright returns space-after-comma form. Clean.

---

## Must-fix before implementation
B1, H3, H4, M1/MT1. **Resolve or explicitly defer with justification:** H1, M6. M3/M4 are cheap clarity fixes.
