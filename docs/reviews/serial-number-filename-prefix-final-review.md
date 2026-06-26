# Final Whole-Branch Review — Serial-Number Filename Prefix

**Date:** 2026-06-25
**Branch:** `feat/serial-number-filename-prefix` (19 commits, `c8ccefe..d0ab4b9`)
**Reviewer:** Claude adversarial subagent on Opus (final merge gate, SDD whole-branch review). Codex at usage limit → Claude-fallback per `docs/plugins.md`. A confirmatory Codex pass is cheap if access returns before merge but is NOT a gate.

## Verdict: READY TO MERGE

No Blocking, no Important findings. All 4 prior plan-review fixes (B1/B2/H1/H2) are genuinely present in code and enforced by non-vacuous tests. `tsc --noEmit` clean; full suite 1313/1313 green (99 suites); 32 serial-* tests pass.

## The feature

Prepends a stable, ingestion-time-assigned, monotonically-increasing serial (`NNN_<slug>.<ext>`, zero-padded 3-digit) to every playlist file (raw `.md` + summary/deep-dive/dig-deeper md+html+pdf + `models/<base>.json` envelope). Distinct from `playlistIndex` (mutable UI position). New ingests get `max(serials incl archived)+1`; existing files backfilled in `processedAt` order via a dry-run-default CLI. Two-phase crash-safe migration: Phase A atomically assigns serials in the index (no file I/O); Phase B renames deterministically (target = pure function of the committed serial → crash-resumable without drift).

## Verification of the 8 critical data-integrity invariants

| # | Invariant | Status | Evidence |
|---|---|---|---|
| 1 | B1 — archived index field stays ROOT-relative | ✅ CONFIRMED | `serial-migrate-exec.ts:64,89` `fieldUpdates[field]=op.to` always; `physicalDst` mirrors `archived/`; test `…stores a root-relative index field` asserts `summaryMd==='001_alpha.md'`. Cross-checked `archive.ts:107 unarchiveVideo` — no double `archived/`. |
| 2 | B2 — crash-resume convergence (renamed but stale index) | ✅ CONFIRMED | `serial-migrate-exec.ts:81–84` probes `op.to` when `from` gone; test `repairs a stale index field when the file was already renamed by a crashed run` → `renamed:0`, field converged. |
| 3 | Clobber safety (no overwrite; conflict+skip) | ✅ CONFIRMED | Pass 1 `realpathSync` origin check (TOCTOU-guarded catch→conflict); Pass 2 renames only `if (!existsSync(dst))`; test asserts existing target content untouched. |
| 4 | Monotonicity / no-reuse | ✅ CONFIRMED | `serial-assign.ts:3–6` max over ALL incl archived; test archived serial 9 → next 10. |
| 5 | Idempotency (no `001_001_`) | ✅ CONFIRMED | `applySerial` strips `^\d+_` before re-applying; strip is underscore-delimited, `slugify` never emits `_`; Phase A skips serialled videos, Phase B re-run `renamed:0`. |
| 6 | Ingest/migration agree on next serial | ✅ CONFIRMED | Both call same `nextSerial(readIndex().videos)`; pipeline reads inside loop before upsert; intra-run increment proven via stateful mock (vid1=001, vid2=002). |
| 7 | Provenance rewrite on rename | ✅ CONFIRMED | `serial-migrate-exec.ts:99–107` rewrites `source-md` meta (all 3 byte-identical emitters) + envelope `sourceMd`, best-effort try/catch (no corruption on failure); HTML + envelope tests. |
| 8 | Type gate | ✅ CONFIRMED | `tsc --noEmit` exit 0; `serialNumber: z.number().int().positive().optional()` at `types/index.ts:71`. |

**Additional:** `migrateToSlugFilenames` removal clean (zero dangling refs; `recoverOrphanedVideos` preserved). Orphan recovery adopts `NNN_`→serialNumber (tested, prefixed + unprefixed). `digDeeperHtml` provenance branch retained-but-never-persisted = harmless (M1 accepted). Module naming coherent.

## Minor backlog — all DEFERRED (cosmetic/observability; none threatens user data)

- **T4** collision loop `applySerial` vs symmetric literal; test 3 redundant — stylistic.
- **T7** `>` unescaped in `escAttr` — safe in double-quoted attr; slugs have no special chars.
- **T9** no explicit empty-index/field-preservation tests — covered transitively (Phase A `assigned:0`; envelope `generatedAt` preserved).
- **T10** dual-use `aborted` flag; bare-catch swallows non-OS errors — sound (conflict-on-any-error is the safe direction); observability only.
- **T11** `--folder` with no arg → `"undefined"` (fails fast in `readIndex` 400); header "N new serial(s)" can read "0 new" while body lists re-run renames — cosmetic. 2-line guard is nice-to-have.
- **New:** `render.ts` uses `esc`, `serial-provenance.ts` uses `escAttr` — two escapers for same attribute; inconsequential for slug inputs.

## Bottom line
The two-phase crash-safe design is correctly implemented and adversarially tested against its negative cases (B1 double-prefix, B2 stale index, clobber, serial reuse, double-prefixing). Data-integrity properties all hold in code. The backlog is entirely cosmetic/observability. **Merge.**
