# Video list columns (Channel/Duration; drop 7; move Lang) — Claude code review

**Scope:** render-only frontend change. Branch `feat/list-columns-channel-duration`.
**Verdict: CLEAN — 0 Critical / 0 Important / 0 Minor.** Full jest 1560/1560, `tsc --noEmit` clean.

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

## Codex gap
Per the lighter-execution agreement for this small render-only change, the Codex adversarial pass was not run (single Claude review was the agreed gate). Re-attemptable before merge if desired.
