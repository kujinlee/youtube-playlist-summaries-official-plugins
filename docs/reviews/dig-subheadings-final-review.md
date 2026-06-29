# PR2 (dig section sub-headings) — Final Whole-Branch Review (opus)

**Scope:** 2dcc9ef..86caa84 (2 task commits). **Verdict: READY TO MERGE.** 0 issues at any severity; all carried minors DEFER. Tests: generate 34/34, render-dig-deeper 136, full 1511/1511, tsc clean.

## Seam verification — all PASS
1. Generation→render — prompt requests `###` (generate.ts:75); stock markdown-it (only image rule overridden, no heading offset) → `###`→`<h3>`; matched body `<div class="dug">` (render:305); `.dg .dug h3` (0,2,1) beats `.dg h3` (0,1,1). No collision with `<h2>` title or `figcaption.dig-cap`.
2. Version bump — VERSION=9; staleness symbolic `matched.genVersion < DIG_GENERATOR_VERSION` (dig-merge:104,154); new digs stamped symbolically (route:166); NO literal 8/9 comparison in lib/app; serve-route GENERATOR_VERSION is the unrelated HTML-render version. Lazy `↻ outdated` only — no bulk job/forced re-dig.
3. Korean-safety — "same language…(do NOT switch to English)"; lang=ko mandates Korean. No forced-English.
4. `###`-only — forbids `#`/`##`; "no headings for the section title" means don't repeat title (reinforced by "do not restate the section title") — no contradiction.
5. Orphan wrap — body in `<div class="dug">` (render:318), title h3 outside (317, keeps `.dg h3`); `section.dg-orphans` has no data-dug → hide rules never fire → visible. Single wrap.
6. Render-only/scope — generation in generate.ts, render in render-dig-deeper.ts; no new dep; companion-doc/DugSection untouched.

## Issues
None at any severity.

## Minor triage (all DEFER)
- T1 `###`-only regex 3 OR-branches — composite adequate; slack only matters under hypothetical future edit.
- T1 standalone `/###/` trivial — anchored by siblings.
- T2 first render test uses MATCHED (not orphan) `.dug` — valid matched-path coverage; comment cosmetic.
- T2 DOM-parser vs containment regex — regex adequately proves containment.

## Assessment
Tight 4-line code change (version + 1 prompt line + 1 CSS rule + orphan wrap); all seams verified end-to-end; no version literal leaks. No must-fix; carried minors safe to defer. Codex online all run (no fallback).
