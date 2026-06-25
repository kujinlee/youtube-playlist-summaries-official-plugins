# Adversarial Spec Review — Dig-Deeper Slide Selectivity

**Date:** 2026-06-25
**Spec:** `docs/superpowers/specs/2026-06-25-dig-slide-selectivity-design.md`
**Reviewer:** Claude adversarial subagent (substituting for Codex — at usage limit, per `docs/plugins.md` Codex-fallback rule). Re-attempt the Codex-specific pass before merge if access returns.
**Verdict:** No Blocking. Safe to proceed to implementation-planning. Two HIGH findings absorbed into the spec as explicit tasks.

## Confirmed-correct (verified against code)
- Part 1 needs no pipeline change: `slides.ts:54-57` short-circuits on zero tokens; `slide-tokens.ts` caps ≤3 and is purely reactive. Nothing requires ≥1 slide.
- Dead `digVersion` literal: written `companion-doc.ts:69`, never parsed (`parseFrontmatter` switch `:220-235` ignores it).
- Re-POST replaces the section (`doUpsert` `:409-414`); re-GET swap keys off `data-start` (`nav.ts:237-239`).
- `?dig` already-dug guard (`nav.ts:363-366`) gates only the URL auto-trigger, not explicit clicks → deliberate refresh is unaffected.
- No Gemini fires on page load for dug sections; only `?dig=N` auto-trigger (un-dug target) or explicit button click POSTs (`nav.ts:376`, `:367-369`).
- Code-as-text renders fine (markdown-it, `render-dig-deeper.ts`).

## Findings & resolutions

| ID | Sev | Issue | Resolution in spec |
|----|-----|-------|--------------------|
| H1 | HIGH | expand-all selects `.dig-trigger` only; stale dug sections have none → "refresh outdated" would select nothing; cost-estimate also `.dig-trigger`-based | §4.5: refresh-all is a **separate task**; selector → `.dig-trigger, .dig-refresh`; cost counts stale sections; ship per-section `↻` first. O-2 reworded (not "free reuse"). |
| H2 | HIGH | `MergedSection.dug` is `{ bodyMarkdown }` only; merge strips all other fields at `:100` and `:148` → `genVersion` not available downstream | §4.3: add `isStale` to `MergedSection`; compute at **both** sites; `mergeDigDoc` imports `DIG_GENERATOR_VERSION`. §5 updated. |
| M1 | MED | toggle/trigger/refresh click-delegation ambiguity | §4.4: mandate distinct `.dig-refresh` class; add a dedicated branch to `nav.ts` delegation. |
| M2 | MED | badge must clear via re-GET swap (depends on upsert-before-done) | §4.4: documented; E2E asserts badge gone **after swap**. |
| M3/L1 | MED/LOW | per-section `genVersion` parse touches multiple hard-coded-4-field sites | §4.2: enumerated — type (3 spots), serialize, regex, 2 commit blocks, parseDugSections return; missing → `0`; fixed position after `generatedAt`. |
| L2 | LOW | 3 tests embed dead `digVersion` literal | §4.2 + §7: update fixtures in same task; add legacy-parse test. |
| L3 | LOW | backward-compat | Confirmed safe; edge case #1 accurate. |

## Bottom line
Architecture sound; every reuse claim technically achievable against the real code. Proceed to planning. Plan must treat H1 (refresh-all) and H2 (`MergedSection` widening at two sites) as explicit, separately-tested tasks, and enumerate the multi-site parser changes (M3/L1) + fixture updates (L2). Distinct `.dig-refresh` class mandated (M1).
