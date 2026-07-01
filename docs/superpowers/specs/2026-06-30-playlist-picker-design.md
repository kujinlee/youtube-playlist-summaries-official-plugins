# Playlist Picker (A + B) — Design Spec

**Date:** 2026-06-30
**Status:** Approved (brainstorming gate)
**Approach:** #2 — pluggable playlist-source seam (see [[cloud-multitenant-goal]])

---

## Problem

The ingest UI (`components/Header.tsx`, Row 2) requires the user to paste the **exact** playlist URL
(`https://youtube.com/playlist?list=PLXX3HKP5ZNN3upet7agBU2W4l3jkYstZ2&si=…`). Two pains:

1. **No discovery / recall** — you must already have the URL; there is no way to re-pick a playlist you've
   ingested before, or to browse a channel's playlists.
2. **Cryptic identity** — the playlist is shown as its `list=` id ("hash string"), never its human name. The
   index (`raw/playlist-index.json`) stores only `playlistUrl` + `outputFolder`; the title is fetched at ingest
   (to build the folder slug via `fetchPlaylistTitle`) but **discarded**.

## Goal

Replace "paste the exact URL" with a **picker** offering two sources now, and show real playlist **names**
everywhere a playlist is identified. Build the source seam so a third source (OAuth "my account", roadmap item C)
slots in without reworking the UI.

**Scope (this spec):**
- **A. Recent/known** — dropdown of previously-ingested playlists, read from local index files. No API, no auth.
- **B. Channel public** — panel to browse a channel's public playlists by handle/URL, via the existing API key.
- **Title persistence** — persist `playlistTitle`; show name instead of the `list=` id.

**Out of scope (roadmap, not now):** C (OAuth `mine=true`), server-side per-user settings, playlist thumbnails
beyond what the channel API returns for free, channel-playlist pagination ("load more").

---

## Architecture — pluggable playlist-source seam

Every source returns one normalized shape, so the picker UI is source-agnostic.

```ts
// lib/playlists/types.ts
export type PlaylistSource = 'recent' | 'channel'; // 'oauth' added by roadmap item C
export type PlaylistOption = {
  id: string;        // list= id, e.g. PLXX3HKP5ZNN3upet7agBU2W4l3jkYstZ2  (machine key)
  title: string;     // human name, e.g. "Building with Claude"           (UI label)
  url: string;       // canonical https://youtube.com/playlist?list=<id>
  source: PlaylistSource;
  meta?: { videoCount?: number; channelTitle?: string; thumbnailUrl?: string };
};
```

```
lib/playlists/
  types.ts            # PlaylistOption
  recent-provider.ts  # listRecentPlaylists(root): PlaylistOption[]           — pure fs, no API
  channel-provider.ts # listChannelPlaylists(handle, apiKey): {channelTitle, playlists}
```

- **recent-provider** — scans `<root>/*/raw/playlist-index.json`; reads `playlistUrl`, `playlistTitle`,
  `videos.length`; applies the label fallback chain (below). Skips `archived/` and any folder lacking a valid
  index. Sorted by folder mtime, most-recent first. Pure fs → unit-testable with a temp dir.
- **channel-provider** — two `googleapis` calls (client already in `lib/youtube.ts`):
  1. `channels.list({ part:['id','snippet'], forHandle })` → channelId + channelTitle. Strip a leading `@`;
     also accept a full `youtube.com/@handle` or `/channel/<id>` URL (use `id` directly if a channel URL).
  2. `playlists.list({ part:['snippet','contentDetails'], channelId, maxResults:50 })` → map to
     `PlaylistOption` (`snippet.title`, `contentDetails.itemCount`, `snippet.thumbnails`). One page for v1.

When roadmap item C lands: add `oauth-provider.ts` returning the same `PlaylistOption[]`; the picker UI is
untouched. Channel-recents storage (localStorage) migrates to server settings at that point.

### Label fallback chain (never show a bare hash)

`playlistTitle` → folder slug (e.g. `agentic-ai-claude-code`) → `id`.

---

## Data model — title persistence

Add `playlistTitle: string` to the top of `raw/playlist-index.json` (next to `playlistUrl`, `outputFolder`).

**Write path (going forward):** the ingest/output-folder resolution already calls `fetchPlaylistTitle` to build
the slug — keep the result and persist it. No new API call.

**Backfill (existing 3 playlists):** **Script** `scripts/backfill-playlist-titles.ts`
(+ `npm run backfill-playlist-titles`), mirroring the existing `audit-*` / `backfill-serial` scripts: for each
index missing `playlistTitle`, fetch by id, write it. Run once after merge.

**No per-open fetching.** `recent-provider` stays pure fs — it never calls the API. If a folder still lacks a
`playlistTitle` (script not yet run, or a hand-added folder), the provider shows the **slug** via the fallback
chain; running the backfill script fixes it. This keeps the dropdown instant and quota-free.

### Index file — before / after

```jsonc
// before
{ "playlistUrl": "https://youtube.com/playlist?list=PLXX…", "outputFolder": "…/agentic-ai-claude-code/raw",
  "videos": [ … ] }
// after
{ "playlistUrl": "https://youtube.com/playlist?list=PLXX…", "playlistTitle": "Building with Claude",
  "outputFolder": "…/agentic-ai-claude-code/raw", "videos": [ … ] }
```

---

## API routes (thin — validate, call provider, return JSON)

| Route | Params | Returns | Guards |
|---|---|---|---|
| `GET /api/playlists/recent` | `root` (base output folder) | `PlaylistOption[]` | root validation (no traversal), reuse `assertOutputFolder`-style check |
| `GET /api/playlists/channel` | `handle` (`@x`, `x`, or channel URL) | `{ channelTitle, playlists: PlaylistOption[] }` | `YOUTUBE_API_KEY` from env |

Channel-recents (remembered handles) are **not** a server route — `localStorage` for now.

### URL Contracts

| Component | Action / link | Full URL (all params) |
|---|---|---|
| Recent combobox (load) | fetch recent | `/api/playlists/recent?root=<enc(baseOutputFolder)>` |
| Channel panel (Go) | fetch channel playlists | `/api/playlists/channel?handle=<enc(handle)>` |
| Any picker row (select) | writes into URL field | canonical `https://youtube.com/playlist?list=<id>` (no `si=`) |

Selecting a row only **fills the existing URL field**; the existing `onIngest(playlistUrl, outputFolder)` flow
(unchanged) does the fetch when the user clicks **Fetch & Summarize**.

---

## UI Design

Non-blocking throughout: the channel panel is a small centered modal whose fetch renders results inline and is
always dismissible; the recent list is a lightweight dropdown. Nothing locks the app.

### A — Recent combobox (on the existing Row-2 URL field)

```
Row 2:  [ Paste a playlist URL — or pick ▾ ]              [ Fetch & Summarize ]
                              │ (focus / click ▾)
                              ▼
        ┌─────────────────────────────────────────────┐
        │ RECENT                                       │
        │  Building with Claude            114 videos  │   ← title, not the hash
        │  CS146S · Modern Software Dev      9 videos  │
        │  건강                             11 videos  │
        │ ───────────────────────────────────────────  │
        │  🔍 Browse a channel's playlists…            │   ← opens channel panel
        └─────────────────────────────────────────────┘
```

- Focus or ▾ opens the dropdown; typing/pasting a URL bypasses the list (free-text preserved).
- Selecting a row writes its `url` into the field and closes the dropdown.
- Empty root → dropdown shows only "Browse a channel's playlists…".

### B/c — Channel panel

```
        ┌───────────────────────────────────────  ✕ ─┐
        │ Browse channel playlists                    │
        │ [ @AnthropicAI                    ] [ Go ]   │
        │ Recent: [@AnthropicAI] [@Stanford]          │  ← localStorage; click refills input
        │ ───────────────────────────────────────────  │
        │ Anthropic · 12 public playlists             │
        │  ○ Building with Claude          114 videos │  ← click = select
        │  ○ Research Talks                  31 videos │
        └─────────────────────────────────────────────┘
```

- Successful lookup pushes the handle onto the remembered-recents chips.
- Selecting a playlist fills the URL field and closes the panel.

### Overlay Dismissal — channel panel

| Mechanism | Result |
|---|---|
| ✕ button | close panel, URL field unchanged |
| Esc key | close panel, URL field unchanged |
| Backdrop click | close panel, URL field unchanged |
| Select a playlist | fill URL field, close panel |

### Tokens / components

Reuse existing Header/zinc palette — **no new tokens**. Panel `bg-zinc-900 border-zinc-700`; rows
`hover:bg-zinc-800`; recents chips `bg-zinc-800 text-zinc-300`; spinner + error text reuse the app's existing
loading/error styles. Dark mode is already the app default.

### List operations (sort / filter / grouping)

| List | Sort | Filter | Missing-value behavior |
|---|---|---|---|
| Recent dropdown | folder mtime, newest first | exclude `archived/` + invalid indexes | no title → slug → id |
| Channel results | YouTube API return order (v1) | public playlists only (API) | no itemCount → hide "N videos" |

---

## Error handling

| Case | Behavior |
|---|---|
| Recent: unreadable/absent/corrupt index | skip that folder silently |
| Recent: empty root | dropdown shows only "Browse a channel's playlists…" |
| Channel: unknown handle | inline "No channel found for '@x'"; panel stays open |
| Channel: zero public playlists | inline "No public playlists" |
| Channel: API / network / quota error | inline "Couldn't reach YouTube — try again"; panel open; nothing written |
| Title missing (backfill not run / script fetch failed for that id) | provider shows slug (never the id); no per-open fetch |

No selection ever mutates the URL field on an error path.

---

## Testing (mock at the lib boundary; E2E mocks at the API-route level)

**Unit**
- `recent-provider`: temp-dir fixtures — valid index; missing title → slug fallback; `archived/` skipped;
  corrupt index skipped; sort-by-mtime.
- `channel-provider`: mocked `googleapis` — handle resolves; `@`-strip; channel-URL input; not-found; empty
  playlists; API error.
- title persist-on-ingest; `backfill-playlist-titles` script (writes title; leaves populated ones; handles fetch failure).

**Component (@testing-library/react)**
- Recent combobox: renders titles (not ids); select fills field; free-type preserved; empty state.
- Channel panel: all 4 dismissal paths; select fills field; recents chips refill input; loading state; each
  error state.

**E2E (Playwright, mock at API route)**
- Open dropdown → pick recent → field populated → Fetch fires.
- Open channel panel → enter handle → pick → field populated.
- Fixtures include a playlist **with** and **without** a persisted `playlistTitle`.

---

## Roadmap (not this spec)

- **C. OAuth `mine=true`** — `oauth-provider.ts` behind the same `PlaylistOption` shape; "Sign in with Google".
- Migrate channel-recents localStorage → server per-user settings.
- Playlist thumbnails in the picker; channel pagination.

See [[cloud-multitenant-goal]].
