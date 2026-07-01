# Automatic PDF Export for HTML Docs

**Date:** 2026-07-01
**Status:** Design v2 — revised after Codex adversarial review (`docs/reviews/plan-auto-pdf-export-codex.md`) and a successful Phase 0 chromium spike (this session). AFK — approval substituted by adversarial review.

**Deployment context:** This is a **local, single-user app run via `npm run dev`** on the user's Mac.
Several review findings assumed a pruned production/CI deploy; the fixes are still adopted, but the
runtime contract is "runs locally with dev tooling present."
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

1. **Engine: headless Chromium via Playwright** — add **`playwright`** to `dependencies` (import
   `{ chromium } from 'playwright'`; **never** `@playwright/test` in server code). Spike (this session)
   confirmed the `'playwright'` import resolves and works from Node. Render the exact self-contained doc
   HTML in a **locked-down context** (`javaScriptEnabled: false`, block all non-`data:` network), with
   `page.setContent(html, { waitUntil: 'load' })`, `page.emulateMedia({ media: 'print' })`, then
   `page.pdf({ printBackground: true, format: 'A4' })`. **Not** the old `md-to-pdf` — that renders from
   markdown and cannot reproduce the HTML doc's layout/slides. Chromium binary: rely on the installed
   Playwright browser (`npx playwright install chromium`); `generateDocPdf` surfaces a clear
   install-hint error if launch fails.
   **Spike-validated:** ~423ms/PDF, valid `%PDF-`, Hangul glyphs correct, `printBackground` colors,
   `@media print` hides controls, real base64 slide JPEG renders full-fidelity.
2. **Source HTML is reused, not re-implemented.** Extract the doc-HTML-building logic currently inline
   in `app/api/html/[id]/route.ts` into a shared `buildDocHtml(videoId, outputFolder, type)` returning a
   **domain result union** `{ ok: true; html: string } | { ok: false; reason: 'missing-html' |
   'missing-summary' | 'invalid-path' | 'unparseable' }`. The serve route and PDF route each map reasons
   → HTTP; the library carries no HTTP concerns. Guarantees PDF == on-screen doc.
3. **`page.setContent` (string), not `page.goto(localhost)`.** The doc HTML inlines images as base64
   and embeds CSS, so no network/server is needed — deterministic and testable.
4. **Pure export-to-disk. No index schema fields, no serve route.** The output is files in `pdfs/`.
   This is the deliberate anti-dead-code choice (see removal history). If "open saved PDF from the app"
   is wanted later, it is a separate, additive decision.
5. **Trigger: per-video menu items** in `components/VideoMenu.tsx`: **"Save summary PDF"** (enabled only
   when `summaryHtml` is present — the same state as the "HTML doc" open-link; the PDF presupposes the
   HTML doc has been generated) and **"Save dig-deeper PDF"** (enabled only when `digDeeperMd` exists).
   A `summaryMd`-only video (no `summaryHtml`) does **not** get the summary-PDF item — the user
   generates the HTML doc first (same as today). Mirrors the existing "HTML doc" / "Re-summarize" items.
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
  Lazy-import chromium; launch in a locked-down context (`javaScriptEnabled:false`, block non-`data:`
  network); `setContent` → `emulateMedia('print')` → `page.pdf` → **atomic write with a UUID temp file**
  (`.{base}.{crypto.randomUUID()}.pdf.tmp` in `pdfs/` → `fs.renameSync` to final; final overwrite =
  last-wins). Creates `pdfs/` (recursive). **Lifecycle:** `page.setDefaultTimeout` + overall job timeout;
  `try/finally` closes page and browser; temp file removed on any failure; clear install-hint error if
  chromium launch fails. An in-process single-flight (module-level promise chain) serializes launches as
  a *resource optimization only* — correctness never depends on it (UUID temp handles collisions).
- `lib/pdf/pdf-path.ts` (new) — pure `pdfRelPath(video, type): string` → `pdfs/{base}.pdf` /
  `pdfs/{base}-dig-deeper.pdf`, base derived the same way the serve route derives it. Uses the shared
  `assertIndexRelPathWithin` so a crafted `summaryMd`/`digDeeperMd` cannot escape `pdfs/`.
- `lib/paths/assert-within.ts` (new, shared) — `assertIndexRelPathWithin(outputFolder, rel, allowedExt?)`:
  throws `{ statusCode: 400 }` if `path.resolve(outputFolder, rel)` is not within `outputFolder` (or, when
  `allowedExt` given, has the wrong extension). Applied before every index-derived read in `buildDocHtml`
  and `reRenderSummaryHtml`, and in `pdfRelPath`. Hardens the existing serve route too.
- `app/api/videos/[id]/pdf/route.ts` (new) — POST, returns `{ jobId }`, runs generation with SSE progress.
- `app/api/videos/[id]/pdf/stream/route.ts` (new) — SSE stream (mirror of html-doc/stream).
- `components/PdfStatusBar.tsx` (new) — non-blocking bottom bar; its own component (NOT a literal
  `HtmlDocStatusBar` clone — no view link). On `done` shows `Saved pdfs/<file>` (no anchor); on `error`
  shows `PDF failed — <reason>`; ✕ + auto-dismiss.
- `components/VideoMenu.tsx`, `app/page.tsx` — wire the two menu items + handler + status bar state.
- `next.config.ts` — add `serverExternalPackages: ['playwright']` so the browser driver is not bundled by
  the Next server build. (Next's built-in external list already covers `playwright`; making it explicit
  is belt-and-suspenders. Server code imports from `'playwright'`, never `@playwright/test`.)
- `package.json` — move/add **`playwright`** to `dependencies` (runtime), keep `@playwright/test` in
  `devDependencies` (E2E only).

## Output File Format

- **Folder:** `{outputFolder}/pdfs/` (created on demand, `recursive: true`).
- **Filename (summary):** `{base}.pdf` where `base` = summary markdown filename without `.md`
  (includes the `NNN_` serial prefix), e.g. `275_google-okf.pdf`.
- **Filename (dig-deeper):** `{base}-dig-deeper.pdf`, e.g. `275_google-okf-dig-deeper.pdf`.
- **Write:** atomic — write to a **UUID temp** `pdfs/.{base}.{uuid}.pdf.tmp` then `fs.renameSync` to
  final (matching `htmls/` generator's UUID-temp pattern). Overwrite on re-run (latest render wins). Temp
  removed on failure.
- **Content:** A4, `printBackground: true`, print media emulated (🖨️/theme/zoom controls hidden by the
  docs' existing `@media print` rules).

### Retention (explicit — avoids repeating the PR #50 orphan problem)

PDFs are **user-managed exports** (like a Downloads folder), deliberately not tracked in the index and
not served by any route — so there is no stale reference that can silently rot (the PR #50 failure mode).
Regenerating overwrites the same-base file (last-wins). If the source markdown is later renamed
(new `NNN_` serial), the old-base PDF is left on disk as a stale artifact the user may delete; the app
does not auto-clean it. This is a conscious trade: no hidden index coupling, at the cost of manual
housekeeping — acceptable for a personal export folder.

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
| 11b | Menu: summary item disabled | video with summaryMd but no summaryHtml | "Save summary PDF" hidden/disabled (PDF presupposes HTML doc) |
| 12 | PDF write path containment | crafted base/summaryMd/digDeeperMd | resolved pdf path within `{outputFolder}/pdfs`; else 400, no write |
| 12b | Source read containment | crafted summaryMd/summaryHtml/digDeeperMd | index-derived reads rejected via `assertIndexRelPathWithin`; tested per-field |
| 13 | Concurrency safety | two PDF jobs same doc | UUID temp → no corruption; final overwrite last-wins (single-flight is opt-only) |
| 13b | Chromium launch failure | browser not installed | clear error surfaced ("run npx playwright install chromium"); temp cleaned; SSE error |
| 13c | Render/pdf hang | stuck page | job timeout fires; page+browser closed in finally; SSE error |
| 14 | Korean glyphs | KO doc | PDF contains legible Hangul (spike-validated) |
| 15 | Print CSS applied | any doc | 🖨️/theme/zoom controls absent from PDF (print media); JS disabled, render still correct |
| 16 | Stale PDF after source rename | source md re-serialized | old-base PDF remains (user-managed); no crash, no auto-clean |

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
