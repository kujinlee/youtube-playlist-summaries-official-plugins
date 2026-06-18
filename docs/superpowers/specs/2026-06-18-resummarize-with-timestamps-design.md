# Re-summarize With Timestamps — Design Spec

**Date:** 2026-06-18
**Status:** Draft — pending user review
**Scope:** A per-video action that re-runs summary generation for an **already-summarized** video so its
summary is rewritten **with `▶` timestamps** (the clickable-section-timestamps feature only writes
timestamps during fresh ingestion; existing summaries predate it and have none).

---

## 1. Goal

Existing summaries were generated before the timestamps feature, so opening their HTML shows no `▶`
links. There is currently no path to add timestamps to an existing video: the **Regenerate**
(corrections) action runs `fixSummary` (text edits only), and **ingestion** skips videos already in the
index. This adds a **per-video "Re-summarize"** action that regenerates the summary from the transcript
through the shipped `generateSummary` (which emits the `[[TS:i]]` tokens → `▶` lines).

**Phase 1 (this spec):** the per-video action + its reusable core.
**Phase 2 (deferred):** a bulk "add timestamps to all missing" loop that wraps the same core in an SSE
job. Out of scope here; the core is designed so the loop is a thin layer.

## 2. Decisions (locked during brainstorming)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Existing summary content | **Re-summarize fresh (overwrite)** — new prose, AI ratings/tags/quick-view, plus `▶` timestamps. Reuses the shipped pipeline summary logic. |
| D2 | Preserved across overwrite | Everything **not derived from the summary**: personal review (score/notes), `deepDive*`, `playlistIndex`, `archived`/`removedFromPlaylist`, dates, and the same `summaryMd` filename. |
| D3 | Scope | **Per-video**, single video at a time. Bulk deferred to Phase 2. |
| D4 | Architecture | **Extract a shared `writeSummaryDoc` lib function**; both ingestion and the new route call it (Approach A — single source of truth, no drift). |
| D5 | Cached HTML | **Invalidate (lazy regen)** — delete the cached summary HTML/model and clear `summaryHtml`; the HTML rebuilds with timestamps the next time the user opens it. No eager (extra-Gemini) regen. |
| D6 | Failure safety | **Non-destructive** — transcript fetch + `generateSummary` run before the `.md` is overwritten, so a missing transcript or Gemini error leaves the current summary intact. |

## 3. Architecture: extract `writeSummaryDoc`

The per-video summary work currently inlined in `runIngestion`'s loop (`lib/pipeline.ts:244–334`) moves
into one reusable function:

```ts
interface SummaryDocInput {
  videoId: string;
  title: string;
  youtubeUrl: string;
  channel?: string;          // meta.channelTitle (ingestion) or video.channel (re-summarize)
  durationSeconds: number;
  outputFolder: string;
  baseName: string;          // target file stem — caller decides: new slug, or existing video.summaryMd − .md
}

interface SummaryDocResult {
  language: 'en' | 'ko';
  ratings: Ratings;
  overallScore: number;
  videoType?: string;
  audience?: string;
  tags?: string[];
  tldr?: string;
  takeaways?: string[];
  mdContent: string;
  summaryMd: string;         // `${baseName}.md`
  summaryPdf: string;        // `pdfs/${baseName}.pdf`
}

async function writeSummaryDoc(input: SummaryDocInput): Promise<SummaryDocResult>;
```

It does exactly what the loop does today: `fetchTranscriptSegments` → derive text → `detectLanguage` →
`generateSummary(segments, language, videoId)` → build frontmatter + header + body + quick-view callout
→ write `<baseName>.md` → `generatePdf` → return the fields. **No behavior change for ingestion** — it
produces a byte-identical document; only the code location moves.

- **`runIngestion`** computes its collision-avoiding slug `baseName` (the existing
  `while (fs.existsSync(...))` loop), calls `writeSummaryDoc`, then builds the new `Video` and
  `upsertVideo` as today.
- **Re-summarize** passes the existing `baseName` → overwrites the same `.md` + PDF in place.

The shared boundary stops at content + file write; each caller owns its own **index** update (ingestion
creates a new `Video`; re-summarize merges into the existing one) — sharing that too would entangle
"new vs merge" for no gain.

## 4. Re-summarize flow

**Route:** `POST /api/videos/[id]/resummarize` with body `{ outputFolder: string }`. Synchronous
(awaits and returns JSON), mirroring the existing corrections-`regenerate` route — it is a single
Gemini call (~10–30s).

1. `assertOutputFolder` + `assertVideoId`; read the index; find the `Video`. 404 if absent; 422 if it
   has no `summaryMd` (nothing to re-summarize).
2. `baseName = video.summaryMd.replace(/\.md$/, '')`.
3. `writeSummaryDoc({ videoId: video.id, title: video.title, youtubeUrl: video.youtubeUrl,
   channel: video.channel, durationSeconds: video.durationSeconds, outputFolder, baseName })` →
   overwrites `<base>.md` + PDF with a fresh summary **containing `▶` lines**.
4. **Merge** the regenerated summary-derived fields into the existing `Video`
   (`ratings`, `overallScore`, `videoType`, `audience`, `tags`, `tldr`, `takeaways`, `language`),
   **preserving** all other fields (D2). `summaryMd`/`summaryPdf` stay the same.
5. **Invalidate cached HTML** (D5): delete `htmls/<base>.html` and `models/<base>.json` if present
   (best-effort, ignore ENOENT — mirrors `deep-dive.ts`'s stale-HTML unlink), and set
   `summaryHtml: null`.
6. `upsertVideo(outputFolder, mergedVideo)`.
7. Respond `{ ok: true, summaryMd }`.

After this, the menu shows **"Generate HTML doc"** again (since `summaryHtml` is null); opening it
rebuilds the HTML from the new `.md` → timestamps appear.

## 5. Output File Format

The rewritten `.md` is **identical in format to a freshly-ingested summary** — frontmatter
(tags/video_id/channel/lang/type/audience/score), `# Title`, `**Channel:** … | **Duration:** … |
**URL:** …`, the `> [!summary]` Quick Reference callout, then the numbered `## N.` sections and
`## Conclusion`, each optionally preceded by a `▶ [start–end](…&t=Ns)` line. It is produced by the same
`writeSummaryDoc`, so it matches the annotated sample in
`2026-06-17-clickable-section-timestamps-design.md` §5. The only difference from ingestion: the file is
**overwritten in place** at the existing `baseName` rather than written to a new slug file.

## 6. UI / UX

- **Trigger:** a new `VideoMenu` item, **"Re-summarize (adds ▶ timestamps)"**, shown only when
  `video.summaryMd` is set (same gate as "Edit corrections"). It fires a new `onResummarize(videoId)`
  callback, following the existing menu-item → parent-callback pattern.
- **Confirmation (destructive):** before running, a confirm prompt — *"Re-summarize this video? This
  regenerates the summary from the transcript (adding timestamps) and replaces the current summary,
  ratings, and tags. Your personal review is kept."* Phase 1 uses the browser-native `confirm()` (no
  custom modal to build/test); it can be upgraded to a styled dialog later. Cancel aborts with no
  request sent.
- **Progress (non-blocking):** while the request is in flight, a per-video inline status —
  *"Re-summarizing…"* → *"Done"* (error → an inline error message) — matching the non-blocking status
  pattern used by HTML-doc / deep-dive generation. The user can keep browsing other rows. No
  full-screen overlay.
- **On success:** the row refreshes from the updated index (new score/tags; `summaryHtml` cleared so
  the menu offers "Generate HTML doc").

### URL Contracts
None — this feature generates no new links or URLs. The existing "View/Generate HTML doc" and Obsidian
links in `VideoMenu` are unchanged.

### Overlay Dismissal

| Component | Mechanism | Expected result |
|-----------|-----------|-----------------|
| Re-summarize confirm (`confirm()`) | OK | Proceed: send the POST, show "Re-summarizing…" |
| Re-summarize confirm (`confirm()`) | Cancel / Escape | Abort: no request, menu already closed, no state change |

## 7. Error Handling

| Condition | Behavior |
|-----------|----------|
| Video not found in index | 404; inline error; existing `.md` untouched |
| Video has no `summaryMd` | 422 ("nothing to re-summarize"); inline error |
| Transcript fetch fails (no transcript now) | `writeSummaryDoc` throws before any write → 500; **existing summary intact** |
| `generateSummary` (Gemini) fails | throws before write → 500; existing summary intact |
| PDF generation fails after `.md` write | `.md` already updated (matches ingestion: PDF is a non-critical convenience copy); surface as a non-fatal note if practical |
| HTML/model unlink ENOENT | ignored (best-effort invalidation) |
| `outputFolder`/`videoId` invalid | 400 (assert guards) |

## 8. Testing

- **Unit (`writeSummaryDoc`):** mock `lib/youtube`/`lib/gemini`; assert it writes `<baseName>.md` with
  the expected content (frontmatter + quick-view + `▶`-bearing summary) and returns the AI fields;
  assert ingestion still produces byte-identical output after the extraction (regression).
- **Unit/route (`resummarize`):** mock the lib boundary; assert overwrite of the existing `summaryMd`,
  the preserve-merge (personal review/deepDive/playlistIndex survive; AI fields replaced), the
  HTML/model invalidation + `summaryHtml: null`, and the 404/422/500 paths (incl. non-destructive on
  transcript failure).
- **Component (`VideoMenu`/parent):** the item renders only with `summaryMd`; confirm-cancel sends no
  request; confirm-OK calls the route and shows the non-blocking status; success clears `summaryHtml`.
- **E2E (Playwright, mock at the route/lib boundary):** menu → Re-summarize → confirm → status → row
  reflects new state → "Generate HTML doc" available.

## 9. Non-Goals

- Bulk / "all missing" onboarding (Phase 2).
- Timestamps-only insertion that preserves existing prose (rejected in D1 — full re-summarize chosen).
- Re-running the deep-dive (separate document; untouched).
- A styled confirm modal (native `confirm()` for Phase 1).
- Eager HTML regeneration (D5 — lazy invalidation instead).

## 10. File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `lib/pipeline.ts` | Extract `writeSummaryDoc`; `runIngestion` delegates to it. | Modify |
| `lib/resummarize.ts` | The re-summarize orchestration (load video → `writeSummaryDoc` → merge index → invalidate HTML), kept out of the route so it's unit-testable and reusable by the Phase 2 bulk loop. | Create |
| `app/api/videos/[id]/resummarize/route.ts` | `POST` endpoint. | Create |
| `components/VideoMenu.tsx` | "Re-summarize" item + `onResummarize` prop. | Modify |
| `components/VideoRow.tsx` / `VideoList.tsx` | Wire `onResummarize`, confirm, non-blocking status. | Modify |
