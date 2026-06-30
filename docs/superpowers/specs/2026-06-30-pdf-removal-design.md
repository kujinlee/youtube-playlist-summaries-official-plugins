# PDF Removal — Design Spec

**Date:** 2026-06-30
**Status:** Approved
**Branch:** `feat/remove-pdf-generation`

## Decision

PDFs are now produced by the reader's browser from the HTML doc (Save-as-PDF or print
via the 🖨️ Print button). Server-side PDF generation was already dead code; this effort
removes **all** residual PDF infrastructure — files, dead generator, serve route, and the
`summaryPdf`/`deepDivePdf` schema fields. Scope chosen: **full removal** (not a vestigial
null-field keep).

## Ground-truth facts (verified 2026-06-30)

- **287 orphaned PDF files** across 5 `pdfs/` dirs. Every `summaryPdf`/`deepDivePdf` value
  in all 3 playlist indexes is already `null` (0 non-null) — nothing references these files.
- The `app/api/pdf/[id]` serve route and the e2e "View Summary PDF" test are **already stale**:
  the menu stopped rendering PDF links in commit `63ea1d9`. No live UI links to PDFs.
- Components (`VideoMenu`/`VideoRow`/`VideoList` `.tsx`) do **not** reference the fields —
  only test fixtures do.
- `lib/pdf.ts` (`generatePdf`) is defined + tested but called by nothing in production.

## Work

### 1. Delete on-disk PDFs (irreversible)
Remove all 5 `pdfs/` directories (287 files, ~29 MB) in the data repo:
- `agentic-ai-claude-code/raw/pdfs`, `agentic-ai-claude-code/raw/archived/pdfs`
- `cs146s-the-modern-software-development/raw/pdfs`
- `건강/raw/pdfs`, `건강/raw/archived/pdfs`  ← **not git-tracked; not recoverable.** Approved.

Safe: no index entry references any PDF.

### 2. Remove dead generator + serve route + dependency
- Delete `lib/pdf.ts`, `tests/lib/pdf.test.ts`
- Delete `app/api/pdf/[id]/route.ts` (+ empty `[id]` dir), `tests/api/pdf.test.ts`
- Remove `md-to-pdf` from `package.json`; refresh lockfile
- `next.config.ts`: drop `serverExternalPackages: ['md-to-pdf']` + comment
- `jest.config.ts`: verify suite exits cleanly without md-to-pdf's Puppeteer handle.
  Keep `forceExit` if still needed (other async handles); update the stale comment either way.

### 3. Remove `summaryPdf` / `deepDivePdf` schema fields
- `types/index.ts`: delete both field lines
- `lib/pipeline.ts`: remove `pdfFilename`/`pdfPath`/`summaryPdf` computation (146–148);
  drop both keys from returned objects (162–164, 335–337)
- `lib/archive.ts`: drop both from the `getFilePairs` loop (line 20)
- `lib/serial-migrate.ts`: remove `'summaryPdf'`, `'deepDivePdf'` from `PATH_FIELDS`
- `scripts/migrate-pdfs-to-subfolder.ts` (+ `tests/lib/migrate-pdfs-to-subfolder.test.ts`):
  **delete** — spent one-time migration whose only job was moving PDFs. Approved.
- `scripts/fix-duplicate-summaries.ts`: trim `summaryPdf` handling; keep `summaryMd` logic

### 4. Test updates (~40 files)
- **Delete:** `tests/lib/pdf.test.ts`, `tests/api/pdf.test.ts`,
  `tests/lib/migrate-pdfs-to-subfolder.test.ts`, the stale e2e "View Summary PDF" test
  (`tests/e2e/playlist-viewer.spec.ts` Behavior 8)
- **Adjust assertions:** `tests/api/backfill.test.ts`, `tests/api/regenerate.test.ts`
  (drop PDF-not-called assertions/fixtures), `tests/lib/pipeline.test.ts`
  (the two "sets summaryPdf…" cases ~1029–1040), `tests/lib/serial-migrate.test.ts`,
  `tests/lib/serial-invariant.test.ts` (drop PDF rename expectations),
  `tests/lib/archive.test.ts` (drop summaryPdf-move case)
- **Fixture-only churn:** ~30 files drop the two object keys

### 5. Data migration
**None.** Zod is non-strict → the now-unknown keys are dropped from `index.json` on next write;
existing `null`s are harmless. (YAGNI — no migration script.)

## Verification
- `npm test` (full serial suite) green
- `tsc --noEmit` clean
- jest exits cleanly (forceExit decision settled)
- App boots; menu has no PDF item; HTML-doc 🖨️ Print still works

## Out of scope
- The HTML-doc Print button itself (already shipped, unchanged)
- Any change to summary/deep-dive/dig generation
