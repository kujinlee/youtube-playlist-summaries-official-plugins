# Final Dual Review — Auto PDF Export (feat/auto-pdf-export vs master)

**Date:** 2026-07-01

## Claude (pr-review-toolkit code-reviewer)
One material bug + confirmations.
- **Important (85): TOCTOU dedup-lock gap** — `await buildDocHtml` sat between `getActiveJob` and
  `createJob`, breaking the atomic check→create that the one-job-per-key guard relies on (sibling
  html-doc/batch routes keep them adjacent). **FIXED**: reserve the job synchronously right after the
  check; `abandon()` (releaseJobLock+deleteJob) on the `!build.ok` / invalid-path / thrown-build paths.
- Confirmed correct: buildDocHtml status/skeleton parity, HTML_REL_RE guard preserved, path containment
  complete (incl. rerender.ts read), generate-doc-pdf cleanup, SSE lifecycle, done.log schema.

## Codex (adversarial)
Blocking 0, High 2, Medium 1.
- **High 1 — same TOCTOU race.** FIXED (see above).
- **High 2 — timeout didn't cancel `runGenerate`.** The old outer `withTimeout` race rejected but left
  the browser alive; a late `page.pdf()` could `writeFileSync`+rename AFTER the job reported failure.
  **FIXED**: cooperative timeout — render raced against a timer; `finally` closes page/context/browser
  first (canceling pending ops); a `timedOut` guard blocks a late write; the dangling render promise
  gets a no-op `.catch` so its post-close rejection isn't unhandled.
- **Medium — silent POST failure** before job creation (`handleSavePdf` returned on `!res.ok`).
  **FIXED**: on non-OK, read the `error` and show `PdfStatusBar` in error state via a new `errorMessage`
  prop (empty jobId → no SSE, auto-dismiss ~5s).
- Confirmed correct: HTML_REL_RE + companion-first ordering, containment on all index-derived fields,
  UUID-temp, serverExternalPackages key, playwright in dependencies.

## Fix verification
Added tests: pdf-route concurrent-dedup (one job for two same-key POSTs) + build-unavailable lock
release; generate-doc-pdf hang→reject+no-write; PdfStatusBar pre-set error (no SSE) + 5s auto-dismiss.
1472 jest + 2 E2E green; `tsc --noEmit` clean; `npm run build` clean (both /pdf routes registered).
