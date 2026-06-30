# Batch-docs Phase B plan — Codex adversarial review

**Model:** gpt-5.5 (Codex online, no fallback). **Target:** `docs/superpowers/plans/2026-06-29-batch-docs-phase-b-dig.md` + spec + the merged Phase A code + dig subsystem.

**Verdict: 1 Blocking, 2 High, 2 Medium, 1 Low — all addressed in the plan. Cleared to implement (AFK).**

## Findings + resolutions
- **BLOCKING — dig failures become silent successes:** `digSection` EMITS `{type:'error'}` and returns (does NOT throw) for missing video/section, null window, abort-before-write. The batch loop only caught throws → `succeeded++` on a no-op emitter. **Fixed:** dig branch passes a capturing emitter and rethrows the captured error → counted `failed`. Test LB6 added.
- **HIGH — summary-dig client eligibility gap:** `handleBatchGenerate` filtered by `summaryNeedsWork` only, so a summary-current/never-dug video produced `ids=[]` and never posted (contradicts spec eligibility). **Fixed:** mode-aware `videoNeedsBatchWork(v, mode)` (`summary-dig` = `summaryNeedsWork || (summaryMd && !digDeeperMd)`) wired through VideoList select-all (`batchMode` prop), counts, and the POST filter; E2E fixture now a summary-current/never-dug video. (B4 0a/0b + page wiring.)
- **HIGH — parse throw rejects the batch:** `parseSummaryMarkdown` throws on a summary with no `##` sections; uncaught in the pre-pass → fatal batch error. **Fixed:** `missingDigSections` wraps parse in try/catch → 0 sections, continue. Test LB7.
- **MEDIUM — companion path:** pre-pass derived `${base}-dig-deeper.md` instead of indexed `digDeeperMd`. **Fixed:** `video.digDeeperMd ?? derived`.
- **MEDIUM — cancel mid-dig double-count:** the abort error was swallowed then `succeeded++`. **Fixed by the Blocking change** (captured+rethrown → failed); top-of-loop abort check still emits `cancelled`.
- **LOW — read-only const mutation in B1 test:** `(gen as any).DIG_GENERATOR_VERSION = 9` may throw. **Fixed:** partial mock keeps the real const.

## Verified CLEAN by Codex
- Extraction fidelity: route-local fn self-contained; section key `timeRange?.startSec` matches.
- Staleness parser: `parseDugSections` returns `genVersion`; `DIG_GENERATOR_VERSION` exported.
- Route mode validation: both literals; real mode passed through.
- BulkActionBar confirm-cancel coverage; Phase A summary-label test still matches.

## Cross-check with my own pre-review
My independent check (dig-post.test.ts hits the route end-to-end with mocked deps → extraction keeps it green; jest path-alias maps `@/lib/*` ≡ `../../lib/*`) agreed and is unaffected by the fixes.
