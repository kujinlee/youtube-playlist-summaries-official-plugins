# Adversarial Review — Serial-Number Filename Prefix Plan

**Date:** 2026-06-25
**Plan:** `docs/superpowers/plans/2026-06-25-serial-number-filename-prefix.md`
**Reviewer:** Claude adversarial subagent (substituting for Codex — at usage limit, per `docs/plugins.md` Codex-fallback). Re-attempt Codex before merge if access returns.
**Original verdict:** NOT safe to execute as-is — 2 Blocking + 2 High. **All addressed in the revised plan.**

## Findings & resolutions

| ID | Sev | Issue | Resolution |
|----|-----|-------|-----------|
| B1 | Blocking | Phase B wrote `archived/001_x.md` into the index path-field, but the repo convention is **root-relative** (`unarchiveVideo` rebuilds the `archived/` path from a root-relative field → double `archived/` → file never restored) | Task 10: index field set to `op.to` (root-relative) always; physical rename mirrors src location under `archived/`. Test asserts `summaryMd === '001_alpha.md'` (not `archived/...`). |
| B2 | Blocking | Crash after rename but before `updateVideoFields` → re-run's `resolveOnDisk(from)` finds nothing → index field stuck stale forever (serve route 404s). Spec claimed safe; plan didn't realize it. | Task 10: when `from` is gone, probe `to`; if present, still set `fieldUpdates[field]=op.to` so the index converges. New test simulates renamed-but-stale-index → asserts repair. |
| H1 | High | Task 11 used `tsx`; repo has no `tsx` — scripts run via `ts-node` + `TS_NODE_COMPILER_OPTIONS` CommonJS override | Task 11: package.json entry corrected to the `ts-node` pattern. |
| H2 | High | Script used `@/` imports; ts-node (CommonJS) doesn't resolve them at runtime (only jest does) | Task 11: script uses relative imports (`../lib/...`). |
| M1 | Med | `digDeeperHtml` is never persisted (rendered fresh per GET); dig-deeper provenance branch is dead; the "dig-deeper md basename" caveat was factually wrong (renderer gets the summary mdPath) | Task 10 note rewritten; Self-Review gap-check corrected. Field kept (harmless/future-proof). |
| L1 | Low | Task 6 must also drop `migrateToSlugFilenames` from the import at `app/api/videos/route.ts:3` | Task 6 Files updated. |
| L2 | Low | Exact test range `tests/lib/pipeline.test.ts:952-1027` + import at ~L12 | Task 6 Test line updated. |

## Confirmed correct (no action)
- `VideoSchema` export name + placement; `readIndex`/`writeIndex` (atomic temp→rename, no Zod validation) / `upsertVideo` / `updateVideoFields` signatures.
- Pipeline new-video block insertion (Task 4) + `writeSummaryDoc({baseName})→<baseName>.md`; `reconstructVideo` edit (Task 5); collision loop terminates and is unique.
- The three `<meta name="source-md" content="...">` tags are byte-identical → Task 7 regex matches all three.
- Model envelope top-level `sourceMd: string`, `models/<base>.json` keyed off `summaryMd` base; `summaryHtml` at `htmls/<base>.html`.
- Conflict pre-check `realpathSync` is guarded by `existsSync` → never throws ENOENT.
- `nextSerial` over the full index incl archived (spec §5.3).
- No task test depends on a later task's symbol; ordering sound.
- Harness: `pipeline.test.ts` mock-based (`mockReadIndex`/`mockUpsertVideo`, `makeIndexedVideo`); `reconstructVideo` tests use a real temp dir.

## Bottom line
Pure-helper tasks (1,2,3,7,8) sound. Tasks 9–11 revised for B1/B2/H1/H2 + M1/L1/L2. Plan is now safe to execute pending user approval (Post-Plan Gate).
