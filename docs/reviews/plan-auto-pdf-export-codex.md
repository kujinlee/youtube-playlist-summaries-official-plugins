# Codex Adversarial Review — Spec: Automatic PDF Export

**Date:** 2026-07-01
**Target:** `docs/superpowers/specs/2026-07-01-auto-pdf-export-design.md`
**Reviewer:** Codex (fresh session). Counts: Blocking 2, High 4, Medium 5, Low 2.

**Framing:** This app is a **local, single-user tool run via `npm run dev`** on the user's Mac — not
a pruned production/CI deploy. That lowers the severity of the two "Blocking" (deploy-time) findings,
but all proposed fixes are cheap + correct and are ADOPTED.

## Blocking (adopted)
1. **prod-playwright-dep** — `@playwright/test` is a devDependency. **Fix applied to spec:** add
   `playwright` to `dependencies`; server code imports from `'playwright'` only (spike confirmed
   `import { chromium } from 'playwright'` works). Add a plan task asserting `npm run build` succeeds.
2. **browser-binary-assumption** — Chromium presence assumed from dev cache. **Fix:** depend on
   `playwright`; document `npx playwright install chromium`; `generateDocPdf` surfaces a clear error
   ("run npx playwright install chromium") if launch fails. Acceptable for local-only app.

## High (adopted)
1. **summary-pdf-enable-contradiction** — summary serve 404s when `summaryHtml` absent. **Fix:** enable
   "Save summary PDF" only when `summaryHtml` is present (same state as the "HTML doc" open-link); new
   enumerated behavior for summaryMd-present/summaryHtml-absent → item disabled. PDF presupposes the
   HTML doc exists.
2. **process-local-serialization** + 5. **fixed-temp-collision** — **Fix:** correctness no longer relies
   on serialization. Use a **UUID temp filename** (`.{base}.{uuid}.pdf.tmp`) + atomic rename; final
   overwrite = last-wins. Keep an in-process single-flight only as a resource optimization (avoid
   parallel chromium launches), not a correctness guarantee.
3. **source-path-traversal** — index-derived reads (`reRenderSummaryHtml` reads `video.summaryMd` with
   no containment). **Fix:** add shared `assertIndexRelPathWithin(outputFolder, rel, allowedExt?)` and
   apply before every index-derived read in the shared builder + PDF path derivation; test malicious
   `summaryMd`/`summaryHtml`/`digDeeperMd` independently. (Low real risk — index is app-authored — but
   cheap hygiene; also hardens the existing serve route.)

## Medium (adopted)
1. **playwright-hang-lifecycle** — specify `page.setDefaultTimeout`, overall job timeout, `try/finally`
   `page.close()`/`browser.close()`, browser-disconnect reset, lock release on error.
2. **build-html-boundary** — `buildDocHtml` returns a **domain result union**
   `{ ok: true; html } | { ok: false; reason }`; routes map reasons → HTTP. No HTTP concerns in the lib.
3. **cjk-font-plan-vague** — spike PROVED Hangul renders via macOS system fonts. **Decision:** local-only
   app relies on installed system CJK fonts (validated); bundled subset webfont deferred unless it breaks.
   Documented as an explicit assumption.
4. **setcontent-script-network** — locked-down context: `javaScriptEnabled: false` (static PDF doesn't
   need the nav/dig/zoom JS; print CSS handles layout) + block all non-`data:` network. Verify render
   parity during impl.
5. **dead-artifact-repeat** — **Decision documented:** PDFs are **user-managed exports** (Downloads-style),
   overwrite-on-regenerate same-base; source rename leaves a stale PDF (user cleans up). No index/serve
   route = nothing to rot silently. New enumerated behavior for the rename/stale case.

## Low (adopted)
1. **statusbar-copy-mismatch** — `PdfStatusBar` is its own component: shows `Saved pdfs/<file>`, no anchor.
2. **next-config-too-loose** — choose **`playwright`** (in Next's built-in external list); never import
   `@playwright/test` in server code.

## Validated by Phase 0 spike (this session)
Real chromium via `'playwright'`: ~423ms total per PDF; valid `%PDF-`; Hangul glyphs correct;
`printBackground` colors preserved; `@media print` hides 🖨️; real base64 slide JPEG renders full-fidelity.
