# Adversarial Plan Review — sync-progress-print-export

**NOTE: Codex at usage limit (until Jul 18 2026); Claude adversarial review in its place per
docs/plugins.md. Re-attempt Codex before merge if access returns.**

Verdict: plan-ready-with-fixes (all applied).

## Blocking (applied)
- **B1** Task 4 print-CSS test regex `/@media print\{[^}]*#print-btn[^}]*display:none/` never matches —
  `[^}]*` stops at the first `}` (after the palette vars), before `#print-btn`. → Replaced with a literal
  substring assertion `toContain('#theme-toggle,#print-btn{display:none}')` in render.test + render-deep-dive.
- **B2** Task 4 CSS change breaks EXISTING `theme.test.ts` assertions: `:33` (`'#theme-toggle{'`) and `:48`
  (`'#theme-toggle{display:none}'`). → Added a Task 4 sub-step to update them to the `#theme-toggle,#print-btn`
  forms.
- **B3** Making `IngestState.current/total/title` required breaks three other `setIngest({...})` literals
  (`app/page.tsx:162` start, `:178` POST-error, `:228` connection-lost) under `tsc`. → Task 2 now updates all
  three with `current:0,total:0,title:''`.

## High (applied)
- **H1** `setSyncNote('')` clear-on-start location pinned to `app/page.tsx:162` (in `handleIngest`, immediately
  before the `status:'running'` setIngest).

## Medium / Low (confirmations, no change needed)
- M1 Task 1 header line range "316–355" is loose but the code snippets anchor exactly; Task 2 line refs accurate.
- M2 within-run dedup + reconcile tail + cancel check unaffected by the counter change (verified).
- M3 `'step'` positive constraint satisfied (steps only for new videos ≥1); `title` is on the step variant.
- L1 regenerate/backfill/VideoMenu/version line numbers + unused-local analysis verified; `disabledClass`
  stays used; `pdfBase` correctly removed; named test files all exist.
- L2 No existing test asserts the 'Generating PDF…' step; only `pipeline.test.ts` summaryPdf literals (~208,228)
  need flipping to null; the writeSummaryDoc test already asserts not-called.
