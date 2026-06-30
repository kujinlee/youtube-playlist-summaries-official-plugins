# PDF Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all residual server-side PDF infrastructure — on-disk files, the dead `md-to-pdf` generator, the serve route, and the `summaryPdf`/`deepDivePdf` schema fields — now that PDFs come from the browser (Save-as-PDF / 🖨️ Print on the HTML doc).

**Architecture:** Three commits, each leaving `tsc` + the full jest suite green. (1) Delete orphaned PDF files in the data repo. (2) Remove the self-contained dead generator + serve route + dependency. (3) Remove the schema fields atomically (Zod requires the field while it exists and `Video`-typed fixtures won't compile without it, so the type change + every producer + every fixture must land together).

**Tech Stack:** Next.js (custom build — read `node_modules/next/dist/docs/` before config edits), TypeScript, Zod, jest + ts-jest/SWC, Playwright.

## Global Constraints

- Full jest suite runs serially: `npm test` (uses `--runInBand`). Type gate is `npx tsc --noEmit` (jest uses SWC, no typecheck).
- Zod `VideoSchema` is **non-strict** → unknown keys in existing `index.json` are dropped on next write. No data migration script.
- Data repo (`../youtube-playlist-summaries-official-plugins-data`) is separate from the code repo. File deletions there are **not** part of code-repo commits.
- `건강/` data is **not git-tracked** — its PDF deletion is irreversible (approved).
- Commit message footer:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01AALGnVtj4uLCXBKEeNSbYf
  ```

---

### Task 1: Delete orphaned PDF files (data repo)

**Files (data repo, not code repo):**
- Delete dirs: `agentic-ai-claude-code/raw/pdfs`, `agentic-ai-claude-code/raw/archived/pdfs`, `cs146s-the-modern-software-development/raw/pdfs`, `건강/raw/pdfs`, `건강/raw/archived/pdfs`

**Interfaces:** None (filesystem only). Safe because all `summaryPdf`/`deepDivePdf` index values are already `null`.

- [ ] **Step 1: Re-confirm zero index references before deleting**

```bash
cd /Users/kujinlee/code/agentic-ai-docs/youtube-playlist-summaries-official-plugins
grep -ho '"summaryPdf":"[^"]*"\|"deepDivePdf":"[^"]*"' ../youtube-playlist-summaries-official-plugins-data/*/raw/playlist-index.json 2>/dev/null | grep -v 'null' | wc -l
```
Expected: `0`

- [ ] **Step 2: Delete the five pdfs/ directories**

```bash
cd /Users/kujinlee/code/agentic-ai-docs/youtube-playlist-summaries-official-plugins-data
rm -rf agentic-ai-claude-code/raw/pdfs agentic-ai-claude-code/raw/archived/pdfs \
       cs146s-the-modern-software-development/raw/pdfs \
       건강/raw/pdfs 건강/raw/archived/pdfs
```

- [ ] **Step 3: Verify gone**

```bash
find /Users/kujinlee/code/agentic-ai-docs/youtube-playlist-summaries-official-plugins-data -type d -name pdfs | wc -l
find /Users/kujinlee/code/agentic-ai-docs/youtube-playlist-summaries-official-plugins-data -name '*.pdf' | wc -l
```
Expected: `0` and `0`

- [ ] **Step 4: Commit the git-tracked deletions in the data repo (if it is a git repo)**

```bash
cd /Users/kujinlee/code/agentic-ai-docs/youtube-playlist-summaries-official-plugins-data
git rev-parse --is-inside-work-tree 2>/dev/null && git add -A && git commit -q -m "chore: remove orphaned PDF files (PDFs now from browser)" || echo "data repo not git-tracked — files removed only"
```

---

### Task 2: Remove dead generator, serve route, dependency, config

**Files:**
- Delete: `lib/pdf.ts`, `tests/lib/pdf.test.ts`
- Delete: `app/api/pdf/[id]/route.ts` and the now-empty `app/api/pdf/` tree
- Delete: `tests/api/pdf.test.ts`
- Modify: `package.json` (remove `md-to-pdf`)
- Modify: `next.config.ts` (remove `serverExternalPackages: ['md-to-pdf']` + comment)
- Modify: `jest.config.ts` (resolve the `forceExit` comment)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing. Verified no production module imports `lib/pdf.ts` or the `/api/pdf` route; menu PDF links were removed in `63ea1d9`.

- [ ] **Step 1: Confirm nothing imports the generator or route**

```bash
cd /Users/kujinlee/code/agentic-ai-docs/youtube-playlist-summaries-official-plugins
grep -rn "from '.*lib/pdf'\|from \"@/lib/pdf\"\|api/pdf" --include='*.ts' --include='*.tsx' app lib components | grep -v node_modules
```
Expected: no matches under `app/` `lib/` `components/` other than the route file itself.

- [ ] **Step 2: Delete generator + route + their tests**

```bash
git rm lib/pdf.ts tests/lib/pdf.test.ts tests/api/pdf.test.ts
git rm -r "app/api/pdf"
```

- [ ] **Step 3: Remove `md-to-pdf` from package.json and refresh lockfile**

Edit `package.json` — delete the line `"md-to-pdf": "^5.2.5",` from `dependencies`. Then:
```bash
npm install
```
Expected: `package-lock.json` updates; no errors.

- [ ] **Step 4: Remove md-to-pdf from `next.config.ts`**

Read `node_modules/next/dist/docs/` for the current `serverExternalPackages` semantics first. Delete the `serverExternalPackages: ['md-to-pdf']` entry and the `md-to-pdf uses __dirname…` comment above it (lines ~9–12). If `md-to-pdf` was the only entry, remove the whole key.

- [ ] **Step 5: Resolve the `forceExit` comment in `jest.config.ts`**

The comment at line ~20 says `forceExit` is required because md-to-pdf (Puppeteer) keeps an async handle. Test whether it is still needed:
```bash
npx jest tests/lib/index-store.test.ts --no-forceExit 2>&1 | tail -5
```
- If the run exits on its own → remove `forceExit` and its comment.
- If it hangs / warns about open handles → keep `forceExit`, replace the comment with a generic reason (no longer md-to-pdf-specific).

- [ ] **Step 6: Typecheck + full suite**

```bash
npx tsc --noEmit && npm test 2>&1 | tail -15
```
Expected: tsc clean; all tests pass (pdf.test.ts / api pdf test no longer exist).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor(pdf): remove dead md-to-pdf generator, serve route, and dependency

PDFs are produced by the browser from the HTML doc; the server-side
generator, the /api/pdf serve route, and the md-to-pdf dependency were
all dead. Removes them plus the matching next.config/jest.config refs.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AALGnVtj4uLCXBKEeNSbYf
EOF
)"
```

---

### Task 3: Remove `summaryPdf` / `deepDivePdf` schema fields (atomic)

**Files:**
- Modify: `types/index.ts:55-58` (delete both field lines)
- Modify: `lib/pipeline.ts:146-148, 162-164, 335-337`
- Modify: `lib/archive.ts:20`
- Modify: `lib/serial-migrate.ts:7`
- Modify: `scripts/fix-duplicate-summaries.ts:22, 55` (trim summaryPdf; keep summaryMd)
- Delete: `scripts/migrate-pdfs-to-subfolder.ts`, `tests/lib/migrate-pdfs-to-subfolder.test.ts`
- Modify (assertions): `tests/api/backfill.test.ts`, `tests/api/regenerate.test.ts`, `tests/lib/pipeline.test.ts` (the two "sets summaryPdf…" cases ~1029-1040), `tests/lib/serial-migrate.test.ts`, `tests/lib/serial-invariant.test.ts`, `tests/lib/archive.test.ts`
- Modify (e2e): `tests/e2e/playlist-viewer.spec.ts` — delete "View Summary PDF" test (Behavior 8, ~456-475)
- Modify (fixtures only): drop the two object keys from ~30 remaining test files that set `summaryPdf`/`deepDivePdf` (full list via grep in Step 2)

**Interfaces:**
- Consumes: nothing new.
- Produces: `Video` type no longer has `summaryPdf`/`deepDivePdf`. `PATH_FIELDS` in `lib/serial-migrate.ts` drops to `['summaryMd','deepDiveMd','summaryHtml','deepDiveHtml','digDeeperMd','digDeeperHtml']`.

> **Why atomic:** `summaryPdf`/`deepDivePdf` are `.nullable()` (required, not `.optional()`). While the field exists, every `Video`-typed fixture must supply it; the moment it's removed, every fixture that still names it fails `tsc` ("object literal may only specify known properties"). So the type edit and all fixture edits land in one commit.

- [ ] **Step 1: Delete the spent migration script + its test**

```bash
git rm scripts/migrate-pdfs-to-subfolder.ts tests/lib/migrate-pdfs-to-subfolder.test.ts
```

- [ ] **Step 2: Enumerate every remaining reference (work-list for this task)**

```bash
grep -rln "summaryPdf\|deepDivePdf" --include='*.ts' --include='*.tsx' . | grep -v node_modules
```
Expected: the production files + ~35 test files. Each must be edited so zero references remain (except none — the field is gone entirely).

- [ ] **Step 3: Edit production code**

`types/index.ts` — delete:
```ts
  summaryPdf: z.string().nullable(),
  deepDivePdf: z.string().nullable(),
```

`lib/pipeline.ts` — delete the PDF computation (146-148):
```ts
  const pdfFilename = file.replace(/\.md$/, '.pdf');
  const pdfPath = path.join(path.dirname(mdPath), 'pdfs', pdfFilename);
  const summaryPdf = fs.existsSync(pdfPath) ? `pdfs/${pdfFilename}` : null;
```
and remove `summaryPdf,` + `deepDivePdf: null,` from the returned object (162-164) and the second object (335-337).

`lib/archive.ts:20` — change the loop array to:
```ts
  for (const relPath of [video.summaryMd, video.deepDiveMd]) {
```

`lib/serial-migrate.ts:6-9` — drop the two PDF entries from `PATH_FIELDS`:
```ts
export const PATH_FIELDS = [
  'summaryMd', 'deepDiveMd',
  'summaryHtml', 'deepDiveHtml', 'digDeeperMd', 'digDeeperHtml',
] as const;
```

`scripts/fix-duplicate-summaries.ts` — remove the `summaryPdf?` type member (line ~22) and drop `['summaryPdf', 'pdf']` from the field/ext loop (line ~55), keeping `['summaryMd', 'md']`.

- [ ] **Step 4: Remove PDF-specific test cases (assertions, not just fixtures)**

- `tests/lib/pipeline.test.ts`: delete the two `it('sets summaryPdf …')` blocks (~1029-1040).
- `tests/lib/serial-migrate.test.ts`: remove the `summaryPdf` rename expectations (lines ~13-18, ~41-49).
- `tests/lib/serial-invariant.test.ts`: remove the `summaryPdf` invariant cases (~66-69, ~111-113).
- `tests/lib/archive.test.ts`: remove/rename the `'moves summaryMd and summaryPdf…'` test (~57) so it only asserts md/html moves.
- `tests/api/backfill.test.ts`: remove the `summaryPdf` fixture (45) and the `'skips PDF regeneration when summaryPdf is null'` test (~139); ensure remaining backfill behavior still asserted.
- `tests/api/regenerate.test.ts`: remove the `summaryPdf` fixture (53); if a "does not fire PDF generation" test remains, delete it (the symbol no longer exists).
- `tests/e2e/playlist-viewer.spec.ts`: delete the entire "View Summary PDF" test (Behavior 8, ~456-475) and the `summaryPdf` in the makeVideo default (~29-31).

- [ ] **Step 5: Strip the two keys from all remaining fixture-only files**

For every file still listed by the Step 2 grep that only *sets* the keys in a fixture object, delete the `summaryPdf: …,` and `deepDivePdf: …,` pairs. Files include (verify against grep, edit each):
`tests/components/VideoMenu.test.tsx`, `VideoList.test.tsx`, `VideoRow.test.tsx`, `VideoList.selection.test.tsx`, `PageIntegration.test.tsx`, `AskGeminiMenuItem.test.tsx`, `tests/lib/serial-assign.test.ts`, `serial-migrate-normalization.test.ts`, `serial-migrate-exec.test.ts`, `types.test.ts`, `video-schema.test.ts`, `index-store.test.ts`, `ask-gemini.test.ts`, `archive-html.test.ts`, `tests/lib/html-doc/ensure.test.ts`, `rerender.test.ts`, `generate.test.ts`, `batch.test.ts`, `eligibility.test.ts`, `generate-deep-dive.test.ts`, `tests/lib/deep-dive/*.test.ts`, `tests/api/html-serve.test.ts`, `html-serve-deep-dive.test.ts`, `dig-post.test.ts`, `dig-state.test.ts`, `videos.test.ts`, `html-doc-pipeline.test.ts`, `deep-dive-html-pipeline.test.ts`, `backfill-serial-prefix.test.ts` (scripts), `tests/e2e/*.spec.ts` (batch-docs, html-doc, deep-dive-doc, dig-deeper).

Note: `VideoMenu.test.tsx:77` and `VideoRow.test.tsx:463` pass the keys via `as any` overrides — remove those props too (they test PDF menu items that no longer render; delete the dead assertions).

- [ ] **Step 6: Verify zero references remain**

```bash
grep -rn "summaryPdf\|deepDivePdf" --include='*.ts' --include='*.tsx' . | grep -v node_modules
```
Expected: no output.

- [ ] **Step 7: Typecheck + full suite**

```bash
npx tsc --noEmit && npm test 2>&1 | tail -20
```
Expected: tsc clean; all tests pass.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor(pdf): remove summaryPdf/deepDivePdf schema fields

Drops the now-vestigial PDF path fields from VideoSchema and every
producer (pipeline, archive, serial-migrate, fix-duplicate-summaries),
deletes the spent migrate-pdfs-to-subfolder script, and clears the
fields from all fixtures/assertions. Zod is non-strict so existing
index.json entries drop the keys on next write — no data migration.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AALGnVtj4uLCXBKEeNSbYf
EOF
)"
```

---

## Verification (post Task 3)

- [ ] `npx tsc --noEmit` clean
- [ ] `npm test` full serial suite green
- [ ] jest exits cleanly (forceExit decision from Task 2 holds)
- [ ] `grep -rn "summaryPdf\|deepDivePdf\|md-to-pdf\|generatePdf" --include='*.ts' --include='*.tsx' .` → no output (outside node_modules)
- [ ] App boots (`npm run dev`); a video menu shows no PDF item; HTML doc opens with working 🖨️ Print
- [ ] No `pdfs/` dirs remain in the data repo
