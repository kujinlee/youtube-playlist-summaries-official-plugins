# Deep-Dive Retirement — Design Spec

**Date:** 2026-06-30
**Status:** Approved
**Branch:** `feat/remove-deep-dive`

## Decision

Retire the **deep-dive** feature entirely (whole-video Gemini analysis → `<base>-deep-dive.md` + deep-dive HTML doc). It is superseded by **dig-deeper** (per-section, on-demand, clip-grounded elaboration with slide screenshots). **Summary** and **dig-deeper** remain fully intact.

This was an explicitly deferred decision: dig-deeper was built additively (PR #23) with "retire deep-dive" left open. This spec closes it.

## Ground-truth facts (verified 2026-06-30)

- On disk: **24** `*-deep-dive.md` + **16** `*-deep-dive.html` (agentic-ai 22/15, cs146s 1/1, 건강 1/0). Distinct from `*-dig-deeper.*` (kept).
- **Shared boundary is clean** except `nav.ts`. Transcript resolution (`transcript-source.ts`), `theme.ts`, the `DocVersion` type, and the dig-deeper machinery are all separable.
- Summary's primary "dig deeper ▶" nav points at **dig-deeper**, not deep-dive — survives untouched.
- `DocVersion` type + `docVersion`/`CURRENT_DOC_VERSION` are **shared with summary** — KEEP. Only `deepDiveVersion` + `CURRENT_DEEP_DIVE_VERSION` are deep-dive-specific.
- `dig-deeper` does **not** import any `lib/deep-dive/` or `render-deep-dive` code.

## Work

### 1. Delete on-disk artifacts (full cleanup — approved, irreversible)
All `*-deep-dive.md` (24) + `*-deep-dive.html` (16) across `raw/` and `archived/` in all 3 playlist folders. Commit deletions in the git vaults (agentic-ai, cs146s); 건강 not git (irreversible). `*-dig-deeper.*` MUST be left untouched.

### 2. Delete dedicated code (no shared consumers)
- `lib/deep-dive/` — `ensure.ts`, `version.ts`, `write-doc.ts`
- `app/api/videos/[id]/deep-dive/route.ts` (+ dir)
- `lib/html-doc/generate-deep-dive.ts`, `lib/html-doc/render-deep-dive.ts`
- `components/DeepDiveOverlay.tsx`, `components/DeepDiveStatusBar.tsx`
- `lib/gemini.ts`: `generateDeepDive`, `generateDeepDiveFromTranscript`, `generateDeepDiveCombined` (+ any deep-dive-only helpers/prompts they use exclusively)
- 13 dedicated test files: `tests/lib/deep-dive/*` (4), `tests/api/deep-dive-post.test.ts`, `tests/api/deep-dive-html-pipeline.test.ts`, `tests/api/html-serve-deep-dive.test.ts`, `tests/lib/html-doc/generate-deep-dive.test.ts`, `tests/lib/html-doc/render-deep-dive.test.ts`, `tests/lib/html-doc/render-deep-dive-helpers.test.ts`, `tests/lib/gemini-deepdive-*.test.ts` (3), `tests/components/DeepDiveOverlay.test.tsx`, `tests/components/DeepDiveStatusBar.test.tsx`, `tests/e2e/deep-dive-doc.spec.ts`

### 3. Surgical edits to shared code
- `types/index.ts` — remove `deepDiveMd`, `deepDiveHtml`, `deepDiveVersion`. KEEP `docVersion` + `DocVersion`/`DocVersionSchema`.
- `lib/html-doc/nav.ts` *(HIGHEST RISK)* — remove the `digControl('summary',…)` overload, `wireDigLinks()`, and the deep-dive cross-doc block in the inline `NAV_SCRIPT`. KEEP summary "dig deeper ▶" controls + the full dig-state machine + `scrollToHashSection`. The inline JS mirrors TS helpers (DRIFT WARNING) — edit both in lockstep.
- `app/api/html/[id]/route.ts` — delete the `type === 'deep-dive'` branch; tighten the type guard to `'summary' | 'dig-deeper'`.
- `components/VideoMenu.tsx` — remove "Deep Dive doc" + "Open Deep Dive in Obsidian" items, `onDeepDive` prop, `CURRENT_DEEP_DIVE_VERSION` import.
- `app/page.tsx` — remove `DeepDiveStatusBar` import, `deepDive` state, `handleDeepDive`, `handleDeepDiveClose`, the `onDeepDive` prop wiring, and the `DeepDiveStatusBar` render.
- `lib/archive.ts` — drop `video.deepDiveMd` from the move + cached-HTML loops (summary-only).
- `lib/timestamp-audit.ts` — remove the `deepDives` branch + `CURRENT_DEEP_DIVE_VERSION` import.
- `lib/timestamp-repair.ts` — remove the `ensureDeepDiveHtml` import + any deep-dive repair path.
- Shared test fixtures — strip `deepDiveMd`/`deepDiveHtml` keys (tsc surfaces the exact list).

### 4. Explicitly preserved
Summary, dig-deeper (companion `.md` + slides + Ask-AI + dig-state machine), transcript resolution, theme/print, the `docVersion` system for summary, summary→dig navigation, timestamp audit/repair for summary.

### 5. Data migration
None. Zod non-strict → stale `deepDive*` keys drop on next write.

## Verification
- `npx tsc --noEmit` clean
- `npm test` full serial suite green
- **Nav regression:** summary "dig deeper ▶" → dig works; dig page loads; no console errors from the trimmed `NAV_SCRIPT` (Playwright nav specs green + manual eyeball of the inline script)
- App boots; video menu shows no deep-dive items; summary + dig docs unaffected
- `grep -rn "deepDive\|DeepDive\|deep-dive\|render-deep-dive" lib app components types --include='*.ts*'` → no live references (comments aside)

## Out of scope
- dig-deeper, summary, or any change to their behavior
- The `DocVersion` system (kept for summary)

## Risks
- **`nav.ts` inline script surgery** — the highest risk. Mitigation: keep e2e summary/dig nav tests green, manually verify the inline JS after trimming, confirm no `wireDigLinks`/`data-type="summary"` references remain.
- **Orphan recovery** — N/A: the deep-dive `.md` files are deleted, so `recoverOrphanedVideos` has nothing to mis-ingest. (If any `.md` were kept, the recover/reconcile filter would need checking.)
