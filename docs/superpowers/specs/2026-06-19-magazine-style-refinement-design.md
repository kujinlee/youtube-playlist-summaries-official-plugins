# Magazine Style Refinement — Design Spec (Backlog Bundle A)

**Date:** 2026-06-19 · **Branch:** feat/magazine-style-refinement (stacked on PR #3 / feat/summary-deepdive-quality)
**Process (right-sized, user-approved):** short spec → TDD implementation + Claude code review. **Codex adversarial review skipped** — pure style/markup change, no logic or security surface.
**Visual contract:** `prototype-darkmode/magazine-style-variants.html` (user picked **L3 lead + B1 bullets**).

## Problem (backlog #6, #7, #5)

The magazine summary's gold "lead" line is over-emphasized (bold + larger + saturated gold) and competes with the section title; the bold `Label:` prefix on every bullet is redundant with the (now fuller) sentence and adds a competing black anchor per line.

## Decisions

### #6 — Lead prominence (shared: summary + deep-dive)
The gold lead drops to **regular weight, slightly smaller**, keeping the gold color as the sole "supplement" signal so the title clearly leads.
- `render.ts` `.lead`: `font-weight: 600 → 400`, `font-size: 1.12rem → 1.02rem` (color unchanged: `var(--gold)`).
- `render-deep-dive.ts` `.dd h2 + p`: same change (`font-weight: 600 → 400`, `font-size: 1.12rem → 1.02rem`) — keeps the two artifacts visually consistent.

### #7 — Drop bullet labels (summary, render-only)
Render only the bullet sentence; drop the `<strong>${label}:</strong> ` prefix.
- `render.ts`: `<li><strong>${esc(b.label)}:</strong> ${esc(b.text)}</li>` → `<li>${esc(b.text)}</li>`.
- **No prompt/schema change.** `generateMagazineModel` still emits `{label, text}`; `label` is now unused (vestigial, harmless). The fuller `text` from the prior quality pass already reads as a complete sentence, so plain bullets stand on their own.
- **Follow-up (not now):** a later cleanup may drop `label` from the prompt + `MagazineModelSchema` (touches cached `models/*.json` compatibility — out of scope for this style pass).

### #5 — Palette dedup (opportunistic)
Extract the shared 11-key magazine palette (`page, card, ink, meta, rule, ghost, gold, goldline, li, foot, shadow`) into a `BASE_PALETTE` in `theme.ts`; both `render.ts` and `render-deep-dive.ts` build their `LIGHT`/`DARK` by spreading it (+ deep-dive's extra `link, h3, h4, codebg, preborder, quote`). **Must emit byte-identical CSS** — the exhaustive palette tests are the safety net.

### Rollout — MINOR docVersion bump {3,0} → {3,1}
The summary serve route serves the **stored** `summaryHtml` file; it does not re-render on view. So this style change reaches existing summaries only through the version-aware path: bump `CURRENT_DOC_VERSION` to **{3,1}** (a MINOR/render change), so an existing `{3,0}` summary is minor-stale → `ensureHtmlDoc` runs the **cheap re-render** (`reRenderSummaryHtml` from the cached magazine model, no Gemini) under the new CSS/markup. (`{1,0}`/`{2,0}` docs are major-stale and re-summarize as before.) This is the correct, consistent rollout — exactly the version-aware mechanism, applied to a style change.
- **Deep-dive** has no `docVersion` yet (backlog #1), so its lead change cannot auto-roll-out — it applies on the deep-dive's next render/regeneration. Acceptable: #1 will close this gap.

## Test impacts
- `tests/lib/html-doc/render-deep-dive.test.ts` — update the `.dd h2 + p` lead-rule assertion (weight/size); palette assertions stay green if dedup is byte-identical.
- `tests/lib/html-doc/render.test.ts` — update/loosen any assertion that checks the `<strong>` label markup in bullets; assert the plain `${text}` bullet.
- `tests/e2e/darkmode-html.spec.ts` — re-confirm; no value change expected (lead color unchanged).

## Test impacts (additions for rollout)
- `tests/lib/doc-version.test.ts` — `CURRENT_DOC_VERSION` expectation `{3,0}` → `{3,1}`.
- `tests/lib/html-doc/ensure.test.ts` — confirm a `{3,0}` stored doc is now minor-stale → `reRenderSummaryHtml` (not re-summarize); update any fixture that used `{3,0}` to mean "current/up-to-date" → `{3,1}`.

## Non-goals
- No inline bullet emphasis (B1 chosen, not B2/B3/B4) → no `generateMagazineModel` prompt change.
- No schema change, no cache migration (`label` stays in the model, unused).
- No deep-dive `docVersion` (that is backlog #1) — the deep-dive lead change applies on its next render/regeneration only.
