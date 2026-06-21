# T4 Behaviors-Table Adversarial Review — ensureDeepDiveHtml / writeDeepDiveDoc

**Reviewer:** Claude (adversarial, full repo access) — **Codex-unavailable fallback** (usage limit; re-attempt before merge).
**Date:** 2026-06-20.

## Resolutions

- **B1 (deepDiveHtml never written today):** RESOLVED by design choice (a) — `ensureDeepDiveHtml` itself persists `deepDiveHtml` (capturing `htmlPath` from `runDeepDiveHtml`/`reRenderDeepDiveHtml`) in its final `updateVideoFields`. The field becomes authoritative; rows #3/#4/#5 then work. `updateVideoFields` is NOT a whitelist (index-store.ts), so this is mechanically fine.
- **B2 (who writes deepDiveMd + atomicity):** RESOLVED — `writeDeepDiveDoc` writes only the `.md` FILE and returns `{deepDiveMd}` (no index write, emits only `step`). `ensureDeepDiveHtml` persists `deepDiveMd` + `deepDiveHtml` + `deepDiveVersion` in ONE `updateVideoFields` call AFTER render succeeds → atomic; a crash before it leaves `deepDiveMd` null → clean row-#1 recovery next call.
- **H1 (FIX — stuck loop):** minor-stale branch: if `reRenderDeepDiveHtml` returns a non-`rerendered` status (e.g. `.md` deleted on disk → `skipped-no-md`), do NOT fall back to `runDeepDiveHtml` (it also reads the `.md` → throws → version never advances → infinite re-fail). Fall back to a FULL regenerate (`writeDeepDiveDoc` → `runDeepDiveHtml`).
- **H2:** render-fail-after-md-write leaves `deepDiveMd` unpersisted (stamp is post-success) → next call row #1 full regen. Clean. Test must assert post-failure index state (version still {1,0}/absent).
- **H3 / D5 (accepted):** video-only path stamps {2,0} with no ▶ and will not auto-upgrade later — intentional per spec D5 (avoids perpetual-Update trap). Document, don't change.
- **M1:** concurrency/double-submit is the ROUTE's job (T5, mirror html-doc/route.ts), NOT this unit. No in-unit locking test.
- **M2:** event ownership — `ensureDeepDiveHtml` emits `start` (first) and `done` (last, after stamp) in every branch; the no-op branch emits `start`+`done` and early-returns WITHOUT calling `updateVideoFields`. `writeDeepDiveDoc` emits only `step`.

## Rows ADDED to the behaviors table (now in plan Task 4)
1. Minor-stale but `.md` deleted → reRender skips → full cascade regenerate (H1).
2. Persistence/atomicity: deepDiveMd + deepDiveHtml + deepDiveVersion in one updateVideoFields post-success.
3. First-time generate with `summaryMd === null` → base = `video.id` → writes `<id>-deep-dive.md`.
4. Precedence: html-missing AND minor-stale both true → html-missing (full render) path wins (else-if order).
5. No-op branch → emits start+done, early-return, NO updateVideoFields.
6. ko language pass-through.
7. Video-only output stamped {2,0} despite no ▶ (H3/D5, intentional).

## Verdict
With H1 fixed in the plan and rows 1-7 added, the behaviors table is complete and correct to write tests against.
