# Date Columns Design: Published & Added

**Date:** 2026-05-28
**Status:** Approved

## Summary

Add two new sortable date columns to the video table — "Published" (when the video was published on YouTube) and "Added" (when it was added to the playlist). Both timestamps are already available from the YouTube API but are not currently captured or displayed.

---

## Problem

- The table has no way to sort by video recency or by playlist curation order.
- `#` (playlistIndex) approximates playlist order but is frozen at first ingest and doesn't reflect YouTube publish date at all.
- Users who want to find recently published videos or recently curated additions have no sort option for either.

---

## Data Capture

Two timestamps are fetched from the YouTube API — both are ISO 8601 strings (`2024-11-12T14:30:00Z`).

| Field | YouTube API source | Part required |
|---|---|---|
| Video publish date | `videos.list` → `snippet.publishedAt` | `'snippet'` (already requested) |
| Added to playlist | `playlistItems.list` → `snippet.publishedAt` | `'snippet'` (must be added to current `part: ['contentDetails']`) |

**No additional API quota cost.** Both fields come from calls already made; the only change is adding `'snippet'` to the `playlistItems.list` call and capturing two more fields.

### `playlistItems.list` change

```ts
// Before
part: ['contentDetails']

// After
part: ['contentDetails', 'snippet']
```

The `addedToPlaylistAt` value is collected during the playlist page loop alongside `videoId` and carried into the `VideoMeta` struct.

---

## Data Model

### `VideoMeta` (transport type, `lib/youtube.ts`)

Add two optional fields:

```ts
videoPublishedAt?: string   // ISO 8601 — from videos.list snippet.publishedAt
addedToPlaylistAt?: string  // ISO 8601 — from playlistItems.list snippet.publishedAt
```

### `Video` (index type, `types/index.ts`)

Add two optional Zod-validated fields:

```ts
videoPublishedAt: z.string().datetime().optional()
addedToPlaylistAt: z.string().datetime().optional()
```

### `SortColumn` union

Extend with two new members:

```ts
type SortColumn = ... | 'videoPublishedAt' | 'addedToPlaylistAt'
```

### Pipeline (`lib/pipeline.ts`)

Pass both fields from `VideoMeta` into the `Video` object when building it during ingest. No stamping logic needed — these are live values from the API, not stable IDs.

For already-indexed videos (skipped during the main loop), `videoPublishedAt` and `addedToPlaylistAt` are populated from the `positionMap`-equivalent during the post-reconcile stamp pass. Specifically, both fields are passed through `upsertVideo` only if not already set (same `??` pattern as `playlistIndex`), so a re-sync fills them in for previously-indexed videos.

---

## UI

### Column placement

```
# | Title | Lang | Type | Audience | Published | Added | USE | DPT | ORI | RCN | CMP | OVR
```

Both date columns are inserted after `Audience` and before the rating block.

### Column spec

| Key | Label | Full name (tooltip) | Align | Format |
|---|---|---|---|---|
| `videoPublishedAt` | `Published` | `Published on YouTube` | left | `YYYY-MM-DD` |
| `addedToPlaylistAt` | `Added` | `Added to playlist` | left | `YYYY-MM-DD` |

**Format rule:** Display date only (`YYYY-MM-DD`), not time. Strip time component before rendering: `value.slice(0, 10)`.

### Sort behaviour

- Clicking an inactive date column → **descending first** (newest at top), unlike other columns which start ascending. This matches the stated user intent: "see recently published / recently added first."
- Clicking the active date column → toggles to ascending.
- Null/missing dates sort to the **bottom** regardless of direction.
- Display value for missing date: `—` (em dash).

### Sort direction toggle logic (diff from current)

Currently `VideoList` always starts `asc` on first click. Date columns need an exception:

```ts
const DATE_COLS: SortColumn[] = ['videoPublishedAt', 'addedToPlaylistAt'];

const nextOrder: SortOrder =
  col === sortColumn && sortOrder === 'desc' ? 'asc'
  : col === sortColumn && sortOrder === 'asc' ? 'desc'
  : DATE_COLS.includes(col) ? 'desc'   // first click on date col → newest first
  : 'asc';                              // first click on all others → smallest first
```

---

## API Sort Handler

The `/api/videos` route (or equivalent sort path) must handle the two new `SortColumn` values. Date strings sort correctly with string comparison (`localeCompare` or direct `<`/`>`) since they are ISO 8601 and lexicographic order equals chronological order. Null values always go last.

```ts
// Null-safe date comparator (desc example)
function compareDates(a: string | undefined, b: string | undefined): number {
  if (!a && !b) return 0;
  if (!a) return 1;   // nulls to bottom
  if (!b) return -1;
  return b.localeCompare(a);  // desc: newer first
}
```

---

## Backward Compatibility

- Existing videos in the JSON index will have `videoPublishedAt` and `addedToPlaylistAt` as `undefined` until the playlist is re-synced.
- No migration script required — the fields are optional in the schema.
- The table renders `—` for missing dates; sort treats them as last.
- Re-syncing any playlist automatically backfills both dates for all already-indexed videos (via the `??` fill-in pass).

---

## Testing

### Unit tests (`tests/lib/`)

| Test | Covers |
|---|---|
| `youtube.test.ts` — `fetchPlaylistVideos` returns `addedToPlaylistAt` from `playlistItems.snippet.publishedAt` | API data capture |
| `youtube.test.ts` — `fetchPlaylistVideos` returns `videoPublishedAt` from `videos.snippet.publishedAt` | API data capture |
| `youtube.test.ts` — missing `snippet.publishedAt` → field is `undefined` (not null, not empty string) | Null safety |
| `pipeline.test.ts` — new video has both dates stamped from `VideoMeta` | Pipeline ingest |
| `pipeline.test.ts` — already-indexed video gets dates backfilled on re-sync if previously undefined | Backfill |
| `pipeline.test.ts` — already-indexed video keeps existing dates on re-sync if already set | Stability |

### Component tests (`tests/components/`)

| Test | Covers |
|---|---|
| `VideoList.test.tsx` — renders `Published` and `Added` column headers | Column presence |
| `VideoList.test.tsx` — renders ISO date `YYYY-MM-DD` in cell | Format |
| `VideoList.test.tsx` — renders `—` when date is undefined | Null display |
| `VideoList.test.tsx` — first click on `Published` column calls `onSort` with `('videoPublishedAt', 'desc')` | Default desc |
| `VideoList.test.tsx` — first click on `Added` column calls `onSort` with `('addedToPlaylistAt', 'desc')` | Default desc |
| `VideoList.test.tsx` — second click on active date column calls `onSort` with `'asc'` | Toggle |
| `VideoList.test.tsx` — first click on non-date column (e.g. `name`) calls `onSort` with `'asc'` | Other cols unaffected |

### E2E (if applicable)

Covered by existing playlist sync E2E — verify dates appear in the table after a sync round-trip.

---

## Files Changed

| File | Change |
|---|---|
| `lib/youtube.ts` | Add `'snippet'` to `playlistItems.list` part; capture `addedToPlaylistAt` and `videoPublishedAt` in `VideoMeta` |
| `types/index.ts` | Add `videoPublishedAt`, `addedToPlaylistAt` to `VideoSchema`; extend `SortColumn` |
| `lib/pipeline.ts` | Pass both date fields from `VideoMeta` → `Video`; backfill in post-reconcile pass |
| `components/VideoList.tsx` | Add two columns to `COLUMNS`; update first-click direction logic for date cols |
| `components/VideoRow.tsx` | Render `YYYY-MM-DD` or `—` for both date fields |
| `app/api/videos/route.ts` (or sort path) | Handle `videoPublishedAt` / `addedToPlaylistAt` in sort comparator with null-last logic |
