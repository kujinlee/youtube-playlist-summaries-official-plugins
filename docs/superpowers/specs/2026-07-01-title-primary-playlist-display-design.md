# Title-Primary Playlist Display

**Date:** 2026-07-01
**Status:** Design (approved in brainstorming)
**Scope:** Header + playlist picker **display only**. No change to playlist resolution, ingestion, the
folder/slug scheme, or the data model. The `list=` URL remains the machinery identity; this makes the
human-readable **title** the primary thing shown, with the full URL as an always-present qualifier.

---

## Problem

The Header currently makes the **playlist URL** the prominent control (a large editable input), with the
title shown only as a muted `▶ 건강` caption above it (`components/Header.tsx:262`). Users think in
playlist *names*, not `list=` ids, so the URL is friction. But titles are **not unique** — a YouTube
playlist's identity is its `list=<id>`; two playlists (different creators, or one account) can share a
title. So the URL can't simply be hidden — it's needed to disambiguate the occasional collision.

## Goal

Make the **title** the primary label everywhere a playlist is shown, with the **full URL as a muted
qualifier** beneath it. Keep URL-paste as the (only, for now) way to add a not-yet-seen playlist, but
tuck it out of the steady-state view.

## Decisions (from brainstorming)

1. **Always show `title` + muted full URL** (not conditional-on-collision) — simplest, no collision
   logic. Applies to the current playlist and every picker row.
2. The muted URL is a **clickable link that opens the playlist on YouTube** in a new tab.
3. The editable URL input is **tucked into a collapsed "+ Add by link" disclosure**; it
   **auto-collapses on a successful switch**, and Escape/blur dismisses it.
4. **Empty state** (no playlist yet) → the "+ Add by link" field starts **expanded** with a prompt.
5. Title fallback when `playlistTitle` is absent → folder slug → `"Untitled playlist"` (matches
   `lib/playlists/recent-provider.ts:33`).

## Out of Scope (future)

A discovered-playlist dropdown that lets a user pick a playlist without pasting a URL (finding playlist
URLs is real friction). Requires a reliable discovery method; noted as a follow-up, not built here.
Also out of scope: the pre-existing same-title→same-slug folder-collision at the data layer (separate).

## UI Design

### Current playlist (Header) — after

```
┌─ Data folder ───────────────────────────┐
│ /…/plugins-data                          │   ← baseOutputFolder input (unchanged)
└──────────────────────────────────────────┘
→ writes to: …/건강/raw                        ← resolved-target caption (unchanged)

건강                                           ← TITLE, read-only, prominent (was muted ▶ caption)
https://youtube.com/playlist?list=PLXX…837     ← muted URL, clickable → opens YouTube (new tab)

[ ▾ RECENT / channel picker ]   [ + Add by link ]   ← picker + disclosure toggle
```

Revealed after clicking **+ Add by link** (or auto-expanded in the empty state):

```
[ + Add by link ]  ▲
┌──────────────────────────────────────────┐
│ Paste a YouTube playlist link…            │   ← the existing editable URL input + debounced resolve
└──────────────────────────────────────────┘
```

### RECENT / channel picker rows — after (`PlaylistPicker.tsx:44`, `ChannelPlaylistPanel` rows)

```
RECENT
  Agentic AI. Claude Code
  https://youtube.com/playlist?list=PLXX…Z2      ← muted, smaller, truncate w/ ellipsis
  건강
  https://youtube.com/playlist?list=PLXX…837
  CS146S The Modern Software Development
  https://youtube.com/playlist?list=PLmm…kk
  ─────────────────────────────
  🔍 Browse a channel's playlists…              ← action row, unchanged
```

### Tokens / component specs

| Element | Style |
|---|---|
| Current-playlist title | prominent: `text-sm text-zinc-100` (up from muted `text-xs text-zinc-400`); drop the `▶` prefix |
| Current-playlist URL | `text-xs text-zinc-500` link, `hover:underline`, `truncate`, `target="_blank" rel="noopener noreferrer"` |
| Picker row title | `text-sm text-zinc-200 truncate` (existing) |
| Picker row URL | `text-xs text-zinc-500 truncate` (new second line) |
| "+ Add by link" toggle | small text button, `text-xs text-zinc-400 hover:text-zinc-200` |
| Add-by-link input | the existing URL `<input>`, moved under the disclosure |

## URL Contracts

| Component | Link/target | Full URL |
|---|---|---|
| Current-playlist muted URL | opens playlist on YouTube (new tab) | `video`-independent: the current playlist's `playlistUrl` (e.g. `https://youtube.com/playlist?list=<id>`), rendered verbatim as the `href` |
| Picker row muted URL | (display only; row click selects the option) | the option's `url` (`PlaylistOption.url`), shown as text; the **row**'s existing select handler resolves via the option's `id`/`url` — unchanged |
| Add-by-link input | POST-less GET resolve (existing) | `/api/resolve-folder?url=<enc paste>&root=<enc root>` → `{ outputFolder }` → `onResolvedTarget` (unchanged) |

Note: picker **row selection** stays keyed on the option's identity (`id`/`url`), never the title — the
muted URL is presentational. The current-playlist muted URL is a real anchor (`<a href>`), so it is a
navigable link, not a resolve trigger.

## Overlay Dismissal

The "+ Add by link" disclosure is an inline expander (not a full overlay), but it has explicit
open/close paths:

| Component | Mechanism | Expected result |
|---|---|---|
| Add-by-link disclosure | click "+ Add by link" toggle | expands, focuses the URL input |
| Add-by-link disclosure | successful resolve → switch (`onResolvedTarget` fires) | auto-collapses |
| Add-by-link disclosure | Escape while input focused | collapses, no switch |
| Add-by-link disclosure | blur (focus leaves the input, empty/unchanged) | collapses |
| Add-by-link disclosure | empty state (no current playlist) | starts expanded; does not auto-collapse until a switch succeeds |

## Components & Data Flow

- **`components/Header.tsx`** — replace the muted `▶ {currentPlaylistTitle}` caption (`:262`) + the
  always-visible URL input with: (a) a prominent title + muted URL anchor block; (b) an "+ Add by link"
  disclosure wrapping the existing URL input and its debounced resolve logic (`:77-116`, `handleUrlChange`
  `:195-215`) — logic unchanged, only its visibility/placement. Add local `addByLinkOpen` state
  (auto-open when `!currentPlaylistTitle`; set false on successful `onResolvedTarget`).
- **`components/PlaylistPicker.tsx`** — render each option as two lines: `o.title` (existing) + a muted
  `o.url` line (`:44`). Selection handler unchanged.
- **`components/ChannelPlaylistPanel.tsx`** — same two-line treatment for channel rows (options carry
  `url`), for consistency.
- **Props/data:** `currentPlaylistTitle` and `currentPlaylistUrl` already flow into Header. No new API,
  no schema change. Title fallback computed in Header when `currentPlaylistTitle` is empty (slug from the
  resolved target's last path segment, else "Untitled playlist").

## Error / Edge Cases

| Case | Behavior |
|---|---|
| No `currentPlaylistTitle` (fetch failed / legacy) | show folder-slug fallback, else "Untitled playlist"; URL line still shown if a URL exists |
| No current playlist at all (fresh) | title/URL block hidden; "+ Add by link" expanded with prompt |
| `currentPlaylistUrl` missing but title present | show title, omit the muted URL line (no dangling empty anchor) |
| Picker option missing `url` (shouldn't happen — provider always sets it) | render title only for that row (no empty URL line) |
| Very long URL | `truncate` with ellipsis; full URL in `title=` attribute for hover |

## Testing

- **Component (RTL):**
  - Header: prominent title rendered; muted URL is an `<a>` with correct `href` + `target=_blank`;
    "+ Add by link" hidden by default, reveals input on click, auto-collapses when `onResolvedTarget`
    fires, collapses on Escape; empty state starts expanded.
  - Title fallback when `currentPlaylistTitle` absent.
  - PlaylistPicker: each option renders title + muted URL line; selecting a row still calls the select
    handler with the option (id/url), not the title; option without `url` renders title only.
- **E2E (playwright):** open Header → current playlist shows name + URL link; click "+ Add by link" →
  paste a URL → resolves → disclosure collapses; open RECENT → rows show name + URL; selecting a row
  switches playlist. (Stub `/api/resolve-folder` + `/api/playlists/recent`.)
- No unit tests for resolution/slug logic — unchanged.
