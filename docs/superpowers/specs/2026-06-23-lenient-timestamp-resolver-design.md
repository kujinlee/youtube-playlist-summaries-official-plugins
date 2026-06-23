# Lenient Timestamp Resolver

**Date:** 2026-06-23
**Branch:** `feat/lenient-timestamp-resolver`
**Status:** Design — reworked after adversarial review (`docs/reviews/spec-lenient-timestamp-resolver-review.md`); ready to plan.

## Problem

`resolveTranscriptTokens` (`lib/transcript-timestamps.ts:57`) converts Gemini's `[[TS:<index>]]` tokens into `▶ [start–end](url)` lines. It currently **degrades all-or-nothing**: if *any* non-fenced own-line token has an out-of-range index, a non-strictly-increasing index, or a resolved offset that isn't finite/strictly-increasing, it drops **every** ▶ line (the `valid` flag at lines 79-89 gates the whole rewrite).

The PR #17 repair proved this is a real, recurring loss: 3 docs (`8oyZB24-vAM` summary, `yB16BT1IMag` + `VBnG5Fse2ms` deep-dives) deterministically resolve to **zero** ▶ because the model emits a few bad indices and the all-or-nothing rule discards the good ones too. The generation guard (PR #17) cannot help — the miss is deterministic. As the corpus grows, more docs hit this.

## Decision

Make the resolver **lenient**: keep the resolvable tokens, drop only the bad ones, so a doc with a few malformed indices still gets partial ▶ coverage. Single function change; no signature change; no other caller affected.

### 1. Per-token validity (candidate) filter

From the own-line non-fenced tokens collected in Pass 1, a token is a **resolvable candidate** iff ALL hold:
- its index parses to an integer via the existing `/^\d+$/` test (else `NaN` → not a candidate);
- `0 <= index < segments.length`;
- `Number.isFinite(segments[index].offset)`;
- `Math.floor(segments[index].offset) < videoDuration` (see §3 for `videoDuration`).

The last clause prevents an **inverted range**: the final kept token's `end` is `videoDuration`, so a token whose start is `>= videoDuration` could otherwise render `▶ [start–end]` with `end <= start`. (Minor known caveat: a sub-1-second FINAL segment whose `floor(offset) == videoDuration` would see its own token excluded — negligible for real multi-second transcripts.)

Non-candidate tokens are dropped (their line → `null`, no `▶`), exactly as today's degrade did for those specific lines.

### 2. LIS selection (keep the maximal increasing-offset subsequence)

Among the resolvable candidates, **in document order**, keep the **longest subsequence whose resolved `segments[index].offset` values are strictly increasing**; drop the rest.

- **Why offset, not index:** the binding invariant is that each kept ▶ line's `[start–end]` range is positive and non-overlapping (`start = floor(offset[index])`, `end =` next-kept offset or `videoDuration`). Strictly-increasing offsets guarantee that. Index values are lookups only and don't affect rendered ranges, so selection is on offset.
- **Algorithm (deterministic):** O(n²) longest-increasing-subsequence DP over candidate offsets (n = section count, ~3–7). `length[i] = 1 + max(length[j])` over `j < i` with `offset[j] < offset[i]` (0 if none); on ties choose the **smallest** such `j` as predecessor. Reconstruct from the **earliest** position `i` achieving the global max `length`, walking back predecessors. The back-pointer chain is strictly increasing by construction. Fully deterministic given the candidate list.
- Strict inequality: equal offsets cannot both be kept; the strict `<` drops the **later-in-document** duplicate (e.g. offsets `[1,2,2,3]` → keep doc-positions `[0,1,3]`).
- **All-decreasing input** (no two candidates form an increasing pair) → max length 1 → the earliest-peak rule keeps the **first** document candidate. (Any single survivor is arbitrary for reverse-ordered input; this is pinned only for determinism, with a test.)

### 3. videoDuration and global preconditions (all-or-nothing only for these)

`videoDuration = Math.floor(lastSeg.offset + lastSeg.duration)` where `lastSeg = segments[segments.length-1]` (unchanged from today).

These cannot be salvaged per-token, so they drop ALL tokens:
- no own-line tokens present → no-op (return markdown with only stray-inline stripping);
- `videoId` is null/empty → drop all (cannot build URLs);
- `segments.length === 0` → drop all;
- `lastSeg.offset` or `lastSeg.duration` not finite → `videoDuration` non-finite → drop all (every kept line ultimately needs a finite `videoDuration`).

### 4. End-of-token resolution

For each kept token in document order: `start = floor(segments[index].offset)`; `end = floor(next-kept token's offset)`, or `videoDuration` for the **final kept** token. "Next" now means next *kept* token, not next raw token. A single kept token → `start..videoDuration`.

### 5. Rebuild contract (implementation — pin this; do NOT use a positional counter)

- **Pass 1:** walk lines, fence-aware (toggle on `FENCE`); for each own-line non-fenced token (`OWN_LINE_TOKEN`) record `{ lineIndex, parsedIndex }` (parsedIndex = `NaN` if not `/^\d+$/`). Count `N` = number of such records.
- **Select:** apply §1 filter → candidates; run §2 LIS → ordered kept list; `M` = kept count. Build `keptMap: Map<lineIndex, { start, end }>` with §4 ends computed over the kept list.
- **Pass 2:** walk lines fence-aware again; fenced lines and fence markers → verbatim; a line in `tokenSet` (the Pass-1 lineIndexes) → `keptMap.has(lineIndex) ? timestampLine(start, end, videoId) : null`; any other line → strip stray inline tokens (`line.replace(ANY_TOKEN, '')`). Filter out `null` lines and join.
- Fence-awareness, unterminated-fence handling, and inline stripping are UNCHANGED from the current implementation.

### 6. Warn wording (`console.warn`) — evaluate in this order

1. Pass 1 counts `N` (own-line non-fenced tokens) — independent of any precondition.
2. If `N === 0` → no-op, **no warn**.
3. Else if a global precondition (§3) fails → `M = 0`, drop all, warn: `resolveTranscriptTokens: dropped all ${N} timestamp tokens (invalid indices or missing videoId/segments)`.
4. Else run §1+§2 → `M`:
   - `M === N` → **no warn**;
   - `0 < M < N` → warn: `resolveTranscriptTokens: kept ${M} of ${N} timestamp tokens (dropped ${N - M} out-of-range/out-of-order)`;
   - `M === 0` → warn: the same "dropped all N" message as step 3.

### 7. Interaction with the generation guard (PR #17)

`generateSummary` / `generateDeepDiveFromTranscript` retry once when the resolved output has no `▶` (`includes('▶')`). Leniency means **one** kept token already yields a `▶`, so the guard fires less often. It does NOT eliminate the guard: an *all-invalid* doc still resolves to 0 ▶ and still triggers one retry + `[timestamp-miss]`. No guard code changes.

### 8. No version bump; repair fixes existing docs

The resolver runs at **generation** time, not render time, so existing `.md` files are unaffected until regenerated. Therefore **no `CURRENT_DOC_VERSION` / `CURRENT_DEEP_DIVE_VERSION` change** (a minor bump only re-renders from the existing `.md`; a major bump would force-resummarize the 226+ deferred docs — out of scope). To fix the 3 deterministic-miss docs (and future ones), re-run the existing repair after this lands: `npm run repair-timestamps -- --folder …/raw --stuck-only --run` (the audit still flags them; re-gen now routes through the lenient resolver).

### 9. CRLF

Input is assumed LF (Gemini JSON output). `\s` in `OWN_LINE_TOKEN`/`FENCE` already tolerates a trailing `\r`. Full CRLF normalization is out of scope (and `resolveTranscriptTokens` does not normalize today).

## Components & boundaries

| Unit | Responsibility | Change |
|------|----------------|--------|
| `lib/transcript-timestamps.ts` `resolveTranscriptTokens` | per-token candidate filter + LIS + keptMap rebuild + next-kept-end + new warn wording | Modify (one function) |

`formatTimestamp`, `timestampLine`, `buildWatchUrl`, `buildIndexedTranscript` unchanged. Consumers (`gemini.ts` ×3 call sites, `parse.ts`, `render-deep-dive.ts`) see only well-formed `timestampLine` output and handle each ▶ line independently → compatible.

## Testing (TDD)

`videoDuration` for the suite's `SEGS` (offsets 0/135/330/600, last dur 30) = **630 (10:30)**.

**New behavior tests (add to `tests/lib/transcript-timestamps.test.ts`):**
1. All-valid strictly-increasing indices → unchanged (every ▶ emitted, no warn).
2. One out-of-range index among valid → that token dropped, rest kept; warn "kept M of N".
3. Spuriously-large early offset with longer increasing tail (offsets `[5,1,2,3,4]`) → LIS keeps the tail.
4. Non-monotonic middle token → dropped, surrounding kept.
5. NaN offset at an in-range index → that token candidate-removed (still counted in `N`); a sibling valid token renders; warn "kept 1 of 2".
6. Malformed token INSIDE a fence → not counted in `N`, left verbatim.
7. Single kept token → renders `start..videoDuration` (guards the §4 off-by-one).
8. All-decreasing offsets → exactly one kept = the **first** document candidate (pin §2).
9. Duplicate offsets `[1,2,2,3]` → keep doc-positions `[0,1,3]` (later duplicate dropped).
10. Index-decreasing but offset-increasing kept pair → valid positive ranges (no inversion).
11. All indices invalid → 0 ▶, warn "dropped all N".
12. `videoId` null → 0 ▶; `segments.length === 0` → 0 ▶.
13. `lastSeg` duration non-finite → 0 ▶ (videoDuration non-finite).

**Existing tests to UPDATE (currently assert all-or-nothing):**
- `transcript-timestamps.test.ts:115` "degrades … out of range" (`[[TS:0]],[[TS:99]]`) → now keeps `[[TS:0]]`: `▶ [0:00–10:30]`, warn "kept 1 of 2".
- `:122` "not strictly increasing" (`[[TS:2]],[[TS:1]]`) → LIS keeps the first doc candidate `[[TS:2]]` (idx2 off330): `▶ [5:30–10:30]`, warn "kept 1 of 2".
- `:143` "malformed non-digit own-line token" (`[[TS:0]],[[TS:-1]]`) → keeps `[[TS:0]]`: `▶ [0:00–10:30]`.
- `:163` "segment offsets non-monotonic" (segs `[off100,off90]`, `[[TS:0]],[[TS:1]]`, videoDuration 95) → token0 (off100) candidate-removed by `offset<videoDuration`; token1 (off90) kept: `▶ [1:30–1:35]`.
- `:174` "embedded-] malformed own-line token" (`[[TS:0]],[[TS:a]b]]`) → keeps `[[TS:0]]`: `▶ [0:00–10:30]`.

**Existing tests that SURVIVE unchanged (still 0 ▶ / unchanged):**
- `:150` float index `[[TS:1.5]]` (single) → still 0 ▶ (warn wording now "dropped all 1").
- `:186` non-finite last-segment timing → still 0 ▶ (global precondition).
- `:129` null videoId / empty segments → still 0 ▶.
- `:81` happy path, `:89` no-tokens, `:94`/`:134` inline strip, `:101`/`:108` fence-aware → unchanged (monotonic, all offsets < 630).

Also update the `gemini.test.ts` "degrades to no timestamps when Gemini emits an out-of-range index" case (single `[[TS:9]]`) — out of range → candidate-removed → still 0 ▶ (its assertion `not.toMatch(/▶/)` survives; intent is now "all-invalid", not "degrade"). Confirm during implementation.

Full `npm test` + `npx tsc --noEmit` green before each commit. Dual review per task.

## Out of scope

- Re-summarizing the 226 deferred lower-version docs (they re-gen lazily and now benefit from the lenient resolver).
- Changing the prompt to make Gemini emit better indices.
- Any version-stamp / `ensure*` change.
