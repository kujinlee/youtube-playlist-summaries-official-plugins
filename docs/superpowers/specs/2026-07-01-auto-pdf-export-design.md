# Automatic PDF Export for HTML Docs

**Date:** 2026-07-01
**Status:** Design (AFK — decisions assumed; validated by adversarial review in lieu of live approval)
**Depends on prior context:** PDF generation was removed in PR #50 (`2026-06-30-pdf-removal-design.md`)
because it had become orphaned dead code (server-side `md-to-pdf` during ingest, tracked in the index,
served by a stale `/api/pdf` route). This feature reintroduces PDF **on purpose and minimally**, and
is explicitly designed to avoid the failure mode that caused the removal.

---

## Problem

Producing a PDF of a document today is manual: the reader opens the summary or dig-deeper **HTML doc**,
clicks the 🖨️ Print button (`window.print()`), then in the browser's print dialog chooses "Save as PDF"
and picks a destination folder every time. There is no way to *collect* a folder of self-contained,
printer-ready PDFs without repeating that manual dance per document.

## Goal

Add a button that, in one click, **automatically generates a PDF of a doc's HTML rendering and saves
it to a dedicated `pdfs/` folder** — no print dialog, no folder picker. The PDF must look like the
on-screen HTML doc (magazine layout, slide crops, timestamps, print CSS applied) and be fully
self-contained. Works for both the **summary HTML doc** and the **dig-deeper HTML doc**.

## Decisions (AFK-assumed — flagged for adversarial review)

1. **Engine: headless Chromium via Playwright** (already a dependency, `@playwright/test ^1.60`,
   chromium browsers present in `~/Library/Caches/ms-playwright/`). Render the exact self-contained
   doc HTML with `page.setContent(html, { waitUntil: 'load' })`, `page.emulateMedia({ media: 'print' })`,
   then `page.pdf({ printBackground: true, format: 'A4' })`. **Not** the old `md-to-pdf` — that renders
   from markdown and cannot reproduce the HTML doc's layout/slides.
2. **Source HTML is reused, not re-implemented.** Extract the doc-HTML-building logic currently inline
   in `app/api/html/[id]/route.ts` into a shared `buildDocHtml(videoId, outputFolder, type)` and have
   both the serve route and the PDF generator call it. Guarantees PDF == on-screen doc.
3. **`page.setContent` (string), not `page.goto(localhost)`.** The doc HTML inlines images as base64
   and embeds CSS, so no network/server is needed — deterministic and testable.
4. **Pure export-to-disk. No index schema fields, no serve route.** The output is files in `pdfs/`.
   This is the deliberate anti-dead-code choice (see removal history). If "open saved PDF from the app"
   is wanted later, it is a separate, additive decision.
5. **Trigger: per-video menu items** in `components/VideoMenu.tsx`: **"Save summary PDF"** (enabled when
   `summaryHtml`/`summaryMd` exists) and **"Save dig-deeper PDF"** (enabled only when `digDeeperMd`
   exists). Mirrors the existing "HTML doc" / "Re-summarize" items.
6. **Non-blocking UX.** A bottom status bar (reusing the `HtmlDocStatusBar` idiom) shows
   "Saving PDF — <title>…" then "Saved pdfs/<file>" and auto-dismisses. The reader can keep working.
7. **Button-triggered only — no auto-generation at ingest.** (Auto-gen at ingest is what created 287
   orphans.) PDFs are produced on demand.
8. **Batch ("save PDFs for many videos") is deferred** to a possible Phase B, mirroring the batch-docs
   2-phase rollout. Phase A = per-video.

## Non-Goals

- No `/api/pdf` serve route; no `summaryPdf`/`deepDivePdf` index fields.
- No auto-generation during ingestion.
- No change to the existing 🖨️ Print button (it stays as the manual fallback).
- No batch mode in this phase.

## Architecture

```
components/VideoMenu.tsx  ──(click "Save summary PDF" / "Save dig-deeper PDF")──▶
  page.tsx handler  ──POST /api/videos/[id]/pdf { outputFolder, type }──▶
    app/api/videos/[id]/pdf/route.ts
      → buildDocHtml(videoId, outputFolder, type)     [shared with serve route]
      → generateDocPdf(html, absPdfPath)              [lib/pdf/generate-doc-pdf.ts, Playwright]
      → atomic write to {outputFolder}/pdfs/{base}.pdf
      → SSE progress via existing job-registry
  components/PdfStatusBar.tsx  ◀──SSE── /api/videos/[id]/pdf/stream?jobId=…
```

**New/changed units**
- `lib/html-doc/build-doc-html.ts` (new) — `buildDocHtml(videoId, outputFolder, type): Promise<string | { error, status }>`.
  Extracted verbatim from the serve route's summary + dig-deeper branches. Serve route refactored to call it.
- `lib/pdf/generate-doc-pdf.ts` (new) — `generateDocPdf(html: string, absOutPath: string): Promise<void>`.
  Launches chromium (serialized via a single shared browser or a mutex to avoid concurrent-launch cost),
  `setContent` → print media → `page.pdf` → atomic write (temp in same dir → rename). Creates `pdfs/`.
- `lib/pdf/pdf-path.ts` (new) — pure `pdfRelPath(video, type): string` → `pdfs/{base}.pdf` /
  `pdfs/{base}-dig-deeper.pdf`, base derived the same way the serve route derives it.
- `app/api/videos/[id]/pdf/route.ts` (new) — POST, returns `{ jobId }`, runs generation with SSE progress.
- `app/api/videos/[id]/pdf/stream/route.ts` (new) — SSE stream (mirror of html-doc/stream).
- `components/PdfStatusBar.tsx` (new) — non-blocking bottom bar (clone of `HtmlDocStatusBar`).
- `components/VideoMenu.tsx`, `app/page.tsx` — wire the two menu items + handler + status bar state.
- `next.config.ts` — add `serverExternalPackages: ['playwright-core']` (or `'@playwright/test'`) so the
  browser driver is not bundled by the Next server build. (Spike confirms exact package.)

## Output File Format

- **Folder:** `{outputFolder}/pdfs/` (created on demand, `recursive: true`).
- **Filename (summary):** `{base}.pdf` where `base` = summary markdown filename without `.md`
  (includes the `NNN_` serial prefix), e.g. `275_google-okf.pdf`.
- **Filename (dig-deeper):** `{base}-dig-deeper.pdf`, e.g. `275_google-okf-dig-deeper.pdf`.
- **Write:** atomic — write to `pdfs/.{base}.pdf.tmp` then `fs.renameSync` to final. Overwrite on re-run
  (latest render wins), matching how `htmls/` is written.
- **Content:** A4, `printBackground: true`, print media emulated (🖨️/theme/zoom controls hidden by the
  docs' existing `@media print` rules).

## Async-Operation UX (per dev-process gate)

- **Blocking or non-blocking?** Non-blocking. Generation takes ~1–4s (chromium launch + render); the
  reader can keep browsing the list. A full-screen overlay is not justified.
- **What the user sees while it runs:** bottom status bar `Saving PDF — <title>…`.
- **Dismissal:** auto-dismiss on done (after showing `Saved pdfs/<file>` briefly) or on error
  (`PDF failed — <reason>`); plus a manual ✕.

### Overlay Dismissal

| Component | Mechanism | Expected result |
|---|---|---|
| PdfStatusBar | ✕ button | bar hides; in-flight job continues server-side (fire-and-forget, like HtmlDocStatusBar) |
| PdfStatusBar | auto on `done` | shows "Saved pdfs/<file>" ~2.5s then hides |
| PdfStatusBar | auto on `error` | shows "PDF failed — <reason>" ~5s then hides |

### URL Contracts

No user-visible links are generated (the actions are POSTs). The only URLs are internal fetch targets:

| Caller | Method | Full URL |
|---|---|---|
| page.tsx handler | POST | `/api/videos/[id]/pdf` (body `{ outputFolder, type }`) |
| PdfStatusBar | GET (SSE) | `/api/videos/[id]/pdf/stream?jobId=<uuid>` |

## Enumerated Behaviors (contract for tests)

| # | Behavior | Trigger | Expected |
|---|---|---|---|
| 1 | Summary PDF path | `pdfRelPath(video,'summary')` | `pdfs/{summaryMd-base}.pdf` |
| 2 | Dig-deeper PDF path | `pdfRelPath(video,'dig-deeper')` | `pdfs/{base}-dig-deeper.pdf` (base from digDeeperMd, stripping `-dig-deeper.md`) |
| 3 | pdfs/ created if missing | generate into fresh folder | folder created; file written |
| 4 | Atomic write | generate | temp file renamed to final; no partial file on failure |
| 5 | Overwrite on re-run | generate twice | second run replaces first; one final file |
| 6 | buildDocHtml summary | type=summary | same HTML the serve route returns for summary (version-aware re-render honored) |
| 7 | buildDocHtml dig-deeper | type=dig-deeper | same HTML the serve route returns for dig-deeper (skeleton when nothing dug) |
| 8 | buildDocHtml refactor parity | serve route | serve route output byte-identical to pre-refactor (regression) |
| 9 | POST returns jobId | POST /pdf | `{ jobId }`; 400 on missing outputFolder / invalid id / bad type |
| 10 | SSE progress | during gen | emits start → (step) → done{file} or error{reason} |
| 11 | Menu: dig-deeper item disabled | video with no digDeeperMd | "Save dig-deeper PDF" hidden/disabled |
| 12 | Path containment | crafted base | resolved pdf path must be within `{outputFolder}/pdfs`; else 400, no write |
| 13 | Concurrency | two PDF jobs | serialized (shared browser/mutex); no chromium port clash |
| 14 | Korean glyphs | KO doc | PDF contains legible Hangul (spike-validated) |
| 15 | Print CSS applied | any doc | 🖨️/theme/zoom controls absent from PDF (print media) |

## Testing Strategy

- **Unit (jest):** `pdf-path.ts` (behaviors 1–2), `build-doc-html.ts` (6–7; 8 as a golden/regression
  against current serve output). `generate-doc-pdf.ts` — mock Playwright at the module boundary to
  assert setContent/emulateMedia/pdf/atomic-write ordering (behaviors 3–5,12) without launching a browser.
- **Route (jest):** POST validation + jobId + SSE event shape with the generator mocked (9–10).
- **Component (RTL):** VideoMenu item enable/disable (11); PdfStatusBar states + dismissal.
- **E2E (playwright):** menu click → status bar → done, with the PDF generator stubbed at the route.
- **Phase 0 spike (real chromium, not committed as a test):** prove `generateDocPdf` renders a
  self-contained sample doc (with Hangul + a base64 image) to a valid non-empty PDF with correct
  glyphs and hidden controls (behaviors 14–15). This gates the rest of the plan.

## Risks

- **Playwright in the production server path.** Mitigate: `serverExternalPackages`; lazy-import chromium
  only inside `generateDocPdf`; serialize launches. Spike confirms it runs under `next dev`/`next start`.
- **CJK fonts in headless chromium.** macOS chromium can use system CJK fonts, but headless font config
  can differ. Spike validates Hangul; if broken, embed a webfont (`@font-face` base64) in a print-only
  style injected before `pdf()`.
- **Cold-launch latency / memory.** ~1–4s per PDF; acceptable for a local single-user app. A shared
  browser instance kept warm is an optional optimization (deferred unless the spike shows it's needed).
- **buildDocHtml refactor regression.** Guard with a byte-parity golden test (behavior 8) before adding
  the PDF path.
- **Reintroducing dead code.** Explicitly mitigated by no serve route / no schema fields (goal #4/#7).
