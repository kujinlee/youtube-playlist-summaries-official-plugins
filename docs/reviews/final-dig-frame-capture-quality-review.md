# Final Whole-Branch Review — Dig Frame Capture Quality

Branch: `feat/dig-frame-capture-quality` (stacked on PR #30)
Reviewer: Claude (opus, whole-branch; Codex at usage limit until Jul 18)
Date: 2026-06-26

## Verdict: READY TO MERGE — no Critical/Important, no fix-first items.

Full suite **1389 jest + tsc clean**. Scene-bounded sampling + largest-frame selection +
settled-timestamp nudge + version 4→5.

## Verified
- **Offsets/units consistent:** `relStart = token.sec - startSec` (clip-relative); `pts_time` is
  relative to the `-ss` seek point, so `sceneOffset` is directly comparable to `maxWindowSec`;
  `winLen = min(sceneOffset, maxWindowSec)` never crosses the slide boundary or clip end. No
  off-by-one.
- **Both single-frame fallbacks reachable/correct:** `maxWindowSec < minSample` (token at endSec)
  and `sceneOffset < minSample` (slide ends immediately).
- **No PR #30 regression:** no-leak strip, catch-drops-token, assertVideoId, assetsRoot containment,
  execFile-array-argv, ≤3 cap, code/config-as-image policy all untouched. Appended settled-frame
  sentence refines only *which instant* to point at — no contradiction with existing triggers.
- **Migration transparent:** staleness is `genVersion < DIG_GENERATOR_VERSION` against the imported
  constant; v4 sections re-flag `↻ outdated`, no data script.
- **Resource safety:** `framesDir` removed in `finally` (incl. throw path); `.cache` exists before
  `mkdtempSync`; temp clip deleted in outer `finally`. No fd/dir leaks across the per-token loop.
- **Test quality:** `mockFfmpegPipeline` writes real frame files so `pickLargestFile`/`copyFileSync`
  run for real; the asset's 500-byte size proves largest-frame selection; scene-bound test reads the
  actual `-t` argv; failure/fallback branches genuinely driven.

## Minor / follow-ups (non-blocking)
- **Env-override coverage gap:** `numEnv` + the `minSample = max(0.5, 1/SAMPLE_FPS)` coupling are
  unexercised by tests (constants read once at module load). Correct by inspection; a direct `numEnv`
  unit test (and one asserting `minSample` at `SAMPLE_FPS=1`) would close it. Recommended follow-up.
- **m1** (`pickLargestFile` no try/catch around `statSync`): DEFER — runs over an exclusively-owned,
  freshly-created `framesDir` whose only writer has exited; TOCTOU unreachable; outer catch drops the
  token if it ever threw.
- **m2** (`statSync` on subdirs): DEFER — `framesDir` only contains flat `f_%03d.jpg`; `isFile()`
  filters anyway.
- **m3** (`parseFirstSceneChange` "non-finite" test comment slightly loose): trivial, fix opportunistically.

## Review chain (Codex at limit → Claude adversarial throughout)
- Plan review (opus, empirically verified ffmpeg): `docs/reviews/plan-dig-frame-capture-quality-review.md` — 2 Blocking + 3 High fixed pre-implementation.
- Task 1 review: Spec ✅ 16/16, PASS. Task 2 review (opus): Spec ✅, quality ✅. Task 3: self-verified.
- Final whole-branch: this doc.
