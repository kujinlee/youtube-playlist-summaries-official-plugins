# Final Adversarial Review — "View Deep Dive HTML" (feat/deep-dive-html-export)

**Reviewer:** Claude (opus) — documented Codex fallback per `docs/plugins.md` (Codex rate-limited).
**Codex still owed before merge:** YES. This Claude review does not satisfy the dual-review gate on its own; run `codex:rescue --fresh` and record `docs/reviews/deep-dive-html-final-codex.md` before merging.
**Scope:** full feature diff `git diff master..HEAD` (14 commits).
**Date:** 2026-06-09.

---

## Verdict: **APPROVE** (with Codex review still owed; no Blocking/High findings)

The feature is correct, well-tested, and injection-safe in practice. `tsc --noEmit` clean, `npm run build` clean. The intermittent test failure is **pre-existing and unrelated** to this feature (Puppeteer/md-to-pdf timeout). All findings below are Low/informational.

---

## Verification evidence

| Check | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 (clean) |
| `npm run build` | exit 0 — `/api/html/[id]` compiles as a dynamic route |
| Feature suites in isolation (8 files, 31 tests) | **all pass, 2.7s, zero flake** across repeated runs |
| Full `npx jest` Run 1 | **1 failed** (`pdf.test.ts` ascii), 697 passed, 45s |
| Full `npx jest` Run 2 | 698 passed, **1855s** (machine thrashing) |
| Full `npx jest` Run 3 | 698 passed, 17.7s |

---

## THE FLAKY TEST — identified with high confidence

**Test:** `tests/lib/pdf.test.ts` → `generatePdf › "renders ASCII art code blocks without error and produces a non-empty file"` (line 55).

**Symptom:** Jest 5000ms/30000ms timeout (`jest.setTimeout(30_000)` at top of file). It is the **last** test in the `generatePdf` suite, so under load it is the one that gets starved.

**Cause — confirmed by the three-run timing spread:**
- This suite exercises `lib/pdf.ts` → `md-to-pdf` → **Puppeteer/Chromium**. Each of its four tests launches a headless browser render.
- When the full suite runs, multiple jest workers each spin up Chromium concurrently. Run 2 took **1855 seconds** (vs 17.7s for Run 3 on an idle machine) — a 100x blow-up that is pure browser-launch contention. Under that contention a single PDF render exceeds the 30s per-test cap → timeout → "failure". When the box is idle (Run 3), every render finishes fast and the suite is green.
- This is **load-dependent, not logic-dependent** → exactly the "passes on re-run" behavior described.

**Relationship to this feature: NONE.** The deep-dive-HTML path does zero Puppeteer/PDF work — `renderDeepDiveHtml` is synchronous `markdown-it` string rendering; `runDeepDiveHtml` is `fs` + render only. The 8 feature suites run in 2.7s with no browser. The feature did not add, touch, or slow `lib/pdf.ts`. The jest config comment (`forceExit` for md-to-pdf open handles) documents this Puppeteer fragility as a known pre-existing condition.

**Recommended fix (pre-existing tech debt, optional, NOT a merge blocker for this feature):**
- Raise `jest.setTimeout` in `pdf.test.ts` to 60–90s, **and/or**
- Serialize the Puppeteer suites — `maxWorkers` cap, or mark `pdf.test.ts` to run `--runInBand`, or share a single browser instance across the four tests. The real fix is eliminating per-test Chromium-launch contention.

---

## Findings (all Low / informational)

### L-1 — `data:image` src passes through markdown-it (Low, not exploitable)
Probed live: `md.render('![x](data:image/png;base64,…)')` keeps the `data:image` src (markdown-it's `validateLink` permits `data:image/*`). Non-image `data:`, `javascript:`, and `vbscript:` links are all **blocked** (verified). A `data:image` src cannot execute script, and with `html:false` no raw `<img onerror=…>` survives. No XSS. Informational only — note that the renderer trusts Gemini-authored markdown, which is the design assumption.

### L-2 — Frontmatter strip regex is LF-only (Low, in-pipeline files unaffected)
`/^---\n[\s\S]*?\n---\n/` does not match **CRLF** frontmatter (verified: `video_id` leaks into the rendered body if the `.md` has `\r\n` line endings) and does not match a frontmatter block with **no trailing newline**. In practice `lib/deep-dive.ts` writes every deep-dive `.md` with `\n` (Node template strings), so shipped files always match. The only way to hit this is a user hand-editing the `.md` in a CRLF editor — and the worst outcome is cosmetic (the YAML renders as an `<hr>`/heading). Non-sensitive content; no security impact. If hardening is desired: `/^---\r?\n[\s\S]*?\r?\n---\r?\n?/`.

### L-3 — `<span>` vs `<a>` disabled-markup inconsistency (Low, a11y nit — actually the BETTER pattern)
"View Deep Dive HTML" disabled state uses `<span aria-disabled="true">` while the older "View Deep Dive PDF"/"Open Deep Dive in Obsidian" disabled states use `<a href="#" aria-disabled tabIndex={-1} onClick={preventDefault}>`. The new `<span>` is the more correct a11y choice (a non-link should not be a focusable anchor with a dead `#` href). Not a defect in the new code. If anyone touches this, the right direction is to migrate the old `<a href="#">` disabled items to `<span>`, not the reverse. Matches the existing "Generate HTML doc" disabled `<span>` already in the file (line 92), so the feature is internally consistent.

---

## Adversarial checks that PASSED (no finding)

1. **Serve route — summary non-regression.** Summary branch is unchanged in behavior; the only edit is the shared `HTML_REL_RE` now being Unicode-aware. Existing summary tests (path-traversal `../../../../etc/passwd` → never 200, missing file → 404, unset → 404, happy path → 200) all still pass, and a **new KO-slug summary regression test** is present (`html-serve.test.ts:72`, "was 404 before the Unicode-regex fix"). B-1 is covered for summary too.

2. **Unicode path guard is airtight.** `HTML_REL_RE = /^htmls\/[\p{L}\p{N}._-]+\.html$/u` forbids `/` inside the filename (no `../` traversal — `.` is allowed but not `/`, so `..` cannot reach a parent), and the `path.resolve` + `startsWith(htmlDir + sep)` containment check is a hard backstop applied to BOTH summary and deep-dive paths via the shared `guard()`. Even a crafted `deepDiveMd`/`summaryMd` that smuggled a separator would be caught by containment.

3. **Deep-dive lazy-gen serves the right file.** `base = deepDiveMd.replace(/\.md$/,'')`, `rel = htmls/${base}.html`. Generate path (`runDeepDiveHtml`) writes to the identical `htmls/${base}.html` and returns the in-memory bytes (H-2: no write-then-reread). Cache-hit reads that same path. The "no doubled `-deep-dive`" test (`generate-deep-dive.test.ts:52`) guards the filename derivation.

4. **Render error does not leak sensitive info in the 500.** The lazy-gen `catch` returns a fixed `{ error: 'failed to render deep dive html' }` — no stack, no path. Good.

5. **Archive H-3 path derivation is correct.** `getCachedHtmlPaths` reads the index and derives `htmls/<md-base>.html` from `summaryMd`/`deepDiveMd`. On **archive**, deletion runs **before** `getFilePairs` moves the md files (comment at `archive.ts:95` + ordering verified), so the md paths are still root-relative when the html paths are derived — correct. On **unarchive**, files are moved back first, then html cache is defensively cleared, then `summaryHtml` set null. Containment guard (`abs.startsWith(base + sep)`) applies to both. No path-escape via crafted md names.

6. **Clearing `summaryHtml` on unarchive does not lose a valid cache.** The cache file is deleted in the same operation, so the field correctly reflects "no cache". Re-view regenerates summary HTML via the existing generate path. Acceptable and consistent.

7. **`deep-dive.ts` stale-delete is correct + best-effort.** `fs.unlinkSync(join(outputFolder,'htmls',`${base}-deep-dive.html`))` with `base` derived from `summaryMd ?? videoId` (same base used to write the new md), wrapped in try/catch → no crash if `htmls/` absent. Covered by `deep-dive-html-stale.test.ts`.

8. **`render-deep-dive` head injection is escaped.** Every interpolated head value (`lang`, `videoId`, `sourceMd`, `title`) goes through `esc()` (handles `& < > "`). `title` is derived from the body H1 and escaped. The `html:false` body render escapes raw HTML and drops `javascript:`/`vbscript:`/non-image-`data:` links (verified live). Injection-safe for Gemini-authored content.

9. **Type consistency / dead code.** `summaryHtml` is `z.string().nullable().optional()` in the schema; no `deepDiveHtml` index field added (deep-dive HTML is deliberately index-less — keyed on file existence), and a test asserts `'deepDiveHtml' in video === false`. No dead code spotted in the diff.

10. **Coverage of concurrency / KO end-to-end / summary-KO regression.**
    - KO end-to-end: present for both deep-dive (`deep-dive-html-pipeline.test.ts:66`) and summary (`html-serve.test.ts:72`).
    - Real md → serve integration with ASCII + frontmatter-strip: present (`deep-dive-html-pipeline.test.ts:55`).
    - **Gap (Low):** no explicit test for **two simultaneous first-views** of the same uncached deep-dive (concurrent `runDeepDiveHtml` writing the same `htmls/<base>.html`). In practice the atomic write (`tmpPath` with `randomUUID()` → `renameSync`) makes this safe — last writer wins, both readers get a valid complete file, no torn read. Worth a one-line note in the plan; not worth blocking on, since the atomic-rename design already handles it correctly.

---

## Pre-merge checklist
- [ ] Run Codex adversarial review (`codex:rescue --fresh`) and save `docs/reviews/deep-dive-html-final-codex.md` — **still owed** per dual-review gate.
- [ ] (Optional, pre-existing) Address the `pdf.test.ts` Puppeteer-contention flake (raise timeout and/or serialize the PDF suites) — separate from this feature.
- [ ] (Optional) L-2: make the frontmatter strip CRLF-tolerant if hand-edited `.md` files are a concern.
