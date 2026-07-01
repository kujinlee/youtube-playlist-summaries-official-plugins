# Final Whole-Branch Review — Title-Primary Playlist Display

**Reviewer:** opus (whole-branch) · **Date:** 2026-07-01 · **Branch:** `feat/title-primary-playlist-display`
**Range:** `4b1429c..b5c096b` (11 commits) · **Ground truth:** jest 1525/1525, E2E playlist-picker 3/3, `tsc --noEmit` exit 0

## Verdict: READY TO MERGE

0 Blocking / 0 High / 0 Medium. 2 Low (both spec-intended, non-blocking).

## Scope
Title-primary Header: prominent playlist title + muted clickable URL; free-text paste moved behind a collapsible `+ Add by link` disclosure; recent/channel picking via a `▾ Recent` dropdown; two-line (title + muted URL) rows in the recent picker and channel panel; `playlistDisplayTitle` fallback helper; `safeHttpUrl` XSS guard.

## Findings by area
- **Composed correctness — PASS.** `page.tsx` sets `currentPlaylistUrl/Title` before `setPlaylistLoaded(true)`, so the empty-state auto-open (ref-once, gated on `playlistLoaded && !hasCurrentPlaylist`) never fires for a real playlist. Paste → collapse (guarded by `urlEditedByUser`); pick → reopen (`applyPickedUrl setAddByLinkOpen(true)`) then guard-collapse on successful resolve; auto-fill → no collapse. Picked URL is never lost (lives in `playlistUrl`; Fetch stays enabled). No interaction gap found.
- **Security — PASS.** The only new anchor is `CurrentPlaylist` and it renders `safeHttpUrl(url)` (rejects `javascript:`/`data:`/mixed-case/protocol-relative/malformed → no anchor). Picker + channel rows render the URL as React-escaped `<span>` text, never as an href.
- **Spec fidelity — PASS.** Every `## UI Design`, `## URL Contracts`, and `## Overlay Dismissal` row maps to code + a test.
- **Contract consistency — PASS.** `PlaylistPicker`'s dropped `value/onChange` has no other consumer; `playlistLoaded` wired end-to-end (default false → safe pre-load).
- **Regression / YAGNI — PASS.** Resolve/Fetch/Sync debounce + seq guards untouched (only the two-line guarded collapse added). `Header.test.tsx` adaptation preserved assertion intent (post-resolve assertions target hint/fetchBtn/callbacks; B19 reopens before re-editing).
- **Test quality — PASS.** H10 (auto-fill-no-collapse) and pick-reopen guards are mutation-verified with real teeth; E2E covers pick→ingest, add-by-link auto-collapse, channel browse.

## Low (optional, non-blocking)
1. `AddByLink` blur on an untouched existing-playlist field collapses (value == currentUrl) — intended per the Overlay Dismissal spec.
2. `CurrentPlaylist` link text is the raw URL, truncated via CSS `truncate` + full URL in `title=` — matches spec.

## Process note
Codex reviewed the plan (`plan-title-primary-playlist-display-codex.md`); per-task Claude reviews ran each task; an automated security review surfaced the `javascript:` URI XSS (fixed in `37490da`/`f70d131`); the E2E surfaced a real pick-reopen bug (fixed in `7139b69`).
