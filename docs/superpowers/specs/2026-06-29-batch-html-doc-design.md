# Batch-generate summary HTML docs for selected videos — design

**Date:** 2026-06-29
**Status:** Approved (brainstorming), pending implementation plan
**Scope:** Sub-project 2 (Frontend) + a thin backend batch endpoint/lib fn

---

## Goal

Let the user select multiple videos in the list (checkboxes) and generate their **summary
HTML docs** in one batch, with non-blocking progress — instead of opening each video's menu and
running "HTML doc" one at a time. Primary use: warming the backlog of existing videos whose HTML
was never generated (the interactive complement to the ingestion-time pre-gen feature, PR #46).

---

## Decisions (settled in brainstorming)

| # | Decision | Choice |
|---|---|---|
| 1 | Selection mechanism | Per-row checkboxes + a "select all needing generation" header control |
| 2 | Eligibility | Skip already-current videos; generate only missing/stale (no wasted Gemini) |
| 3 | Progress UI | **Non-blocking** status bar (N-of-M), user keeps working |
| 4 | Doc scope | **Summary HTML only** (deep-dive keeps its own per-row action) |
| 5 | Select-all semantics | Selects all *currently-visible* (filtered) rows that are missing/stale |

---

## Current state (what's reused)

- **Job pattern:** POST → `{ jobId }` → buffered SSE via `lib/job-registry.ts`. Used by ingestion
  (`/api/ingest` + `/api/ingest/stream`) and single HTML-doc (`/api/videos/[id]/html-doc` + stream).
- **`ProgressEvent`** union (`types/index.ts:91`) already carries `{type:'step', videoId, current,
  total}` and non-fatal `{type:'error', videoId}` + `{type:'done', succeeded, failed}` — **no schema
  change needed**.
- **`ensureHtmlDoc(videoId, outputFolder, onProgress, current?, force?)`** (`lib/html-doc/ensure.ts:18`)
  — version-aware: a video already current emits `done` and returns with no Gemini call. This is how
  "skip up-to-date" is enforced at generate-time.
- **Eligibility predicate** (from `VideoMenu.tsx:70`): a video needs generation when
  `!!video.summaryMd && (!video.summaryHtml || isOlder(video.docVersion ?? {major:1,minor:0}, CURRENT_DOC_VERSION))`.
- **Progress precedents:** `HtmlDocStatusBar` (non-blocking bottom bar, single video) and
  `BackfillOverlay` (blocking modal, batch). This feature follows the non-blocking bar.
- **Refresh:** page-level `fetchVideos()` with a `fetchSeqRef` race guard; ingestion refreshes
  incrementally per `'Saved'` step and fully on `done`.

---

## Architecture

```
VideoList (checkbox col + select-all-needing)
   └─ selection: Set<videoId> lifted to app/page.tsx
BulkActionBar  (visible when ≥1 selected)
   └─ POST /api/videos/batch-html-doc  { outputFolder, videoIds[] }  ─► { jobId }   (new route)
        │  videoIds = the missing/stale subset of the selection (client filters current ones out)
        └─ runBatchHtmlDoc(videoIds, outputFolder, onProgress, signal)   (new lib fn)
             └─ for each videoId (sequential): ensureHtmlDoc(videoId, outputFolder, () => {})
                emits {type:'step', videoId, current, total} / {type:'error', videoId} / {type:'done', succeeded, failed, total}
   └─ GET /api/videos/batch-html-doc/stream?jobId   (new SSE route, job-registry)
BatchHtmlDocStatusBar (non-blocking)  ── incremental fetchVideos() per video done; full on done
```

Only one batch per `outputFolder` at a time (409 like ingestion).

---

## UI Design

### Wireframe (list with selection active)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  [✓ Generate HTML doc — 6 videos]  [Clear]   (3 already current — won't run)    │  ◄ BulkActionBar (appears when ≥1 selected)
├──┬───┬──────────────────────────────────────────────┬──────┬──────────────────┤
│☑ │ # │ Title                                         │ Score│ … (existing cols)│  ◄ header: ☑ = "select all needing generation"
├──┼───┼──────────────────────────────────────────────┼──────┼──────────────────┤
│☑ │ 1 │ ▸ A Brain and a Pair of Hands            ⋯    │ 4.2  │ …                │  ◄ checked, needs gen
│☐ │ 2 │ ▸ Handoff is my new favourite skill      ⋯    │ 3.8  │ …                │  ◄ unchecked
│▢ │ 3 │ ▸ Some video with no summary yet         ⋯    │  —   │ …                │  ◄ disabled (no summaryMd)
│☑⏳│ 4 │ ▸ OKF: the simple folder …               ⋯    │ 4.0  │ …                │  ◄ in active batch → ⏳
└──┴───┴──────────────────────────────────────────────┴──────┴──────────────────┘

  ┌───────────────────────────────────────────────────────────┐
  │ Generating HTML docs — video 3 of 6 · 1 failed     [✕]     │  ◄ BatchHtmlDocStatusBar (non-blocking, fixed bottom)
  │ ████████████░░░░░░░░░░░░  50%                              │
  └───────────────────────────────────────────────────────────┘
```

### Component specs

- **Checkbox column** (new leading column in `VideoList`/`VideoRow`): a checkbox per row.
  - Enabled when the row has `summaryMd`. Disabled (▢, non-interactive, tooltip "No summary to
    generate from") when `summaryMd` is null.
  - Checked state driven by `selected.has(video.id)`.
  - During an active batch, a row whose video is in the running set shows the existing ⏳ busy glyph
    and its checkbox is disabled.
- **Header select-all control** (the ☑ in the header cell): tri-state.
  - Click → select all *currently-visible* rows (after sort/search/archive filters) that are
    **missing/stale** (eligibility predicate above). Does NOT select current or no-summary rows.
  - Checked when all eligible-visible rows are selected; indeterminate when some are; unchecked when
    none.
- **`BulkActionBar`** (new, appears above the table when `selected.size > 0`):
  - Primary button: `Generate HTML doc — {willGenerate} videos` where `willGenerate` = count of
    selected rows that are missing/stale. Clicking POSTs **only those** `willGenerate` videoIds (the
    client filters already-current rows out of the request, so the backend never has a skip case).
  - Helper text: `({skipCount} already current — won't be generated)` when any selected rows are
    current. `skipCount` is purely informational (client-side); it is not sent or reported by the job.
  - `Clear` button → empties selection.
  - Generate button disabled when `willGenerate === 0`.
- **`BatchHtmlDocStatusBar`** (new, non-blocking fixed bottom bar; modeled on `HtmlDocStatusBar`):
  - Running: `Generating HTML docs — video {current} of {total}{ · {failed} failed}` + progress bar
    (`current/total`).
  - Done: `✓ {succeeded} generated{, {failed} failed}`, auto-closes after ~4s.
  - Error (fatal/non-per-video): `✕ {message}`.

### Tokens / styling
Reuse existing list/table + status-bar styles. Checkbox column uses the app's existing control
styling; no new color tokens. The status bar reuses `HtmlDocStatusBar`'s container/progress styles.

---

## Selection operations (table-UI gate — enumerated)

| Operation | Trigger | Result |
|---|---|---|
| Toggle one row | click a row checkbox | add/remove that `videoId` from `selected` |
| Select-all-needing | click header ☑ (from unchecked/indeterminate) | `selected` = all visible rows that are missing/stale |
| Deselect-all | click header ☑ (from checked) | `selected` = ∅ |
| Clear | `BulkActionBar` Clear button | `selected` = ∅ |
| Disabled row | row has no `summaryMd` | checkbox non-interactive; never enters `selected` |
| Filter/sort change | user sorts/searches/toggles archive | `selected` persists by `videoId`; rows no longer visible stay selected but are not shown (Generate acts on the full `selected` set; see Edge cases) |

---

## Async operation (gate)

- **Blocking or non-blocking?** **Non-blocking** (status bar). Justification: a batch of N videos
  takes minutes (N sequential Gemini calls); the user can usefully browse, sort, search, and read
  already-generated docs meanwhile. A blocking overlay is explicitly not justified here.
- **What the user sees/does while it runs:** the bottom status bar shows `video X of N` + a running
  failed count; the list stays interactive; rows being processed show ⏳.
- **Dismissal:** see Dismissal table.

### Dismissal table (`BatchHtmlDocStatusBar`)

| Mechanism | Expected result |
|---|---|
| ✕ close button (while running) | cancels the in-flight batch job (AbortSignal), closes SSE, bar disappears; videos already done keep their HTML |
| Auto-close on `done` | bar shows the `✓ … generated` summary, then auto-dismisses after ~4 s |
| ✕ close button (after done) | immediate dismiss |
| Fatal error event | bar shows `✕ {message}`, stays until ✕ (no auto-close) |

### URL Contracts

This feature's new components generate **no user-facing document URLs** — the batch acts via API
calls, and per-row "HTML doc" view links remain the existing `VideoMenu` ones (unchanged). The new
HTTP contracts:

| Caller | Method + URL | Body / params | Response |
|---|---|---|---|
| `BulkActionBar` | `POST /api/videos/batch-html-doc` | `{ outputFolder: string, videoIds: string[] }` | `{ jobId: string }` (or 409 if a batch is already running for the folder) |
| `BatchHtmlDocStatusBar` | `GET /api/videos/batch-html-doc/stream?jobId={jobId}` | query `jobId` | SSE stream of `ProgressEvent` |

---

## Backend: `runBatchHtmlDoc`

```ts
export async function runBatchHtmlDoc(
  videoIds: string[],
  outputFolder: string,
  onProgress: (e: ProgressEvent) => void,
  signal?: AbortSignal,
): Promise<void>
```

- Validates `outputFolder` + each `videoId` (defense-in-depth, like the pipeline).
- `onProgress({ type: 'start', total: videoIds.length })`.
- Sequential loop with index `i` (1-based):
  - if `signal?.aborted` → `onProgress({ type: 'cancelled' })`; return.
  - `onProgress({ type: 'step', videoId, step: 'Generating HTML doc…', current: i, total })`.
  - `try { await ensureHtmlDoc(videoId, outputFolder, () => {}); succeeded++ }`
    `catch (err) { failed++; console.warn(...); onProgress({ type: 'error', videoId, log }) }` —
    non-fatal, continue. (No-op `onProgress` to `ensureHtmlDoc` keeps its 1-of-N sub-steps off the
    batch stream — same isolation trick as the pre-gen feature.)
- `onProgress({ type: 'done', succeeded, failed, total })`.
- The client sends only missing/stale `videoIds`, so the loop has no skip case to report. If a row
  raced to current between select and run, `ensureHtmlDoc` no-ops it internally (its own `done`
  swallowed by the no-op adapter) and the loop counts it as `succeeded` — harmless, no `skipped`
  field needed (keeps the existing `ProgressEvent` schema unchanged).

---

## Data refresh

- On each `{type:'step'}` whose `videoId` differs from the previous (i.e., the prior video finished),
  and on `{type:'done'}`, call the existing `fetchVideos()` (throttled by its `fetchSeqRef` guard) so
  rows flip their menu from "generate" to a "HTML doc" link as they complete. Mirrors ingestion's
  per-`Saved` incremental refresh.
- Batch uses its **own** state (`batchJob`) — NOT the single-job `busyVideoId` scalar (which assumes
  one active job). Rows in the active batch derive ⏳ from membership in the batch's video set.

---

## Error handling / edge cases

- **Per-video failure:** non-fatal; emit `{type:'error', videoId}`, increment `failed`, continue.
  Final summary reports `failed`.
- **Empty / all-skipped selection:** Generate button disabled when `willGenerate === 0`.
- **No-summary rows:** cannot be selected (disabled checkbox); never sent to the endpoint.
- **Double submit:** one batch per `outputFolder`; second POST returns 409 (like ingestion).
- **Selection across filters:** `selected` is keyed by `videoId` and persists when rows are filtered
  out of view. Generate acts on the entire `selected` set (not just visible). The `BulkActionBar`
  count reflects the full set so the user sees how many will run.
- **Became-current race:** a selected row that turned current before the batch runs is skipped by
  `ensureHtmlDoc` (counted, not an error).
- **Cancellation:** ✕ aborts between videos; in-flight `ensureHtmlDoc` for the current video may
  finish (best-effort), then the loop stops and emits `cancelled`.

---

## Out of scope

- Deep-dive HTML batch (summary only).
- Parallel generation (sequential — avoids hammering Gemini, matches existing patterns).
- Force-regenerate of already-current docs (skip-only; a force toggle was considered and dropped).
- Persisting selection across page reloads.
- No `ProgressEvent` schema change, no `docVersion`/`GENERATOR_VERSION` bump, no new output file
  format (reuses `htmls/<base>.html`).

---

## Testing strategy

Mock Gemini at the lib boundary; E2E mocks at the route level (project policy).

### Lib — `runBatchHtmlDoc` (jest, mock `ensureHtmlDoc`)
| # | Behavior | Trigger | Expected |
|---|---|---|---|
| L1 | Generates each selected video | 3 ids | `ensureHtmlDoc` called once per id (in order); `start{total:3}` → 3 `step`s → `done{succeeded:3,failed:0}` |
| L2 | Progress counter | 3 ids | `step` events carry `current: 1,2,3` + `total: 3` with the right `videoId` |
| L3 | Sub-progress isolation | mock `ensureHtmlDoc` fires a sentinel on its onProgress | sentinel never appears on the batch stream (no-op adapter); `ensureHtmlDoc` called with a callback distinct from the batch onProgress |
| L4 | Best-effort per-video failure | 2nd id's `ensureHtmlDoc` rejects | `error{videoId}` emitted, loop continues, 3rd id processed, `done{succeeded:2,failed:1}` |
| L5 | Abort | signal aborted before 2nd | `cancelled` emitted; no `ensureHtmlDoc` after abort |
| L6 | Empty list | `[]` | `start{total:0}` → `done{succeeded:0,failed:0}`; `ensureHtmlDoc` never called |

### API — batch route + stream
| # | Behavior | Expected |
|---|---|---|
| A1 | POST returns jobId | `{ jobId }`; `runBatchHtmlDoc` started in background |
| A2 | Double-submit | second POST for same `outputFolder` returns 409 |
| A3 | Stream terminal | SSE closes on `done`/`cancelled`/fatal-`error`; stays open on per-video `error` |

### Component / E2E (Playwright, route-mocked)
| # | Behavior | Expected |
|---|---|---|
| C1 | Checkbox toggle | clicking a row checkbox adds/removes it from selection; `BulkActionBar` count updates |
| C2 | Disabled checkbox | a row with no `summaryMd` has a non-interactive checkbox and never selects |
| C3 | Select-all-needing | header ☑ selects exactly the visible missing/stale rows; current + no-summary excluded; tri-state reflects partial/all |
| C4 | Bar counts | `BulkActionBar` shows `willGenerate` and `skipCount` correctly for a mixed selection |
| C5 | Run + progress | Generate POSTs the right `videoIds`; status bar shows `video X of N`; list rows refresh to "HTML doc" links as they complete |
| C6 | Dismissal — cancel | ✕ while running aborts the job and closes the bar |
| C7 | Dismissal — auto-close | on `done` the bar shows the summary and auto-closes (~4s) |

---

## Files (anticipated)

- **New:** `lib/html-doc/batch.ts` (`runBatchHtmlDoc`); `app/api/videos/batch-html-doc/route.ts`;
  `app/api/videos/batch-html-doc/stream/route.ts`; `components/BulkActionBar.tsx`;
  `components/BatchHtmlDocStatusBar.tsx`.
- **Modified:** `components/VideoList.tsx` + `components/VideoRow.tsx` (checkbox column + header
  select-all); `app/page.tsx` (selection state, batch job state, handlers, refresh wiring).
- **Unchanged:** `ensureHtmlDoc`, `runHtmlDoc`, `render.ts`, `VideoMenu` (per-row action stays),
  `types/index.ts` (`ProgressEvent` already sufficient).
