# Codex Adversarial Review — Stage 1A MetadataStore Seam Plan

**Reviewer:** Codex (frontier), fresh session
**Date:** 2026-07-02
**Target:** `docs/superpowers/plans/2026-07-02-stage-1a-metadata-store-seam.md`
**Verdict:** 1 Blocking, 2 High, 3 Medium, 1 verified-OK. All addressed in plan v2.

## Findings

- **[Blocking] Principal path resolution breaks byte-identical behavior (Task 1/4).** `getPrincipal` returned `localPrincipal(path.resolve(outputFolder))`, but `index-store` uses the **raw** `outputFolder` for `indexPath()`; `assertOutputFolder` resolves only for its guard. A relative/symlink-spelled folder would persist/read a different string, and mocked-arg assertions would see resolved paths. → **Fix:** `Principal.outputFolder` preserves the caller's exact raw string; `getPrincipal(of) = { assertOutputFolder(of); localPrincipal(of) }` — no resolve. (Also resolves the Medium on Task 7 mock args.)

- **[High] `backfill-titles.ts` is per-child-folder, not per-root (Task 6 Step 2).** It receives `root` and iterates discovered playlist folders, doing `readIndex(folder)`/`writeIndex(folder,…)` per child. One principal for `root` would target the wrong `playlist-index.json`. → **Fix:** guard `root` at entry, but build a principal per discovered `folder` before each access.

- **[High] Seam-completeness grep is too narrow (Task 8 Step 1).** Searching only `from '@/lib/index-store'` lines misses **relative** imports (`lib/pipeline.ts:6`, `lib/archive.ts:3`, …) and the **namespace** import in the delegating impl → false "complete." → **Fix:** `rg` over symbol usage `readIndex|writeIndex|upsertVideo|updateVideoFields` in `app lib scripts`, whitelisting only `lib/index-store.ts` + `lib/storage/local/local-metadata-store.ts` + intentional tests.

- **[Medium] `scripts/backfill-serial-prefix.ts` mis-listed as "imports only guards."** It directly calls `readIndex`. → **Fix:** explicitly scope `scripts/` **out of Part 1** (scripts can't use `@/*` at runtime — need relative storage imports), rerouted in a follow-up; correct the wrong claim.

- **[Medium] Audit "no redundant guard" reasoning is false/forward-dangerous (Task 6 Step 3).** `timestamp-repair/audit`, `summary-audit` currently guard only via delegation; using `localPrincipal` (no guard) is byte-identical *today* but skips validation once the store is non-local. → **Fix:** use `getPrincipal(folder)` wherever the old first touch of a raw folder occurred; resolve principal once at entry and pass down.

- **[Medium] Test-arg assertions (Task 7).** `tests/api/review.test.ts`, `regenerate.test.ts`, `dig-section.test.ts`, `pipeline.test.ts` assert raw call args on mocked data fns. → **Fixed by the Blocking fix** (raw preserved). Add a characterization test on one route mock before rerouting all routes.

- **[Verified OK] Namespace-import mock interception.** `import * as indexStore from '@/lib/index-store'` **is** intercepted by existing `jest.mock` (Jest aliases `@/*`). Not a problem. Add one characterization test as a belt-and-suspenders check.

## Disposition
All Blocking/High/Medium addressed in plan v2 (single rule: `getPrincipal` everywhere a raw folder enters, resolve once + pass principal down, raw preserved; per-folder principals in backfill-titles; scripts out of scope; ripgrep completeness check; route characterization test).
