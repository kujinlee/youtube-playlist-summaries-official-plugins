# Adversarial Review — Spec: Dig Image Sizing + Per-Section Ask-AI

**Reviewer:** Claude adversarial subagent (fresh, full file access, break-it mandate)
**Date:** 2026-06-28
**Codex gap:** Codex CLI at usage limit; this Claude adversarial review satisfies the Phase-1 gate (AFK — substitutes for user approval). Re-attempt before merge if access returns.

**Verdict:** NOT ready as written → all findings addressed in spec rev 2.

## Blocking
- **B1 — `endSec` absent from `MergedSection`; the section "m:ss–m:ss" range is unsatisfiable as specified.** `MergedSection` carries only `startSec` (`dig-merge.ts:26–33`); `mergeDigDoc` drops `timeRange.endSec` (`:86`). → **Fixed:** derive end from the next section's `startSec` at render time (render-local, no model/`dig-merge` change); nullable → "onward" phrasing for the last section. `buildSectionPrompt` takes `endSec: number | null`.
- **B2 — required `language` arg breaks 27 existing `renderDigDeeperDoc` test call sites + E2E** (`tsc` would fail day one). → **Fixed:** `language?` optional, default `'en'`.

## High
- **H1 — new zoom Esc handler collides with the expand-all dialog's `document` Esc (`nav.ts:304`).** → **Fixed:** zoom Esc early-returns unless the lightbox is open; no `stopPropagation`; additive-safe.
- **H2 — `.dg-zoom` z-index unspecified vs existing `9000` overlays.** → **Fixed:** `z-index:9500`.
- **H3 — "DOM/component test of inline script" implies a harness the repo lacks.** Inline scripts (`NAV_SCRIPT`) are never executed in jest — only string-asserted; interactive behavior runs only in Playwright E2E (`dig-deeper.spec.ts`). → **Fixed:** interactive behavior (zoom dismissal, Ask-AI clipboard/confirmation) → Playwright E2E; pure logic + render contract → jest. No jsdom eval of inline strings.

## Medium
- **M1 — image-rule branches + existing-test breakage.** The rule returns raw HTML directly so `class="dig-slide"` works; but only the success branch should get it (missing-slide `<span>`, containment-fail `''`, non-asset `<img>` unchanged), and the existing `.dug img{margin:2em 0}` test (`render-dig-deeper.test.ts:846–847`) breaks. → **Fixed:** four named branches; `.dg-slide`-specific CSS; test updated in-task.
- **M2 — `data-ai-prompt` vs `data-ai-url` encoding conflated.** → **Fixed:** `data-ai-prompt` = HTML-attr-escaped raw prompt (NO percent-encoding); `data-ai-url` = percent-encoded prompt inside URL; round-trip test (incl. Korean).
- **M3 — "instant/no version bump" claim.** Confirmed TRUE: dig-deeper serve branch renders fresh every GET (`route.ts:195`), no cache/version gate (unlike summary at `:87–91`). → Stated explicitly in spec.

## Low
- **L1 — `buildWholeVideoPrompt` duplicates `buildGeminiPrompt`.** → **Fixed:** `buildGeminiPrompt(video)` delegates to `buildWholeVideoPrompt(video.youtubeUrl, video.language)`.
- **L2 — third copy of the clipboard-confirm pattern** (React + inline JS + nav) — intentionally un-shared (browser can't import); acknowledged.
- **L3 — `max-height` has no acceptance criterion.** → Added a measurable-ish criterion in Risks.

## Cleared
- markdown-it `html:false` does NOT affect the image rule's returned raw HTML (it governs authored-HTML escaping only) — `class="dig-slide"` ships as written.
- `video.language` IS in scope at the serve route (`route.ts:49–53`, `z.enum(['en','ko'])`).
