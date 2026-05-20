# Task 11: Header Component — Claude Code Review

## Strengths

- Plan alignment is exact: URL input, folder input, onIngest callback, disabled button — all present, nothing added.
- 8 tests written against 2 required; all edge cases from enumerate-behaviors step covered.
- Tests exercise real DOM behavior via `fireEvent`, not mocks.
- All 8 component tests pass; 107 full-suite tests pass with no regressions.
- `'use client'` correctly placed; `&amp;` entity handled correctly.

## Issues

### Critical
None.

### Important (Should Fix)

1. **No `<form>` — no Enter key submit** (`components/Header.tsx:14–34`)
   Inputs inside bare `<header>`, not `<form>`. Pressing Enter after typing a URL does not submit.
   Fix: wrap in `<form onSubmit={e => { e.preventDefault(); onIngest(playlistUrl, outputFolder); }}>` and use `type="submit"` on button.

2. **Output folder input has no placeholder or label** (`components/Header.tsx:24`)
   No `placeholder` or `<label>` — screen reader gap, and test locates it only by value (brittle if default is empty).
   Fix: add `placeholder="Output folder"`.

3. **`onIngest` called with raw untrimmed `playlistUrl`** (`components/Header.tsx:29`)
   Guard uses `.trim()` but callback receives unstripped value. Server must trim or fetch will fail on URLs with surrounding spaces.
   Fix: `onIngest(playlistUrl.trim(), outputFolder)`.

### Minor

4. No Tailwind styling (expected to be added later).
5. `useState(defaultOutputFolder)` snapshots prop at mount — async settings fetch will leave input stale.
6. "Does not call onIngest when disabled" test relies on `fireEvent` + disabled button interaction — consider adding explicit `toBeDisabled()` assertion alongside `not.toHaveBeenCalled()`.
7. `--detectOpenHandles` Jest warning (existing issue from md-to-pdf/Puppeteer, not caused by Header).

## Recommendations

Fix issues #1, #2, #3 in the same commit before wiring Header into `page.tsx`. Add `useEffect` for prop sync (issue #5) when async settings loading is implemented in Task 6.

## Assessment

**Ready to merge: With fixes**

Core implementation is correct and well-tested; three Important issues are each 1–3 lines and should be resolved before integration.
