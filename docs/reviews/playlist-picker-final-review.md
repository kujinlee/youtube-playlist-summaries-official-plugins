# Whole-Branch Final Review — Playlist Picker (`feat/playlist-picker`)

**Date:** 2026-06-30
**Reviewer:** Claude opus (whole-branch), SDD final gate
**Diff:** `0803c7f..058a525` (13 implementation commits, 30 files, +805/−11)
**Verdict:** ✅ **READY TO MERGE** — 0 Blocking / 0 High / 0 Medium.

---

## Scope
Playlist picker: recent playlists (local index scan) + a channel's public playlists (YouTube API key),
persist + display the playlist name instead of the `list=` id, pluggable `PlaylistOption` seam for future OAuth.
13 TDD tasks, each per-task dual-reviewed (spec + quality) clean. Full suite reported 1423 jest + 2 E2E green, tsc clean.

## Cross-cutting verification (composed system, not just per-task)
- **Contract consistency — PASS.** `PlaylistOption` (`lib/playlists/types.ts`) identical across provider → route →
  component → E2E. Recent route → `{ playlists }`; channel route → `{ channelTitle, playlists }`; consumers read
  matching keys.
- **Persistence↔display end-to-end — PASS.** `writeIndex` serializes directly (no Zod re-parse) → `pipeline.ts`
  spread persists `playlistTitle`; `readIndex` preserves it; `/api/videos:114` surfaces it; `page.tsx` threads
  `currentPlaylistTitle`; `Header.tsx` renders the `▶` caption. No drop point.
- **Header debounce invariant — PASS.** `applyPickedUrl` sets `urlEditedByUser.current = true` (both picker onPick
  and channel onSelect route through it); resolver/Sync/Browse untouched.
- **Security — PASS.** `assertOutputFolder` (resolve + within-home + realpath symlink) at BOTH route and provider;
  no traversal; no SSRF via `root` (fs-only). Channel: `parseChannelHandle` host-allowlists before any API call;
  parsed value only reaches the googleapis client; unparseable input → `ChannelNotFoundError` with no API call.
- **Dead code — none.** `meta.thumbnailUrl` unused in UI but is the documented seam for roadmap C.

## Accumulated Minor triage — all KEEP-AS-FOLLOWUP
- T3 flat-layout scan untested / `videoCount: undefined` — real data all-nested; UI guards `!= null`.
- T5 `resolveChannelId` channelId branch untested; `yt` built before guard; implicit error ctor — cosmetic; `instanceof` proven by 404 route test.
- T8 backfill `readIndex`-failure no reason/log; `--root` no-value — run-once script; caught downstream.
- T10 dropdown re-fetch per focus; brief stale options; no loading indicator — quota-free local read; UX nicety.
- T11 cosmetic `act()` warnings — test-template noise; assertions pass.
- T13 channel E2E no `resolve-folder` mock — test asserts only field value, never clicks Fetch; inert.

## Follow-up backlog (not merge-blocking)
1. Run `npm run backfill-playlist-titles` on real data so existing 3 playlists gain `playlistTitle` (else they show
   the folder slug via fallback — by design).
2. `root` boundary is `$HOME`-wide (localhost single-user) — multi-tenant per-user hardening tracked in roadmap.
3. Optional one-line log on backfill `readIndex` failure next time scripts are touched.

**Confidence:** high. No changes required before merge.
