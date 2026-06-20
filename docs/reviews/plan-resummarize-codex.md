# Codex Adversarial Review — Versioned HTML-Doc Regeneration Plan

**Date:** 2026-06-18 · **Tool:** `codex:rescue --fresh` · **Branch:** feat/resummarize-timestamps
**Verdict (as received):** must-fix first — 1 Blocking + 3 High before any task begins.

## Blocking — `done` emitted before `docVersion` stamped
`ensureHtmlDoc` passed the route's `onProgress` straight into `runHtmlDoc`, whose `done` event the route
treats as terminal (releases the job lock, status bar closes/opens) **before** `ensureHtmlDoc` stamps
`docVersion`. → the row can refetch while still stale.
**Fix:** `ensureHtmlDoc` forwards only child `step` events; it owns exactly one terminal `done`, emitted
**after** the final `updateVideoFields({ docVersion })`. It **throws** on error (the route's `.catch`
already emits the `error` event — don't double-emit). *(Task 3 rewritten.)*

## High — `GeminiSummaryResponse` not imported (tsc fail)
Task 2's result interface used `GeminiSummaryResponse[...]` but `lib/pipeline.ts` doesn't import it.
**Fix:** add `GeminiSummaryResponse` to the `../types` type import; type `videoType`/`audience` with the
already-imported `VideoType`/`Audience`. *(Task 2 updated.)*

## High — stale UI after corrections (persist fixed, memory not)
Clearing `summaryHtml` in the regenerate route fixes the index, but the in-memory row keeps the stale
direct link until a hard refetch (`CorrectionsPanel` patch + `onAnnotationChange` types exclude
`summaryHtml`).
**Fix:** regenerate route returns `summaryHtml: null`; thread it through `CorrectionsPanel`'s patch and
the `onAnnotationChange` `Pick` types so the row updates in memory. *(Task 5 expanded.)*

## High — existing route test asserts `runHtmlDoc`
`tests/api/html-doc-post.test.ts` mocks `lib/html-doc/generate` and asserts `runHtmlDoc`; it must be
**rewritten** (mock `ensureHtmlDoc`), not "extended." Also `tests/api/html-doc-pipeline.test.ts` drives
the route end-to-end — its video fixtures lack `docVersion`, so after the swap they'd trigger
re-summarize; fixtures must set `docVersion {2,0}` (or mock the re-summarize path). *(Task 4 expanded.)*

## Medium (addressed)
- **Auto-open conflict:** `HtmlDocStatusBar:43` calls `window.open` on `done`, conflicting with the
  user's "menu becomes clickable" model (and popup-block-prone). **Fix:** remove the auto-open; the
  status bar's existing "View HTML doc ↗" link + the now-current menu item are the open paths. *(Task 7.)*
- **Stale E2E:** `tests/e2e/html-doc.spec.ts` asserts View/Generate/Regenerate. **Fix:** rewrite it for
  the single "HTML doc" action + `docVersion`. *(Task 7.)*

## Medium (accepted, no change)
- **Injectable `current` param** on `ensureHtmlDoc` — a defaulted optional param for testability; the
  route always calls the 3-arg form, so nothing leaks. Kept as an intentional test seam.

## Low (accepted)
- Progress-event ordering drift (slug selection moved before the transcript fetch inside
  `writeSummaryDoc`) — output byte-identical; cosmetic.

## Solid (Codex confirmed)
Task 2's markdown builder matches current frontmatter order / structural tags / `score` / metadata /
divider / quick-view insertion; `mdContent` + `pdfPath` stay in scope for `generatePdf`; `runHtmlDoc`
overwrites `models/<base>.json` (the pre-delete is redundant-but-harmless); `reRenderSummaryHtml` status
handling compatible; deep-dive stamping correctly out of scope; optional `docVersion` needs no migration.
