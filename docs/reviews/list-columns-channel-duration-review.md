# Video list columns (Channel/Duration; drop 7; move Lang) — Claude code review

**Scope:** video-list display columns + sortability. Branch `feat/list-columns-channel-duration`.
**Verdict: CLEAN.** Full jest **1566/1566** (serial `--runInBand`; a parallel run showed 4 pre-existing `pdf.test.ts` parallel-load flakes — passes isolated), `tsc --noEmit` clean. Two Claude review passes, both clean.

> **Follow-up after first review:** product decision changed — Channel and Duration became **sortable** (which also fixes header casing: sortable headers render as title-case `<button>`s, not CSS-uppercased plain `<th>`s), and the **My Score** header was re-aligned **left** to line up with the left-aligned star rating.

## Change
- Add `Channel` (`video.channel`) + `Duration` (`formatDuration(video.durationSeconds)`) columns.
- Remove Type, Audience, USE, DPT, ORI, RCN, CMP columns.
- Move `Lang` to after `Added`. New order: `# | Title | Channel | Duration | Published | Added | Lang | OVR | My Score | Note`.
- Both new columns display-only (not sortable) — explicit product decision.
- Type/Audience FilterBar dropdowns kept; backend sort comparators + `SortColumn` type left untouched (accepted dead capability).
- `formatDuration` extracted from `lib/pipeline.ts` (server-only deps) into pure `lib/format-duration.ts`, re-exported from pipeline so the client component and the existing `pipeline.test.ts` import path both work.

## Verified clean (independent reviewer)
1. **Column alignment** — `VideoList.tsx` COLUMNS (10 data cols) order matches `VideoRow.tsx` `<td>` sequence exactly. No misalignment.
2. **`TOTAL_COLUMNS` = 12** — 1 checkbox + 1 chevron + 10 data; expanded-row colSpan spans full width.
3. **Client/server boundary** — `VideoRow` imports `formatDuration` from `@/lib/format-duration` (zero deps); no server-only code in the client bundle.
4. **Channel cell** — `max-w-[12rem] truncate`, em-dash fallback, `title=` tooltip; empty-string `channel` treated as absent (correct).
5. **Dead code** — `TYPE_COLOR`, `AUDIENCE_COLOR`, `VideoType`/`Audience` imports, and the `ratings` destructure all removed.
6. **Test quality** — 7-sortable-header assertion named per column; Channel tests cover set + absent; Duration tests cover `m:ss` and `h:mm:ss` (8927→2:28:47 verified). Not weakened.

## Second pass — sortability + alignment (clean)
1. **Three-layer sync** — `SortColumn` union (`types/index.ts`), `SORT_COLUMNS` allow-set (`app/api/videos/route.ts`), and `COLUMNS` keys (`VideoList.tsx`) all carry `channel` + `durationSeconds`. No silent name-sort fallback.
2. **Channel comparator** — missing channel sorts to the bottom in both directions (matches the `serialNumber`/`personalScore` null pattern); `localeCompare` for present values. Tests cover asc/desc/missing-to-bottom with case-unambiguous data.
3. **Duration comparator** — numeric subtract, direction-aware; no null-guard needed (`durationSeconds` is a required non-negative schema field).
4. **No comparator fallthrough** — both new columns handled in explicit early-return branches before the ratings-key `else`.
5. **My Score alignment** — header `align:'left'` now matches the left-aligned `StarRating` cell body.
- One reviewer "Important" was self-downgraded to cosmetic (Duration header/button alignment works in practice and matches the pre-existing OVR column — not a regression); two Minors explicitly "not a real bug."

## Codex gap
Per the lighter-execution agreement, the Codex adversarial pass was not run (Claude review was the agreed gate). Re-attemptable before merge if desired.
