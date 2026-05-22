# Claude Code Review: UI Parity Features (Sync, playlistIndex, FilterBar)

## Assessment: Ready to merge (with fixes applied)

## Strengths

- `handleSync` guard (`if (currentPlaylistUrl)`) is belt-and-suspenders even though `syncEnabled` already disables the button
- Reconciliation pass in `lib/pipeline.ts` correctly preserves `playlistIndex` for videos no longer in the playlist via `?? v.playlistIndex` fallback
- Double-filter architecture (archive filtering in `filteredVideos`, `showArchive={true}` passed to VideoList) is clean — VideoList's internal filter is a no-op pass-through
- Test coverage is solid with correct TDD ordering
- `FilterBar` is a pure controlled component with full delegation to parent via `onChange` patches
- `currentPlaylistUrl` only set when `data.playlistUrl` is truthy — stale URL not cleared by fetch with no URL

## Issues Found

### Important (Fixed)

**1. VideoList `showArchive` semantic drift**
- `showArchive={true}` is hardcoded in `page.tsx` while `VideoList` tests still exercise the `showArchive=false` path
- Fixed: Added architectural comment to `VideoList.tsx` documenting that archive filtering is the caller's responsibility via `filteredVideos` in `page.tsx`

**2. Missing minScore test coverage for 3.5+ and 4.5+ threshold values**
- FilterBar.test.tsx only tested `minScore=4` (middle option)
- Fixed: Added tests for `minScore=3.5` and `minScore=4.5`

**3. `fireEvent.click` on disabled button has ambiguous behavior**
- Test "does not call onSync when Sync button is disabled" used `fireEvent.click` on a disabled button, which has different semantics across JSDOM versions
- Fixed: Replaced with a direct `toBeDisabled()` assertion; the click behavior is not needed since a disabled button is guaranteed by HTML spec

### Minor (Noted, not fixed)

**4. Stats bar label "Total videos" misleading when filters active**
- With 5 of 147 videos visible, "5 Total videos" is confusing
- Not fixed (no user requirement for this label change; can be addressed separately)

## Recommendations

- Consider removing `showArchive` prop from `VideoList` entirely in a follow-up refactor (filtering is now the caller's responsibility)
- Consider adding a "Clear filters" button to `FilterBar` for discoverability
