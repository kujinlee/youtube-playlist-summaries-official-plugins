# Sync Progress, Print Export & Doc-Version Refresh — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show new-items progress during Sync, replace server-side PDF generation with a Print button on the HTML docs, and bump both doc versions so existing docs can re-render into the new styles + Print button.

**Architecture:** Pure edits to the ingest pipeline, the main page's progress UI, the two HTML-doc renderers + shared theme module, the doc-version constants, and the row menu. PDF generation is removed at its three call sites; the `/api/pdf` route, the `summaryPdf`/`deepDivePdf` fields, `lib/pdf.ts`, and existing `.pdf` files are left dormant. Re-render stays lazy/menu-gated (no serve-route change).

**Tech Stack:** TypeScript, Next.js (App Router), React, jest + ts-jest, @testing-library/react, markdown-it (`html:false`).

## Global Constraints

- The project gates on `npx tsc --noEmit` — **no unused locals/imports may remain** after PDF removal.
- markdown-it stays `html:false`; injected chrome (Print button) is template-literal HTML we emit directly.
- `ProgressEvent` `'step'` `current`/`total` are `int().positive()` — only emit `'step'` for NEW videos (so both ≥ 1). `'start'`/`'done'` `total` are `nonnegative` (0 allowed).
- The stored `playlistIndex` field MUST remain the playlist position (`i + 1`), NOT the new-items counter.
- Version-bump re-render is lazy/menu-gated; the serve route is unchanged (no auto-refresh on GET).
- Run the narrowest test first; full `npm test` + `npx tsc --noEmit` green before each commit.
- Dual review per task (Claude + Codex/fallback); save to `docs/reviews/`.

---

### Task 1: Remove server-side PDF generation

**Files:**
- Modify: `lib/pipeline.ts` (import line 5; ingest loop ~316–355; `Video` record line 334)
- Modify: `app/api/videos/[id]/regenerate/route.ts` (import line 7; block lines 71–78)
- Modify: `app/api/quick-view/backfill/route.ts` (import line 6; lines 49, 54, 82–91, 105, 107)
- Test: `tests/lib/pipeline.test.ts`, `tests/api/regenerate.test.ts`, `tests/api/backfill.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: ingest no longer calls `generatePdf`; new `Video.summaryPdf` is `null`. `SummaryDocResult.mdContent` is **kept** (still built for the `.md` write).

- [ ] **Step 1: Update the failing tests first**

In `tests/lib/pipeline.test.ts` (it already does `jest.mock('../../lib/pdf')` with a `mockGeneratePdf`):
- Add an assertion in the main ingest test that PDF is never generated and the field is null:
```ts
    expect(mockGeneratePdf).not.toHaveBeenCalled();
```
- Change the existing `upsertVideo` expectations that assert `summaryPdf: 'pdfs/hello-world.pdf'` (and any other `summaryPdf: 'pdfs/…'`) to:
```ts
        summaryPdf: null,
```
- If any test asserts a `'Generating PDF…'` step was emitted, delete that assertion.

In `tests/api/regenerate.test.ts`, change the PDF assertion (currently `toHaveBeenCalled()`):
```ts
    expect(mockGeneratePdf).not.toHaveBeenCalled();
```
(Keep the `jest.mock('../../../../../lib/pdf')` and the `mockGeneratePdf` binding so it stays referenced.)

In `tests/api/backfill.test.ts`, ensure the PDF assertion is unconditional:
```ts
    expect(mockGeneratePdf).not.toHaveBeenCalled();
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest pipeline.test regenerate.test backfill.test`
Expected: FAIL — current code calls `generatePdf` and sets `summaryPdf: 'pdfs/…'`.

- [ ] **Step 3: Remove PDF generation from `lib/pipeline.ts`**

Delete the import (line 5): `import { generatePdf } from './pdf';`

In the ingest loop, drop `mdContent` from the destructure (line 316):
```ts
      const { language, ratings, overallScore, videoType, audience, tags, tldr, takeaways } =
        await writeSummaryDoc({
          videoId: meta.videoId, title: meta.title, youtubeUrl: meta.youtubeUrl,
          channel: meta.channelTitle, durationSeconds: meta.durationSeconds, outputFolder, baseName,
        });
```
Delete the two PDF lines (321–322):
```ts
      fs.mkdirSync(path.join(outputFolder, 'pdfs'), { recursive: true });
      const pdfPath = path.join(outputFolder, 'pdfs', `${baseName}.pdf`);
```
Change the `Video` record (line 334) to:
```ts
        summaryPdf: null,
```
Delete the `'Generating PDF…'` step + the `generatePdf` call (lines 354–355) entirely, so the flow goes from `alreadyIndexed.add(...)` straight to the `'Saved'` step.

(`SummaryDocResult.mdContent` on the interface/return stays — `writeSummaryDoc` still builds it for the `.md`. Update the stale comment on `writeSummaryDoc` (line 40) to drop the "ingestion keeps generating PDFs" clause.)

- [ ] **Step 4: Remove PDF from the regenerate route**

In `app/api/videos/[id]/regenerate/route.ts`: delete the import (line 7) `import { generatePdf } from '../../../../../lib/pdf';` and the whole block (lines 71–78):
```ts
    // PDF regeneration fires in background — same pattern as backfill.
    // Failure is non-critical; the .md is already updated.
    if (video.summaryPdf) {
      const pdfPath = path.join(outputFolder, video.summaryPdf);
      generatePdf(updatedContent, pdfPath).catch(() => {
        // swallow — PDF is a convenience copy; .md is the source of truth
      });
    }
```

- [ ] **Step 5: Remove PDF from the backfill route**

In `app/api/quick-view/backfill/route.ts`: delete the import (line 6) `import { generatePdf } from '../../../../lib/pdf';`; delete `let pdfFailed = 0;` (line 49); delete the `pdfTasks` declaration + comment (lines 51–54); delete the background-PDF block (lines 82–91); delete `await Promise.all(pdfTasks);` and its comment (lines 104–105); change the done emit (line 107) to:
```ts
      emit({ type: 'done', total, succeeded, failed });
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx jest pipeline.test regenerate.test backfill.test`
Expected: PASS.

- [ ] **Step 7: Full suite + typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: all green, no unused-local errors.

- [ ] **Step 8: Review (Claude + Codex/fallback) → `docs/reviews/task-1-remove-pdf-generation-*.md`; address High/Important; re-run tests.**

- [ ] **Step 9: Commit**

```bash
git add lib/pipeline.ts "app/api/videos/[id]/regenerate/route.ts" app/api/quick-view/backfill/route.ts tests/lib/pipeline.test.ts tests/api/regenerate.test.ts tests/api/backfill.test.ts docs/reviews/task-1-*
git commit -m "refactor(pdf): stop generating PDFs in ingest/regenerate/backfill"
```

---

### Task 2: New-items Sync progress

**Files:**
- Modify: `lib/pipeline.ts` (`runIngestion` ~276–303, 315–357, 395)
- Modify: `app/page.tsx` (`IngestState`/`IDLE_INGEST` lines 15–22; SSE handler 197–207; render 425–460)
- Test: `tests/lib/pipeline.test.ts` (add E2E covered by Playwright for the UI)

**Interfaces:**
- Consumes: Task 1's PDF-free loop.
- Produces: `'start'`/`'step'`/`'done'` carry new-items `total`; `'step'` carries `current` (new index, ≥1) + `title`. `IngestState` gains `current`, `total`, `title`.

- [ ] **Step 1: Write the failing pipeline tests**

Add to `tests/lib/pipeline.test.ts` (a describe for new-items progress). Use the existing mock setup; the key assertions:
```ts
  it('counts only new (not-yet-indexed) videos in progress totals', async () => {
    // Arrange: index already has video 'a'; playlist returns [a, b, c] (b,c are new).
    // (Reuse the file's existing playlist/index mocks; seed the index with one already-indexed id.)
    const events: ProgressEvent[] = [];
    await runIngestion('https://playlist', outputFolder, (e) => events.push(e));

    const start = events.find((e) => e.type === 'start');
    expect(start).toMatchObject({ type: 'start', total: 2 }); // 2 new, not 3

    const steps = events.filter((e) => e.type === 'step');
    // No skip step for the already-indexed video:
    expect(steps.some((s) => s.step === 'Already processed — skipped')).toBe(false);
    // New videos carry new-basis current/total + title:
    const saved = steps.filter((s) => s.step === 'Saved');
    expect(saved.map((s) => s.current)).toEqual([1, 2]);
    expect(saved.every((s) => s.total === 2)).toBe(true);
    expect(saved.every((s) => typeof s.title === 'string' && s.title.length > 0)).toBe(true);
  });

  it('stores playlistIndex as the playlist position, not the new-items counter', async () => {
    // Playlist [a(indexed), b(new)] → b is new #1 but at playlist position 2.
    await runIngestion('https://playlist', outputFolder, () => {});
    const stored = /* read the index for video b via the test's index helper */;
    expect(stored.playlistIndex).toBe(2);   // playlist position, not 1
  });

  it('emits done with total 0 when there are no new videos', async () => {
    // Index already contains every playlist id.
    const events: ProgressEvent[] = [];
    await runIngestion('https://playlist', outputFolder, (e) => events.push(e));
    expect(events.filter((e) => e.type === 'step')).toHaveLength(0);
    expect(events.find((e) => e.type === 'done')).toMatchObject({ type: 'done', total: 0 });
  });
```
(Wire the index/playlist fixtures the same way the existing pipeline tests do — seed `readIndex` with the already-indexed id and `fetchPlaylistVideos` with the playlist metas.)

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest pipeline.test -t "new"`
Expected: FAIL — current code uses full-playlist `total`, emits a skip step, and stores nothing distinct.

- [ ] **Step 3: Implement the new-items counter in `runIngestion`**

Replace `const total = metas.length;` (line 276) — remove it (inline `metas.length` at the loop bound). After building `alreadyIndexed` (line 287), add:
```ts
  // Progress is over NEW (not-yet-indexed) distinct videos only — skips are instant and
  // must not inflate the bar. playlistPos (below) stays the true playlist position.
  const newTotal = new Set(metas.filter((m) => !alreadyIndexed.has(m.videoId)).map((m) => m.videoId)).size;
  let newIndex = 0;
```
Change the start emit (line 289):
```ts
  onProgress({ type: 'start', total: newTotal });
```
In the loop, replace `const current = i + 1;` (line 298) with:
```ts
    const playlistPos = i + 1;
```
Replace the skip branch (lines 302–305) with a silent continue:
```ts
      if (alreadyIndexed.has(meta.videoId)) {
        continue;
      }
```
Right after the skip check, start the new-video counter:
```ts
      newIndex += 1;
```
In every `'step'` emit for this video (the `Fetching transcript…`, `Generating summary…`, `Saved` emits), use `current: newIndex, total: newTotal`. E.g.:
```ts
      onProgress({ type: 'step', videoId: meta.videoId, title: meta.title, step: 'Fetching transcript…', current: newIndex, total: newTotal });
      ...
      onProgress({ type: 'step', videoId: meta.videoId, title: meta.title, step: 'Generating summary…', current: newIndex, total: newTotal });
      ...
      onProgress({ type: 'step', videoId: meta.videoId, title: meta.title, step: 'Saved', current: newIndex, total: newTotal });
```
Change `playlistIndex: current` (line 339) to:
```ts
        playlistIndex: playlistPos,
```
Change the final done emit (line 395):
```ts
  onProgress({ type: 'done', total: newTotal });
```
(The reconcile-tail `positionMap` at 381 already uses `idx + 1`, independent of these counters — leave it.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest pipeline.test`
Expected: PASS.

- [ ] **Step 5: Update the progress UI in `app/page.tsx`**

Extend `IngestState` (lines 15–20) and `IDLE_INGEST` (line 22):
```ts
interface IngestState {
  status: IngestStatus;
  step: string;
  progress: number;
  error: string;
  current: number;
  total: number;
  title: string;
}

const IDLE_INGEST: IngestState = { status: 'idle', step: '', progress: 0, error: '', current: 0, total: 0, title: '' };
```
In the `'step'` branch of the SSE handler (lines 197–202), carry the new fields:
```ts
        if (data.type === 'step') {
          const progress =
            data.current != null && data.total != null && data.total > 0
              ? Math.min(100, Math.round((data.current / data.total) * 100))
              : 0;
          setIngest({
            status: 'running', step: data.step, progress, error: '',
            current: data.current ?? 0, total: data.total ?? 0, title: data.title ?? '',
          });
```
Replace the single step label line (line 452) with the new-items count + title:
```tsx
              {ingest.total > 0 && (
                <p className="text-xs text-zinc-400">
                  New video {ingest.current} of {ingest.total}
                  {ingest.step ? ` · ${ingest.step}` : ''}
                </p>
              )}
              {ingest.title && <p className="text-xs text-zinc-500 truncate">{ingest.title}</p>}
```
Add a "no new videos" message: in the `'done'`/`'cancelled'` branch (lines 211–219), before resetting to idle, if no step was ever seen the bar simply disappears (status→idle). To surface the up-to-date case, add a transient note — set a small state `lastSyncNote`:
```ts
        } else if (data.type === 'done' || data.type === 'cancelled') {
          terminal = true;
          es.close();
          ingestESRef.current = null;
          ingestJobIdRef.current = null;
          if (data.type === 'done' && data.total === 0) {
            setSyncNote('Sync complete — no new videos.');
          }
          setIngest(IDLE_INGEST);
          const { col, order } = sortRef.current;
          fetchVideos(folder, col, order);
        }
```
Add `const [syncNote, setSyncNote] = useState('');` near the other state, render it as a dismissible line under the Sync controls (cleared on the next sync start), e.g. near the ingestion section:
```tsx
      {syncNote && ingest.status === 'idle' && (
        <p className="px-6 py-1 text-xs text-zinc-400">{syncNote}</p>
      )}
```
Clear it on sync start: in `handleIngest` (≈ `app/page.tsx:162`), add `setSyncNote('');` immediately before the `setIngest({ status: 'running', ... })` call that begins ingestion (H1).

**REQUIRED for `tsc` (B3): update the OTHER three `setIngest({...})` object literals** so they satisfy the now-required `current`/`total`/`title` fields. There are four `setIngest({...})` literals total; besides the `'step'` one above, add `current: 0, total: 0, title: ''` to each of:
- the sync-start literal at `≈ app/page.tsx:162` (`{ status: 'running', step: '', progress: 0, error: '' }`)
- the POST-error literal at `≈ :178`
- the connection-lost literal in `es.onerror` at `≈ :228`
Verify with `npx tsc --noEmit` that no "missing properties" error remains. (Alternatively make the three fields optional on `IngestState`; the explicit-init approach is preferred to match `IDLE_INGEST`.)

- [ ] **Step 6: Full suite + typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: green. (UI behavior is exercised by E2E in Task… the existing Playwright ingest test — update its progress-text expectation if it asserts the old label; otherwise no change.)

- [ ] **Step 7: Review (Claude + Codex/fallback) → `docs/reviews/task-2-new-items-progress-*.md`; address findings; re-run tests.**

- [ ] **Step 8: Commit**

```bash
git add lib/pipeline.ts app/page.tsx tests/lib/pipeline.test.ts docs/reviews/task-2-*
git commit -m "feat(sync): show new-items progress (N of M) + current title"
```

---

### Task 3: Remove the PDF menu items

**Files:**
- Modify: `components/VideoMenu.tsx` (lines 44–48 derived vars; lines 71–87 and 124–139 menu items)
- Test: `tests/components/VideoMenu.test.tsx`

**Interfaces:** Consumes nothing; produces a menu with no PDF entries.

- [ ] **Step 1: Update the test first**

In `tests/components/VideoMenu.test.tsx`, replace any assertion that "View Summary PDF" / "View Deep Dive PDF" render with their absence:
```ts
  it('does not render PDF menu items (PDF generation removed)', () => {
    render(<VideoMenu {...baseProps} />);
    expect(screen.queryByText('View Summary PDF')).not.toBeInTheDocument();
    expect(screen.queryByText('View Deep Dive PDF')).not.toBeInTheDocument();
  });
```
Keep/confirm the existing assertions for the surviving items ("Watch on YouTube", "Open in Obsidian", "HTML doc", "Deep Dive doc", "Archive").

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest VideoMenu`
Expected: FAIL — the PDF items still render.

- [ ] **Step 3: Remove the PDF items from `VideoMenu.tsx`**

Delete `const hasSummaryPdf = !!video.summaryPdf;` and `const hasDeepDivePdf = !!video.deepDivePdf;` (lines 44–45) and `const pdfBase = …;` (line 48). Delete the entire "View Summary PDF" `<li>` (lines 71–87) and the entire "View Deep Dive PDF" `<li>` (lines 124–139). Leave all other items unchanged.

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest VideoMenu`
Expected: PASS.

- [ ] **Step 5: Full suite + typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: green (no unused `disabledClass`? it is still used by the "HTML doc"/"Deep Dive doc"/"Open Deep Dive in Obsidian" disabled branches — confirm it stays referenced).

- [ ] **Step 6: Review → `docs/reviews/task-3-remove-pdf-menu-*.md`; address findings; re-run.**

- [ ] **Step 7: Commit**

```bash
git add components/VideoMenu.tsx tests/components/VideoMenu.test.tsx docs/reviews/task-3-*
git commit -m "feat(menu): remove View PDF items (PDF replaced by Print on HTML docs)"
```

---

### Task 4: Print button on the HTML docs

**Files:**
- Modify: `lib/html-doc/theme.ts` (add `PRINT_BUTTON`; extend button + print CSS in `themeStyleBlock`)
- Modify: `lib/html-doc/render.ts` (import + inject at line 108)
- Modify: `lib/html-doc/render-deep-dive.ts` (import + inject at line 198)
- Test: `tests/lib/html-doc/theme.test.ts`, `tests/lib/html-doc/render.test.ts`, `tests/lib/html-doc/render-deep-dive.test.ts`

**Interfaces:**
- Produces: `PRINT_BUTTON` constant exported from `theme.ts`; both rendered docs contain `id="print-btn"` with `onclick="window.print()"`, hidden in print.

- [ ] **Step 1: Write the failing tests**

In `tests/lib/html-doc/theme.test.ts`:
```ts
  it('exports a print button with a window.print() handler', () => {
    expect(PRINT_BUTTON).toContain('id="print-btn"');
    expect(PRINT_BUTTON).toContain('onclick="window.print()"');
  });
```
(import `PRINT_BUTTON` alongside the existing theme imports.)

**Also update the TWO existing `theme.test.ts` assertions the CSS change will break (B2):**
- the button-style assertion `expect(css).toContain('#theme-toggle{')` (≈ line 33) → `expect(css).toContain('#theme-toggle,#print-btn{')`
- the print-hide assertion `expect(css).toContain('#theme-toggle{display:none}')` (≈ line 48) → `expect(css).toContain('#theme-toggle,#print-btn{display:none}')`

In both `tests/lib/html-doc/render.test.ts` and `tests/lib/html-doc/render-deep-dive.test.ts`, add (using each file's existing rendered `html` string). **Use a literal substring, NOT a `[^}]*` regex** — the print rule contains an inner `{…vars…}` palette block, so `[^}]*` would stop at the first `}` before `#print-btn` and never match (B1):
```ts
  it('includes a Print button hidden in print', () => {
    expect(html).toContain('id="print-btn"');
    expect(html).toContain('onclick="window.print()"');
    expect(html).toContain('#theme-toggle,#print-btn{display:none}');
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest theme.test render.test render-deep-dive`
Expected: FAIL — `PRINT_BUTTON` undefined; no `print-btn` in output.

- [ ] **Step 3: Add `PRINT_BUTTON` + CSS in `theme.ts`**

After `THEME_TOGGLE_BUTTON` (line 85), add:
```ts
/** Print button markup, injected next to the theme toggle. Inline window.print() — safe: these
 * are self-contained docs we emit directly (markdown-it html:false governs content, not chrome). */
export const PRINT_BUTTON =
  `<button id="print-btn" type="button" onclick="window.print()" aria-label="Print" title="Print">\u{1F5A8}\u{FE0F}</button>`;
```
In `themeStyleBlock` change the transition line (67), the button-style line (68), and the print line (69):
```
html.theme-ready body,html.theme-ready #theme-toggle,html.theme-ready #print-btn{transition:background-color .2s,color .2s}
#theme-toggle,#print-btn{position:fixed;top:1rem;width:2.4rem;height:2.4rem;border-radius:50%;border:1px solid rgba(128,128,128,.35);background:var(--card);color:var(--ink);font-size:1.1rem;line-height:1;cursor:pointer;box-shadow:var(--shadow);display:flex;align-items:center;justify-content:center;z-index:10}
#theme-toggle{right:1rem}#print-btn{right:3.6rem}
@media print{:root,:root:not([data-theme]),[data-theme="light"],[data-theme="dark"]{${l}}#theme-toggle,#print-btn{display:none}}
```

- [ ] **Step 4: Inject `PRINT_BUTTON` in both renderers**

In `lib/html-doc/render.ts`: add `PRINT_BUTTON` to the theme import (line 2–6 block) and change line 108:
```tsx
${THEME_TOGGLE_BUTTON}${PRINT_BUTTON}
```
In `lib/html-doc/render-deep-dive.ts`: add `PRINT_BUTTON` to the theme import and change line 198:
```tsx
${THEME_TOGGLE_BUTTON}${PRINT_BUTTON}
```

- [ ] **Step 5: Run to verify they pass**

Run: `npx jest theme.test render.test render-deep-dive`
Expected: PASS.

- [ ] **Step 6: Full suite + typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: green.

- [ ] **Step 7: Review → `docs/reviews/task-4-print-button-*.md`; address findings; re-run.**

- [ ] **Step 8: Commit**

```bash
git add lib/html-doc/theme.ts lib/html-doc/render.ts lib/html-doc/render-deep-dive.ts tests/lib/html-doc/theme.test.ts tests/lib/html-doc/render.test.ts tests/lib/html-doc/render-deep-dive.test.ts docs/reviews/task-4-*
git commit -m "feat(html-doc): add Print button to summary + deep-dive docs"
```

---

### Task 5: Bump doc versions so existing docs refresh

**Files:**
- Modify: `lib/doc-version.ts` (line 9 comment, line 10 constant)
- Modify: `lib/deep-dive/version.ts` (line 6 comment, line 7 constant)
- Test: `tests/lib/doc-version.test.ts` (or wherever the version constants/`isOlder` are tested), `tests/lib/deep-dive/version.test.ts`

**Interfaces:** Produces `CURRENT_DOC_VERSION = {3,3}`, `CURRENT_DEEP_DIVE_VERSION = {2,1}`.

- [ ] **Step 1: Write/Update the failing tests**

In the summary version test file:
```ts
  it('current doc version is 3.3', () => {
    expect(CURRENT_DOC_VERSION).toEqual({ major: 3, minor: 3 });
  });
  it('treats a 3.2 doc as older (re-render needed)', () => {
    expect(isOlder({ major: 3, minor: 2 }, CURRENT_DOC_VERSION)).toBe(true);
    expect(needsResummarize({ major: 3, minor: 2 }, CURRENT_DOC_VERSION)).toBe(false); // minor → re-render, not re-summarize
  });
```
In the deep-dive version test file:
```ts
  it('current deep-dive version is 2.1', () => {
    expect(CURRENT_DEEP_DIVE_VERSION).toEqual({ major: 2, minor: 1 });
  });
  it('treats a 2.0 deep dive as older (cheap re-render needed)', () => {
    expect(isOlder({ major: 2, minor: 0 }, CURRENT_DEEP_DIVE_VERSION)).toBe(true);
    expect(needsRegenerate({ major: 2, minor: 0 }, CURRENT_DEEP_DIVE_VERSION)).toBe(false);
  });
```
(If exact test files differ, add these assertions where the constants are currently tested.)

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest doc-version version`
Expected: FAIL — constants are still `{3,2}` / `{2,0}`.

- [ ] **Step 3: Bump the constants + comments**

`lib/doc-version.ts` line 9–10:
```ts
/** The version current code produces. major 3 = fuller magazine bullets + divider-normalized .md (major 2 = ▶ timestamps). minor = HTML render/style: 1 = lighter lead + label-less bullets, 2 = timestamp moved into the title as a muted (label) link, 3 = meta-line video URL link + Print button. */
export const CURRENT_DOC_VERSION: DocVersion = { major: 3, minor: 3 };
```
`lib/deep-dive/version.ts` line 6–7:
```ts
/** The version current code produces. major 2 = ▶ section timestamps. minor 1 = timestamp trailing the heading + first-sentence gold + Print button. */
export const CURRENT_DEEP_DIVE_VERSION: DeepDiveVersion = { major: 2, minor: 1 };
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx jest doc-version version`
Expected: PASS.

- [ ] **Step 5: Full suite + typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: green. (Sanity: `ensureHtmlDoc`/`ensureDeepDiveHtml` tests still pass — the minor bump routes a stored-older doc through the re-render branch, which existing tests already cover.)

- [ ] **Step 6: Review → `docs/reviews/task-5-version-bump-*.md`; address findings; re-run.**

- [ ] **Step 7: Commit**

```bash
git add lib/doc-version.ts lib/deep-dive/version.ts tests/lib/doc-version.test.ts tests/lib/deep-dive/version.test.ts docs/reviews/task-5-*
git commit -m "feat(doc-version): bump summary 3.3 + deep-dive 2.1 (URL link, styles, Print button)"
```

---

## Verification (Phase 4)

After Task 5, run the app and enumerate UX cases as a TaskCreate list before clicking:
- Sync a playlist with a few new items → status shows `New video N of M · <step>` + the title; bar reflects new-items progress; no "Generating PDF…" step.
- Sync an already-complete playlist → "Sync complete — no new videos."
- Open a pre-existing deep-dive doc: menu shows it as needing update (button); click → re-renders with trailing-muted timestamps + first-sentence gold + Print button.
- Same for a pre-existing summary doc: URL link + Print button appear after re-render.
- Click Print on each doc → browser print dialog; theme toggle + print button hidden in the print preview; light palette in print.
- No "View … PDF" items in the row menu.
Screenshots → `.screenshots/`, deleted after.

## Self-Review Notes
- **Spec coverage:** Change 1 → Tasks 2; Change 2 → Tasks 1 (generation), 3 (menu), 4 (Print button); Change 3 → Task 5. Every spec edge case maps to a test (new-items 0, playlistIndex guard, print-hidden CSS, version routing).
- **Type consistency:** `newTotal`/`newIndex`/`playlistPos` (Task 2), `PRINT_BUTTON` (Task 4), `CURRENT_DOC_VERSION {3,3}` / `CURRENT_DEEP_DIVE_VERSION {2,1}` (Task 5) used consistently.
- **No placeholders:** every step has concrete code/commands.
- **tsc gate:** Tasks 1 & 3 explicitly check for unused locals after removals.
