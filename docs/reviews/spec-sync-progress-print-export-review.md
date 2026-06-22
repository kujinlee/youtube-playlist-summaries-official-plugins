# Adversarial Spec Review — sync-progress-print-export

**NOTE: Codex at usage limit (until Jul 18 2026); Claude adversarial review in its place per
docs/plugins.md. Re-attempt Codex before merge if access returns.**

Verdict: sound to plan against WITH fixes below (all applied to the spec).

## Blocking
- **B1** Spec oversold "existing docs re-render": the serve route does NO version check and never
  self-heals. Re-render is menu-click-gated, per-doc, and overwrites the cached HTML only via
  `ensureHtmlDoc`/`ensureDeepDiveHtml`. → Reworded; serve-route auto-refresh explicitly out of scope
  (the menu button appearing is what resolves the user's "can't regenerate" complaint).
- **B2** (a) `'step'` `current`/`total` are `int().positive()` → 0 illegal; steps are emitted ONLY for new
  videos so both are ≥1 (made explicit). (b) `runIngestion` does NOT track `succeeded`/`failed` today →
  dropped them from the `done` plan; `done` stays `{type:'done', total: newTotal}`.

## High (tsc/lint fallout from PDF removal — the project gates on `tsc --noEmit`)
- **H1** Keep `SummaryDocResult.mdContent` field (still built for the `.md` write); only drop it from the
  ingest-loop destructure.
- **H2** regenerate.test.ts: keep `jest.mock('../../lib/pdf')` + assert `not.toHaveBeenCalled()` (binding
  stays used).
- **H3** backfill: remove ALL of — `generatePdf` import, the `if (video.summaryPdf){…pdfTasks.push…}`
  block, the `pdfTasks` array, `await Promise.all(pdfTasks)`, `pdfFailed`, the `(PDF only)` error emit; and
  simplify the `done.failed` to just `failed`. Repurpose the test to assert `generatePdf` never called.

## Medium
- **M1** Add a stored-data behavior row: new video at playlist position 200, 3rd new item → stored
  `playlistIndex === 200`, progress shows `3 of N`. (Guards against mechanically renaming `current`→`newIndex`
  and corrupting `playlistIndex`.)
- **M2** Remove the now-unused `const total = metas.length`; inline `metas.length` at the loop bound.
- **M3** `IDLE_INGEST` must initialize the new `current:0, total:0, title:''` fields so reset paths clear
  the title line.
- **M4** Add `#print-btn` to the `themeStyleBlock` print rule (theme.ts) — covers BOTH renderers since both
  embed `themeStyleBlock`; the deep-dive structural print rule is redundant but harmless.

## Low
- **L1** `tests/lib/pdf.test.ts` stays unchanged (lib/pdf.ts dormant).
- **L2** VideoMenu.test.tsx: invert the "View … PDF" assertions to absence.
- **L3** HTML `<meta generator>` not version-stamped — fine (version lives in the index); reinforces B1 root cause.
