# Adversarial Review — Plan: Dig Slide Capture Fixes (v7)

**Reviewer:** Claude adversarial subagent (Opus, fresh, full file access; ffmpeg behavior verified empirically with ffmpeg 8.1.2)
**Date:** 2026-06-28
**Codex gap:** Codex CLI at usage limit; this Claude adversarial review satisfies the Post-Plan Gate (AFK). Re-attempt before merge if access returns.

**Verdict:** NOT READY as written → addressed inline (plan/spec rev 2). Findings + disposition:

## Blocking
- **B1 — trailing-edge fix had no real test coverage; the mock ignores ffmpeg `-ss`.** The fix relied on ffmpeg input-seek, which the unit mock doesn't honor, so the headline test was vacuous. → **Fixed: switched to JS-side trailing filter** (sample the whole window, filter frames by ordinal before `pickLargestFile`); redesigned the test to assert the chosen asset is the *trailing* largest (by byte size), proving the leading frame is excluded.
- **B2 — filename collision → overwrite.** A null-end token (`171|caption`, resolves to `171+DEFAULT_FWD=175`) and an explicit `171|175` token survive dedup with different keys but produce the SAME filename `160-171-175.jpg`. → **Fixed: dedup the captured set by resolved `assetName` in `slides.ts` (first-wins)**, guaranteeing filename uniqueness regardless of the parser's `(sec,endSec)` key.

## High
- **H1 — spec (JS-filter) vs plan (ffmpeg `-ss`) contradicted.** → **Fixed: both now specify JS-side filtering** (version-independent, testable).
- **H2 — `-ss` before `-i` accuracy is ffmpeg-version-dependent;** `pickedSec` math assumed PTS reset. → **Moot under the JS-filter approach** (sample from clip start, ordinal math is exact regardless of ffmpeg version).
- **H3 — existing `slides.test.ts` tests not enumerated → Task 3 would commit red.** → **Fixed: explicit step to grep + rewrite ALL string-return and `sectionId-start.jpg` filename assertions in the Task-3 commit.**
- **H4 — `TAIL_FRACTION` (fraction) is the wrong knob; contamination is an absolute 1–3s lead.** A 1s progression window samples 1 frame. → **Fixed: switched to absolute `TRAIL_SEC` (`tailStart = max(start, winEnd − TRAIL_SEC)`, default 4s)** anchored on the reliable `end`.
- **H5 — three string-returning mocks in `dig-post.test.ts` (lines 164, 440, 463) must all become `{markdown, slides:[]}`.** → **Fixed: enumerated explicitly in Task 3.**

## Medium
- **M1 — `pickedSec` is a float; parser used `\d+`.** → **Fixed: parse with `([\d.]+)`/`parseFloat`.**
- **M3 — zero-slide re-dig (`written.size===0`) never prunes stale assets.** → **Fixed: prune when `written.size > 0 || tokens.length === 0`** (legit-empty clears stale; all-captures-failed does not wipe the prior set).
- **M4 — `pickedSec` can round past `endSec`.** → **Fixed: clamp `pickedSec` to `[startSec, winEnd]`.**
- **M2** — global-replace + dedup interaction preserved; added an assertion note.

## Low
- **L1 — unclamped `TAIL_FRACTION` env** → moot (replaced by `TRAIL_SEC`, guarded by `max()`).
- **L2 — test regex only matched integer `-ss 5`** → moot (JS-filter; assert chosen asset, not argv).
- **L3 — resolution claim contingent on H2** → moot under JS-filter.
- **L4 — `crypto` already imported** → confirmed, no duplicate.

## Cleared (disproven hunts)
- **Cross-section prune** (`sectionId 16` deleting `160`'s files): NOT a bug — the prune prefix includes the hyphen, and `'160-…'.startsWith('16-')` is false (decimal ints, no leading zeros). Safe.
- **Frontmatter nesting misparse:** the indentation state machine tolerates the deeper 6/8-space list (terminator is a non-indented line); the only real parse risk was the float (M1).
