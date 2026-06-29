# PR1 (dig captions) Task 1 — Claude Code Review

**Diff:** 366228b..eeb9bf6 (`render-dig-deeper.ts` + new captions unit test + 4 existing test files for the crop→div rename).
**Verdict:** Task quality **Approved**.

## Spec Compliance — ✅
figure.dig-slide-fig + optional figcaption.dig-cap with `esc(altAttr)`; empty caption → no figcaption; missing-asset (`span.missing-slide`) + external (plain img) unchanged; crop wrapper figure→div nested in semantic figure; margins moved to `.dig-slide-fig`, children `margin:0 auto`; border-radius inherited from STRUCTURAL_CSS (crop child sets 0); render-only (generate.ts untouched, no version bump). All 4 existing test files updated per Step 6; leave-unchanged assertions (crop.test.ts:27/49/58/65-67, crop.spec.ts:141) correctly untouched.

## Strengths
- Test-assertion deviation correctly diagnosed + fixed: brief's `not.toContain('dig-cap')`/`'dig-slide-fig'` were vacuous (those strings are in CSS class defs) → tightened to `not.toContain('<figcaption')` / `'<figure class="dig-slide-fig"'`; verified non-vacuous (catches stray figcaption / figure wrap).
- `esc(altAttr)` consistent; no raw-caption path (escaping test confirms `<b>&"` → escaped).
- Split print-block assertions more resilient than the old exact-string match (anticipates Task 2's caps-toggle).
- Containment guard line untouched.

## Issues
### Important
1. `render-dig-deeper.size.test.ts` split print assertions are `toContain` on the whole HTML, not scoped to the `@media print` block → a regression moving `.dg .dig-slide-crop{width:min(100%,540px)}` OUT of print would still pass. **Brief explicitly chose this tradeoff** (Task-2 resilience). → FINAL TRIAGE; not blocking.
### Minor
1. SECURITY-CRITICAL containment-guard comment was trimmed (the `if(!absPath.startsWith(assetsRoot+path.sep)) return ''` guard CODE is intact; only the WHY-comment lost). → restore the security rationale comment (cheap, preserves intent).
2. Narrow coverage: `cropMap=undefined` default path producing a caption only implicitly exercised. → defer.

## Codex
Codex adversarial review dispatched in parallel; recorded in `task-dig-captions-t1-codex.md` (Codex may be at usage limit → Claude fallback).
