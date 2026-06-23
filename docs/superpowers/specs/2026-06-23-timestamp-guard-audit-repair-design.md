# Timestamp Coverage: Generation Guard + Health-Check + Batch Repair

**Date:** 2026-06-23
**Branch:** `feat/timestamp-guard-audit-repair`
**Status:** Design — reworked after adversarial review (`docs/reviews/spec-timestamp-guard-audit-repair-review.md`); ready to plan.

## Problem (audited)

A read-only audit of the `agentic-ai-claude-code` corpus found **232 of ~270 `.md` docs have no ▶ timestamps**:

| | Total | With ▶ | No ▶ (would re-gen on open) | No ▶ **STUCK** |
|---|---|---|---|---|
| Summaries | 260 | 33 | 221 | 5 |
| Deep-dives | 10 | 4 | 5 | 1 |

**Root cause — two compounding mechanisms (confirmed):**

1. **Generation intermittently emits zero timestamps despite available segments.** `generateSummary` (`gemini.ts:147`, block `183-190`) asks Gemini for `[[TS:i]]` tokens then calls `resolveTranscriptTokens`. It yields zero ▶ when (a) the model omits the tokens (stochastic — see [[gemini-json-reliability]]), (b) `resolveTranscriptTokens` degrades **all-or-nothing** on non-strictly-increasing/out-of-range indices (strips every token, no remnants — this class is **deterministic**, not stochastic), or (c) no transcript existed at the time (pre-PR-#15 gated video). Proven intermittent for the stochastic class: re-running `bC9BaY18b0o` went **0→5** with identical code. Evidence: the 5 stuck summaries are normal 5–7-section English docs with `▶=0` and `[[TS:` remnants `=0`.

2. **The version stamp records "ran the generator," not "produced timestamps."** `ensureHtmlDoc` does `updateVideoFields(..., { docVersion: current })` **unconditionally** (`ensure.ts:63`), and `needsResummarize` only fires on a **major** version increase (`stored.major < current.major`). So a zero-timestamp result is marked fully-current → never re-runs → **stuck**. The 226 non-stuck docs are at an older major and would re-run lazily on open, but are equally vulnerable to mechanism 1 on that re-run. Nothing detects any of this.

## Decision — three components

### 1. Generation guard (the real fix — attacks mechanism 1 at the source)

When **segments are non-empty but the resolved output contains no ▶**, retry the generation once (cheap paths only); if still zero, warn and return the last result (partial > failure). Semantics, pinned per review:

- **Throw vs. zero-▶ are distinct.** `resolveTranscriptTokens` never throws (it `console.warn`s and degrades). `generateJson` / `model.generateContent` *can* throw → that propagates unchanged (no ▶-retry, preserving today's error handling). The guard fires **only** on the success-but-zero-▶ case with `segments.length > 0`.
- **`▶`-presence test:** `resolved.includes('▶')`. The marker is literally `'▶'` (U+25B6, `transcript-timestamps.ts:31`) and the resolver degrades all-or-nothing, so `includes` is a sound proxy — do **not** convert it to a count check.
- **Retry budget:** exactly **one** extra attempt (≤2 generations total). The miss may be deterministic (the index-monotonicity class), so a re-roll is not guaranteed to help; one retry caps wasted cost.

Per-generator scope:

| Generator | Cost | On segments>0 & 0 ▶ |
|---|---|---|
| **`generateSummary` (`gemini.ts:147`)** | flash, cheap | **retry once**, then warn + return last |
| **`generateDeepDiveFromTranscript` (`gemini.ts:322`)** | pro, **no video upload** | **retry once**, then warn + return last |
| **`generateDeepDiveCombined` (`gemini.ts:374`)** | pro **+ full video upload** (most expensive call in the system) | **warn only — NO retry** |
| `generateDeepDive` (`gemini.ts:345`) | pro + video, **no segments** | out of scope (no timestamps expected) |

**Why combined is warn-only (H1):** retrying `generateDeepDiveCombined` re-uploads the full video to `gemini-2.5-pro`, doubling the costliest call. The ▶-miss was demonstrated only on the flash-summary path, and `writeDeepDiveDoc`'s combined→transcript→video cascade already accepts a tokenless string without throwing. We keep observability (the `[timestamp-miss]` warn) without paying a second video upload on speculation.

- **`generateSummary` wrapping (H3):** wrap the **whole** `generateJson → resolveTranscriptTokens → build-return` block (lines `183-190`, including `trimToWords` of `tldr`/`takeaways`) in the ≤2-attempt loop. The retry must **re-call `generateJson`** (the tokens come from `parsed.summary`; re-resolving the same parse is pointless), so all returned fields (`ratings`, `videoType`, `tldr`, …) come from the accepted attempt and stay internally consistent. When `segments.length === 0`, no retry and no warn (no timestamps expected).
- **Warn message (M1):** `console.warn('[timestamp-miss] <videoId>: <N> segments but 0 timestamps after <k> attempt(s)')` — neutral wording, no "transient" claim (the miss may be deterministic).

**Rejected alternative — making the version stamp timestamp-aware** (don't stamp `current` unless ▶ present): rejected because a genuinely un-timestampable video (no captions, Gemini can't transcribe) would then re-summarize on **every** open forever. The stamp legitimately means "current format produced"; the guard's retry — not the stamp — is the right lever to maximize timestamp success before stamping.

### 2. Health-check (detection — closes the "nothing detects it" gap)

Logic lives in **`lib/timestamp-audit.ts`** (`auditTimestamps(folder): AuditReport`), tested under `tests/lib/`. **`scripts/audit-timestamps.ts`** is a thin `ts-node` wrapper (arg-parse + console + exit code), mirroring how `scripts/rerender-html.ts` delegates to `reRenderAll`. Read-only, no Gemini.

- **Input set:** read the index; classify each video by its index entry. Summaries = videos with `summaryMd`; deep-dives = videos with `deepDiveMd`. (Split via the index, not a `-deep-dive.md` filename scan.)
- **▶ detection (M3):** read the `.md` on disk and test **line-leading** `▶` (`/^▶/m`), not bare `includes('▶')` — matches the renderer's leading-marker convention and rejects inline-prose `▶`. (Caveat: `/^▶/m` is not fence-aware — a `▶` at column 0 of a fenced line would still match; acceptable, as authored summary/deep-dive bodies never begin a fenced line with `▶`.)
- **Version source (H2):** stored version from `video.docVersion ?? {major:1,minor:0}` (summaries) / `video.deepDiveVersion ?? {major:1,minor:0}` (deep-dives) — absent is treated as PRE_FEATURE, mirroring `ensure.ts`.
- **Categories per kind:** `total`, `withTs`, `noTsWouldRegen` (no ▶ AND stored.major < current.major), `noTsStuck` (no ▶ AND stored.major == current.major), `mdMissing` (index points to a `.md` not on disk — distinct, not counted "with ▶").
- **Stuck thresholds:** summary current major = `CURRENT_DOC_VERSION.major` (3); deep-dive current major = `CURRENT_DEEP_DIVE_VERSION.major` (2).
- **Exit code (L1):** counts always printed; the wrapper exits non-zero when **summary** `noTsStuck > 0`. Deep-dive stuck is reported but **not** exit-gating — a captionless deep-dive legitimately has 0 ▶ and can't be distinguished from a bug-stuck one by ▶-count alone (M4), so gating on it would fail CI permanently.
- **Empty-folder guard (L2):** the wrapper errors clearly if neither `--folder` nor a non-empty `OUTPUT_FOLDER` is set (before `assertOutputFolder`).

### 3. Batch repair (data migration — programmatic, not manual)

Logic lives in **`lib/timestamp-repair.ts`** (`repairTimestamps(folder, opts, onProgress): RepairResult`), tested under `tests/lib/`. **`scripts/repair-timestamps.ts`** is a thin `ts-node` wrapper. Re-generates timestamp-less docs by driving the existing lib path (so it benefits from the guard's retry), instead of opening each in the UI.

- **Force re-gen (B3):** add `force?: boolean` to `ensureHtmlDoc` / `ensureDeepDiveHtml`. With `force`, the re-gen branch runs regardless of version — `if (force || needsResummarize(stored, current))` (summary) / `if (force || !video.deepDiveMd || needsRegenerate(stored, current))` (deep-dive) — and the branch stamps the **true** current version (never an inflated major). This is required because a stuck doc has `stored.major == current.major`, so without `force` the only reachable branches don't re-summarize. `repairTimestamps` calls `ensure*(…, { force: true })`, reusing their tested render-then-stamp sequence (no duplicated stamp logic).
- **Dry-run by default:** prints the `(videoId, kind, reason)` list it *would* repair and exits without calling Gemini (no `ensure*` calls).
- **`--run`** actually regenerates. **`--stuck-only`** limits to docs at the current major (the 6). **`--ids a,b,c`** limits to specific videos. Without filters, `--run` targets all timestamp-less docs.
- **Sequential (L4):** `repairTimestamps` runs a sequential `for` loop — that loop is what serializes (the lib does not enforce it). Logs `[repair] i/N <videoId> <kind>: <before ▶> → <after ▶>`. Skips and logs any doc whose regeneration throws (e.g., no obtainable transcript) without aborting the batch. A captionless doc that re-gens to video-only logs `0 → 0` and the batch moves on — **no loop** (each doc is processed once).
- **Operational note:** do not run repair while the dev server is processing the same folder — both read-modify-write `playlist-index.json`.

## Components & boundaries

| Unit | Responsibility | Change |
|------|----------------|--------|
| `lib/gemini.ts` `generateSummary` / `generateDeepDiveFromTranscript` | semantic-retry guard (retry + warn) on missing ▶ | Modify |
| `lib/gemini.ts` `generateDeepDiveCombined` | warn-only on missing ▶ (no retry) | Modify |
| `lib/html-doc/ensure.ts` `ensureHtmlDoc` / `lib/deep-dive/ensure.ts` `ensureDeepDiveHtml` | add `force?: boolean` → force re-gen branch, stamp true current | Modify |
| `lib/timestamp-audit.ts` `auditTimestamps` | read-only corpus timestamp health-check logic | Create |
| `lib/timestamp-repair.ts` `repairTimestamps` | programmatic re-gen of timestamp-less docs (dry-run default) | Create |
| `scripts/audit-timestamps.ts` | thin ts-node wrapper (arg-parse + console + exit code) | Create |
| `scripts/repair-timestamps.ts` | thin ts-node wrapper (arg-parse + console) | Create |
| `package.json` | `audit-timestamps` / `repair-timestamps` npm scripts (mirror `rerender-html`) | Modify |

## Option B execution (after the merge gate)

Run `npm run repair-timestamps -- --folder <…> --stuck-only --run` to repair the **6 stuck** docs as verification (cheap). **Do NOT** run the unfiltered repair of the 226 — that is a separate, explicit, user-gated cost decision deferred per Option B.

## Testing (TDD — boundary mocks per project policy)

- **Guard (`tests/lib/gemini.test.ts`)**: mock `model.generateContent` / `generateJson` to return a summary WITHOUT `[[TS:i]]` on attempt 1 and WITH on attempt 2 → assert two generations and resolved `summary` contains ▶. Both attempts tokenless → assert one `[timestamp-miss]` warn (spy) and returns the last result. `segments: []` + tokenless → assert NO retry and NO warn. For `generateDeepDiveFromTranscript`: same retry behavior. For `generateDeepDiveCombined`: tokenless + segments>0 → assert **one** generation (no retry) and a `[timestamp-miss]` warn.
- **Force param (`tests/lib/html-doc/ensure.test.ts`, `tests/lib/deep-dive/ensure.test.ts`)**: a doc at `stored.major == current.major` with `force:true` → assert the re-gen branch runs (`writeSummaryDoc` / `writeDeepDiveDoc` called) and `updateVideoFields` stamps `docVersion`/`deepDiveVersion` == **current** (not inflated). `force:false` on the same doc → no-op branch (no re-gen).
- **Health-check (`tests/lib/timestamp-audit.test.ts`)**: temp folder + synthetic index/.md fixtures covering ▶-present, ▶-absent-old-major, ▶-absent-current-major (stuck), **absent-`docVersion`** (H2), and **`md`-missing-on-disk** (M3) → assert per-category counts and that fenced/non-line-leading `▶` is NOT counted.
- **Repair (`tests/lib/timestamp-repair.test.ts`)**: mock `ensureHtmlDoc`/`ensureDeepDiveHtml`; assert dry-run lists targets and makes **no** `ensure*` calls; `--run --stuck-only` calls `ensure*(…, {force:true})` for exactly the current-major-no-▶ docs; a throwing doc is logged and skipped, batch continues.
- Full `npm test` + `npx tsc --noEmit` green before each commit. Dual review per task.

## Out of scope

- The unfiltered 226-doc bulk repair (deferred — Option B).
- Changing `needsResummarize` / version-stamp semantics (rejected above; `force` is additive, not a semantics change).
- Caption-availability pre-checks in the repair (the guard + cascade resolver already handle gated videos; a doc that genuinely can't be transcribed is logged + skipped).
- Re-running the audit across other playlists (the script is folder-parameterized; running it elsewhere is operator choice).
