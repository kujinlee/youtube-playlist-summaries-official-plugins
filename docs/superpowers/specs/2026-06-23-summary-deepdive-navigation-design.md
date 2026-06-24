# Summary ↔ Deep-Dive Navigation (Sub-project 1)

**Date:** 2026-06-23
**Branch:** `feat/summary-deepdive-navigation`
**Status:** Design — pending adversarial review gate. (User approved the approach.)

## Problem

Summary and deep-dive docs are both anchored to the same video timeline (every section has a ▶ timestamp), but there is no way to move between them. A user reading summary §5 "Fable `[16:16]`" cannot jump to the deep-dive's discussion of that moment, or vice-versa.

This is **Sub-project 1** of a two-part effort. It is **render-only** (no generation change): add timeline-based cross-navigation between the existing docs. Sub-project 2 (deep-dive coverage ⊇ summary) is a separate, costlier generation change, deferred until navigation is validated.

## Decision

Both renderers already emit per-section ▶ links whose URL carries `&t=<startSec>s`. Use that shared timeline as the join key:

1. **`data-start` on each section.** Each section element gets `data-start="<startSec>"`, parsed from the section's existing ▶ link URL (`t=(\d+)s`). Sections with no ▶ get no `data-start` (not navigation targets). Summary: on the `<section>` wrapper; deep-dive: on the `<h2>` (section-level only in v1 — subsection `### ` nav is out of scope).
2. **A cross-doc nav control per section** — emitted ONLY when the counterpart doc exists (see gating). Summary → **"dig deeper ▾"**; deep-dive → **"↑ summary"**. The control is an `<a class="dig" data-type="deep-dive|summary" data-t="<startSec>">…</a>` whose `href` is computed client-side.
3. **A shared client script (`NAV_SCRIPT`)**, injected into both pages (like the existing `THEME_*` scripts), does two things:
   - **Wire the `.dig` links from `window.location`:** clone the current URL, set its `type` query param to the link's `data-type`, set the hash to `t=<data-t>`. This inherits `id` + `outputFolder` from the current serve URL — nothing absolute is baked into the cached HTML (move-safe, decoupled; neither renderer reads the other's file).
   - **Scroll-on-load:** if `location.hash` matches `#t=<sec>`, scroll to the `[data-start]` element with the greatest `data-start ≤ sec` (the section covering that moment); `scrollIntoView`.

### Counterpart-existence gating

The serve route (`app/api/html/[id]/route.ts`) **404s** a `?type=deep-dive` request when the video has no `deepDiveMd` (it lazy-renders if the `.md` exists). So a "dig deeper" link would 404 for a summary whose video has no deep-dive. → The nav control is emitted **only when the counterpart exists**:
- summary renderer gets `hasDeepDive` (caller passes `!!video.deepDiveMd`);
- deep-dive renderer gets `hasSummary` (caller passes `!!video.summaryMd`).

The render drivers already read the index: `runHtmlDoc`/`reRenderSummaryHtml` (summary) and `runDeepDiveHtml`/`reRenderDeepDiveHtml` (deep-dive) thread the flag into the renderer.

## Components & boundaries

| Unit | Responsibility | Change |
|------|----------------|--------|
| `lib/html-doc/nav.ts` (new) | `NAV_SCRIPT` (client script), `digControl(targetType, startSec)` (the `<a class="dig">` HTML), `startSecFromTsUrl(url): number \| null` (parse `t=Ns`), `.dig` CSS snippet | Create |
| `lib/html-doc/render.ts` `renderSummaryHtml` | `data-start` on `<section>`; `digControl('deep-dive', …)` when `hasDeepDive`; inject `NAV_SCRIPT`; `.dig` CSS | Modify (+ `hasDeepDive` param) |
| `lib/html-doc/render-deep-dive.ts` `renderDeepDiveHtml` | `data-start` on `<h2>`; `digControl('summary', …)` when `hasSummary`; inject `NAV_SCRIPT`; `.dig` CSS | Modify (+ `hasSummary` param) |
| `lib/html-doc/generate.ts`, `rerender.ts`, `generate-deep-dive.ts` | thread `!!video.deepDiveMd` / `!!video.summaryMd` into the renderer | Modify |
| `lib/doc-version.ts` | `CURRENT_DOC_VERSION` `{3,3}→{3,4}` + comment | Modify |
| `lib/deep-dive/version.ts` | `CURRENT_DEEP_DIVE_VERSION` `{2,2}→{2,3}` + comment | Modify |

Both bumps are **minor** (HTML render/style) → existing docs lazily re-render from `.md`/model, no Gemini.

### Renderer signature

Add the flag as a final optional param (default `false`) so existing callers/tests are unaffected unless updated: `renderSummaryHtml(model, parsed, sourceMd, hasDeepDive = false)`, `renderDeepDiveHtml(mdContent, sourceMd, hasSummary = false)`. (Confirm the exact current signatures during planning and append, not reorder.)

## NAV_SCRIPT behavior (pin)

```js
// 1. wire dig links from the current serve URL
for (const a of document.querySelectorAll('a.dig')) {
  const u = new URL(window.location.href);
  u.searchParams.set('type', a.dataset.type);   // 'summary' | 'deep-dive'
  u.hash = 't=' + a.dataset.t;
  a.setAttribute('href', u.pathname + u.search + u.hash);
}
// 2. scroll to the section covering #t=<sec> on load
const m = location.hash.match(/^#t=(\d+)/);
if (m) {
  const target = Math.max(...[...document.querySelectorAll('[data-start]')]
    .map(e => +e.dataset.start).filter(s => s <= +m[1]), -1);
  if (target >= 0) document.querySelector(`[data-start="${target}"]`)?.scrollIntoView();
}
```
(Guard empties: no `[data-start]` ≤ sec → no scroll. Runs after DOM ready, like the theme scripts.)

## Migration

After merge (render-only, no Gemini): re-render all summary docs (`npm run rerender-html -- <folder>`) and all major-2 deep-dive docs (`reRenderDeepDiveHtml` per video, as in the H3 migration). Then verify on `uvg9UmI0PuQ` (has both): the summary's sections carry `data-start` + a "dig deeper" control, and clicking it lands on the deep-dive section covering that time.

## Testing (TDD)

- **`nav.ts` unit:** `startSecFromTsUrl('…&t=185s')===185`, malformed→`null`; `digControl('deep-dive', 16)` contains `data-type="deep-dive" data-t="16"` and the "dig deeper" label.
- **`render.ts`:** a section with a ▶ → `<section … data-start="20">`; with `hasDeepDive:true` → contains a `.dig` `data-type="deep-dive"`; with `hasDeepDive:false` → NO `.dig`; `NAV_SCRIPT` present in output.
- **`render-deep-dive.ts`:** `<h2 … data-start="…">`; `hasSummary:true`→`.dig data-type="summary"`; false→none; existing H2/H3 timestamp + `section restructure` tests still pass.
- **`NAV_SCRIPT` behavior (jsdom):** load a fixture HTML with two `[data-start]` sections + a `.dig`, set `window.location` with `?type=summary&outputFolder=X` and hash `#t=200`; run `NAV_SCRIPT`; assert the `.dig` href became `…type=deep-dive…#t=<n>` and `scrollIntoView` was called on the section with the greatest `data-start ≤ 200`.
- **Version:** `CURRENT_DOC_VERSION==={3,4}`, `CURRENT_DEEP_DIVE_VERSION==={2,3}`. Update any fixture compared to these constants (e.g. `VideoMenu.test.tsx` deep-dive fixtures, summary equivalents) — grep `minor:` and reconcile.
- Full `npm test` + `npx tsc --noEmit` green; dual review per task.

## Out of scope

- Subsection (`### `) nav controls (section-level only in v1).
- Coverage / deep-dive ⊇ summary (Sub-project 2).
- Showing the nav control when the counterpart doc does not exist (gated off).
- Any generation change.
