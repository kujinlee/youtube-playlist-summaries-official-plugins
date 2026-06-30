# Dig sub-heading gold style — Claude code review

**Scope:** render-only CSS change to `.dg .dug h3` (dig section sub-heading). Branch `feat/dig-subheading-gold-style`.
**Change:** `font-size:.95rem→1.12rem`, `color:var(--ink)→var(--gold)`, `letter-spacing:.02em→.01em`. Test strengthened to assert size + gold color (was weight-only). No `DIG_GENERATOR_VERSION` bump (render-only, reaches all docs on next render).

**Verdict: Approved. 0 issues at any severity.**

## Why the change
Old style failed on two axes simultaneously: smaller than a real h3 (.95 vs 1.15rem) AND same color as prose (`--ink`) → read as bold prose, not a heading. Option C (user-selected from a 5-way rendered comparison, light+dark) moves off the prose color to `--gold` and bumps size above prose, keeping the sans-serif sub-label identity distinct from the serif `<h2>` section titles.

## Seam verification — all PASS
1. **Specificity** — selector unchanged; `.dg .dug h3` (0,2,1) still beats generic `.dg h3` (0,1,1). Only property values changed.
2. **Gold sharing** — `--gold` is also used by `.dg .lead` (render-dig-deeper.ts:36, weight **400**, section-top intro). Sub-heading is weight **700**, 1.12rem, mid-prose inside `.dug` → distinguishable by weight + position. Links use `--link` (:43), not gold. Same gold-for-emphasis language as the summary/deep-dive docs the user referenced.
3. **Print legibility** — theme.ts:71 `@media print` re-applies the LIGHT palette `${l}` to every theme state, so gold prints as `#b07700` on near-white card `#fbf9f6` — the identical gold `.lead` already prints in. No new print risk; no print rule recolors/hides h3.
4. **Dark mode** — gold `#e6b54d` on card `#221d18`: high contrast, verified in rendered dark screenshot.
5. **Orphan path** — orphan dug bodies wrapped in `.dug` (test :1072) → inherit the gold h3, consistent with matched path.
6. **PR1 collision** — figcaption is `.dig-cap`, untouched. No interaction.

## Test quality
Strengthened "distinct .dg .dug h3" test asserts `font-size:1.12rem` + `font-weight:700` + `color:var(--gold)` as **separate** per-property matches (`/\.dg \.dug h3\{[^}]*PROP/` — order-independent within the rule; no nested braces so `[^}]*` is safe) plus structural `<div class="dug">[\s\S]*<h3>` containment. Adequate. Confirmed RED before implement (failed on font-size assertion), GREEN after.

## Tests
render-dig-deeper 136/136; full suite 1510 pass + 1 known pdf.test.ts flake (passes isolated 18/18 — pre-existing, not a regression); tsc clean.

## Issues
None at any severity.
