# Adversarial Spec Review — Serial-Number Filename Prefix

**Date:** 2026-06-25
**Spec:** `docs/superpowers/specs/2026-06-25-serial-number-filename-prefix-design.md`
**Reviewer:** Claude adversarial subagent (substituting for Codex — at usage limit, per `docs/plugins.md` Codex-fallback rule). Re-attempt the Codex-specific pass before merge if access returns.

## Confirmed-correct (verified against code)
- `playlistIndex` is current-position, not monotonic (`pipeline.ts:407-413`, commit `42483e1`). Spec §1.1 accurate.
- `migrateToSlugFilenames` strips `NNN_`, sole caller `app/api/videos/route.ts:71`, independent of `recoverOrphanedVideos` (line 70). Safe to remove.
- Slug/collision (`slugify.ts`, `pipeline.ts:331-337`); slide assets keyed by videoId (`slides.ts:104,121,160`); dig-deeper companion name derived at runtime (`dig/[sectionId]/route.ts:150`); serve route base from index (`html/[id]/route.ts:122-142`); `processedAt` always populated; 8 index path-fields complete (`types/index.ts:55-62`).

## Findings & resolutions

| ID | Sev | Issue | Resolution in spec |
|----|-----|-------|--------------------|
| F1 | HIGH | rename-many-then-one-JSON-write not crash-safe; serial could be reassigned divergently on resume → unfindable video | **Two-phase migration** (§6): Phase A commits all serials atomically first → Phase B target names are deterministic functions of committed serial → crash-resume cannot drift. Per-video index writes bound blast radius. |
| F2 | HIGH | blind `renameSync` could clobber existing `NNN_<slug>` | §6 Phase B step 2: `exists(src) && !exists(dst)` guard; conflict → abort video + log, never clobber. Edge case 6. |
| F3 | MED | 3 `source-md` emitters (not 1) + model envelope has own `sourceMd` | §6 step 3 + §7: meta-rewrite all 3 emitters; rewrite envelope `sourceMd` on model rename. |
| F4 | MED | re-render no-ops on pre-persisted-model summaries | §6 step 3 + O-2 RESOLVED: use deterministic meta string-rewrite, not re-render; missing model/HTML → no-op not failure. Edge case 9. |
| F5 | LOW | backfill ordering | Confirmed sound (processedAt total order). No change. |
| F6 | MED | `max+1` racy under ADR-005 no-locking | §5.1: read `max` inside the `upsertVideo` critical section; document residual single-user race; forbid concurrent ingest + `--apply`. Edge case 10. |
| F7 | confirm+caveat | stripper removal safe; but `reconstructVideo` must adopt serial from recovered prefixed filename | §5.3 + §7: recovery is the one place allowed to parse `NNN_` → `serialNumber`. Edge case 11. |
| F8 | MED | archived files live under `archived/`; archive moves only 4 of 8 fields | §6: Phase B renames at actual on-disk location (root or `archived/`). Edge case 3 corrected. |
| F9 | confirm | 8 fields complete; model file not a field but must rename | Already in §4/§6. |
| F10 | LOW | dig route `${videoId}.md` fallback dead-but-harmless | No action. |

## Verdict
Original verdict: **not safe to plan** until F1, F2 (data-loss class) addressed; F8/F7-caveat and F3/F4/F6 should-fix. **All addressed in the revised spec.** Ready for user spec-review gate, then implementation planning.
