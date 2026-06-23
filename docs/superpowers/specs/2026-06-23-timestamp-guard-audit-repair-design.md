# Timestamp Coverage: Generation Guard + Health-Check + Batch Repair

**Date:** 2026-06-23
**Branch:** `feat/timestamp-guard-audit-repair`
**Status:** Design — author-locked (user chose Option B); pending adversarial review gate.

## Problem (audited)

A read-only audit of the `agentic-ai-claude-code` corpus found **232 of ~270 `.md` docs have no ▶ timestamps**:

| | Total | With ▶ | No ▶ (would re-gen on open) | No ▶ **STUCK** |
|---|---|---|---|---|
| Summaries | 260 | 33 | 221 | 5 |
| Deep-dives | 10 | 4 | 5 | 1 |

**Root cause — two compounding mechanisms (confirmed):**

1. **Generation intermittently emits zero timestamps despite available segments.** `generateSummary` (`gemini.ts:183-187`) asks Gemini for `[[TS:i]]` tokens then calls `resolveTranscriptTokens`. It yields zero ▶ when (a) the model omits the tokens (stochastic — see [[gemini-json-reliability]]), (b) `resolveTranscriptTokens` degrades **all-or-nothing** on non-strictly-increasing/out-of-range indices (strips every token, no remnants), or (c) no transcript existed at the time (pre-PR-#15 gated video). Proven intermittent: re-running `bC9BaY18b0o` went **0→5** with identical code. Evidence: the 5 stuck summaries are normal 5–7-section English docs with `▶=0` and `[[TS:` remnants `=0`.

2. **The version stamp records "ran the generator," not "produced timestamps."** `ensureHtmlDoc` does `updateVideoFields(..., { docVersion: current })` **unconditionally** (`ensure.ts:63`), and `needsResummarize` only fires on a **major** version increase. So a zero-timestamp result is marked fully-current → never re-runs → **stuck**. The 226 non-stuck docs are at an older major and would re-run lazily on open, but are equally vulnerable to mechanism 1 on that re-run. Nothing detects any of this.

## Decision — three components

### 1. Generation guard (the real fix — attacks mechanism 1 at the source)

In the timestamp-bearing generators, when **segments are non-empty but the resolved output contains no ▶**, **retry the generation once**; if the retry still yields zero ▶, `console.warn('[timestamp-miss] <videoId>: generated with N segments but 0 timestamps')` and return the last result (partial > failure). A re-roll usually succeeds (the bC9BaY18b0o 0→5 proof), so this materially reduces future stuck docs.

- **`generateSummary` (`gemini.ts:147`)**: wrap the `generateJson` + `resolveTranscriptTokens` step (lines 183-187) in a loop of up to 2 attempts. Accept the first attempt whose resolved `summary` contains ▶ (when `segments.length > 0`); otherwise retry once, then warn + return the last attempt. When `segments.length === 0`, do not retry or warn (no timestamps are expected).
- **`generateDeepDiveCombined` (`gemini.ts:330`)** and **`generateDeepDiveFromTranscript`**: same guard around their `model.generateContent(...)` + `resolveTranscriptTokens(...)` step (they receive `segments`; both resolve tokens). The video-only `generateDeepDive` is unaffected (no segments, no timestamps expected).
- **Retry budget:** exactly **one** extra attempt (≤2 generations total). The miss is intermittent, not deterministic; more retries waste tokens.

**Rejected alternative — making the version stamp timestamp-aware** (don't stamp `current` unless ▶ present): rejected because a genuinely un-timestampable video (no captions, Gemini can't transcribe) would then re-summarize on **every** open forever. The stamp legitimately means "current format produced"; the guard's retry — not the stamp — is the right lever to maximize timestamp success before stamping.

### 2. Health-check script (detection — closes the "nothing detects it" gap)

`scripts/audit-timestamps.mjs` — **read-only**, no Gemini. Given `--folder <outputFolder>` (default from `OUTPUT_FOLDER`), scans the index + `.md` files and prints, for summaries and deep-dives separately: total, with ▶, no-▶-would-regen (major < current), no-▶-**stuck** (major == current). Exit non-zero if any stuck docs exist (so it can gate CI / be run ad hoc). This is the committed form of the audit already run by hand.

- Timestamp majors: summary timestamps at `docVersion` major 2; deep-dive at `deepDiveVersion` major 2. "Stuck" = no ▶ AND stored major == current major (`{3,_}` summaries / `{2,_}` deep-dives).

### 3. Batch repair command (data migration — programmatic, not manual)

`scripts/repair-timestamps.mjs` — re-generates timestamp-less docs by driving the existing lib path (so it benefits from the guard's retry), instead of opening each in the UI.

- **Dry-run by default:** prints the list of `(videoId, kind, reason)` it *would* repair and exits without calling Gemini.
- **`--run`** actually regenerates. **`--stuck-only`** limits to docs at the current major (the 6). **`--ids a,b,c`** limits to specific videos. Without filters, `--run` targets all timestamp-less docs.
- Per doc: summary → `writeSummaryDoc(...)` + `runHtmlDoc(...)`; deep-dive → `writeDeepDiveDoc(...)` + `runDeepDiveHtml(...)`; then `updateVideoFields(..., {docVersion/deepDiveVersion: current})`. (Reuses `ensureHtmlDoc`/`ensureDeepDiveHtml` with a forced-regen flag where practical, to avoid duplicating the stamp logic.)
- Sequential (the pipeline already serializes per folder); logs `[repair] i/N <videoId> <kind>: <before ▶> → <after ▶>`. Skips and logs any doc whose regeneration throws (e.g., no obtainable transcript) without aborting the batch.

## Components & boundaries

| Unit | Responsibility | Change |
|------|----------------|--------|
| `lib/gemini.ts` `generateSummary` / `generateDeepDiveCombined` / `generateDeepDiveFromTranscript` | semantic-retry guard on missing ▶ | Modify |
| `scripts/audit-timestamps.mjs` | read-only corpus timestamp health-check | Create |
| `scripts/repair-timestamps.mjs` | programmatic re-gen of timestamp-less docs (dry-run default) | Create |

## Option B execution (after the merge gate)

Run `node scripts/repair-timestamps.mjs --folder <…> --stuck-only --run` to repair the **6 stuck** docs as verification (cheap). **Do NOT** run the unfiltered/`--all` repair of the 226 — that is a separate, explicit, user-gated cost decision deferred per Option B.

## Testing (TDD — boundary mocks per project policy)

- **Guard (`tests/lib/gemini.test.ts`)**: mock `model.generateContent` to return a summary WITHOUT `[[TS:i]]` on attempt 1 and WITH on attempt 2 → assert two calls and resolved `summary` contains ▶. Both attempts tokenless → assert `console.warn('[timestamp-miss]…')` (spy) and returns the last result. `segments: []` + tokenless → assert NO retry and NO warn. Same three cases for `generateDeepDiveCombined`/`FromTranscript`.
- **Health-check (`tests/scripts/audit-timestamps.test.ts`)**: against a temp folder + synthetic index/.md fixtures (▶-present, ▶-absent-old-major, ▶-absent-current-major) → assert the printed counts and non-zero exit when stuck>0.
- **Repair (`tests/scripts/repair-timestamps.test.ts`)**: mock `lib/gemini` + `lib/html-doc`/`lib/deep-dive` generators; assert dry-run lists targets and makes **no** generator calls; `--run --stuck-only` regenerates exactly the current-major-no-▶ docs; a throwing doc is logged and skipped, batch continues.
- Full `npm test` + `npx tsc --noEmit` green before each commit. Dual review per task.

## Out of scope

- The unfiltered 226-doc bulk repair (deferred — Option B).
- Changing `needsResummarize` / version-stamp semantics (rejected above).
- Caption-availability pre-checks in the repair (the guard + cascade resolver already handle gated videos; a doc that genuinely can't be transcribed is logged + skipped).
- Re-running the audit across other playlists (the script is folder-parameterized; running it elsewhere is operator choice).
