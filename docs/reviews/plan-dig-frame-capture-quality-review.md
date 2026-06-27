# Adversarial Review — Dig Frame Capture Quality Plan

Branch: `feat/dig-frame-capture-quality`
Reviewer: Claude (opus, whole-plan; Codex at usage limit until Jul 18)
Date: 2026-06-26

The reviewer empirically verified the load-bearing ffmpeg/promisify claims against the project's
real toolchain. Findings + resolutions (all folded into the revised plan):

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| B1 | Blocking | `util.promisify` of a jest-mocked `execFile` resolves to stdout only — `{ stderr }` is always `undefined`, so scene detection is untestable / passes for the wrong reason | Added `runCapture` explicit `{stdout,stderr}` Promise wrapper for the scene pass; plan forbids `execFileAsync` `{stderr}` destructure |
| B2 | Blocking | New sampling breaks 5 existing tests (mock `cb(null,'','')` writes no frames → `pickLargestFile` null → token dropped); self-review falsely claimed "still green" | Added Task 2 Step 2 migrating all 5 via shared `mockFfmpegPipeline`; rewrote the call-counting test to count fps passes |
| H1 | High | Duplicate `import os` in test block → tsc TS2300 | Removed; `os` already imported |
| H2 | High | `token.sec == endSec` is valid (parser uses `> endSec`) → `maxWindowSec = 0` | Single-frame fallback when `maxWindowSec < minSample`; added test |
| H3 | High | `fps` over sub-`1/SAMPLE_FPS` window emits 0 frames; env override couples to floor | `minSample = max(0.5, 1/SAMPLE_FPS)` floor + single-frame fallback below it |
| M1 | Med | Compounding 0-producing paths (H2 window + parser fallback) jointly untested | Covered by the single-frame guards + endSec test |
| M2 | Med | Real ffmpeg emits integer `pts_time:1` (not `3.2`) — keep fixtures representative | Added parser test for integer `pts_time:1` |
| M3/L1-L3 | Low | prompt-regex adjacency, statSync race, copy-vs-move wording | Accepted; full `dig/generate` suite run covers M3 |

**Verified correct (no change needed):** `pts_time` is relative to `-ss` and on stderr; first
post-seek frame not auto-selected (no spurious `pts_time:0`); `.cache` parent exists before
`mkdtempSync`; `-ss` before `-i` (input seeking) is correct.

Verdict (pre-fix): do not implement as written. Verdict (post-revision): Blocking/High all resolved.
