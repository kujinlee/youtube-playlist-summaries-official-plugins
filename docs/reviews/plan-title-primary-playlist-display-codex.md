# Codex Adversarial Review — Plan: Title-Primary Playlist Display

**Reviewer:** Codex (`gpt-5.5`, fresh session) · **Date:** 2026-07-01
**Target:** `docs/superpowers/plans/2026-07-01-title-primary-playlist-display.md`
**Spec:** `docs/superpowers/specs/2026-07-01-title-primary-playlist-display-design.md`

## Findings (verbatim severity)

### 1. [Blocking] Task 2 commits a known TypeScript-red state
`PlaylistPicker` drops `value/onChange` in Task 2, but `Header` keeps passing them until Task 5; the plan explicitly commits this non-compiling state (relying on jest/SWC skipping typecheck), violating the "tsc green every commit" constraint.
**Fix:** Rewrite `PlaylistPicker` and rewire `Header` in the **same commit**.
**Resolution:** ✅ Reordered — new components (`CurrentPlaylist`, `AddByLink`) land first (additive), then a single combined task (Task 4) rewrites `PlaylistPicker` + wires `Header` + updates `page.tsx` in one commit. `tsc --noEmit` is green at every commit.

### 2. [High] Unconditional resolve-collapse fires for auto-fill and picks
`setAddByLinkOpen(false)` was added to the shared resolver, which also runs after `currentPlaylistUrl` auto-fill and after `applyPickedUrl`, not only after a user paste — surprising collapses / flicker.
**Fix:** Collapse only for a user-driven switch.
**Resolution:** ✅ Collapse guarded by `urlEditedByUser.current` — auto-fill (which never sets that flag) no longer collapses; explicit paste/pick still does (matches the spec's "collapse on a successful switch").

### 3. [High] Empty-state auto-open races async playlist loading
`Header` first renders with empty `currentPlaylistUrl/Title` while `app/page.tsx` async-loads settings→videos, so `emptyInitRef` could open the disclosure for a real existing playlist.
**Fix:** Gate empty-state auto-open on a settled/loaded signal from the parent.
**Resolution:** ✅ New `playlistLoaded` prop from `page.tsx` (set true after the mount effect's `fetchVideos` resolves). Header auto-opens only when `playlistLoaded && !hasCurrentPlaylist`.

### 4. [High] Slug fallback ignores available `defaultOutputFolder`
`displayTitle` used `target ?? undefined`, but `target` is null before resolve while `defaultOutputFolder` is already the viewed playlist folder — so legacy/no-title playlists showed `Untitled playlist`.
**Fix:** Fall back through `defaultOutputFolder`.
**Resolution:** ✅ `playlistDisplayTitle(currentPlaylistTitle, target ?? defaultOutputFolder)` — the previously-discarded `_defaultOutputFolder` prop is now consumed.

### 5. [High] Channel E2E closes the field before asserting it
Test starts with the disclosure already open (empty state), forces resolve to fail so it stays open, then clicks `+ Add by link` — toggling it **closed** before `getByPlaceholder` asserts the value.
**Fix:** Don't toggle when already visible.
**Resolution:** ✅ Test now asserts the value on the already-open field (no toggle click).

### 6. [Medium] Header acceptance tests miss listed behaviors 3, 9, 10
Slug fallback, paste-triggered auto-collapse, and recent-pick-enables-Fetch were enumerated but untested.
**Resolution:** ✅ Added three Header unit tests in Task 4 Step covering exactly these.

### 7. [Medium] AddByLink Escape `preventDefault` untested
**Resolution:** ✅ Added a native-`dispatchEvent` assertion that the Escape keydown is `defaultPrevented`.

### 8. [Medium] PlaylistPicker / ChannelPlaylistPanel edge behaviors untested
Outside-click, disabled, no-root (Picker) and missing-url (Panel) were listed without tests.
**Resolution:** ✅ Added focused RTL tests for outside-click-closes, disabled, and no-root-no-fetch (Picker) and missing-url-title-only (Panel).

### 9. [Low] None.

## Outcome
All Blocking + High findings addressed inline in the revised plan (v2). Mediums also addressed (added tests). No Codex gap — review ran on the frontier model to completion.
