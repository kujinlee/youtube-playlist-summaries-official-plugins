# Adversarial Plan Review — Dig-Deeper Slide Selectivity

**Date:** 2026-06-25
**Plan:** `docs/superpowers/plans/2026-06-25-dig-slide-selectivity.md`
**Reviewer:** Claude adversarial subagent on Opus (substituting for Codex — at usage limit all session, per `docs/plugins.md` Codex-fallback). Re-attempt the Codex pass before merge if access returns.
**Original verdict:** NEEDS REVISION — 2 Blocking + 2 High + 3 Medium, all verified against real code. Architecture sound; every spec section maps to a task; no requirements dropped.

## Findings & resolutions (all addressed in the revised plan)

| ID | Sev | Issue | Resolution |
|----|-----|-------|-----------|
| B1 | Blocking | Task 3 named `tests/api/dig-route.test.ts` (does not exist; real file is `tests/api/dig-post.test.ts`), which **mocks** `lib/dig/companion-doc` + fs — so the planned on-disk `parseDugSections` assertion cannot run. | Task 3 retargeted to `dig-post.test.ts`; assertion changed to the mocked spy: `expect(mockUpsertDugSection).toHaveBeenCalledWith(expect.objectContaining({ section: expect.objectContaining({ genVersion: DIG_GENERATOR_VERSION }) }))` (mirrors existing happy-path assertion ~`:284-300`). |
| B2 | Blocking | Making `DugSection.genVersion` required breaks shared builders (`makeDug` dig-merge.test:59, `makeDugWithBody` render-dig-deeper.test:46, e2e dug fixtures, inline `dugA`/`dugB`) → Task 2's own `tsc` gate fails. Plan's `dug({…genVersion})` helper is invented; real is `makeDug(sectionId, title, startSec?)`. | Task 2 gains an explicit step: add an optional `genVersion` param (default `DIG_GENERATOR_VERSION`) to those builders + fix inline literals, so existing calls stay valid (fresh) and stale tests pass an older value. Tasks 4/5 use the real builder signatures. |
| H1 | High | Task 6 "badge gone after swap" E2E can't pass: the swap is `fetch(location.href)` → `/api/html/…` (nav.ts ~`:232`), not the POST/SSE; the harness `stubHtmlRoutes` returns fixed stale HTML, so `.dig-refresh` persists. | Task 6 test step now re-routes `**/api/html/<videoId>**` to fresh (non-stale) companion HTML before the click (Playwright LIFO route precedence), so the re-GET returns `genVersion=current` HTML with no `.dig-refresh`. |
| H2 | High | Stale anchor: plan said parse-regex insertion "~`:188`", but `:188` is the `startSec` regex; the `generatedAt` block is `:200-204`. | Anchor corrected to "after the `generatedAt` block (`:200-204`)"; interface insertion noted at `:36`. (Order-independent since parse is regex-keyed, but the stated anchor was misleading.) |
| M1 | Med | Task 5 control-block anchor `:200-208` → real `:201-206`; CSS `:133-134` correct. | Anchor corrected; quoted `control` line + in-scope vars (`ms`/`isDug`/`startSec`) verified. |
| M2 | Med | Only ONE `MergedSection` object literal exists (`:105`); the "second site" (`:148`) is a mutation (`ms.dug=…`), not a literal. Plan prose "both construction sites" overstated (code sketch was already correct). | Task 4 prose clarified: literal at `:105` sets `isStale: isStale_`; `:148` adds `ms.isStale = …`. No other literal. Orphan path builds non-`MergedSection` objects (unaffected). |
| M3 | Med | The "3 fixtures break" claim was overstated: `html-serve.test.ts:140,223` + `companion-doc.test.ts:345` are **input** fixtures with no serialized-output equality assertion; the dead `digVersion` line is parsed-and-ignored. | Task 2 Step 4 re-scoped: those 3 are harmless (removing the line is cosmetic, no `genVersion` needed); target the genuine `serialize()`-output round-trip assertions in `companion-doc.test.ts` instead. |
| L1 | Low | `tests/lib/dig/generate.test.ts` already exists with a `buildDigPrompt` block. | Task 1 says **append** to the existing file (not "create if none"). |
| L2/L3/L4 | Low | nav.ts anchors (`_startDocDig:252`, `?dig` guard `:363-366`, delegation `:318-329`), expand-all count auto-update (both `:273` and `:297`), and `digVersion` removal safety — all **verified correct**, no change needed. | Confirmed; no action. |

## Confirmed correct (no action)
- Part 1 needs no pipeline change; `.dig-refresh` won't be caught by `.dig-toggle`/`.dig-trigger` `closest()` (exact class tokens); `_startDocDigAsync` reads `+trigger.dataset.section` so `.dig-refresh[data-section]` satisfies it; inserting the refresh branch before the trigger branch is unambiguous. Single `MergedSection` literal ⇒ `tsc` covers the `isStale` addition. Every spec section maps to a task.

## Bottom line
Architecture verified sound against the real code. The blockers are test-harness mismatches (mocked boundary, shared builders, Playwright re-GET) and stale anchors — all fixed in the revised plan. Ready to implement after revision + user approval.
