# Automatic PDF Export — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-video menu buttons that render a summary or dig-deeper HTML doc to a self-contained PDF (headless Chromium) and save it to `{outputFolder}/pdfs/`, with a non-blocking status bar.

**Architecture:** Extract the serve route's doc-HTML builder into a shared `buildDocHtml` (domain-result union), feed its output to `generateDocPdf` (Playwright `setContent`→`page.pdf`, locked-down context, UUID-temp atomic write). A new POST route runs it as an SSE job; a new `PdfStatusBar` reports progress. Pure export-to-disk — no index fields, no serve route (anti-orphan, per PR #50 history).

**Tech Stack:** Next.js 15 (App Router), TypeScript, `playwright` (runtime dep — chromium), Jest + ts-jest, @testing-library/react, Playwright E2E. Test runner uses SWC (no typecheck) → `npx tsc --noEmit` is the real type gate.

## Global Constraints

- **Engine validated by Phase 0 spike** (this session): `import { chromium } from 'playwright'` from Node; ~423ms/PDF; Hangul glyphs OK; `printBackground` colors; `@media print` hides controls; base64 slide JPEG renders. No further spike needed before implementation.
- Server code imports chromium from **`'playwright'`** only — never `@playwright/test`.
- Output: `{outputFolder}/pdfs/{base}.pdf` (summary) and `{base}-dig-deeper.pdf` (dig-deeper); UUID-temp atomic write; overwrite last-wins.
- No index schema fields, no `/api/pdf` serve route. PDFs are user-managed exports.
- "Save summary PDF" enabled only when `video.summaryHtml` present; "Save dig-deeper PDF" only when `video.digDeeperMd` present.
- SSE via existing `lib/job-registry.ts` (`createJob`/`emitJobEvent`/`subscribeJob`/`getActiveJob`/`releaseJobLock`/`deleteJob`). `ProgressEvent` union from `types` (`start`/`step`/`done`/`error`).
- Path safety: every index-derived read goes through `assertIndexRelPathWithin` (Task 1).

---

### Task 1: Shared path-containment helper

**Files:**
- Create: `lib/paths/assert-within.ts`
- Test: `tests/lib/paths/assert-within.test.ts`

**Interfaces:**
- Produces: `assertIndexRelPathWithin(outputFolder: string, rel: string, allowedExt?: string): string` — returns the resolved absolute path; throws `Object.assign(new Error(...), { statusCode: 400 })` if `rel` resolves outside `outputFolder` or (when `allowedExt` given, e.g. `'.md'`) the extension differs.

- [ ] **Step 1: Write failing tests**

```typescript
import { assertIndexRelPathWithin } from '@/lib/paths/assert-within';

const ROOT = '/data/pl/raw';

test('returns resolved absolute path for a safe rel', () => {
  expect(assertIndexRelPathWithin(ROOT, 'htmls/275_x.html')).toBe('/data/pl/raw/htmls/275_x.html');
});
test('admits Unicode (Korean) filenames', () => {
  expect(assertIndexRelPathWithin(ROOT, 'raw/건강.md')).toBe('/data/pl/raw/raw/건강.md');
});
test('rejects ../ traversal', () => {
  expect(() => assertIndexRelPathWithin(ROOT, '../../etc/passwd')).toThrow();
  try { assertIndexRelPathWithin(ROOT, '../x'); } catch (e) { expect((e as {statusCode:number}).statusCode).toBe(400); }
});
test('rejects absolute path escape', () => {
  expect(() => assertIndexRelPathWithin(ROOT, '/etc/passwd')).toThrow();
});
test('enforces allowedExt when provided', () => {
  expect(() => assertIndexRelPathWithin(ROOT, 'htmls/x.html', '.md')).toThrow();
  expect(assertIndexRelPathWithin(ROOT, 'raw/x.md', '.md')).toBe('/data/pl/raw/raw/x.md');
});
```

- [ ] **Step 2: Run to verify fail** — `npx jest assert-within` → FAIL (module not found).

- [ ] **Step 3: Implement**

```typescript
import path from 'path';

/**
 * Resolve an index-derived relative path against outputFolder and assert containment.
 * Throws { statusCode: 400 } if the resolved path escapes outputFolder, or (when allowedExt
 * given) the extension differs. Returns the resolved absolute path on success.
 */
export function assertIndexRelPathWithin(outputFolder: string, rel: string, allowedExt?: string): string {
  const root = path.resolve(outputFolder);
  const abs = path.resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw Object.assign(new Error(`path outside output folder: ${rel}`), { statusCode: 400 });
  }
  if (allowedExt && path.extname(abs).toLowerCase() !== allowedExt.toLowerCase()) {
    throw Object.assign(new Error(`unexpected extension for ${rel}`), { statusCode: 400 });
  }
  return abs;
}
```

- [ ] **Step 4: Run** — `npx jest assert-within` → PASS.
- [ ] **Step 5: Commit** — `git add lib/paths/assert-within.ts tests/lib/paths/assert-within.test.ts && git commit -m "feat: shared assertIndexRelPathWithin path-containment helper"`

---

### Task 2: PDF output path derivation

**Files:**
- Create: `lib/pdf/pdf-path.ts`
- Test: `tests/lib/pdf/pdf-path.test.ts`

**Interfaces:**
- Consumes: `assertIndexRelPathWithin` (Task 1); `Video` type from `@/types`.
- Produces: `pdfRelPath(video: Video, type: 'summary' | 'dig-deeper'): string` → `pdfs/{base}.pdf` or `pdfs/{base}-dig-deeper.pdf`. `base` derived identically to the serve route: summary → `basename(summaryMd)` sans `.md`; dig-deeper → `basename(digDeeperMd)` stripping trailing `-dig-deeper.md` (else sans `.md`). Throws if the required source field is absent.

- [ ] **Step 1: Write failing tests**

```typescript
import { pdfRelPath } from '@/lib/pdf/pdf-path';
import type { Video } from '@/types';

const base = (o: Partial<Video>): Video => ({ id: 'v', /* minimal */ ...o } as Video);

test('summary → pdfs/{base}.pdf', () => {
  expect(pdfRelPath(base({ summaryMd: 'raw/275_google-okf.md' }), 'summary')).toBe('pdfs/275_google-okf.pdf');
});
test('dig-deeper strips -dig-deeper.md', () => {
  expect(pdfRelPath(base({ digDeeperMd: 'raw/275_google-okf-dig-deeper.md' }), 'dig-deeper')).toBe('pdfs/275_google-okf-dig-deeper.pdf');
});
test('summary without summaryMd throws', () => {
  expect(() => pdfRelPath(base({}), 'summary')).toThrow();
});
test('dig-deeper without digDeeperMd throws', () => {
  expect(() => pdfRelPath(base({ summaryMd: 'raw/x.md' }), 'dig-deeper')).toThrow();
});
```

- [ ] **Step 2: Run to verify fail** — `npx jest pdf-path` → FAIL.

- [ ] **Step 3: Implement**

```typescript
import path from 'path';
import type { Video } from '@/types';

export function pdfRelPath(video: Video, type: 'summary' | 'dig-deeper'): string {
  let base: string;
  if (type === 'dig-deeper') {
    if (!video.digDeeperMd) throw new Error('no dig-deeper doc for this video');
    const b = path.basename(video.digDeeperMd);
    base = b.endsWith('-dig-deeper.md') ? b.slice(0, -'-dig-deeper.md'.length) + '-dig-deeper' : b.replace(/\.md$/, '');
  } else {
    if (!video.summaryMd) throw new Error('no summary for this video');
    base = path.basename(video.summaryMd).replace(/\.md$/, '');
  }
  return `pdfs/${base}.pdf`;
}
```

> Note: dig-deeper base keeps the `-dig-deeper` suffix so the file is `…-dig-deeper.pdf` (behavior 2). The serve route strips it to find the *summary* md; here we re-append for the PDF filename.

- [ ] **Step 4: Run** — `npx jest pdf-path` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: pdfRelPath output-path derivation"`

---

### Task 3: Extract shared `buildDocHtml` + refactor serve route

**Files:**
- Create: `lib/html-doc/build-doc-html.ts`
- Modify: `app/api/html/[id]/route.ts` (call the shared builder; map reasons → HTTP)
- Modify: `lib/html-doc/rerender.ts` (guard index-derived reads via `assertIndexRelPathWithin`)
- Test: `tests/lib/html-doc/build-doc-html.test.ts`, `tests/api/html-route-parity.test.ts`

**Interfaces:**
- Produces: `buildDocHtml(videoId: string, outputFolder: string, type: 'summary' | 'dig-deeper'): Promise<BuildResult>` where
  `type BuildResult = { ok: true; html: string } | { ok: false; reason: 'not-found' | 'missing-html' | 'missing-summary' | 'invalid-path' | 'unparseable' }`.
  Logic is the two branches currently inline in `app/api/html/[id]/route.ts:75-197`, verbatim, but returning the union instead of `Response`. The dig-deeper "graceful unavailable" skeleton HTML is returned as `{ ok: true, html }` (it is a valid served page today).
- Consumes: `assertIndexRelPathWithin` (Task 1) for `summaryMd`, `digDeeperMd`, model, html paths.

- [ ] **Step 1: Write failing tests** (build fixtures on disk like existing `render-dig-deeper.test.ts`; assert union shape)

```typescript
import { buildDocHtml } from '@/lib/html-doc/build-doc-html';
// (reuse makeTempDir + index/md fixtures; see tests/lib/html-doc/*.test.ts patterns)

test('summary with current summaryHtml → { ok:true, html }', async () => {
  // arrange: temp folder, index with summaryHtml pointing to a current-version htmls/*.html
  const r = await buildDocHtml('vidA', dir, 'summary');
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.html).toContain('<meta name="generator"');
});
test('summary with no summaryHtml → { ok:false, missing-html }', async () => {
  const r = await buildDocHtml('vidNoHtml', dir, 'summary');
  expect(r).toEqual({ ok: false, reason: 'missing-html' });
});
test('dig-deeper with nothing dug → { ok:true } skeleton', async () => {
  const r = await buildDocHtml('vidDig', dir, 'dig-deeper');
  expect(r.ok).toBe(true);
});
test('crafted digDeeperMd traversal → { ok:false, invalid-path }', async () => {
  const r = await buildDocHtml('vidEvil', dir, 'dig-deeper'); // index digDeeperMd = '../../../etc/x-dig-deeper.md'
  expect(r).toEqual({ ok: false, reason: 'invalid-path' });
});
```

- [ ] **Step 2: Run to verify fail** — `npx jest build-doc-html` → FAIL.

- [ ] **Step 3: Implement `build-doc-html.ts`** by moving the summary + dig-deeper branch logic from `app/api/html/[id]/route.ts` (lines 75-197) into `buildDocHtml`, replacing each `new Response(JSON.stringify({error}), {status})` with `return { ok:false, reason }` and each `serveHtml(x)` with `return { ok:true, html:x }`. Reason mapping: 404 html-missing→`missing-html`; summary-md-missing/unparseable→`missing-summary`/`unparseable`; containment 400→`invalid-path`; video-not-found→`not-found`. Apply `assertIndexRelPathWithin` for `summaryMd`, `digDeeperMd`, `models/{base}.json`, and the `htmls/*.html` rel.

- [ ] **Step 4: Refactor the serve route** to call `buildDocHtml` and map:

```typescript
const r = await buildDocHtml(videoId, outputFolder, type);
if (r.ok) return new Response(r.html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
const status = r.reason === 'invalid-path' ? 400 : 404;
return new Response(JSON.stringify({ error: r.reason }), { status });
```

Keep the top-level `outputFolder`/`assertOutputFolder`/`assertVideoId`/`type` validation in the route (HTTP concern).

- [ ] **Step 5: Guard `rerender.ts` reads** — wrap `video.summaryMd` (and any derived md/model reads) with `assertIndexRelPathWithin(outputFolder, video.summaryMd, '.md')` before `fs.readFileSync`.

- [ ] **Step 6: Byte-parity regression test** — `tests/api/html-route-parity.test.ts`: for a fixture folder, assert the serve route's HTML output for summary and dig-deeper is unchanged vs a captured golden (snapshot the pre-refactor output first, then confirm equality after refactor).

- [ ] **Step 7: Run** — `npx jest build-doc-html html-route-parity rerender` → PASS. Then `npx jest` (full) to confirm existing html/serve tests still pass.

- [ ] **Step 8: Type gate** — `npx tsc --noEmit`.

- [ ] **Step 9: Commit** — `git commit -m "refactor: extract buildDocHtml (domain-result union) + path-guard index reads"`

---

### Task 4: `generateDocPdf` (Playwright) + runtime dependency

**Files:**
- Modify: `package.json` (add `playwright` to `dependencies`), `next.config.ts` (`serverExternalPackages: ['playwright']`)
- Create: `lib/pdf/generate-doc-pdf.ts`
- Test: `tests/lib/pdf/generate-doc-pdf.test.ts` (mock `playwright` at module boundary)

**Interfaces:**
- Produces: `generateDocPdf(html: string, absOutPath: string, opts?: { timeoutMs?: number }): Promise<void>` — renders `html` to a PDF at `absOutPath` via chromium; creates the parent dir; writes to a UUID temp then renames; closes page+browser in `finally`; removes temp on failure; throws a clear error with an install hint if launch fails.

- [ ] **Step 1: Add the dependency + config**

```bash
npm install --save playwright@^1.60.0
```
In `next.config.ts`, add to the config object: `serverExternalPackages: ['playwright'],` (Next 15 top-level key; if the file uses `experimental.serverComponentsExternalPackages`, match the installed Next's key — check `node_modules/next/dist/docs` per AGENTS.md before editing).

- [ ] **Step 2: Write failing tests** (mock chromium so no real browser launches)

```typescript
jest.mock('playwright', () => {
  const pdf = jest.fn(async () => Buffer.from('%PDF-1.7 fake'));
  const page = { setContent: jest.fn(), emulateMedia: jest.fn(), pdf, close: jest.fn(), setDefaultTimeout: jest.fn(), route: jest.fn() };
  const context = { newPage: jest.fn(async () => page), close: jest.fn() };
  const browser = { newContext: jest.fn(async () => context), close: jest.fn(), newPage: jest.fn(async () => page) };
  return { chromium: { launch: jest.fn(async () => browser) }, __mock: { page, context, browser, pdf } };
});
import { generateDocPdf } from '@/lib/pdf/generate-doc-pdf';
import fs from 'fs';
import os from 'os';
import path from 'path';

test('writes a PDF to the target path and creates pdfs/ dir', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-'));
  const out = path.join(dir, 'pdfs', 'x.pdf');
  await generateDocPdf('<html></html>', out);
  expect(fs.existsSync(out)).toBe(true);
  expect(fs.readFileSync(out).subarray(0, 5).toString('latin1')).toBe('%PDF-');
});
test('emulates print media and disables JS/network hardening', async () => {
  const { __mock } = jest.requireMock('playwright');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-'));
  await generateDocPdf('<html></html>', path.join(dir, 'pdfs', 'y.pdf'));
  expect(__mock.page.emulateMedia).toHaveBeenCalledWith({ media: 'print' });
  expect(__mock.pdf).toHaveBeenCalledWith(expect.objectContaining({ printBackground: true }));
  expect(__mock.browser.close).toHaveBeenCalled(); // closed in finally
});
test('leaves no temp file after success', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-'));
  const out = path.join(dir, 'pdfs', 'z.pdf');
  await generateDocPdf('<html></html>', out);
  const leftovers = fs.readdirSync(path.join(dir, 'pdfs')).filter((f) => f.endsWith('.tmp'));
  expect(leftovers).toEqual([]);
});
```

- [ ] **Step 3: Run to verify fail** — `npx jest generate-doc-pdf` → FAIL.

- [ ] **Step 4: Implement**

```typescript
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const DEFAULT_TIMEOUT_MS = 30_000;

export async function generateDocPdf(html: string, absOutPath: string, opts: { timeoutMs?: number } = {}): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const { chromium } = await import('playwright'); // lazy: only load when a PDF is actually requested
  const dir = path.dirname(absOutPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(absOutPath, '.pdf')}.${crypto.randomUUID()}.pdf.tmp`);

  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  try {
    try {
      browser = await chromium.launch();
    } catch (err) {
      throw new Error(`Failed to launch Chromium for PDF export. Run: npx playwright install chromium\n${(err as Error).message}`);
    }
    // Locked-down context: static self-contained doc needs no JS or network.
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);
    await page.route('**/*', (route) => {
      route.request().url().startsWith('data:') ? route.continue() : route.abort();
    });
    await page.setContent(html, { waitUntil: 'load' });
    await page.emulateMedia({ media: 'print' });
    const buf = await page.pdf({ printBackground: true, format: 'A4' });
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, absOutPath);
  } finally {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* ignore */ }
    if (browser) { try { await browser.close(); } catch { /* ignore */ } }
  }
}
```

> `setContent` uses `about:blank` (allowed); all base64 images are `data:` (allowed); everything else is aborted. `waitUntil:'load'` resolves once inline content is parsed.

- [ ] **Step 5: Run** — `npx jest generate-doc-pdf` → PASS.

- [ ] **Step 6: Real smoke (manual, not committed as a jest test)** — a scratch script that calls `generateDocPdf(realDigDeeperHtml, /tmp/smoke.pdf)` and asserts a >10KB `%PDF-` file with a visible page. (Phase 0 spike already proved the engine; this confirms the wired function.)

- [ ] **Step 7: Type gate + build** — `npx tsc --noEmit` and `npm run build` (confirms `playwright` as a real dep does not break the Next build).

- [ ] **Step 8: Commit** — `git commit -m "feat: generateDocPdf — chromium print-to-pdf with UUID-temp atomic write"`

---

### Task 5: PDF API routes (POST + SSE stream)

**Files:**
- Create: `app/api/videos/[id]/pdf/route.ts`, `app/api/videos/[id]/pdf/stream/route.ts`
- Test: `tests/api/pdf-route.test.ts`

**Interfaces:**
- POST `/api/videos/[id]/pdf` body `{ outputFolder, type: 'summary'|'dig-deeper' }` → `{ jobId }` (400 on missing/invalid; 404 when the doc source is unavailable). Runs `buildDocHtml` → `generateDocPdf` into `path.resolve(outputFolder, pdfRelPath(video, type))` (containment via `assertIndexRelPathWithin(outputFolder, rel)`), emitting `start`→`step`→`done`/`error` on the job.
- GET `/api/videos/[id]/pdf/stream?jobId=` → SSE (identical shape to `html-doc/stream/route.ts`).

- [ ] **Step 1: Write failing tests** (mock `generate-doc-pdf` + `build-doc-html`; use `_resetJobRegistry`)

```typescript
jest.mock('@/lib/pdf/generate-doc-pdf', () => ({ generateDocPdf: jest.fn(async () => {}) }));
jest.mock('@/lib/html-doc/build-doc-html', () => ({ buildDocHtml: jest.fn(async () => ({ ok: true, html: '<html></html>' })) }));
// POST returns jobId; missing outputFolder → 400; bad type → 400.
// done event includes the saved file basename.
```

- [ ] **Step 2: Run to verify fail** — `npx jest pdf-route` → FAIL.

- [ ] **Step 3: Implement POST** (mirror `html-doc/route.ts`: validate, `getActiveJob` guard keyed `${outputFolder}::${videoId}::${type}`, `createJob`, run async, `emitJobEvent`, `releaseJobLock`+grace-delete on terminal):

```typescript
// after validation + readIndex/find video (404 if absent):
const buildResult = await buildDocHtml(videoId, outputFolder, type);
if (!buildResult.ok) {
  const status = buildResult.reason === 'invalid-path' ? 400 : 404;
  return NextResponse.json({ error: buildResult.reason }, { status });
}
let rel: string;
try { rel = pdfRelPath(video, type); assertIndexRelPathWithin(outputFolder, rel); }
catch { return NextResponse.json({ error: 'invalid path' }, { status: 400 }); }
const absOut = path.resolve(outputFolder, rel);
const jobId = crypto.randomUUID();
createJob(jobId, key);
emitJobEvent(jobId, { type: 'start' });
generateDocPdf(buildResult.html, absOut)
  .then(() => { emitJobEvent(jobId, { type: 'done', total: 1, current: 1, log: path.basename(rel) }); onTerminal(); })
  .catch((err) => { logError(`pdf:${videoId}`, err); emitJobEvent(jobId, { type: 'error', log: errorSummary(err) }); onTerminal(); });
return NextResponse.json({ jobId });
```

(Emit an intermediate `{ type:'step', step:'Rendering PDF…', current:1, total:1 }` before `generateDocPdf` for the bar.)

- [ ] **Step 4: Implement stream route** — copy `html-doc/stream/route.ts` verbatim (path depth is the same: `../../../../../../lib/job-registry`).

- [ ] **Step 5: Run** — `npx jest pdf-route` → PASS.
- [ ] **Step 6: Type gate** — `npx tsc --noEmit`.
- [ ] **Step 7: Commit** — `git commit -m "feat: /api/videos/[id]/pdf POST + SSE stream"`

---

### Task 6: `PdfStatusBar` component

**Files:**
- Create: `components/PdfStatusBar.tsx`
- Test: `tests/components/PdfStatusBar.test.tsx`

**Interfaces:**
- Produces: `PdfStatusBar({ videoId, jobId, title, onClose, onError? })` — non-blocking bottom bar. Subscribes to `/api/videos/[id]/pdf/stream?jobId=`. States: running (`Saving PDF — <title>… <step>`), done (`Saved pdfs/<file>` — NO anchor; `<file>` = the `done` event's `log`), error (`PDF failed — <message>`). ✕ dismiss; auto-dismiss ~2.5s on done, ~5s on error.

- [ ] **Step 1: Write failing tests** (mock `EventSource`; assert copy + no anchor on done + dismissal). Model on any existing status-bar test; if none, use RTL with a fake EventSource pushing `done` `{ type:'done', log:'275_x.pdf' }` and assert `getByText(/Saved pdfs\/275_x\.pdf/)` and `queryByRole('link')` is null.

- [ ] **Step 2: Run to verify fail** — `npx jest PdfStatusBar` → FAIL.

- [ ] **Step 3: Implement** by adapting `HtmlDocStatusBar.tsx`: same EventSource lifecycle; drop `viewUrl`/anchor; on `done` render a plain `<span>Saved pdfs/{file}</span>` using the `done` event's `log`; heading label `Saving PDF`.

- [ ] **Step 4: Run** — `npx jest PdfStatusBar` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: PdfStatusBar non-blocking progress bar"`

---

### Task 7: VideoMenu items + page wiring

**Files:**
- Modify: `components/VideoMenu.tsx` (two items), `app/page.tsx` (handler + `pdfJob` state + render `PdfStatusBar`)
- Test: `tests/components/VideoMenu.test.tsx` (extend)

**Interfaces:**
- `VideoMenu` gains prop `onSavePdf: (videoId: string, type: 'summary' | 'dig-deeper') => void`. Renders "Save summary PDF" only when `video.summaryHtml` is set; "Save dig-deeper PDF" only when `video.digDeeperMd` is set. Both disabled while `busy`.
- `page.tsx`: `handleSavePdf(videoId, type)` POSTs `/api/videos/${id}/pdf` with `{ outputFolder, type }`, sets `pdfJob = { jobId, videoId, title, file? }`; renders `<PdfStatusBar … onClose={() => setPdfJob(null)} />`.

- [ ] **Step 1: Write failing component tests**

```typescript
// "Save summary PDF" present when summaryHtml set; absent when only summaryMd.
// "Save dig-deeper PDF" present only when digDeeperMd set.
// clicking calls onSavePdf(video.id, 'summary'|'dig-deeper') and onClose.
```

- [ ] **Step 2: Run to verify fail** — `npx jest VideoMenu` → FAIL.

- [ ] **Step 3: Implement menu items** (after the Re-summarize `<li>`):

```tsx
{video.summaryHtml && (
  <li role="none">
    {busy
      ? <span aria-disabled="true" className={disabledClass}>Save summary PDF <span aria-hidden="true">⏳</span></span>
      : <button type="button" onClick={() => { onSavePdf(video.id, 'summary'); onClose(); }} className={itemClass}>Save summary PDF</button>}
  </li>
)}
{video.digDeeperMd && (
  <li role="none">
    {busy
      ? <span aria-disabled="true" className={disabledClass}>Save dig-deeper PDF <span aria-hidden="true">⏳</span></span>
      : <button type="button" onClick={() => { onSavePdf(video.id, 'dig-deeper'); onClose(); }} className={itemClass}>Save dig-deeper PDF</button>}
  </li>
)}
```

- [ ] **Step 4: Wire `page.tsx`** — add `onSavePdf={handleSavePdf}` where `VideoMenu` is rendered; add `pdfJob` state + `handleSavePdf` (POST, set state) + render `PdfStatusBar` near where `HtmlDocStatusBar` is rendered. Follow the existing `handleGenerateHtml` pattern for POST + job state.

- [ ] **Step 5: Run** — `npx jest VideoMenu` → PASS; then `npx jest` (full).
- [ ] **Step 6: Type gate** — `npx tsc --noEmit`.
- [ ] **Step 7: Commit** — `git commit -m "feat: Save summary/dig-deeper PDF menu items + page wiring"`

---

### Task 8: E2E — menu → status bar → done

**Files:**
- Test: `tests/e2e/pdf-export.spec.ts`

**Interfaces:**
- Consumes: the app under `next dev`; stub the PDF POST + stream routes (do NOT launch a real browser in E2E). Fixture: a video with `summaryHtml` and `digDeeperMd` set.

- [ ] **Step 1: Write the E2E test** — stub `POST **/api/videos/*/pdf` → `{ jobId }` and `GET **/api/videos/*/pdf/stream**` → SSE `data: {"type":"start"}` then `data: {"type":"done","log":"275_x.pdf"}`. Open the row menu, click "Save summary PDF", assert the bottom bar appears with `Saving PDF`, then `Saved pdfs/275_x.pdf`, then auto-dismisses. Repeat for "Save dig-deeper PDF".

- [ ] **Step 2: Run** — `npx playwright test pdf-export`. Expected PASS.
- [ ] **Step 3: Commit** — `git commit -m "test(e2e): PDF export menu → status bar flow"`

---

## Self-Review

- **Spec coverage:** Behaviors 1–2 → Task 2; 3–5,13,13b,13c → Task 4; 6–8,12b → Task 3; 9–10 → Task 5; 11,11b → Task 7; 12 → Tasks 2/5; 14–15 → Phase 0 spike (validated) + Task 4 smoke; 16 (stale-rename) → documented as user-managed, no code. Retention/anti-orphan → Tasks by omission (no index/serve route). All spec sections map to a task.
- **Placeholder scan:** Byte-parity golden (Task 3 Step 6) and the real smoke (Task 4 Step 6) are described with concrete assertions, not "add tests". No TBD/TODO.
- **Type consistency:** `buildDocHtml` union (`{ok:true,html}|{ok:false,reason}`) is produced in Task 3 and consumed in Tasks 4-caller/5; `pdfRelPath(video,type)` signature consistent across Tasks 2/5; `generateDocPdf(html,absOutPath,opts?)` consistent across Tasks 4/5; `assertIndexRelPathWithin` signature consistent across Tasks 1/3/5. `PdfStatusBar` props match page wiring in Task 7.
- **AGENTS.md caveat:** Task 4 Step 1 flags checking `node_modules/next/dist/docs` for the correct `serverExternalPackages` key name before editing `next.config.ts`.
