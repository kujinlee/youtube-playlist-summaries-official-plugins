# Adversarial Plan Review — summary↔deep-dive navigation

**NOTE: Codex at usage limit (until Jul 18 2026); Claude (opus) adversarial review per docs/plugins.md fallback.**

Verdict: **needs-rework** → all Blocking/High/Medium applied. Architecture, signature threading, version asymmetry, and HTML-injection safety verified CORRECT; the issues are TDD-fixture precision errors that would halt the implementer at RED.

## Applied
- **B1 — `FM` out of scope.** It's declared at `render-deep-dive.test.ts:241` inside `describe('H3 subsection timestamps')` with a `render = (body)=>renderDeepDiveHtml(FM+body,'v1-deep-dive.md')` helper. → The 2 new deep-dive tests now go INSIDE that describe and call `renderDeepDiveHtml(FM + …, 'v1-deep-dive.md', true)` directly (FM in scope).
- **B2 — named summary fixtures don't exist.** `render.test.ts` has top-level `parsed` (no timeRange) + `model` (2 sections), and `withTs` (section0 `startSec:135`, section1 `timeRange:null`) scoped in `describe('renderMagazineHtml — section timestamps')`. → New summary tests go INSIDE that describe, reuse `withTs`+`model` (index-aligned, 2 sections each); a `start=0` case clones `withTs` with `startSec:0`; the no-timeRange assertion is tightened to count `<section data-start=` occurrences (===1) instead of the loose `<section>\s`.
- **H3 — explicit `:94`.** `generate-deep-dive.ts` has TWO `renderDeepDiveHtml` calls: `:50` (`runDeepDiveHtml`) and `:94` (`reRenderDeepDiveHtml`) — both get `!!video.summaryMd` (video in scope at :42 and :82). Plan now names both lines.
- **M1 — version.test.ts title.** Update BOTH `:5` title (`'current deep-dive version is 2.2'`→`2.3`) AND `:6` assertion (`{2,2}`→`{2,3}`).
- **L1 — strengthen NAV_SCRIPT assertion.** Assert `toContain('a.dig')` (a NAV_SCRIPT-unique token), not `</script>` (which the existing THEME_TOGGLE_SCRIPT also satisfies).

## Verified-correct (reviewer)
- jsdom single-file pragma works (precedent: `theme.test.ts`; `jest-environment-jsdom` installed); pure-function describes under jsdom are harmless.
- `scrollIntoView` prototype stub is sufficient (same fn resolved via prototype; fresh per beforeEach).
- `wireDigLinks` URL round-trip correct (no double-encode; id in path; outputFolder `%2F`↔`/`).
- Presence-gating keeps the existing exact-`<h2>` deep-dive tests (`:204`,`:229` ts-null) and the summary `<h2>…ts…</h2>` exact test (`:227`, hasDeepDive defaults false → `dig=''`) green. Summary `data-start` goes on `<section>`, deep-dive on `<h2>` — don't drift.
- Version blast radius minimal: only `version.test.ts:5-6` + `VideoMenu.test.tsx:34/51/67` (deepDiveVersion). `:15/:27` (docVersion {3,3}) untouched (no summary bump). E2E uses `{1,0}`/`{2,0}` (major-only, immune). `timestamp-audit`/`ensure` use major or literal targets. No `not.toContain('<script')` blanket assertion anywhere; the XSS `not.toContain` tests are about escaped content, unaffected by a legit inline NAV_SCRIPT.
- L4 (spec's `ensure.test.ts:86` stale-comment ref) was a bogus line ref; the `version.ts` comment edit in Step 3 covers the doc-comment intent. No action.
