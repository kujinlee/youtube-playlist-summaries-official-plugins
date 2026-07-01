# Codex Adversarial Review — PLAN: Automatic PDF Export

**Date:** 2026-07-01
**Target:** `docs/superpowers/plans/2026-07-01-auto-pdf-export.md`
**Reviewer:** Codex (fresh). All findings ADOPTED.

## High (fixed in plan)
1. **`done.log` not in ProgressEvent** — `done` schema lacks `log` (types/index.ts:102). Task 5 emits it,
   Task 6 reads it → tsc fail / untyped cast. **Fix:** Task 5 Step 1 adds `log: z.string().optional()`
   to the `done` variant + a validation test.
2. **HTML path guard weakened** — the serve route guards `summaryHtml` with `HTML_REL_RE`
   (`^htmls/[\p{L}\p{N}._-]+\.html$`) + `htmlDir` containment; the generic `assertIndexRelPathWithin`
   only checks output-folder containment, so `summaryHtml:'secret.html'` could leak. **Fix:** Task 3
   preserves `HTML_REL_RE` + `htmlDir` containment verbatim for the summaryHtml read; the generic helper
   is used only for md/model reads. Tests for `'secret.html'`, `'htmls/../secret.html'`, Unicode `htmls/*.html`.
3. **Timeout doesn't bound the job** — `page.setDefaultTimeout` bounds page ops but not launch/overall; a
   hang means Task 5's `.then/.catch` never runs → lock never released. **Fix:** Task 4 passes
   `chromium.launch({ timeout })` AND wraps generation in an overall `Promise.race` reject-timeout; Task 5
   route test: `generateDocPdf` never resolves → `error` event + `releaseJobLock`.

## Medium (fixed)
4. **Parity coverage underspecified** — Task 3 must mirror existing html-serve B1–B8 + re-render cases:
   missing summary md→200 skeleton, parse failure→200, model missing→200, missing companion file→200,
   companion-path-alone→400. **Fix:** Task 3 test list expanded to enumerate each.
5. **page/context not closed** — sketch closes only `browser`. **Fix:** Task 4 tracks `context`+`page`,
   closes both in `finally` before `browser.close()`; mock asserts `page.close`/`context.close`.

## Low (fixed)
6. **"Next.js 15" wording** — installed Next is **16.2.6**; `serverExternalPackages` still correct. Wording fixed.
7. **pdfRelPath contract** — Task 2 claimed it "Consumes assertIndexRelPathWithin" but the signature has no
   `outputFolder` and doesn't call it; containment is enforced at the Task 5 call site. **Fix:** claim removed.

## Confirmed NON-issues by Codex
- `page.route('**/*')` + `setContent` + `javaScriptEnabled:false`: `data:` allowed; print CSS enforces base
  slide size (`render-dig-deeper.ts:193`). Render OK.
- Late SSE replay: registry buffers (`job-registry.ts:31`) + replays (`:43`); plan includes `releaseJobLock`
  + grace-delete. OK.
- dig-deeper suffixing `x-dig-deeper.md`→`x-dig-deeper.pdf`. OK.
