# Adversarial Plan Review — Deep-Dive HTML Export

**Reviewer:** Claude-opus (documented Codex fallback per `docs/plugins.md` — Codex rate-limited).
**A real Codex adversarial pass is still owed before merge.**
**Plan:** `docs/superpowers/plans/2026-06-09-deep-dive-html-export.md` (9 tasks)
**Spec:** `docs/superpowers/specs/2026-06-09-deep-dive-html-export-design.md`
**Branch:** `feat/deep-dive-html-export`
**Date:** 2026-06-09

## Verdict: **APPROVE** (with two Low fixes recommended; no Blocking/High found)

The plan is unusually well-grounded. I empirically installed `markdown-it@14` in a scratch dir and
ran every exact-HTML assertion the tests make; all pass against the real renderer. I compiled the
TS-strict-risk patterns with the project's own `tsc`. The serve-route rewrite preserves every
behavior the current route and its two test suites rely on, and the plan correctly updates the one
existing assertion that would otherwise break.

---

## Empirical verification performed

- **markdown-it@14 installed in `/tmp` and run** against the Task 2 source MD. Confirmed byte-for-byte:
  - `<h1>The ABCs of agent building (Deep Dive)</h1>` ✓
  - `<h3><strong>1. High-Level Summary</strong></h3>` ✓ (the `**` DOES become `<strong>` inside the heading)
  - `<h4>Sub-point</h4>` ✓
  - ` ```ascii ` → `<pre><code class="language-ascii">…</code></pre>`; the generic test regex `/<pre><code[^>]*>…<\/code><\/pre>/` matches ✓
  - `<script>` escaped to `&lt;script&gt;`, raw `<script>alert(2)</script>` absent ✓
  - `[click](javascript:alert(1))` → rendered as **literal text** (validateLink rejects it, so no `<a>` at all); `href="javascript:` absent ✓. Same for `data:` and `vbscript:` ✓
  - Raw `<img src=x onerror=…>` escaped (html:false) ✓
- **Real artifact** `…/agentic-ai-claude-code/raw/the-abcs-of-agent-building-deep-dive.md`: the
  frontmatter-strip regex `/^---\n[\s\S]*?\n---\n/` strips the multi-line tags block cleanly; `lang`,
  `video_id`, and title extraction all return correct values. The real ` ```ascii ` blocks (which use
  `↓` arrows and `\` backslashes) survive intact inside `<pre><code>`.
- **KO heading** `### **1. 개요**` → `<h3><strong>1. 개요</strong></h3>` ✓; KO body text preserved ✓.
- **TS strict** — compiled Task 4's `let video;` (untyped) + assign-in-`try` + `if (!video) return`
  inside the try, then `video.deepDiveMd` access AFTER the try, with `tsc --strict`. **Compiles clean**
  — TS control-flow analysis narrows the evolving `let` and does not flag `video` as possibly-undefined
  after the block. No `noImplicitAny` error either.
- **tsconfig** `esModuleInterop: true` → `import MarkdownIt from 'markdown-it'` is valid.
- **`readIndex` does NOT Zod-validate** (plain `JSON.parse` + cast), so the partial test fixtures are
  accepted as-is. **`writeIndex` calls `assertVideoId` per video** — all fixtures use valid ids, so
  Task 5/6's `updateVideoFields → writeIndex` path is safe.
- **Existing tests confirmed:** `tests/api/html-serve.test.ts` line 40 currently asserts
  `&type=deep-dive → 400`; Task 4 Step 1(a) replaces it with `&type=bogus → 400`. That is the ONLY
  place the old suite couples to `type !== 'summary'` (grepped). `tests/api/html-doc-pipeline.test.ts`
  only uses `type=summary` and is unaffected by the widened type.
- **`runDeepDive` signature** is `(videoId, outputFolder, onProgress)` — Task 5's test call
  `runDeepDive(VIDEO_ID, dir, () => {})` matches.
- **Archive non-regression:** existing `tests/lib/archive.test.ts` uses real fs + real index-store
  (not mocked) and asserts only `archived` + file moves; its `makeVideo` omits `summaryHtml`. Task 6
  setting `summaryHtml: null` does not break any existing assertion.

---

## Findings

### Blocking — none
### High — none
### Medium — none

### Low

**L-1 (Task 5) — the existing `tests/lib/deep-dive.test.ts` mocks `lib/index-store`, but the NEW
`deep-dive-html-stale.test.ts` does not — they are different test models, and the plan's hedge
("extend if present; else create") is slightly misleading.**
`tests/lib/deep-dive.test.ts` already exists and mocks `../../lib/index-store`, `../../lib/gemini`,
`../../lib/youtube`, `../../lib/pdf` (no real fs). The plan creates a *separate* file
(`tests/lib/deep-dive-html-stale.test.ts`) that uses a REAL temp dir + REAL index-store and mocks
only gemini/pdf/youtube. That is a valid and self-consistent design (it must hit the real fs to
observe the stale-HTML unlink), and it will pass — I traced the call graph: real `readIndex` →
real md `writeFile` → real `mkdir pdfs` → mocked `generatePdf` → the new `unlinkSync` → real
`updateVideoFields`. **No defect, but** the plan's Step-1 phrasing "extend if present" should be
deleted: the file IS present and must NOT be extended (its `index-store` mock would defeat the
real-fs assertion). Recommend the plan say plainly: "create a new real-fs test file; do not touch
the existing mocked suite." Mark it explicit so the implementer doesn't try to graft the test into
the mocked file and get a green-for-the-wrong-reason.

**L-2 (Task 2 / Task 6) — KO font and provenance are internally consistent but DIVERGE from the
shipped summary renderer's conventions; flag for deliberate sign-off, not a bug.**
The shipped `lib/html-doc/render.ts` uses `SERIF = Georgia, 'Nanum Myeongjo', 'Apple SD Gothic Neo'…`
for headings/title. Task 2's deep-dive CSS instead uses a sans stack
`… 'Apple SD Gothic Neo','Malgun Gothic' …` with NO `Nanum Myeongjo` serif. The spec (§Output file
format) says "Korean serif fallback (`'Nanum Myeongjo','Apple SD Gothic Neo'`)". So **Task 2's CSS
contradicts its own spec line** — the spec asks for a serif KO fallback, the plan's CSS ships a sans
one and omits `Nanum Myeongjo`. None of Task 2's tests assert on the font (they only check `<style>`
present and `<html lang>`), so tests still pass — but the rendered KO output won't match the
spec's stated serif intent. **Fix:** either add `'Nanum Myeongjo'` to the deep-dive `body`/heading
stack to honor the spec, or amend the spec line to accept the sans stack. Cosmetic, non-blocking,
but it's a spec/plan contradiction worth resolving before implementation so the screenshot in
verification matches the spec.

---

## Items explicitly checked and found CORRECT (no action)

- **Serve-route 400/404/200 matrix** preserved: missing outputFolder → 400; invalid type → 400;
  video-not-found → 404; summaryHtml unset → 404; traversal → 400/404 (never 200); cached serve → 200.
  The `readIndex` try/catch `statusCode === 400` handling is preserved verbatim.
- **B-1 Unicode regex** `/^htmls\/[\p{L}\p{N}._-]+\.html$/u` admits real KO slugs
  (`모든-곳에-구글-deep-dive.html`) and still forbids `/` so `../` cannot appear; the `path.resolve`
  containment check remains the real backstop. Confirmed against a real KO deepDiveMd.
- **No double-suffix**: `base = deepDiveMd.replace(/\.md$/,'')` already ends `-deep-dive`, so
  `htmls/<base>.html` = `…-deep-dive.html`, not doubled. Tests assert this exactly.
- **H-1/H-2 no-index-write race avoidance**: `runDeepDiveHtml` does NOT call `updateVideoFields`;
  the serve route serves the returned in-memory bytes on the lazy path (no write-then-re-read).
  Concurrent first-views write identical bytes via temp→rename; last rename wins, harmless.
- **Task 6 `getCachedHtmlPaths`** derives html names from the root-relative `summaryMd`/`deepDiveMd`,
  which archive never rewrites (archive only moves the md/pdf, not the cached html, and does not
  update those index fields). So delete-before vs delete-after the move is immaterial — the plan's
  "read while paths are still root-relative" rationale is slightly off but the code is correct.
  `updateIndexIfKnown` signature widening to `Partial<{archived; summaryHtml}>` flows into
  `updateVideoFields(…, Partial<Video>)` cleanly (`summaryHtml?: string | null` exists on the schema).
  No other caller of `updateIndexIfKnown` exists (it's module-private to `archive.ts`).
- **Clearing `summaryHtml` on unarchive** does not lose a still-valid cache: unarchive also deletes
  the cached html files, so the cleared field is consistent with the now-absent cache (next view of
  summary would 404 until regenerated — acceptable and matches the archive-side behavior).
- **Task 7** mirrors the existing "View Deep Dive PDF" disabled `<a href="#" aria-disabled tabIndex={-1}>`
  pattern exactly; `hasDeepDive` already exists in `VideoMenu.tsx`. The test's URL-param assertions
  (`pathname`, `outputFolder`, `type=deep-dive`) match the href the plan generates.
- **Task 1** `markdown-it@14` + `@types/markdown-it` with `esModuleInterop` is sufficient for the
  default import.

---

## Recommendation

Proceed with implementation. Apply **L-1** (clarify Task 5's test-file instruction) and decide
**L-2** (KO serif: align plan CSS to spec, or amend spec) before/at Task 2. Obtain the owed Codex
adversarial pass before merge per `docs/plugins.md`.
