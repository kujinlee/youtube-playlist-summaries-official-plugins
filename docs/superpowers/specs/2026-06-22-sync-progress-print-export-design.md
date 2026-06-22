# Sync Progress, Print Export, and Doc-Version Refresh

**Date:** 2026-06-22
**Branch:** `feat/sync-progress-print-export`
**Status:** Design — approved for planning (user authorized autonomous progression through adversarial-review gates)

## Problem

Three related Sync/doc-UX issues:

1. **Sync progress is uninformative.** When a playlist sync summarizes new items, the status bar shows only a
   percentage + a step label. The user can't tell how many new items remain. The percentage is also
   misleading: it's computed over the *entire* playlist (e.g. 253 videos), so a sync of a few new items
   crawls at ~1% while the loop fast-skips already-summarized videos.

2. **Server-side PDF generation is no longer wanted.** Every ingested video runs `generatePdf`
   (md-to-pdf / Puppeteer) — a slow step (the "Generating PDF…" the user saw). Instead, the self-contained
   HTML docs (which already have full `@media print` CSS) should expose a **Print** button so the user can
   print or save-as-PDF from the browser on demand.

3. **New doc styles don't reach existing docs.** PR #12 changed both renderers (summary meta-line URL link;
   deep-dive trailing-muted timestamps + first-sentence gold) but bumped neither doc version. Existing docs
   are therefore treated as "current" and never re-render. The serve route serves cached HTML with no
   version check; the only regeneration gate is the menu's version comparison. Both versions must bump so
   that each existing doc **shows as needing update in the menu** — clicking the menu entry re-renders that
   one doc (cheaply, no Gemini) and it picks up the new styles + Print button.

   **Important (verified):** the bump does NOT silently refresh docs. The serve route
   (`app/api/html/[id]/route.ts`) does no version check — it serves the cached `htmls/<base>.html`
   verbatim. Re-render is **menu-click-gated, one doc at a time**, via `ensureHtmlDoc` /
   `ensureDeepDiveHtml`, which overwrite the cached HTML and re-stamp the version. Opening an already-cached
   doc directly (not through the menu's regenerate button) will not refresh it. Auto-refresh-on-serve is
   **out of scope** — the menu button appearing is what resolves the "can't regenerate" complaint (today the
   menu shows the deep-dive as a plain link with no regenerate path because the version isn't stale).

These interlock: issues 1 & 2 both edit the ingest loop in `lib/pipeline.ts`; issues 2 & 3 are both render
changes that share one minor version bump per doc type. One spec, one plan.

## Decisions (locked with user)

| # | Decision |
|---|----------|
| 1 | Sync status shows **new-items progress**: `New video <n> of <N> · <step>` + the current video **title** on a second line. Counter and percentage are over **new/changed items only**, not the whole playlist. |
| 2 | **Stop generating PDFs** (ingest + regenerate + backfill); **remove the "View … PDF" menu items**; add a **Print** button to both HTML docs. Leave the `/api/pdf` route, the `summaryPdf`/`deepDivePdf` index fields, `lib/pdf.ts`, and existing `.pdf` files **dormant** (no deletion, no schema migration). |
| 3 | Bump **both** doc versions by a **minor**: summary `{3,2}→{3,3}`, deep-dive `{2,0}→{2,1}`. Minor → cheap re-render from existing `.md`/model on demand; no Gemini, no `.md` change. |

## Design

### Change 1 — New-items Sync progress

**`types/index.ts` — `ProgressEvent`:** no schema change needed. `current`/`total`/`title`/`step` already
exist on the `'step'` variant. We change their *semantics* (counter is now new-items based) and start
populating the UI from `title`.

**`lib/pipeline.ts` — `runIngestion` loop (~lines 286–362):**
- Before the loop, compute the new-items total over distinct, not-yet-indexed IDs:
  ```ts
  const newTotal = new Set(metas.filter((m) => !alreadyIndexed.has(m.videoId)).map((m) => m.videoId)).size;
  let newIndex = 0;
  ```
- `onProgress({ type: 'start', total: newTotal })` (was the full playlist `total`). `start.total` is
  `nonnegative`, so `0` is legal here.
- **Remove the now-unused `const total = metas.length`** (M2): it was used only by the old `start`/`done`
  emits; inline `metas.length` at the loop bound (`i < metas.length`).
- **Separate the two meanings of `i + 1`:** keep a `playlistPos = i + 1` used **only** for the stored
  `playlistIndex` field (line 339) — do NOT use the new counter there (that would corrupt stored playlist
  position). The progress `current`/`total` come from `newIndex`/`newTotal`.
- **Skipped (already-indexed) videos:** remove the per-skip `'step'` emit entirely (skips are instant set
  lookups; emitting them is what made the bar crawl). Just `continue`.
- **New video:** increment `newIndex` once when starting the video; every `'step'` for that video carries
  `current: newIndex, total: newTotal` and `title: meta.title`. Because steps are emitted **only for new
  videos**, `newIndex ≥ 1` and `newTotal ≥ 1` whenever a `'step'` fires — satisfying the schema's
  `int().positive()` on `step.current`/`step.total` (B2). Steps after PDF removal:
  `Fetching transcript…` → `Generating summary…` → `Saved`.
- `onProgress({ type: 'done', total: newTotal })` — keep the existing `done` shape (just change the value
  to `newTotal`). **Do NOT add `succeeded`/`failed`** — `runIngestion` does not track them today and the UI
  does not consume them (B2).
- **`newTotal === 0`:** the loop emits no per-video steps; `done` fires with `total: 0` (`done.total` is
  `nonnegative`). UI renders an "already up to date — no new videos" message (see below).

**`app/page.tsx` — ingest progress UI (~lines 15–22, 198–201, 425–460):**
- `IngestState` gains `title: string`, `current: number`, `total: number` fields. **`IDLE_INGEST` must
  initialize them** (`current: 0, total: 0, title: ''`) so the done/cancelled/error reset paths clear the
  title line (M3).
- On a `'step'` event: `progress = total>0 ? round(current/total*100) : 0`; `step = data.step`;
  `title = data.title ?? ''`; store `current`/`total` from the event so the UI can render the count.
- Render two lines under the bar:
  - line 1: `New video {current} of {total} · {step}` (when `total>0`);
  - line 2: the `title` (omitted when empty).
- On `'done'` with `total === 0` (or no steps seen): show `Sync complete — no new videos.`
- The blue bar width stays `${progress}%`; percentage label stays.

### Change 2 — Drop PDF generation, add Print button

**Stop generating (3 call sites):**
- `lib/pipeline.ts`: remove the `pdfs/` mkdir, `pdfPath`, the `'Generating PDF…'` step, and the
  `await generatePdf(...)` call. The new `Video` record sets `summaryPdf: null` (was `pdfs/<base>.pdf`).
  Remove the now-unused `mdContent` from the **ingest-loop destructure** and the `generatePdf` import.
  **Keep `SummaryDocResult.mdContent`** on the interface/return — `writeSummaryDoc` still builds `mdContent`
  to write the `.md`; only the unused local destructure is removed (H1). `tsc --noEmit` (project gate) will
  flag any leftover unused locals — none must remain.
- `app/api/videos/[id]/regenerate/route.ts`: remove the `generatePdf` import and the background
  `if (video.summaryPdf) generatePdf(...)` block. (It is fire-and-forget — no response/ordering impact.)
- `app/api/quick-view/backfill/route.ts`: remove **all** PDF surface (H3): the `generatePdf` import, the
  `if (video.summaryPdf) { … pdfTasks.push … }` block, the `pdfTasks` array, the `await Promise.all(pdfTasks)`,
  the `pdfFailed` counter and its `(PDF only)` error emit, and simplify the final `done.failed` from
  `failed + pdfFailed` to just `failed`. No unused locals may remain.

**Remove PDF menu items — `components/VideoMenu.tsx`:** delete `hasSummaryPdf`, `hasDeepDivePdf`, `pdfBase`,
and the "View Summary PDF" / "View Deep Dive PDF" menu entries. No other menu items change.

**Leave dormant (no change):** `lib/pdf.ts`, `app/api/pdf/[id]/route.ts`, the `summaryPdf`/`deepDivePdf`
fields, the reconstruct logic that detects existing `pdfs/*.pdf`, and existing `.pdf` files on disk. (Old
videos keep a `summaryPdf` value pointing at a real file; new videos get `null`. Nothing references the
field in the UI anymore, so a stale value is invisible.)

**Add the Print button — `lib/html-doc/theme.ts` (shared) + both renderers:**
- New exported constant `PRINT_BUTTON`:
  ```ts
  export const PRINT_BUTTON =
    `<button id="print-btn" type="button" onclick="window.print()" aria-label="Print" title="Print">\u{1F5A8}\u{FE0F}</button>`;
  ```
  (printer emoji 🖨️). Inline `onclick="window.print()"` is safe: these are self-contained docs we emit
  directly; markdown-it's `html:false` only governs the *content*, not our injected chrome.
- Extend `themeStyleBlock`'s fixed-button CSS so `#print-btn` sits left of `#theme-toggle`
  (toggle at `right:1rem`; print at `right:3.6rem`), shares the circular icon-button styling, and is hidden
  in print. Add `#print-btn` to the **`themeStyleBlock` print rule** (`theme.ts`, the
  `@media print{ … #theme-toggle{display:none} }`) — this covers BOTH renderers since both embed
  `themeStyleBlock` (M4). The deep-dive's own structural `@media print` rule already hides `#theme-toggle`;
  it's redundant for `#print-btn` and needs no change.
- `lib/html-doc/render.ts` and `render-deep-dive.ts`: inject `${PRINT_BUTTON}` immediately next to
  `${THEME_TOGGLE_BUTTON}` (right after `<body>`), in both files.

### Change 3 — Version bumps so existing docs refresh

- `lib/doc-version.ts`: `CURRENT_DOC_VERSION = { major: 3, minor: 3 }` (was `{3,2}`). Update the comment:
  `minor 3 = meta-line video URL link + Print button`.
- `lib/deep-dive/version.ts`: `CURRENT_DEEP_DIVE_VERSION = { major: 2, minor: 1 }` (was `{2,0}`). Update the
  comment: `minor 1 = timestamp trailing the heading + first-sentence gold + Print button`.
- No logic change: the existing minor-stale branches already route through cheap re-render
  (`reRenderDeepDiveHtml` reads only the `.md`; `reRenderSummaryHtml` uses the cached model, falling back to
  `runHtmlDoc` when the model is absent — `ensure.ts:54-57`). Regeneration stays **lazy/on-demand** (the
  menu shows the video as needing update; clicking re-renders one doc). No bulk re-run, no Gemini for the
  minor path.

## Components & boundaries

| Unit | Change | Depends on |
|------|--------|-----------|
| `lib/pipeline.ts` `runIngestion` | new-items counter; drop PDF step | `index-store`, `writeSummaryDoc` |
| `app/page.tsx` ingest section | render new-items count + title; no-new message | SSE `ProgressEvent` |
| `app/api/videos/[id]/regenerate/route.ts`, `app/api/quick-view/backfill/route.ts` | drop `generatePdf` | — |
| `components/VideoMenu.tsx` | remove PDF menu items | — |
| `lib/html-doc/theme.ts` | `PRINT_BUTTON` + button/print CSS | — |
| `lib/html-doc/render.ts`, `render-deep-dive.ts` | inject `PRINT_BUTTON` | `theme` |
| `lib/doc-version.ts`, `lib/deep-dive/version.ts` | minor bumps | — |

## Error handling / edge cases

| Case | Behavior |
|------|----------|
| Sync with 0 new videos | `start total:0`; no per-video steps; `done total:0`; UI: "Sync complete — no new videos." |
| Same video appears twice in a playlist | counted once in `newTotal` (distinct ID set); the in-run dedup still skips the second occurrence (no progress emit). |
| A new video errors mid-sync | `'error'` event as today; `newIndex` already advanced; remaining new videos continue; `done` succeeded/failed reflect outcomes. |
| Old summary lacking `models/<base>.json` after the minor bump | `isOlder` branch → `reRenderSummaryHtml` returns non-`rerendered` → falls back to `runHtmlDoc` (rebuilds model via Gemini for that one doc, on demand). Not a breakage. |
| Old deep-dive after minor bump | `isOlder` branch → `reRenderDeepDiveHtml` from existing `.md` (no Gemini). |
| Print button in a print job | hidden via `@media print` (same as the theme toggle). |
| Existing `.pdf` files / `summaryPdf` values | untouched and unreferenced by UI; harmless. |
| Cancel during sync | unchanged — `'cancelled'` between videos. |

## Testing

**Unit / component (jest):**
- `pipeline.test.ts`: `newTotal` counts only new distinct IDs; `start.total` = new count; per-new-video
  steps carry `current`/`total`/`title` on the new basis; skipped videos emit **no** step; **no**
  `'Generating PDF…'` step; `generatePdf` is **never called**; new `Video` has `summaryPdf: null`.
  **Stored-data guard (M1):** a new video at playlist position 200 that is the 3rd new item → stored
  `playlistIndex === 200` while progress shows `current: 3, total: N` (proves `playlistIndex` uses
  `playlistPos`, not the new counter).
- `regenerate.test.ts`: **keep** `jest.mock('../../lib/pdf')` and assert
  `expect(mockGeneratePdf).not.toHaveBeenCalled()` (was: `toHaveBeenCalled()`) — the binding stays used so
  no unused-local lint break.
- `backfill.test.ts`: assert `generatePdf` is **never called** (repurpose the old conditional-skip test); the
  `done.failed` no longer includes a PDF component.
- `tests/lib/pdf.test.ts`: **unchanged** — `lib/pdf.ts` stays dormant (L1).
- `app/page.tsx` (component test if present, else covered by E2E): renders `New video N of M`, the title,
  and the no-new message.
- `render.test.ts` / `render-deep-dive.test.ts`: both docs contain `id="print-btn"` with
  `onclick="window.print()"`; CSS hides `#print-btn` in `@media print`.
- `theme.test.ts`: `PRINT_BUTTON` constant + button/print-hide CSS present.
- `doc-version` + `deep-dive/version` tests: assert the new `{3,3}` / `{2,1}` constants; `isOlder` routes a
  `{3,2}` / `{2,0}` stored doc to the re-render branch.
- `VideoMenu.test.tsx`: PDF menu items no longer rendered; remaining items intact.

**E2E (Playwright):** existing ingest-progress test updated for the new-items text; a deep-dive/summary doc
shows the Print button. (Mock at the API/lib boundary per project policy — no real PDF, no real Gemini.)

Full `npm test` + `tsc --noEmit` green before each commit. Dual review (Claude + Codex/fallback) per task.

## Out of scope
- Deleting `lib/pdf.ts`, the `/api/pdf` route, the `summaryPdf`/`deepDivePdf` fields, their tests, or
  existing `.pdf` files (deferred; kept dormant).
- Bulk/forced regeneration of all docs (regeneration stays lazy per existing menu behavior).
- Any Gemini prompt or `.md` content change.
