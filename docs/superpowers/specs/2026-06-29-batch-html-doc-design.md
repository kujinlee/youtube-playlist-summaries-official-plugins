# Batch-generate docs for selected videos — design

**Date:** 2026-06-29
**Status:** Approved direction (brainstorming), pending implementation plan(s)
**Scope:** Sub-project 2 (Frontend) + backend batch endpoint/lib + (Phase B) dig-pipeline extraction

---

## Goal

Select multiple videos in the list (checkboxes) and generate their docs in one batch with
non-blocking progress, skipping anything already up-to-date. Two doc modes:

1. **Summary HTML only** — the summary "HTML doc" (one `gemini-2.5-flash` call/video; ~seconds).
2. **Summary + Dig-deeper** — also dig every **missing/stale section** of each video (each section =
   `gemini-2.5-pro` + yt-dlp + ffmpeg; **~$0.05 and ~30 s per section**).

Primary use: warm the backlog of existing videos whose HTML / digs were never generated (the
interactive complement to the ingestion-time pre-gen feature, PR #46).

---

## Phasing (build order — decided)

| Phase | PR | Delivers |
|---|---|---|
| **A** | PR-A | Checkbox selection + select-all-needing + `BulkActionBar` + non-blocking batch status bar + backend `runBatchDocs` (mode `summary`) + `/api/videos/batch-docs` (+stream). Ships and is validated first. |
| **B** | PR-B | Adds the `Summary + Dig-deeper` mode: extract the per-section dig pipeline into a reusable lib fn, dig missing/stale sections in `runBatchDocs` (mode `summary-dig`), the mode toggle, a cost-confirmation dialog, and two-level progress. Purely additive on top of A. |

The endpoint, lib fn, and progress model are designed mode-aware from Phase A so Phase B adds the dig
branch without reworking the contract.

---

## Decisions (settled in brainstorming)

| # | Decision | Choice |
|---|---|---|
| 1 | Selection | Per-row checkboxes + a "select all needing generation" header control |
| 2 | Eligibility | Skip already-current at **both** levels (summary HTML, and per-section dig); generate only missing/stale |
| 3 | Progress UI | **Non-blocking** status bar; user keeps working |
| 4 | Doc modes | `Summary HTML` (Phase A) and `Summary + Dig-deeper` (Phase B). Deep-dive (legacy) untouched. |
| 5 | Select-all semantics | All *currently-visible* (filtered) rows that need work (see Eligibility, below) |
| 6 | Skip authority | **Backend-authoritative**: client sends selected videoIds + mode; backend computes the precise work list and skips current items |
| 7 | Dig cost guard | Mode `summary-dig` shows a confirm dialog with a rough $/time estimate before launching |

---

## Current state (what's reused)

- **Job pattern:** POST → `{ jobId }` → buffered SSE via `lib/job-registry.ts` (used by ingestion and
  single HTML-doc and single dig).
- **`ProgressEvent`** union (`types/index.ts:91`) already carries `{type:'step', videoId, title, step,
  current, total}`, non-fatal `{type:'error', videoId}`, `{type:'done', succeeded, failed}`,
  `{type:'cancelled'}` — **no schema change needed** for either phase.
- **Summary HTML:** `ensureHtmlDoc(videoId, outputFolder, onProgress, current?, force?)`
  (`lib/html-doc/ensure.ts:18`) — version-aware; a current video no-ops (no Gemini).
- **Summary eligibility** (index fields, client-knowable): needs work when
  `!!summaryMd && (!summaryHtml || isOlder(docVersion ?? {major:1,minor:0}, CURRENT_DOC_VERSION))`.
- **Dig (Phase B):** per-section pipeline `runDigPipeline(videoId, sectionId, outputFolder, signal,
  emit)` inside `app/api/videos/[id]/dig/[sectionId]/route.ts:82` → calls `generateDig` +
  `resolveSlideTokens` (yt-dlp/ffmpeg) + `upsertDugSection`. **No backend "all sections" path today**
  (only a client-side "expand all" loop in `nav.ts:254`). Section list via
  `parseSummaryMarkdown(md).sections.filter(s => s.timeRange)`; already-dug ids via
  `readDugSectionIds(digPath)` (`companion-doc.ts:536`); per-section staleness via
  `DugSection.genVersion < DIG_GENERATOR_VERSION (9)` (`dig-merge.ts`).
- **Progress precedents:** `HtmlDocStatusBar` (non-blocking, single) and `BackfillOverlay` (modal,
  batch). This feature uses a non-blocking bar. The dig "expand all" confirm dialog (`nav.ts:300`,
  `~$0.05×N`, `~30s×N`) is the model for the Phase B cost guard.
- **Refresh:** page-level `fetchVideos()` with a `fetchSeqRef` race guard.

---

## Shared architecture

```
VideoList (checkbox col + select-all-needing)
   └─ selection: Set<videoId> lifted to app/page.tsx
BulkActionBar  (visible when ≥1 selected; Phase B adds a mode toggle + cost-confirm)
   └─ POST /api/videos/batch-docs  { outputFolder, videoIds[], mode }  ─► { jobId }
        └─ runBatchDocs(videoIds, mode, outputFolder, onProgress, signal)        (lib/html-doc/batch.ts)
             ├─ PRE-PASS (cheap, no Gemini): build a flat work list, skipping current items:
             │    • summary item  if summary missing/stale
             │    • (mode summary-dig) one dig item per missing/stale dig-eligible section
             │    emit { type:'start', total: workItems.length }
             └─ for each work item (sequential): run it; emit step{current,total,videoId,step}; best-effort
        └─ GET /api/videos/batch-docs/stream?jobId        (SSE, job-registry)
BatchDocStatusBar (non-blocking) ── incremental fetchVideos() as videos complete; full on done
```

One batch per `outputFolder` at a time (409 like ingestion). The **pre-pass computes an accurate
`total`** (it only reads/parses files — no Gemini), so a single flat progress bar is honest even in
mode `summary-dig`.

### `runBatchDocs` contract

```ts
type BatchMode = 'summary' | 'summary-dig';
export async function runBatchDocs(
  videoIds: string[],
  mode: BatchMode,
  outputFolder: string,
  onProgress: (e: ProgressEvent) => void,
  signal?: AbortSignal,
): Promise<void>
```

- **Pre-pass** builds `workItems: ({kind:'summary', videoId} | {kind:'dig', videoId, sectionId, title})[]`:
  - summary item iff `!summaryHtml || isOlder(docVersion, CURRENT)`.
  - dig items (mode `summary-dig` only) = dig-eligible sections (`parseSummaryMarkdown` →
    `timeRange`) whose `sectionId` is absent from `readDugSectionIds` OR whose `genVersion <
    DIG_GENERATOR_VERSION`.
- `onProgress({type:'start', total: workItems.length})`.
- Sequential loop, 1-based `i`; on `signal.aborted` → `{type:'cancelled'}`; return.
  - summary item: `step{videoId, step:'Generating HTML doc…', current:i, total}` →
    `await ensureHtmlDoc(videoId, outputFolder, () => {})`.
  - dig item: `step{videoId, step:'Digging "<title>"…', current:i, total}` →
    `await digSection(videoId, sectionId, outputFolder, signal, () => {})` (the extracted lib fn).
  - each wrapped best-effort: `catch` → `failed++`, `console.warn`, `onProgress({type:'error',
    videoId, log})`, continue.
- `onProgress({type:'done', succeeded, failed, total})`.
- No-op `onProgress` to the per-item generators keeps their own sub-steps off the batch stream
  (same isolation trick as PR #46; tested).

### Phase B backend refactor: extract `digSection`

`runDigPipeline` currently lives inside the dig route. Phase B extracts the core into
`lib/dig/dig-section.ts`:
```ts
export async function digSection(
  videoId: string, sectionId: number, outputFolder: string,
  signal: AbortSignal | undefined, emit: (e: ProgressEvent) => void,
): Promise<void>
```
The existing route is refactored to call it (no behavior change — its tests must stay green). The
batch loops it. This keeps dig generation logic in one place (consumed by both the single-section
route and the batch).

---

## UI Design

### Wireframe (selection active, Phase B mode toggle shown)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Mode: (•) Summary HTML  ( ) Summary + Dig-deeper          ◄ Phase B only      │
│  [✓ Generate — 6 videos]  [Clear]        (3 summaries already current)         │  ◄ BulkActionBar
├──┬───┬──────────────────────────────────────────────┬──────┬──────────────────┤
│☑ │ # │ Title                                         │ Score│ … (existing cols)│  ◄ header ☑ = select-all-needing
├──┼───┼──────────────────────────────────────────────┼──────┼──────────────────┤
│☑ │ 1 │ ▸ A Brain and a Pair of Hands            ⋯    │ 4.2  │ …                │
│☐ │ 2 │ ▸ Handoff is my new favourite skill      ⋯    │ 3.8  │ …                │
│▢ │ 3 │ ▸ Some video with no summary yet         ⋯    │  —   │ …                │  ◄ disabled (no summaryMd)
│☑⏳│ 4 │ ▸ OKF: the simple folder …               ⋯    │ 4.0  │ …                │  ◄ in active batch → ⏳
└──┴───┴──────────────────────────────────────────────┴──────┴──────────────────┘

  ┌───────────────────────────────────────────────────────────┐
  │ Generating — step 14 of 38 · 1 failed              [✕]     │  ◄ BatchDocStatusBar (non-blocking, fixed bottom)
  │ ████████░░░░░░░░░░░░░░░  37%   Digging "OKF folder…"        │
  └───────────────────────────────────────────────────────────┘
```

### Component specs

- **Checkbox column** (new leading column, `VideoList`/`VideoRow`): one checkbox per row. Disabled
  (▢, tooltip "No summary to generate from") when `summaryMd` is null. Checked = `selected.has(id)`.
  Rows in the active batch show the existing ⏳ glyph and a disabled checkbox.
- **Header select-all control** (tri-state ☑): selects all *currently-visible* rows (after
  sort/search/archive filters) that **need work in the current mode** (see Eligibility). Excludes
  no-summary rows. Checked when all such rows are selected; indeterminate when some.
- **`BulkActionBar`** (appears when `selected.size > 0`):
  - **Phase B:** a `Mode` radio — `Summary HTML` / `Summary + Dig-deeper` (default `Summary HTML`).
    Phase A renders no toggle (single mode).
  - Primary button `Generate — {N} videos` (N = selected count). Disabled when no selected video
    needs work in the current mode.
  - Helper text `({M} summaries already current)` (M = client-computable summary-current count).
  - `Clear` empties selection.
  - **Phase B cost guard:** clicking Generate in `summary-dig` mode opens a confirm dialog —
    `"Dig-deeper for selected videos may run many sections (~$0.05 and ~30s each) and take several
    minutes. Continue?"` (mirrors the existing dig "expand all" estimate). Mode `summary` launches
    immediately (cheap).
- **`BatchDocStatusBar`** (new, non-blocking fixed bottom bar; modeled on `HtmlDocStatusBar`):
  - Running: `Generating — step {current} of {total}{ · {failed} failed}` + bar + the current
    `step` text (e.g., `Digging "…"`).
  - Done: `✓ {succeeded} generated{, {failed} failed}`, auto-closes ~4 s.
  - Fatal error: `✕ {message}` (stays until ✕).

### Tokens / styling
Reuse existing list/table, radio, and status-bar styles. No new color tokens.

---

## Eligibility — "needs work" (drives select-all + the disabled Generate state)

Computed **client-side** for selection/labels using only data the client has; the **backend**
re-computes precisely and is the final skip authority.

| Mode | A row "needs work" (client view) |
|---|---|
| `summary` | summary missing/stale: `!summaryHtml || isOlder(docVersion, CURRENT)` (precise, from index) |
| `summary-dig` | summary missing/stale **OR** `digDeeperMd == null` (never dug). *Coarse on dig:* it catches never-dug videos precisely (index field) but not already-dug-yet-version-stale ones — those are reachable by manual checkbox, and the backend still digs only their missing/stale sections. |

Backend skip is always exact (pre-pass), so over-selecting is harmless (current items are skipped).

---

## Selection operations (table-UI gate — enumerated)

| Operation | Trigger | Result |
|---|---|---|
| Toggle one row | click row checkbox | add/remove `videoId` in `selected` |
| Select-all-needing | header ☑ (unchecked/indeterminate) | `selected` = visible rows that need work in current mode |
| Deselect-all | header ☑ (checked) | `selected` = ∅ |
| Clear | `BulkActionBar` Clear | `selected` = ∅ |
| Disabled row | no `summaryMd` | checkbox non-interactive; never selected |
| Mode change (Phase B) | toggle radio | selection persists; select-all-needing recomputes; Generate enabled-state + helper recompute |
| Filter/sort change | sort/search/archive | `selected` persists by `videoId`; Generate acts on the full `selected` set |

---

## Async operation (gate)

- **Blocking or non-blocking?** **Non-blocking** (status bar). A batch (esp. `summary-dig`) takes
  minutes–tens-of-minutes; the user can browse/sort/search/read meanwhile. A blocking overlay is
  not justified.
- **What the user sees/does:** bottom bar shows `step X of N` + current step text + failed count;
  list stays interactive; processing rows show ⏳.
- **Dismissal:** see table.

### Dismissal table (`BatchDocStatusBar`)

| Mechanism | Expected result |
|---|---|
| ✕ while running | abort the job (AbortSignal), close SSE, hide bar; completed items keep their output |
| Auto-close on `done` | show `✓ … generated` summary, auto-dismiss after ~4 s |
| ✕ after done | immediate dismiss |
| Fatal error | show `✕ {message}`, stays until ✕ |

### URL Contracts

New components generate **no user-facing document URLs** (per-row view links remain the existing
`VideoMenu` ones). New HTTP contracts:

| Caller | Method + URL | Body / params | Response |
|---|---|---|---|
| `BulkActionBar` | `POST /api/videos/batch-docs` | `{ outputFolder, videoIds[], mode: 'summary' \| 'summary-dig' }` | `{ jobId }` or 409 if a batch already runs for the folder |
| `BatchDocStatusBar` | `GET /api/videos/batch-docs/stream?jobId={jobId}` | query `jobId` | SSE of `ProgressEvent` |

---

## Data refresh

- As each video's items complete (and on `done`), call the existing `fetchVideos()` (throttled by
  `fetchSeqRef`) so rows flip their menu to "HTML doc" / dig states. Mirrors ingestion's incremental
  refresh.
- Batch uses its **own** `batchJob` state — NOT the single-job `busyVideoId` scalar (which assumes
  one active job). Rows in the active batch derive ⏳ from the batch's video set.

---

## Error handling / edge cases

- **Per-item failure:** non-fatal; `{type:'error', videoId}`, increment `failed`, continue.
- **Nothing needs work:** Generate disabled.
- **No-summary rows:** not selectable; never sent.
- **Double submit:** one batch per `outputFolder`; second POST → 409.
- **Selection across filters:** `selected` keyed by `videoId`, persists when filtered out of view;
  Generate acts on the full set.
- **Became-current race:** the pre-pass (or `ensureHtmlDoc` no-op) skips it; counted, not an error.
- **Cancellation:** ✕ aborts between items; an in-flight item may finish (best-effort) before stop →
  `{type:'cancelled'}`.
- **(Phase B) video without timestamped sections:** no dig-eligible sections → contributes 0 dig
  items (its summary item still runs).
- **(Phase B) dig partial failure** (e.g., yt-dlp/ffmpeg error on one section): that section's item
  fails non-fatally; other sections/videos continue.

---

## Out of scope

- Deep-dive (legacy) batch; force-regenerate of current items (skip-only); parallel generation
  (sequential — avoids hammering Gemini, matches existing patterns); persisting selection across
  reloads; per-section client-side staleness precision (backend-authoritative instead).
- No `ProgressEvent` schema change; no `docVersion`/`GENERATOR_VERSION`/`DIG_GENERATOR_VERSION` bump;
  no new output file format (reuses `htmls/<base>.html`, `<base>-dig-deeper.md` + its assets).

---

## Testing strategy

Mock Gemini/yt-dlp/ffmpeg at the lib boundary; E2E mocks at the route level.

### Phase A — lib `runBatchDocs` (mode `summary`; jest, mock `ensureHtmlDoc`)
| # | Behavior | Expected |
|---|---|---|
| LA1 | Pre-pass skips current summaries | mixed ids → work list only for missing/stale; `start.total` matches |
| LA2 | Generates each needed video | `ensureHtmlDoc` called per needed id in order; `done{succeeded,failed:0}` |
| LA3 | Progress counter | `step.current` 1..total with right `videoId` |
| LA4 | Sub-progress isolation | a sentinel fired by mocked `ensureHtmlDoc` never reaches the batch stream; callback distinct from batch onProgress |
| LA5 | Best-effort failure | one id rejects → `error{videoId}`, loop continues, `done{failed:1}` |
| LA6 | Abort | signal aborted mid-list → `cancelled`; no further `ensureHtmlDoc` |
| LA7 | Empty / all-current | `start{total:0}` → `done{succeeded:0}`; no generator calls |

### Phase A — API + component/E2E
| # | Behavior | Expected |
|---|---|---|
| AA1 | POST returns jobId; 409 on double-submit per folder | — |
| AA2 | Stream terminal on done/cancelled/fatal; open on per-video error | — |
| CA1 | Checkbox toggle updates selection + bar count | — |
| CA2 | Disabled checkbox for no-summary rows | — |
| CA3 | Select-all-needing selects exactly visible missing/stale rows (tri-state) | — |
| CA4 | Run posts right videoIds + `mode:'summary'`; bar shows step X of N; rows refresh | — |
| CA5 | Dismissal — cancel aborts; auto-close on done | — |

### Phase B — dig additions
| # | Behavior | Expected |
|---|---|---|
| LB1 | `digSection` extraction: route still green | refactor preserves single-section route tests |
| LB2 | Pre-pass dig items = missing/stale sections only | mock parse + `readDugSectionIds`/genVersion → correct work list (skips dug-current) |
| LB3 | `runBatchDocs` mode `summary-dig` | per video: summary-if-needed then each missing/stale section dug, in order; `done` totals correct |
| LB4 | Dig best-effort | one section's `digSection` rejects → `error{videoId}`, rest continue |
| LB5 | No timestamped sections | video contributes 0 dig items; summary item still runs |
| CB1 | Mode toggle recomputes select-all + Generate state | — |
| CB2 | Cost-confirm dialog shown for `summary-dig`, not for `summary`; cancel aborts launch | — |
| CB3 | E2E mode `summary-dig` (routes mocked): posts `mode:'summary-dig'`; bar shows dig step text | — |

---

## Files

### Phase A
- **New:** `lib/html-doc/batch.ts` (`runBatchDocs`, mode `summary`); `app/api/videos/batch-docs/route.ts`;
  `app/api/videos/batch-docs/stream/route.ts`; `components/BulkActionBar.tsx`;
  `components/BatchDocStatusBar.tsx`.
- **Modified:** `components/VideoList.tsx` + `components/VideoRow.tsx` (checkbox column + header
  select-all); `app/page.tsx` (selection + batch-job state, handlers, refresh).
- **Unchanged:** `ensureHtmlDoc`, `render.ts`, `VideoMenu`, `types/index.ts`.

### Phase B
- **New:** `lib/dig/dig-section.ts` (`digSection`, extracted from the dig route).
- **Modified:** `lib/html-doc/batch.ts` (dig branch in `runBatchDocs`); `app/api/videos/[id]/dig/[sectionId]/route.ts`
  (call the extracted `digSection`); `components/BulkActionBar.tsx` (mode toggle + cost-confirm);
  `components/BatchDocStatusBar.tsx` (dig step text); `app/page.tsx` (mode state).
