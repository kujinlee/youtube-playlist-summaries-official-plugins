# Final Whole-Branch Review — Stage 1A MetadataStore Seam

**Reviewer:** Claude (opus), whole-branch merge review
**Date:** 2026-07-02
**Range:** cb94ad7..f2ea872 (7 implementation commits, Tasks 1–7)
**Verdict:** ✅ **READY TO MERGE** — no Critical, no Important; 1486/1486 jest green (independently reproduced), `tsc --noEmit` clean.

## Constraint verification (all pass)
1. **Behavior preserved** — no consumer semantics changed; guard still runs before every read (e.g. `dig-section` now guards via `getPrincipal` then delegates, same as before).
2. **Guard not dropped/doubled** — `getPrincipal` = the assert wrapper; `backfill-titles` root+child guards target different paths (intentional). `assertVideoId` untouched.
3. **Raw string preserved** — `getPrincipal` returns `localPrincipal(outputFolder)` with no `path.resolve`/normalize; pinned by `resolve.test.ts`.
4. **`backfill-titles` per-child principal** — correct.
5. **Seam boundary airtight** — only `local-metadata-store.ts` imports the raw data-access functions; every other index-store import is `assertOutputFolder`/`assertVideoId`.
6. **No missed consumer** — non-rerouted routes delegate to already-rerouted lib fns; they don't read/write index records directly.
7. **tsc clean, suite green, no docVersion bump, no test weakened/deleted.**

## Findings
- **Critical / Important:** none.
- **Minor (all defer):**
  - M1 — `archive.ts`/`pipeline.ts` mix raw `outputFolder` with `principal.outputFolder` in filesystem calls (`ensureArchiveDir`, `recoverOrphanedVideos`, `fs.mkdirSync`/`path.join`). Byte-identical today (Principal.outputFolder IS raw). **Stage-1C flag:** these raw-`outputFolder` fs sites are exactly what must NOT be reachable for a cloud principal — audit them when the non-local store lands.
  - M2 — Task 3 test style: `as Video` cast; ordering-dependent shared state across `it` blocks. Brittle-if-reordered; passes.
  - M3 — `resolve.test.ts` guard-rejection test doesn't assert `statusCode === 400` (covered by route suites; optionally tighten).
  - Pre-existing/out-of-scope: `recent-provider.ts` reads `playlist-index.json` directly for folder discovery (last touched PR #56, not in this range); `quick-view` route `readIndex` unguarded.

## Triage
All Minors correctly deferred; none block merge. Carry the M1 raw-`outputFolder` audit into the Stage-1C (SupabaseAdapter) plan.

**Ship it.**
