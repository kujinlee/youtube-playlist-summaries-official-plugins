# Final Whole-Branch Review — Dig-Deeper v2 (in-place expansion)

**Reviewer:** Claude (opus, fresh context, full branch diff `825c9f7..c85c235`, 17 commits)
**Date:** 2026-06-25
**Codex:** at usage limit (Jul 18) — Claude review per fallback policy.

## Verdict: READY TO MERGE — with one recommended pre-merge fix (applied).

Independently re-verified: `tsc --noEmit` exit 0; `jest` 1269/1269 (92 suites); working tree clean. No BLOCKING/HIGH cross-cutting issues. Architecture sound; integration seams correct and well-tested.

## NEW cross-cutting findings

- **[MEDIUM] `mergeDigDoc` orphan double-count** (`lib/html-doc/dig-merge.ts`): two `DugSection`s sharing a `sectionId` that matches NO summary section produce 3 orphans for 2 inputs (`["a","b"]`→`["a","b","b"]`). `postOrphans` filters the raw `dug` array while `preOrphans` also holds the duplicate → appended twice. Narrow (re-summarize removed a twice-dug section) but emits wrong/duplicated paid-for content. **FIXED before merge** (build postOrphans from de-duped map values).
- **[LOW] dig-doc ▶ href uses `summary.videoId` not trusted `args.videoId`** (`render-dig-deeper.ts`): a summary `.md` missing `video_id` frontmatter yields `watch?v=&t=Ns`. Trusted value already passed but unused. **FIXED before merge.**
- **[LOW] bfcache `pageshow` can blank a section** dug in another tab (flips `data-dug` without injecting `.dug`). Narrow (multi-tab + back-nav); self-heals on reload. **DEFERRED to follow-up.**

## Confirmed-sound seams (no issue)
- **Keying chain end-to-end consistent:** `sectionId`(companion) = `startSec`(summary) = `data-section`(trigger) = `/dig/<startSec>`(POST) = `data-start`(section) = dig-state `sectionIds`. No mis-derivation.
- **Version-gate ↔ renderer:** single `GENERATOR_VERSION='magazine-skim v2'` emitted by renderer + imported by route comparator; no drift; guard test + route v1-stale tests present.
- **Security:** `assertWithin` on all derived paths (companion checked first); containment-drop (silent) vs escaped `.missing-slide` placeholder; `MarkdownIt({html:false})` + `esc()` on all titles/lead/bullets/orphan/alt; re-GET swap same-origin.
- **Dead code gone:** `renderDigDeeperHtml` removed; POST no longer renders/writes HTML or stamps `digDeeperHtml`; no orphaned importers.
- **Same-tab (#5):** only `target="_blank"` remaining are YouTube external links; summary dig-controls `removeAttribute('target')` in TS + inline.
- **Event delegation** on stable `.dg`, survives node swaps.
- **Test integrity:** route tests cover all `ReRenderResult` branches + traversal 400s + skeleton/orphan/missing-file 200s + fast-path-not-rerendered spy; 23 E2E cover the full surface. No empty-assertion or dodge-deletion tests.

## Backlog triage (all DEFER, sound reasoning)
T2 flatMap-drop (impossible input), T7 stale JSDoc (cosmetic), T9 html:false test (behavior preserved), T10 silent SSE catch + stale-trigger (narrow; server-controlled), T12 _eaRunBatch re-entry (overlay blocks it), T14 F1 scroll / F2 dig-absence / F5c img selector (coverage nits, tests pass). All safe for a follow-up; none gate merge.

## Deferred follow-up ticket (post-merge)
bfcache section-blanking (LOW); + the Minor backlog above.
