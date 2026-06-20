# Versioned HTML-Doc Regeneration (Timestamp Onboarding) — Design Spec

**Date:** 2026-06-18
**Status:** Draft — pending user review
**Scope:** Collapse the HTML-doc menu into **one "HTML doc" action** that, on click, brings the doc up to
the current output version — **re-summarizing** (to gain new content like `▶` timestamps) or
**re-rendering** (for style-only changes) as needed, then shows it. This is what lets existing
(pre-feature) summaries gain timestamps: clicking "HTML doc" onboards them one at a time.

**Phase 1 (this spec):** the per-video versioned action + its reusable core.
**Phase 2 (deferred):** a bulk "bring all docs to current version" sweep that reuses the same core in an
SSE job. Out of scope here.

---

## 1. Goal

The clickable-timestamps feature only writes `▶` lines during fresh ingestion, so the 240 existing
summaries (generated earlier) show none. There is no path today to add them: **Regenerate** does
`fixSummary` (text edits), and **ingestion** skips indexed videos. More generally, every future style or
content change to the HTML doc has the same problem — old docs go stale with no on-demand refresh.

This introduces a **document version** so staleness is decidable, and a **single "HTML doc" action**
that regenerates the minimum necessary and shows the result.

## 2. Decisions (locked during brainstorming)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Existing summary content | **Re-summarize fresh (overwrite)** when the summary format advanced — new prose, AI ratings/tags/quick-view, plus `▶` timestamps. |
| D2 | Preserved across overwrite | Everything **not derived from the summary**: personal review (score/notes), `deepDive*`, `playlistIndex`, `archived`/`removedFromPlaylist`, dates, the same `summaryMd` filename. |
| D3 | Scope | **Per-video**, on demand. Bulk deferred to Phase 2. |
| D4 | Shared core | Extract `writeSummaryDoc` from `runIngestion`; ingestion and re-summarize call it → no drift. |
| D5 | Trigger | **One unified "HTML doc" menu item** (replaces View / Generate / Regenerate). It shows the current HTML if up to date, else regenerates then shows. |
| D6 | Staleness model | A **`major.minor` document version**. **Major** = summary/content format (bump ⇒ re-summarize, a Gemini call). **Minor** = HTML render/style (bump ⇒ re-render from the cached model, no Gemini). Timestamps = the first **major** bump (`1.0 → 2.0`). |
| D7 | PDF | **Untouched** — `writeSummaryDoc` does not generate the PDF; ingestion keeps its own PDF step; the re-summarize path skips PDF (the existing, now-stale PDF is left as-is; PDFs may be obsoleted once HTML is printable). |
| D8 | Confirmation | **None** (it is the user's deliberate, version-driven action). Transparency comes from explicit non-blocking status, not a modal. |
| D9 | Failure safety | **Non-destructive** — transcript fetch + `generateSummary` run before the `.md` is overwritten, so errors leave the current summary intact. |

## 3. Document version

A single shared constant, readable by both the menu (client) and the server:

```ts
// lib/doc-version.ts
export interface DocVersion { major: number; minor: number }
export const CURRENT_DOC_VERSION: DocVersion = { major: 2, minor: 0 }; // major 2 = ▶ timestamps

export function isOlder(a: DocVersion, b: DocVersion): boolean {
  return a.major < b.major || (a.major === b.major && a.minor < b.minor);
}
export function needsResummarize(stored: DocVersion, current: DocVersion): boolean {
  return stored.major < current.major; // a summary-format (major) advance requires regenerating the .md
}
```

- Each video stores `docVersion?: DocVersion` in the index (optional). **Absent ⇒ `{1,0}`** (pre-feature
  baseline).
- **Stamped to `CURRENT_DOC_VERSION`** by every producer: ingestion, re-summarize, and re-render.
- **Bump policy:** changing `generateSummary`'s `.md` output → bump **major** (and document it as
  summary-breaking by virtue of being a major bump). Changing only the HTML template/CSS → bump
  **minor**.

### Staleness → action

| Stored vs `CURRENT_DOC_VERSION` (+ HTML present?) | Action |
|---|---|
| `stored.major < current.major` | **Re-summarize** the `.md` (Gemini) → full HTML rebuild (new model + render) → stamp current |
| `stored.major == current.major` & `stored.minor < current.minor`, **or** no cached HTML | **Re-render** HTML from the cached magazine model (no Gemini) → stamp current |
| `stored >= current` & HTML present | **Show current** (no work) |

A major regeneration also refreshes the render, so a re-summarized doc is stamped at the full current
`major.minor`. Re-summarizing changes the `.md` sections, so it invalidates the cached magazine model;
the subsequent rebuild regenerates the model — inherent to the rebuild, not a separate version axis.

## 4. Shared core: `writeSummaryDoc`

The per-video summary work inlined in `runIngestion` (`lib/pipeline.ts:244–334`, **excluding** the PDF
step) moves into one reusable function:

```ts
interface SummaryDocInput {
  videoId: string; title: string; youtubeUrl: string;
  channel?: string;          // meta.channelTitle (ingest) | video.channel (re-summarize)
  durationSeconds: number;
  outputFolder: string;
  baseName: string;          // target file stem — caller chooses: new slug | existing video.summaryMd − .md
}
interface SummaryDocResult {
  language: 'en' | 'ko'; ratings: Ratings; overallScore: number;
  videoType?: string; audience?: string; tags?: string[]; tldr?: string; takeaways?: string[];
  mdContent: string; summaryMd: string;  // `${baseName}.md`
}
async function writeSummaryDoc(input: SummaryDocInput): Promise<SummaryDocResult>;
```

`fetchTranscriptSegments` → derive text → `detectLanguage` → `generateSummary(segments, language, videoId)`
→ build frontmatter + header + body + quick-view → write `<baseName>.md` → return. **No PDF inside**
(D7). **Ingestion output is byte-identical** — it keeps its slug `baseName`, calls `writeSummaryDoc`,
then runs its existing `generatePdf` and builds the new `Video` (now also stamping `docVersion`).

## 5. The unified "HTML doc" orchestration

A single function (e.g. `ensureHtmlDoc(videoId, outputFolder, onProgress)` in `lib/html-doc/`) drives
the action, composing existing pieces:

1. Load the `Video`; require `summaryMd` (else disabled). `baseName = summaryMd − .md`;
   `stored = video.docVersion ?? {1,0}`.
2. **If `needsResummarize(stored, CURRENT)`** → progress *"Re-summarizing (adding timestamps)…"*;
   `writeSummaryDoc({…, baseName})` overwrites the `.md` with `▶` lines; delete the cached
   `models/<base>.json` (model now stale); **merge** the returned AI fields into the `Video` (D2 preserve
   set untouched).
3. **Build the HTML** → progress *"Building HTML…"*:
   - If a valid cached model exists (minor-only refresh) → **re-render** via the persist-model path
     (`reRenderSummaryHtml` — parse `.md` + cached model → render → write `htmls/<base>.html`), no Gemini.
   - Else (after re-summarize, or no/invalid model) → **full generate** (`runHtmlDoc` path: parse →
     `generateMagazineModel` (Gemini) → render → write), which also writes the fresh model.
4. Set `summaryHtml = htmls/<base>.html`; **stamp `docVersion = CURRENT_DOC_VERSION`**; `upsertVideo`.
5. Return `{ url }` (the GET serve URL).

`route`: `POST /api/videos/[id]/html-doc` is **enhanced** to call `ensureHtmlDoc` (it already exists for
HTML generation; it gains the version check + the re-summarize branch). Up-to-date videos short-circuit
at step 3's "show current" with no Gemini and no rewrite.

## 6. Output File Format

The rewritten `.md` is **identical in format to a freshly-ingested summary** (frontmatter, `# Title`,
`**Channel:** … | **Duration:** … | **URL:** …`, the `> [!summary]` Quick Reference callout, numbered
`## N.` sections + `## Conclusion`, each optionally preceded by `▶ [start–end](…&t=Ns)`). It is produced
by the same `writeSummaryDoc`, matching the annotated sample in
`2026-06-17-clickable-section-timestamps-design.md` §5. The only difference from ingestion: it is
**overwritten in place** at the existing `baseName`. The index `Video` gains one field, `docVersion`.

## 7. UI / UX

- **Menu:** `View / Generate / Regenerate HTML doc` collapse into **one "HTML doc" item** (shown when
  `summaryMd` exists; disabled otherwise). Deep-dive HTML, Obsidian, and PDF items are unchanged.
- **Link vs. action (no wasted round-trip):** the client decides from data it already has —
  - `summaryHtml` present **and** `!isOlder(video.docVersion ?? {1,0}, CURRENT_DOC_VERSION)` → the item is
    a **direct link** to the GET serve URL → clicking opens it instantly (the click gesture, so no
    popup-block).
  - otherwise → the item is a **button** that starts `POST …/html-doc` (`ensureHtmlDoc`).
- **In-progress status (clear + local):** while a video is regenerating, an **hourglass / spinner shows
  next to that row's menu trigger** — visible even with the menu closed — so the user always knows work
  is happening on that row. The current step is available as the indicator's label/tooltip
  (*"Re-summarizing…" → "Building HTML…"*). During this time the **"HTML doc" menu item is disabled**
  (not re-clickable). The parent tracks per-video regen state (`videoId → status`), so other rows stay
  fully interactive — no full-screen overlay, no blocking.
- **Completion → clickable:** when `ensureHtmlDoc` finishes, the row refreshes from the updated index
  (now `docVersion = CURRENT`, `summaryHtml` set), the hourglass clears, and **"HTML doc" returns to its
  normal clickable state — now a direct link**. The user clicks it (a fresh gesture) to open the
  freshly-built HTML with timestamps. On **error**, the status bar shows the failure message and stays
  open (no auto-close); the row stays busy until the user **dismisses (✕) the error bar**, which clears
  the busy state and returns "HTML doc" to a clickable button to retry. (The error is surfaced
  prominently first; recovery is one dismiss + re-click.)
- **Corrections invalidation (related fix):** the existing corrections-`regenerate` route rewrites the
  `.md` without bumping the version; to keep the unified item honest it must **clear `summaryHtml`**
  after rewriting, so the next "HTML doc" click re-renders the edited content. (Small, in-scope because
  it affects this menu's correctness.)

### URL Contracts
No new links or URLs are generated. The GET serve URL (`/api/html/[id]?outputFolder=…&type=summary`) and
the Obsidian/PDF links are unchanged.

### Overlay Dismissal
No modal/overlay/confirm is introduced (D8). The non-blocking status bar follows the existing
HTML-doc / deep-dive status pattern; nothing to dismiss.

## 8. Error Handling

| Condition | Behavior |
|-----------|----------|
| Video not found | 404; inline error; nothing written |
| No `summaryMd` | menu item disabled; route returns 422 if called |
| Transcript fetch fails on re-summarize | `writeSummaryDoc` throws **before** any write → 500; existing `.md`, `docVersion`, and HTML untouched |
| `generateSummary` (Gemini) fails | throws before write → 500; existing summary intact |
| `generateMagazineModel` fails during build | 500; if re-summarize already overwrote the `.md`, the `.md` is new but `summaryHtml`/`docVersion` are **not** advanced (so a retry rebuilds the HTML); surfaced as an error |
| Model unlink ENOENT | ignored (best-effort) |
| `outputFolder`/`videoId` invalid | 400 (assert guards) |

## 9. Testing

- **Unit `lib/doc-version.ts`:** `isOlder` / `needsResummarize` across major>, minor>, equal, absent.
- **Unit `writeSummaryDoc`:** writes `<baseName>.md` with the expected `▶`-bearing content + returns AI
  fields; **no PDF written**; ingestion still byte-identical after extraction (regression).
- **Unit/route `ensureHtmlDoc`:** the three branches — major-stale → re-summarize + full build + stamp;
  minor-stale / no-html → re-render (no Gemini) + stamp; current → no work; the D2 preserve-merge; model
  invalidation on re-summarize; the non-destructive-on-transcript-failure path; 404/422/500.
- **Component `VideoMenu` + row:** single item; direct link when current; button when stale/absent;
  disabled without `summaryMd`; during regen the row shows the **hourglass** and the item is **disabled**;
  on completion the hourglass clears and the item becomes a clickable direct link.
- **E2E (Playwright, mock at the route/lib boundary):** stale video → click "HTML doc" → hourglass shown
  + item disabled → on done, hourglass clears + item clickable → opening it serves HTML containing `.ts`
  anchors; current video → instant link; error → error indicator + retry; corrections → `summaryHtml`
  cleared → next click re-renders.

## 10. Non-Goals

- Bulk "bring all to current" sweep (Phase 2).
- Timestamps-only insertion preserving existing prose (rejected in D1 — full re-summarize).
- Re-running the deep-dive (separate document; untouched).
- Regenerating the PDF (D7).
- A model-format version axis (a model change rides a **major** bump for now).
- A styled confirm modal (D8).

## 11. File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `lib/doc-version.ts` | `DocVersion`, `CURRENT_DOC_VERSION`, `isOlder`, `needsResummarize`. Shared client+server. | Create |
| `lib/pipeline.ts` | Extract `writeSummaryDoc` (no PDF); `runIngestion` delegates + stamps `docVersion`. | Modify |
| `lib/html-doc/ensure.ts` | `ensureHtmlDoc` — version check → re-summarize / re-render / show; stamp `docVersion`. | Create |
| `lib/html-doc/generate.ts`, `rerender.ts` | Reused by `ensureHtmlDoc` (full build / cached re-render). | Reuse |
| `types.ts` (Video) | Add `docVersion?: DocVersion`. | Modify |
| `app/api/videos/[id]/html-doc/route.ts` | Call `ensureHtmlDoc`. | Modify |
| `app/api/videos/[id]/regenerate/route.ts` | Clear `summaryHtml` after rewriting the `.md`. | Modify |
| `components/VideoMenu.tsx` | Single "HTML doc" item; link-vs-button from `docVersion`. | Modify |
| `components/VideoRow.tsx` / `VideoList.tsx` | Wire the unified action + non-blocking status + "Open". | Modify |
