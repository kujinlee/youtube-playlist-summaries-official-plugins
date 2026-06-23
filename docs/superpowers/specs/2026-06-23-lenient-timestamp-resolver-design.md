# Lenient Timestamp Resolver

**Date:** 2026-06-23
**Branch:** `feat/lenient-timestamp-resolver`
**Status:** Design — pending adversarial review gate.

## Problem

`resolveTranscriptTokens` (`lib/transcript-timestamps.ts:57`) converts Gemini's `[[TS:<index>]]` tokens into `▶ [start–end](url)` lines. It currently **degrades all-or-nothing**: if *any* non-fenced own-line token has an out-of-range index, a non-strictly-increasing index, or a resolved offset that isn't finite/strictly-increasing, it drops **every** ▶ line (the `valid` flag at lines 79-89 gates the whole rewrite).

The repair run on PR #17's stuck docs proved this is a real, recurring loss: 3 docs (`8oyZB24-vAM` summary, `yB16BT1IMag` + `VBnG5Fse2ms` deep-dives) deterministically resolve to **zero** ▶ because the model emits a few bad indices, and the all-or-nothing rule discards the good ones too. The generation guard (PR #17) cannot help — the miss is deterministic, not stochastic. As the corpus grows, more docs hit this.

## Decision

Make the resolver **lenient**: keep the resolvable tokens, drop only the bad ones, so a doc with a few malformed indices still gets partial ▶ coverage.

### 1. Per-token validity pre-filter

A token is **individually resolvable** iff:
- its index parses to an integer (the existing `/^\d+$/` parse; otherwise `NaN`), AND
- `0 <= index < segments.length`, AND
- `Number.isFinite(segments[index].offset)`.

Tokens that fail are **candidates removed** before selection. (Same outcome as today for those specific lines — the token line is dropped, no `▶` emitted.)

### 2. LIS selection (keep the maximal increasing-offset subsequence)

Among the individually-resolvable tokens, **in document order**, keep the **longest subsequence whose resolved `segments[index].offset` values are strictly increasing**. Drop the rest.

- **Why offset, not index:** the binding invariant is that each kept ▶ line's `[start–end]` range is positive and non-overlapping — `start = segments[index].offset`, `end =` the *next kept* token's offset (last kept → video duration). Strictly-increasing offsets guarantee valid ranges. Index values are only lookups; they do not affect rendered ranges, so selection is on resolved offset.
- **Algorithm:** standard O(n²) longest-increasing-subsequence DP over the candidate offsets (n = section count, ~3–7). **Deterministic tie-break:** when multiple subsequences share the maximal length, pick the one the canonical left-to-right DP yields — for each position `i`, `length[i] = 1 + max(length[j])` over `j < i` with `offset[j] < offset[i]`, choosing the **smallest such `j`** (earliest predecessor) on ties; reconstruct from the **earliest** position achieving the global max length. This is fully deterministic given the candidate list.
- Strict inequality: equal offsets cannot both be kept (one is dropped by the strict `<`).

### 3. Global preconditions remain all-or-nothing

These cannot be salvaged per-token, so they drop ALL tokens (unchanged from today):
- no own-line tokens present → no-op (return markdown with only stray-inline stripping);
- `videoId` is null/empty → drop all (cannot build URLs);
- `segments.length === 0` → drop all;
- the **last** segment's `offset`/`duration` not finite → cannot compute video duration → drop all (the last kept token's `end` needs it). (Equivalent to today's lines 88-89 guard, retained.)

### 4. End-of-token resolution

For each kept token in document order: `start = floor(segments[index].offset)`; `end = floor(next-kept token's offset)`, or `videoDuration = floor(lastSeg.offset + lastSeg.duration)` for the final kept token. (Same as today, but "next token" now means "next *kept* token" rather than "next token in the raw list.")

### 5. Fence-awareness, inline tokens, line removal — UNCHANGED

- Fenced (``` / ~~~) tokens are left verbatim, never counted, never rewritten (unterminated fence → remainder treated as fenced).
- A kept token's line → the `▶ …` line. A dropped token's line → removed (`null`, filtered out), exactly as today's degrade path for that line.
- Stray inline (non-own-line) tokens outside fences → stripped (`''`), so no raw `[[TS:…]]` ever reaches the reader.

### 6. Warn wording (`console.warn`)

Let `N` = count of own-line non-fenced tokens encountered, `M` = count kept.
- `M === N` (all kept) → **no warn**.
- `0 < M < N` (partial) → `resolveTranscriptTokens: kept ${M} of ${N} timestamp tokens (dropped ${N-M} out-of-range/out-of-order)`.
- `M === 0` and `N > 0` (none kept — all individually invalid, or a global precondition failed) → `resolveTranscriptTokens: dropped all ${N} timestamp tokens (invalid indices or missing videoId/segments)`.

### 7. Interaction with the generation guard (PR #17)

`generateSummary` / `generateDeepDiveFromTranscript` retry once when the resolved output has no `▶` (`includes('▶')`). With the lenient resolver, **one** kept token already yields a `▶`, so the guard fires less often — strictly an improvement (fewer wasted generations). No guard code changes.

### 8. No version bump; repair fixes existing docs

The resolver runs at **generation** time (inside `generateSummary` / `generateDeepDive*`), not at render time. Existing `.md` files are unaffected until regenerated. Therefore:
- **No `CURRENT_DOC_VERSION` / `CURRENT_DEEP_DIVE_VERSION` change** (a minor bump only re-renders from the existing `.md`, which would not re-resolve; a major bump would force-resummarize all 226+ deferred docs — explicitly out of scope).
- To fix the 3 deterministic-miss docs (and any future ones), **re-run the existing repair after this lands**: `npm run repair-timestamps -- --folder …/raw --stuck-only --run`. The audit still flags them (current major, no ▶), so `--stuck-only` targets them; re-generation now routes through the lenient resolver.

## Components & boundaries

| Unit | Responsibility | Change |
|------|----------------|--------|
| `lib/transcript-timestamps.ts` `resolveTranscriptTokens` | per-token filter + LIS selection + next-kept-offset end resolution + new warn wording | Modify (one function) |

No new files, no signature change, no other caller affected. `formatTimestamp`, `timestampLine`, `buildWatchUrl`, `buildIndexedTranscript` unchanged.

## Testing (TDD)

Unit tests in `tests/lib/transcript-timestamps.test.ts` (and update any existing all-or-nothing expectations there + the `gemini.test.ts` "degrades … out-of-range" case at the timestamp describe block, which must now expect a *partial* result):

1. All-valid strictly-increasing indices → unchanged (every ▶ emitted, no warn).
2. One out-of-range index among valid ones → that token dropped, the rest kept; warn "kept M of N".
3. A single spuriously-large early offset with a longer increasing tail (e.g. offsets `[5,1,2,3,4]`) → LIS keeps the tail `[1,2,3,4]`, drops the outlier.
4. Non-monotonic middle token → dropped, surrounding kept.
5. All indices invalid/out-of-range → zero ▶, warn "dropped all N".
6. `videoId` null → zero ▶ (global precondition), warn "dropped all N".
7. `segments.length === 0` with tokens present → zero ▶.
8. Fenced tokens untouched; stray inline token stripped.
9. End-of-token range uses the **next kept** token's offset (drop a middle token → the previous kept token's `end` extends to the next *kept* one, not the dropped one).
10. Last segment offset/duration non-finite → drop all.

Full `npm test` + `npx tsc --noEmit` green before each commit. Dual review per task.

## Out of scope

- Re-summarizing the 226 deferred lower-version docs (they re-gen lazily on open and now benefit from the lenient resolver).
- Changing the prompt to make Gemini emit better indices (separate lever; the resolver hardening is independent and sufficient).
- Any version-stamp / `ensure*` change.
