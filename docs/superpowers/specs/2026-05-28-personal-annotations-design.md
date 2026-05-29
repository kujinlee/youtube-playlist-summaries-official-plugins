# Personal Review Design

**Date:** 2026-05-28
**Status:** Approved (updated after Codex adversarial review)

## Problem

The app displays AI-generated ratings and scores for each video, but has no way to capture the user's own judgment about a video's value. The user wants to mark videos with a personal score and leave brief notes, then filter the list to concentrate on high-value material and skip low-value material.

## Solution

Add a **personal review** to each video — consisting of an optional 1–5 personal score and an optional free-text note — stored in `playlist-index.json` alongside existing fields. Expose them as a `My Score` star-rating column and a `Note` column in the video table, and add a `My score ≥` filter to the filter bar.

## Data Model

### `VideoSchema` additions (`types/index.ts`)

```ts
personalScore: z.number().int().min(1).max(5).optional(),
personalNote:  z.string().max(500).optional(),
```

Both fields are optional. Existing videos in any index file need no migration — they simply have no personal annotation.

**Max note length: 500 characters.** Notes exceeding 500 chars are rejected with 400. Empty string `""` is treated as absent (field deleted from the index entry, not stored as `""`).

### `FilterState` addition (`types/index.ts`)

```ts
minPersonalScore: number  // 0 = no filter; 1–5 = minimum personal score to show normally
```

`FILTER_DEFAULTS` sets `minPersonalScore: 0`.

**Filter semantics:** When `minPersonalScore > 0`, videos with `personalScore >= minPersonalScore` are shown normally. Videos with `personalScore < minPersonalScore` are hidden. Videos with no personal score (`undefined`) are shown but their cells are dimmed (`opacity-50`) as a visual signal that they have not yet been evaluated. This is intentional — the user chose to see unscored videos dimmed rather than hidden.

### `SortColumn` addition (`types/index.ts`)

```ts
'personalScore'  // added to the union
```

### Data flow ownership

`Page` (`app/page.tsx`) owns the `videos` array state. When an annotation changes (score or note), `VideoRow` calls `onAnnotationChange(videoId, patch: Partial<Pick<Video, 'personalScore' | 'personalNote'>>)` which is defined in `Page` and updates the local `videos` array immediately (optimistic). On API failure the callback receives an error and reverts to the pre-edit value.

The callback chain: `Page` → `VideoList` → `VideoRow` → `StarRating` / `NoteCell`.

## API Route

**`POST /api/videos/[id]/review`**

| Field | Type | Required |
|---|---|---|
| `outputFolder` | `string` | yes |
| `personalScore` | `1 \| 2 \| 3 \| 4 \| 5 \| null` | no |
| `personalNote` | `string (max 500 chars)` | no |

**Field semantics:**
- `personalScore: null` → deletes `personalScore` from the index entry (field absent after write; `null` is never stored)
- `personalScore` absent → score field not touched
- `personalNote: ""` → deletes `personalNote` from the index entry
- `personalNote` absent → note field not touched
- At least one of `personalScore`, `personalNote` must be present (otherwise 400)
- Route maps `null`/`""` values to field deletion before calling `updateVideoFields`

**Security / threat model:** This is a local single-user app with no network exposure by design. No authentication beyond `assertOutputFolder` + `assertVideoId` path guards is applied — consistent with all other write routes (archive, deep-dive). Same-origin CSRF protection is not needed for a localhost-only app.

**Concurrency:** `updateVideoFields` uses a read-modify-write pattern shared by all write routes in this app. This is an accepted trade-off for a single-user local tool. Concurrent saves from the same browser session are extremely unlikely; no additional locking is added.

**Response table:**

| Status | Condition | Body |
|---|---|---|
| `200` | Success | `{ ok: true }` |
| `400` | Missing `outputFolder` | `{ error: "outputFolder is required" }` |
| `400` | Neither `personalScore` nor `personalNote` present | `{ error: "at least one field required" }` |
| `400` | `personalScore` out of range (not 1–5 or null) | `{ error: "personalScore must be 1–5 or null" }` |
| `400` | `personalNote` exceeds 500 chars | `{ error: "personalNote must be 500 characters or fewer" }` |
| `400` | Invalid `videoId` | `{ error: "invalid request" }` |
| `404` | Video not found in index | `{ error: "video not found" }` |
| `500` | Write failure | `{ error: "internal error" }` |

## UI Components

### `StarRating` (`components/StarRating.tsx`)

Renders 5 star icons (★ filled / ☆ empty) up to `personalScore`.

**Interactions:**
- Click a star → sets `personalScore` to that number; fires `POST /api/videos/[id]/annotation`
- Click the currently-selected star → clears score; fires API with `personalScore: null`
- Hover preview: stars up to hovered index light up before click
- **Optimistic update:** `onChange(newScore)` called immediately; if API fails, `onChange(previousScore)` called to revert
- While API is in flight: stars are non-interactive (pointer-events disabled); no spinner needed (instant save feel)

**Accessibility:**
- Rendered as a `radiogroup` with 5 `radio` inputs (visually hidden, stars overlaid)
- Each input labeled `"N star"` (e.g. `"3 stars"`)
- Arrow keys cycle through values; Space selects
- The "clear" affordance (click active star) is keyboard-accessible: pressing Space on the active star clears it

Props:
```ts
interface StarRatingProps {
  videoId: string;
  outputFolder: string;
  value: number | undefined;
  onChange: (score: number | undefined) => void;
}
```

### `NoteCell` (`components/NoteCell.tsx`)

Renders in the `Note` table column.

- **No note:** displays `—`
- **Has note:** displays first 25 characters followed by `…` if longer (truncation is by UTF-16 code unit — acceptable for short notes)
- **Click anywhere on cell:** opens an absolutely-positioned popover anchored to the cell, constrained within the viewport

**Popover:**
- Contains a `<textarea>` pre-filled with current note (empty if none), max 500 chars enforced by `maxLength`
- Focus moves to the textarea on open
- **Save** button: disabled while saving; calls API; on success → calls `onChange(note || undefined)` and closes; on failure → shows error message inline, keeps popover open
- **Cancel** button: discards changes, closes popover; disabled while saving
- **Escape key:** same as Cancel (disabled while saving)
- **Outside click (backdrop):** same as Cancel (disabled while saving)

**Note:** Empty textarea on Save is treated as "clear note" — `onChange(undefined)` is called and the API receives `personalNote: ""`.

Props:
```ts
interface NoteCellProps {
  videoId: string;
  outputFolder: string;
  value: string | undefined;
  onChange: (note: string | undefined) => void;
}
```

### `VideoRow` changes (`components/VideoRow.tsx`)

Two new `<td>` cells added after the existing rating columns:

1. `My Score` cell — renders `<StarRating>`
2. `Note` cell — renders `<NoteCell>`

**Dimming rule:** A single computed `cellDim` class string is used for all data cells:

```ts
const cellDim = video.archived
  ? 'opacity-40'
  : (dimUnscored ? 'opacity-50' : '');
```

This ensures archived and unscored opacities don't stack (archived takes precedence). The `dimUnscored` prop is `true` when `minPersonalScore > 0 && video.personalScore === undefined`.

### `VideoList` changes (`components/VideoList.tsx`)

Two new `<th>` column headers added:
- `My Score` — sortable; **first click = descending** (highest personal score first, matching the pattern of all rating columns)
- `Note` — not sortable

### `FilterBar` changes (`components/FilterBar.tsx`)

The existing `Score` dropdown is renamed to **`AI score ≥`** (was `Score`). A new `My score ≥` dropdown is added immediately after it:

```
AI score ≥  [All ▾]    My score ≥  [All ▾]
```

`My score ≥` options: `All` (value `0`) / `1+` / `2+` / `3+` / `4+` / `5`

### `app/page.tsx` changes

**`onAnnotationChange` callback:**
```ts
const handleAnnotationChange = useCallback(
  (videoId: string, patch: Partial<Pick<Video, 'personalScore' | 'personalNote'>>) => {
    setVideos((prev) =>
      prev.map((v) => (v.id === videoId ? { ...v, ...patch } : v)),
    );
  },
  [],
);
```

Passed as `onAnnotationChange={handleAnnotationChange}` to `<VideoList>`.

**Filter:**
```ts
.filter((v) => {
  if (filters.minPersonalScore === 0) return true;
  if (v.personalScore === undefined) return true;  // shown dimmed, not hidden
  return v.personalScore >= filters.minPersonalScore;
})
```

**Dimming:** `VideoRow` receives `dimUnscored={filters.minPersonalScore > 0 && video.personalScore === undefined}`.

### `app/api/videos/route.ts` changes

New sort case for `personalScore`:

```ts
case 'personalScore':
  if (a.personalScore === undefined && b.personalScore === undefined) return 0;
  if (a.personalScore === undefined) return 1;   // nulls last
  if (b.personalScore === undefined) return -1;  // nulls last
  return dir * (a.personalScore - b.personalScore);
```

## URL Contracts

| Component | Link text | Full URL |
|---|---|---|
| StarRating | (API call, not a link) | `POST /api/videos/{id}/review` body: `{ outputFolder, personalScore }` |
| NoteCell | (API call, not a link) | `POST /api/videos/{id}/review` body: `{ outputFolder, personalNote }` |

## Overlay Dismissal

| Component | Mechanism | Condition | Expected result |
|---|---|---|---|
| NoteCell popover | Cancel button | Not saving | Discards changes, closes popover |
| NoteCell popover | Save button | Not saving | Starts save; closes on success; shows error on failure |
| NoteCell popover | Escape key | Not saving | Same as Cancel |
| NoteCell popover | Outside click (backdrop) | Not saving | Same as Cancel |
| NoteCell popover | Any dismiss mechanism | While saving | No-op (dismiss disabled during save) |

## Sorting

| Column | Direction | Undefined behaviour |
|---|---|---|
| `personalScore` | asc | Unscored videos sort last |
| `personalScore` | desc | Unscored videos sort last |
| `personalScore` | either | Two unscored videos: stable (return 0) |

First click on `My Score` header → descending (highest personal score first).

## Filtering

| `minPersonalScore` | `personalScore` value | Result |
|---|---|---|
| 0 | any | Shown normally |
| > 0 | `>= minPersonalScore` | Shown normally |
| > 0 | `< minPersonalScore` | Hidden |
| > 0 | undefined (unscored) | Shown, cells dimmed (`opacity-50`) |

**Design intent:** Unscored videos are shown dimmed (not hidden) so the user can see what still needs evaluation while still focusing on their highest-rated material.

## Backward Compatibility

- Existing `playlist-index.json` files need no changes — both fields are optional in the Zod schema
- Re-syncing a playlist preserves `personalScore` and `personalNote`: the pipeline skips already-indexed videos entirely (`alreadyIndexed.has(meta.videoId)` check in `runIngestion`) — they are never overwritten

## Out of Scope

- Bulk annotation (setting score/note for multiple videos at once)
- Exporting annotations
- Sharing annotations across devices
- Integration of personal score into the `overallScore` calculation (overallScore remains AI-only)
- Concurrency locking (single-user local app; same trade-off as all other write routes)

## Files Changed

| File | Change |
|---|---|
| `types/index.ts` | Add `personalScore`, `personalNote` to `VideoSchema`; add `minPersonalScore` to `FilterState`; add `'personalScore'` to `SortColumn` |
| `app/api/videos/[id]/review/route.ts` | New — POST review handler |
| `components/StarRating.tsx` | New — accessible 5-star radio widget |
| `components/NoteCell.tsx` | New — truncated preview + edit popover |
| `components/VideoRow.tsx` | Add My Score + Note columns; unified dimming logic |
| `components/VideoList.tsx` | Add My Score (sortable) + Note (unsortable) column headers |
| `components/FilterBar.tsx` | Rename "Score" label to "AI score ≥"; add "My score ≥" dropdown |
| `app/api/videos/route.ts` | Add `personalScore` sort case (nulls last, stable) |
| `app/page.tsx` | Add `minPersonalScore` filter + `onAnnotationChange` + `dimUnscored` prop |

## Testing

### `tests/components/StarRating.test.tsx` (new)

| Test | Covers |
|---|---|
| Renders 5 stars, filled up to value | Display |
| Renders all empty when value is undefined | Unscored state |
| Click star N calls onChange with N | Score set |
| Click active star calls onChange with undefined | Score clear |
| Hover preview lights up stars to hovered index | Hover state |
| Stars are non-interactive while saving | Pending state |
| onChange reverts to previous value on API failure | Rollback |

### `tests/components/NoteCell.test.tsx` (new)

| Test | Covers |
|---|---|
| Shows `—` when note is undefined | Empty state |
| Shows truncated text (25 chars + `…`) when note is long | Truncation |
| Click opens popover with textarea pre-filled | Popover open |
| Cancel closes popover without calling onChange | Cancel |
| Escape closes popover without calling onChange | Escape dismissal |
| Outside click closes popover | Backdrop dismissal |
| Save calls onChange with note and closes popover | Save success |
| Save with empty textarea calls onChange with undefined | Note clear |
| Save button and Cancel disabled while saving | Pending state |
| Inline error shown when API call fails; popover stays open | Save failure |
| Dismiss (Cancel/Escape/backdrop) no-ops while saving | Dismiss during save |

### `tests/components/VideoRow.test.tsx` (update)

| Test | Change |
|---|---|
| Renders My Score stars column | New |
| Renders Note cell column | New |
| Cells use opacity-50 when unscored and dimUnscored=true | New |
| Cells use opacity-40 when archived (archived takes precedence) | New |

### `tests/api/review.test.ts` (new)

| Test | Covers |
|---|---|
| POST with valid score saves to index | Happy path |
| POST with valid note saves to index | Happy path |
| POST with both score and note saves both | Both fields |
| POST with `personalScore: null` deletes field from index | Score clear |
| POST with `personalNote: ""` deletes field from index | Note clear |
| POST with neither field returns 400 | Validation |
| POST with invalid score (0, 6, string) returns 400 | Validation |
| POST with note over 500 chars returns 400 | Validation |
| POST with missing outputFolder returns 400 | Validation |
| POST with unknown videoId returns 404 | Not found |
