# Codex Adversarial Review: UI Parity Features (Sync, playlistIndex, FilterBar)

## P0
None found.

## P1

**1. Concurrent ingest — pre-existing, not introduced by this PR**
`POST /api/ingest` starts `runIngestion` immediately with no per-folder lock. Two concurrent requests can corrupt the index. Not introduced by this feature — pre-existing design gap.
Action: track as separate issue; out of scope for this PR.

**2. playlistIndex durability gap — accepted design limitation**
Already-indexed videos (skipped in main loop) only get `playlistIndex` from the end reconciliation pass. Interrupted ingestion = skipped videos never stamped.
Action: noted; reconciliation approach is the best feasible solution without a transactional index store. Accepted.

**3. Duplicate `#` ranks when playlist is reordered after video removal — FIXED**
Original code: `positionMap.get(v.id) ?? v.playlistIndex`
If B is removed (archived) and C moves from pos 3 to pos 2 in YouTube, both B and C would show `#2`.
Fix: swap operands to `v.playlistIndex ?? positionMap.get(v.id)` — positions are stamped once at first ingest and never changed, making them stable unique IDs.

**4. Sync ignores output folder shown in Header input — FIXED**
`handleSync` in page.tsx used stale page state `outputFolder`, not the value typed in the Header's local form state. If the user edited the folder and clicked Sync, it would sync the wrong folder.
Fix: change `onSync` to `(folder: string) => void`; Header calls `onSync(outputFolder)` passing its local state.

## P2

**1. No empty state for "0 results from filters" vs "no videos loaded"**
`VideoList` returns `null` in both cases. Not fixed — UX improvement to address separately.

**2. Filters preserved across ingest/sync — design decision**
Intentional: filters stay active so a user filtering by language=ko still sees only Korean videos after sync. Not a bug.

**3. `currentPlaylistUrl` not cleared when API returns no URL**
`if (data.playlistUrl)` guards updates but not clears. Edge case: changing to an un-indexed folder leaves Sync button enabled with old URL. Not fixed — low risk in practice.

## P3

- Search fires on every keystroke (no debounce) — acceptable for client-only filtering
- Filters ephemeral, not URL-persisted — acceptable for MVP
- Playlist URL exposed to client — low risk, same URL accepted by POST /api/ingest

## Highest-leverage fixes applied
1. ✅ Stable `playlistIndex` (P1.3) — swap `??` operands
2. ✅ Sync folder mismatch (P1.4) — `onSync` takes folder param
