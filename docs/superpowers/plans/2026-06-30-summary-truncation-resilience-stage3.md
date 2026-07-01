# Summary Truncation Resilience — Stage 3 (Manual Re-summarize Menu) Plan

> **For agentic workers:** superpowers:subagent-driven-development. Steps use `- [ ]`.

**Status:** draft — pending Codex plan review + AFK adversarial approval.

**Goal:** A per-video **"Re-summarize"** menu action that force-regenerates the summary on demand (for a doc the audit flags or that looks off), with non-blocking progress.

## ⚠️ Deliberate deviation from the approved spec (document + let review scrutinize)

The spec (`…-design.md` §Stage 3) specified a **new** `POST /api/videos/[id]/resummarize` route + a **new** SSE stream + a **new** `ResummarizeStatusBar`. During implementation exploration I found the existing **`POST /api/videos/[id]/html-doc`** route already does exactly this: it calls `ensureHtmlDoc(...)` (which supports a `force` flag), owns the job-registry double-submit guard, streams progress via `html-doc/stream`, and is consumed by `HtmlDocStatusBar`. Re-summarize == that same op with `force = true`.

**Decision:** reuse the html-doc route with a `force` body flag + a new menu item, instead of cloning a route/stream/component. Rationale: DRY, one tested SSE + status-bar path, shared double-submit lock (you can't run "HTML doc" and "Re-summarize" on the same video at once — correct). This supersedes the spec's URL Contracts / Overlay Dismissal tables for Stage 3:

| Component | Action | Contract |
|---|---|---|
| VideoMenu "Re-summarize" | force regenerate | `POST /api/videos/[id]/html-doc` body `{ outputFolder, force: true }` → `{ jobId }` |
| (progress) | subscribe | existing `GET /api/videos/[id]/html-doc/stream?jobId=…` (unchanged) |
| HtmlDocStatusBar | dismiss | auto-close on `done`; ✕ dismiss (op continues server-side) — existing behavior, unchanged |

## Global Constraints
- No new route/stream/component. `force` defaults false → existing "HTML doc" behavior byte-identical.
- UI wiring is not TDD (per dev-process); cover with a VideoMenu component test + an E2E.
- `tsc` clean + `npm test` green before commit.

---

### Task 1: `force` flag on the html-doc POST route (TDD)

**Files:**
- Modify: `app/api/videos/[id]/html-doc/route.ts` (read `body.force`, pass to `ensureHtmlDoc`; import `CURRENT_DOC_VERSION`)
- Test: `tests/api/html-doc-post.test.ts`

- [ ] **Step 1: Update + add failing tests**

```ts
import { CURRENT_DOC_VERSION } from '../../lib/doc-version';
// existing test — now asserts the explicit 5-arg call:
it('returns a jobId and starts the run', async () => {
  mockEnsure.mockResolvedValueOnce(undefined);
  const json = await (await POST(req({ outputFolder: HOME }), ctx)).json();
  expect(typeof json.jobId).toBe('string');
  expect(mockEnsure).toHaveBeenCalledWith('vid12345', HOME, expect.any(Function), CURRENT_DOC_VERSION, false);
});
it('passes force=true when the body sets it (Re-summarize)', async () => {
  mockEnsure.mockResolvedValueOnce(undefined);
  await POST(req({ outputFolder: HOME, force: true }), ctx);
  expect(mockEnsure).toHaveBeenCalledWith('vid12345', HOME, expect.any(Function), CURRENT_DOC_VERSION, true);
});
```

- [ ] **Step 2: Run → FAIL** (`npx jest html-doc-post`)
- [ ] **Step 3: Implement** — in the route:

```ts
const force = body?.force === true;
ensureHtmlDoc(videoId, outputFolder, (event: ProgressEvent) => { … }, CURRENT_DOC_VERSION, force).catch(…)
```

- [ ] **Step 4: Run → PASS**; **Step 5: full `npx jest html-doc` + `tsc`**; **Step 6: Commit** `feat(resummarize): force flag on html-doc route`

---

### Task 2: "Re-summarize" menu item + wiring (impl + component test + E2E)

**Files:**
- Modify: `components/VideoMenu.tsx` (add `onResummarize: (id: string) => void` prop + menu `<li>`), `components/VideoRow.tsx`, `components/VideoList.tsx`, `app/page.tsx`
- Test: `tests/components/VideoMenu.test.tsx`; E2E `tests/e2e/playlist-viewer.spec.ts` (or a focused spec)

- [ ] **Step 1: page.tsx** — add `handleResummarize` (clone of `handleGenerateHtml` with `body: { outputFolder, force: true }`; reuses `setHtmlJob`/`HtmlDocStatusBar`/`setBusyVideoId`). Pass `onResummarize={handleResummarize}` down the existing `onGenerateHtml` prop chain (page → VideoList → VideoRow → VideoMenu).

- [ ] **Step 2: VideoMenu.tsx** — add a `<li>`:
```tsx
{hasSummary && (busy
  ? <span aria-disabled="true" className={disabledClass}>Re-summarize <span aria-hidden="true">⏳</span></span>
  : <button type="button" onClick={() => { onResummarize(video.id); onClose(); }} className={itemClass}>Re-summarize</button>)}
```
(Always a button — unlike "HTML doc", it never opens the cached view; it always force-regenerates.)

- [ ] **Step 3: VideoMenu component test** — the item renders when `summaryMd` present; shows ⏳/disabled when `busy`; calls `onResummarize(id)` + `onClose` on click; absent when no summary.

- [ ] **Step 4: E2E** — open a row menu, click "Re-summarize", assert a POST to `…/html-doc` with `force:true` in the body (via `page.route` interception) and that `HtmlDocStatusBar` appears. Reuse the existing mocked-route harness.

- [ ] **Step 5: full `npm test` + `npx tsc` + `npm run test:e2e` (the targeted spec)**; **Step 6: Commit** `feat(resummarize): Re-summarize menu action (force regenerate)`

---

## Self-Review
- **Spec coverage:** on-demand force re-summarize with non-blocking progress. ✓ (via reuse — deviation documented above)
- **Concurrency:** existing job-registry lock keyed `outputFolder::videoId` covers double-submit across both actions. ✓
- **No regression:** `force` defaults false; the "HTML doc" path is unchanged except the now-explicit 5-arg ensureHtmlDoc call (existing test updated).
- **Auth:** none — trusted local app (consistent with all routes).
