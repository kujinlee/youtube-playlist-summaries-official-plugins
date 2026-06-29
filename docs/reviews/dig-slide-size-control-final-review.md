# Dig Slide Size Control — Final Whole-Branch Review (opus)

**Scope:** b73579c..ead695a (feature code: `lib/html-doc/render-dig-deeper.ts`, `tests/lib/html-doc/render-dig-deeper.size.test.ts`, `tests/e2e/dig-slide-size.spec.ts`).
**Verdict:** **READY TO MERGE.** No Critical/Important. Tests: jest 1489/1489, playwright dig-slide-size 14/14, tsc clean.

## Seam verification — all PASS
1. **Sanitizer single-source** — `DIG_SLIDE_SANITIZE_JS` defined once, interpolated into head + body scripts, no divergent copy. Guard order: `null→100` FIRST, then `string&&trim===''→100`, then `Number`/`!isFinite→100`, snap-to-10, clamp[50,150]. `Number(null)`/`Number(' ')` intercepted before `Number()` — neither defaults to 50.
2. **Pre-paint / FOUC** — `SIZE_HEAD_SCRIPT` emitted before `<style>`, sets var synchronously during head parse; `var(--dig-slide-scale,1)` fallback = 100% with no JS.
3. **Print correctness** — grep confirms `.dg img.dig-slide` + `.dg figure.dig-slide-crop` are the ONLY var consumers; both have element-level print overrides; print rule later in stylesheet → wins. No third unguarded consumer → no print bleed. `:root` var-reset removal correct (inline style on documentElement outranks @media :root).
4. **localStorage fail-safe** — all access try/catch (head + body); blocked → 100, no uncaught error (S6 proves real block).
5. **Control wiring** — range 50/150/10/100; dec/inc route ±10 through `apply`→`s` clamp; reset is real `<button>` (click + Enter); readout via textContent. Locked selectors match.
6. **No injection** — only sanitized numerics to setProperty/value/textContent/localStorage; no innerHTML/eval.

## Issues
Critical: none. Important: none. Minor: S7 `before>541` precondition is viewport-dependent (1200px) but non-vacuous at that viewport; otherwise no tautological/flaky assertions.

## Minor triage — all DEFER
- T1#2 `s(s(x))` double-apply + redundant `Number()` — `s` idempotent → no-op. Non-bug.
- T1#4 ASCII `+` vs U+2212 `−` — cosmetic.
- T2 13× `mkdtempSync` not cleaned — CI hygiene; follow-up afterEach, not merge-blocking.
- T2 S4 Enter-via-click-synthesis — native button behavior; validates user path. Informational.
- 8ade914 commit-msg inaccuracy (claims var resets in print) — corrected by ead695a msg + review docs; history immutable.

## Note
Codex adversarial reviews ran cleanly (no fallback) on both tasks. Both tasks dual-reviewed (Claude + Codex). The Task-1 Codex-H1 (`:root` print var-reset) was applied then REVERSED in Task 2 after E2E empirically proved CSS-specificity defeat — documented in t1-codex.md / t2-codex.md.
