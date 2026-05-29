# Design Spec: Video Quick-View (TL;DR + Takeaways + Concepts)

**Date:** 2026-05-29  
**Status:** Approved

---

## Problem

Video summaries are generated as 3–6 prose H2 sections viewed only via Obsidian or PDF.
Users experience a "wall of text" and cannot quickly grasp what a video is about without reading the full summary.

## Goal

Add a **Quick Reference** layer surfaced in two places:

1. **Obsidian** — an `[!summary]` callout block at the top of every new `.md` file
2. **Browser** — an expandable inline row card in the video list table

The card contains: **TL;DR** (1 sentence) · **Key Takeaways** (3–5 bullets) · **Concepts** (existing `tags[]` as pills)

---

## Approach

**Approach 1 — Gemini at ingest + lazy backfill**

- New videos: `tldr` + `takeaways` generated at ingest time, stored in `playlist-index.json`, embedded in `.md`
- Existing videos: first row-expand triggers `GET /api/videos/[id]/quick-view` → Gemini extracts from `.md` → cached in index
- Zero latency for new videos; ~2s on first expand for old videos (instant thereafter)

---

## Data Model

**File:** `types/index.ts` — `Video` interface

```typescript
tldr?: string        // 1-sentence description, ≤25 words
takeaways?: string[] // 3–5 learnable insights, each ≤20 words
```

`tags[]` (already exists) is reused for the "Concepts" pills — no new field.

---

## Gemini Prompt Changes

**File:** `lib/gemini.ts`

### `generateSummary()` — additional JSON response fields

```json
{
  "tldr": "One sentence (≤25 words) describing the core idea of this video.",
  "takeaways": [
    "Learnable insight 1 (≤20 words)",
    "Learnable insight 2",
    "Learnable insight 3"
  ]
}
```

Prompt constraints:
- `tldr`: single sentence, ≤25 words, phrased as "This video teaches/shows/demonstrates X"
- `takeaways`: 3–5 items; each is a concrete learnable insight or action — not a topic label

### New function: `extractQuickView(summaryMarkdown: string)`

Used for the backfill path. Sends the existing `.md` body to Gemini with an extraction-only prompt
asking for `{ tldr, takeaways }` in the same JSON shape. No ratings or classification needed.

---

## Markdown Template (Obsidian)

**File:** `lib/pipeline.ts`

Insert a Quick Reference callout block between the metadata line and the first `---` divider:

```markdown
# Video Title

**Channel:** … | **Duration:** … | **URL:** …

> [!summary] Quick Reference
> **TL;DR:** One sentence description of the video.
>
> **Key Takeaways:**
> - First learnable point
> - Second learnable point
> - Third learnable point
>
> **Concepts:** concept1 · concept2 · concept3

---

## 1. First Section
…
```

- `> [!summary]` is an Obsidian callout — renders as a styled card
- Concepts line: `tags[]` joined with ` · `
- Only new summaries get this block; existing `.md` files are NOT modified

---

## New API Endpoint

**File:** `app/api/videos/[id]/quick-view/route.ts`

### `GET /api/videos/[id]/quick-view?outputFolder=<path>`

| Step | Condition | Action |
|------|-----------|--------|
| 1 | Video not found | 404 |
| 2 | `tldr` present in index | Return `{ tldr, takeaways, tags }` immediately |
| 3 | `tldr` absent, `summaryMd` null | 404 (no summary file to extract from) |
| 4 | `tldr` absent, `summaryMd` present | Read `.md` → call `extractQuickView()` → write `{ tldr, takeaways }` to index → return `{ tldr, takeaways, tags }` |
| 5 | Gemini fails | 500 with error message |

---

## Browser UI

### New Component: `components/VideoQuickView.tsx`

**Props:**
```typescript
interface VideoQuickViewProps {
  videoId: string
  tldr?: string        // pre-loaded from index if available
  takeaways?: string[]
  tags?: string[]
  outputFolder: string
  colSpan: number      // spans all table columns
}
```

**Render states:**

| State | Trigger | Display |
|-------|---------|---------|
| Instant | `tldr` prop provided | Card immediately |
| Loading | `tldr` absent, fetch pending | Spinner row spanning all columns |
| Error | fetch failed | "Could not generate quick view" + Retry button |
| Success | fetch complete | Card |

**Card layout:**
```
┌──────────────────────────────────────────────────────────┐
│  TL;DR: One sentence about what this video teaches.      │
│                                                          │
│  Key Takeaways                                           │
│  • First learnable point from this video                 │
│  • Second learnable point                                │
│  • Third learnable point                                 │
│                                                          │
│  Concepts:  [tag1]  [tag2]  [tag3]  [tag4]              │
└──────────────────────────────────────────────────────────┘
```

Uses existing `Badge` component for concept pills.
Fetches `GET /api/videos/[id]/quick-view?outputFolder=...` when `tldr` is absent.

---

### Updated Component: `components/VideoRow.tsx`

Changes:
- New leftmost cell: `▶` (collapsed) / `▼` (expanded) chevron button
- Local `useState<boolean>(false)` for `isExpanded` — per-row, not lifted
- Click chevron **or** click title → toggle `isExpanded`
- When `isExpanded`: render `<VideoQuickView>` in a `<tr>` beneath the data row

---

## Bulk Backfill — Existing `.md` + `.pdf` Files

A one-time, user-triggered migration for videos that were ingested before the Quick Reference feature existed.

### Trigger: Contextual Banner

When the video list contains at least one video that has `summaryMd` but no `tldr`, a dismissible banner appears in the `FilterBar`:

```
⚡ 47 videos missing Quick Reference.  [Generate all]  ✕
```

- Clicking **Generate all** opens a progress overlay and starts the SSE stream
- Clicking **✕** hides the banner for the session (does not run backfill)
- Banner disappears permanently once all eligible videos are processed

### New API: Bulk Backfill Stream

**File:** `app/api/quick-view/backfill/route.ts`

`GET /api/quick-view/backfill?outputFolder=<path>`

SSE stream. Processes all videos with `summaryMd` set but `tldr` absent, in index order.

**Per-video steps:**
1. Read `summaryMd` file from disk (skip with error event if file missing)
2. Call `gemini.extractQuickView(content)` → `{ tldr, takeaways }`
3. Insert `[!summary]` callout block into `.md` at the correct position (after metadata line, before `---`)
4. Write updated `.md` back to disk
5. Call `generatePdf(updatedContent, pdfPath)` to overwrite the existing PDF (skip if `summaryPdf` is null)
6. Update index entry with `{ tldr, takeaways }`

**SSE event shapes:**
```typescript
{ type: 'start';    total: number }
{ type: 'progress'; videoId: string; title: string; current: number; total: number; status: 'done' | 'error'; error?: string }
{ type: 'complete'; succeeded: number; failed: number }
```

**Error handling:** per-video errors are reported in the stream and skipped — the batch continues.

**Rate limiting:** 200ms delay between Gemini calls to avoid quota exhaustion on large playlists.

### Progress Overlay

**Component:** `components/BackfillOverlay.tsx` (new)

Non-blocking overlay (same visual style as `DeepDiveOverlay`) showing:
```
Generating Quick References…  (12 / 47)
████████░░░░░░░░░░░░  25%

✓ Introduction to Agents
✓ RAG Deep Dive
⚠ Claude Artifacts (PDF failed — .md updated)
…

                             [Dismiss]  ← enabled only when complete/error
```

- Progress bar + per-video status list (scrollable)
- Dismiss button enabled only after `complete` event
- Errors shown inline (⚠) — user can see which videos had issues
- On `complete`: banner in FilterBar is hidden

### Dismissal

| Component | Mechanism | Expected result |
|-----------|-----------|-----------------|
| `BackfillOverlay` | Click **Dismiss** (enabled after `complete`) | Overlay closes; banner hidden |
| `BackfillOverlay` | SSE connection drops mid-run | Overlay shows error state; Retry button appears |

---

## URL Contracts

| Component | Endpoint | Full URL |
|-----------|----------|---------|
| `VideoQuickView` (per-video fetch) | `GET /api/videos/[id]/quick-view` | `/api/videos/[id]/quick-view?outputFolder=<path>` |
| `BackfillOverlay` (bulk stream) | `GET /api/quick-view/backfill` | `/api/quick-view/backfill?outputFolder=<path>` |

---

## Expansion / Dismissal

| Component | Mechanism | Expected result |
|-----------|-----------|-----------------|
| `VideoRow` expanded | Click chevron (`▼→▶`) | Row collapses, `VideoQuickView` unmounts |
| `VideoRow` expanded | Click title cell | Row collapses, `VideoQuickView` unmounts |
| `BackfillOverlay` | Click **Dismiss** (post-complete) | Overlay closes |
| `BackfillOverlay` | Click **✕** on FilterBar banner | Banner hidden for session; no backfill runs |

---

## Files to Create / Modify

| File | Action |
|------|--------|
| `types/index.ts` | Add `tldr?`, `takeaways?` to `Video` |
| `lib/gemini.ts` | Add fields to `generateSummary` schema; add `extractQuickView()` |
| `lib/pipeline.ts` | Embed Quick Reference callout in `.md` template; add `insertQuickViewCallout(content, tldr, takeaways, tags)` helper |
| `app/api/videos/[id]/quick-view/route.ts` | Create per-video backfill endpoint (index-only) |
| `app/api/quick-view/backfill/route.ts` | Create bulk backfill SSE endpoint |
| `components/VideoQuickView.tsx` | Create quick-view card component |
| `components/VideoRow.tsx` | Add chevron, expand state, render `VideoQuickView` |
| `components/BackfillOverlay.tsx` | Create bulk backfill progress overlay |
| `components/FilterBar.tsx` | Add contextual backfill banner |

---

## Testing

### Unit
- `lib/gemini.ts` — `extractQuickView()`: mock Gemini call, assert `{ tldr: string, takeaways: string[] }` shape
- `lib/pipeline.ts` — `insertQuickViewCallout()`: assert insertion at correct position; assert idempotent (no double-insert if already present)
- `lib/pipeline.ts` — markdown builder: assert Quick Reference callout present in new summaries with `tldr`/`takeaways`

### Component
- `VideoQuickView`: instant render, loading state, error+retry state
- `VideoRow`: chevron renders; click toggles expand; click title toggles expand; pre-loaded data renders without fetch
- `BackfillOverlay`: shows progress events; Dismiss disabled during run; enabled after `complete`; error state on SSE drop
- `FilterBar`: banner visible when eligible videos exist; hidden after dismiss; hidden after complete

### E2E
- Expand row with pre-loaded `tldr` → card appears immediately
- Expand row without `tldr` → loading → card appears (mock API)
- Collapse: expand → click chevron → card disappears
- Backfill banner visible with unprocessed videos; click Generate all → overlay appears → progress events → complete → banner hidden

---

## Backward Compatibility

- Existing `.md` files: only modified by the explicit bulk backfill action — never touched by the per-video quick-view endpoint
- Per-video quick-view endpoint (`/api/videos/[id]/quick-view`): updates index only; does NOT touch `.md` or `.pdf` files
- Videos without a `summaryMd` file: skipped silently in bulk backfill; per-video endpoint returns 404
- PDF regeneration: skipped (no error) if `summaryPdf` is null for a video
