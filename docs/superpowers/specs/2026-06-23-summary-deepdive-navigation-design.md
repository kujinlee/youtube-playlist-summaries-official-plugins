# Summary ↔ Deep-Dive Navigation (Sub-project 1)

**Date:** 2026-06-23
**Branch:** `feat/summary-deepdive-navigation`
**Status:** Design — reworked after adversarial review (`docs/reviews/spec-summary-deepdive-navigation-review.md`); ready to plan.

## Problem

Summary and deep-dive docs are both anchored to the same video timeline (every section has a ▶ link whose URL carries `&t=<startSec>s`), but there is no way to move between them. Render-only **Sub-project 1**: timeline-based cross-navigation. Sub-project 2 (deep-dive coverage ⊇ summary) is a separate generation change, deferred.

## Decision

### 1. `data-start` on each section
Each section element gets `data-start="<startSec>"`, gated on **presence of the timeRange/ts object** (NOT a truthiness test on `startSec` — a `0:00` section has `startSec===0`):
- **Summary** (`renderMagazineHtml`, render.ts:53): on the `<section>` wrapper, from `s.timeRange.startSec` (already a parsed integer, types.ts:5) when `s.timeRange != null`.
- **Deep-dive** (`renderDeepDiveHtml` → `renderSection`): on the `<h2>`, from `startSecFromTsUrl(ts.url)` when `ts != null`. (Section-level only in v1; `### ` subsections are out of scope.)
- A section with no ▶ → no `data-start` (not a nav target).

### 2. Counterpart-gated cross-doc control
A nav control per section, emitted ONLY when the counterpart doc exists (the serve route 404s `?type=deep-dive` when there is no `deepDiveMd`):
- Summary → **"dig deeper ▾"** (when `hasDeepDive`); deep-dive → **"↑ summary"** (when `hasSummary`).
- HTML: `<a class="dig" data-type="deep-dive|summary" data-t="<startSec>">…</a>`. `data-t` equals the section's own `data-start`. Built by `digControl(targetType, startSec)`; `href` is computed client-side.
- `hasDeepDive`/`hasSummary` come from the render driver (which has the `Video` from `readIndex`): pass `!!video.deepDiveMd` / `!!video.summaryMd`.

### 3. Shared client behavior (`lib/html-doc/nav.ts`)
Two named, testable functions + a thin `NAV_SCRIPT` wrapper that calls them, injected at **end-of-body** (alongside `THEME_TOGGLE_SCRIPT`, so the DOM is built):
- `wireDigLinks(doc, loc)`: for each `a.dig`, clone `loc.href` into a `URL`, `searchParams.set('type', a.dataset.type)`, set `hash = 't=' + a.dataset.t`, assign `a.href = u.pathname + u.search + u.hash`. Inherits `id` (path) + `outputFolder` (query) from the current serve URL — nothing absolute baked into cached HTML; `URLSearchParams` round-trips `outputFolder` with no double-encoding.
- `scrollToHashSection(doc, loc)`: parse `loc.hash` `^#t=(\d+)`; among `doc.querySelectorAll('[data-start]')`, pick the element with the greatest `data-start ≤ sec` (`Math.max(...vals, -1)`, guard `≥ 0` — `data-start` is never negative, so the `-1` sentinel distinguishes "none" from "section at 0"); `scrollIntoView()`.
- `NAV_SCRIPT` = `<script>(function(){ wireDigLinks(document, location); scrollToHashSection(document, location); })();</script>` (the two functions inlined into the string; the exported copies are what tests exercise).

## Components & boundaries

| Unit | Responsibility | Change |
|------|----------------|--------|
| `lib/html-doc/nav.ts` (new) | `NAV_SCRIPT`, `digControl(targetType, startSec): string`, `startSecFromTsUrl(url): number\|null`, `wireDigLinks`, `scrollToHashSection`, `.dig` CSS snippet | Create |
| `lib/html-doc/render.ts` `renderMagazineHtml(parsed, model, hasDeepDive = false)` | `data-start` on `<section>`; `digControl('deep-dive', startSec)` when `hasDeepDive`; inject `NAV_SCRIPT` end-of-body; `.dig` CSS | Modify (append 3rd param) |
| `lib/html-doc/render-deep-dive.ts` `renderDeepDiveHtml(mdContent, sourceMd, hasSummary = false)` | `data-start` on `<h2>`; `digControl('summary', startSec)` when `hasSummary`; inject `NAV_SCRIPT`; `.dig` CSS | Modify (append param) |
| `lib/html-doc/generate.ts` `runHtmlDoc`, `lib/html-doc/rerender.ts` `reRenderSummaryHtml` | pass `!!video.deepDiveMd` | Modify |
| `lib/html-doc/generate-deep-dive.ts` `runDeepDiveHtml`, `reRenderDeepDiveHtml` | pass `!!video.summaryMd` | Modify |
| `lib/deep-dive/version.ts` | `CURRENT_DEEP_DIVE_VERSION` `{2,2}→{2,3}` + comment | Modify |

**Default-false** on both renderer params keeps all test-only callers (render*.test, darkmode-html.spec — the only non-driver callers) on the no-nav path unless updated.

### Versioning — ASYMMETRIC (the key cost decision)
- **Deep-dive: bump `{2,2}→{2,3}`** (minor). Deep-dives render from `.md` (no model), so existing ones lazily re-render cheaply (no Gemini).
- **Summary: do NOT bump `CURRENT_DOC_VERSION`.** Only **24 of 260** summaries have a cached magazine model; a minor bump would lazily **re-summarize 236 docs via Gemini** (model-less `reRenderSummaryHtml` → `runHtmlDoc`). Instead the nav render change is additive, and the migration eagerly re-renders only the summaries that need nav (see Migration). (Latent tech-debt, out of scope: summary minor bumps are inherently expensive until magazine models are persisted for old docs.)

## Migration

Render-only. After merge:
- **Deep-dive:** re-render all major-2 deep-dives via `reRenderDeepDiveHtml` (as in the H3 migration) — they pick up the `{2,3}` stamp + "↑ summary" controls. Cheap, no Gemini.
- **Summary:** eagerly re-render the **13** model-having summaries among the **18** deep-dive videos (cheap `reRenderSummaryHtml`, no Gemini, no content change) so their "dig deeper" controls + `data-start` + `NAV_SCRIPT` appear. The **5** no-model deep-dive-video summaries are **left as-is** (partial nav: reachable from the deep-dive's "↑ summary" link landing on the page, but no in-page scroll and no "dig deeper" until naturally re-summarized) — documented, no surprise Gemini cost. List the 5 in the migration output.
- Verify on `uvg9UmI0PuQ` (has both, summary has a model): summary sections carry `data-start` + "dig deeper"; clicking lands on the deep-dive section covering that time; and reverse.

## Testing (TDD)

- **`nav.ts` unit:** `startSecFromTsUrl('…&t=185s')===185`; `'…&t=0s'===0`; malformed/no-`t`→`null`. `digControl('deep-dive', 16)` contains `data-type="deep-dive" data-t="16"` + "dig deeper"; `digControl('summary', 0)` → `data-t="0"`.
- **`wireDigLinks` / `scrollToHashSection` (jsdom, `/** @jest-environment jsdom */`):** build a doc with sections `data-start="0"` and `data-start="200"` + a `.dig data-type="deep-dive" data-t="200"`; a fake `loc` `{href:'http://x/api/html/vid?outputFolder=%2FU%2Ff&type=summary', hash:'#t=210'}`. Assert `wireDigLinks` sets the link href to `…type=deep-dive…#t=200` and that decoding `outputFolder` from it equals `/U/f` and `id` stays `vid` in the path. Assert `scrollToHashSection` calls `scrollIntoView` on the `data-start="200"` element; a separate case with `hash:'#t=5'` lands on `data-start="0"` (start=0 reachable); `#t=` absent → no scroll.
- **`render.ts`:** section with ▶ → `<section … data-start="20">`; `hasDeepDive:true` → a `.dig data-type="deep-dive"`; `false` → none; `NAV_SCRIPT` present once, end-of-body. A section with `timeRange:null` → `<section>` with no `data-start` and no `.dig`.
- **`render-deep-dive.ts`:** `<h2 … data-start="…">` when ts present; ts-null section → `<h2>` no attr; `hasSummary:true`→`.dig data-type="summary"`; existing H2/H3 timestamp + `section restructure` tests still pass.
- **Version:** `CURRENT_DEEP_DIVE_VERSION==={2,3}`. Update `deep-dive/version.test.ts:6` + `VideoMenu.test.tsx` deepDiveVersion fixtures (`:34,:51,:67`) `{2,2}→{2,3}`. (No summary-version churn — `CURRENT_DOC_VERSION` unchanged.)
- Full `npm test` + `npx tsc --noEmit` green; dual review per task.

## Out of scope

- Subsection (`### `) nav controls (section-level v1).
- Coverage / deep-dive ⊇ summary (Sub-project 2).
- Nav control when the counterpart doc doesn't exist (gated off).
- Re-summarizing the 236 model-less summaries / the 5 no-model deep-dive-video summaries (no version bump; partial nav documented).
- Persisting magazine models for old summaries (separate tech-debt).
