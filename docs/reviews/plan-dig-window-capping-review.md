# Adversarial Review — Plan: Dig Window-Capping (3′)

**Reviewer:** Claude adversarial subagent (fresh, full file access, adversarial mandate)
**Date:** 2026-06-27
**Subject:** `docs/superpowers/plans/2026-06-27-dig-window-capping.md` + spec
**Codex gap:** Codex CLI at usage limit during the dig branch lineage; this Claude adversarial
review satisfies the Post-Plan Gate. Re-attempt Codex (`codex:rescue --fresh`) before merge if
access returns.

**Verdict:** Architecture (pure `frame-select.ts` + IO orchestrator, extend-on-demand,
anchor-as-fault-tolerance) is the right shape, but the plan is **not executable as written** —
one Blocking algorithmic defect, several High correctness/test-coverage holes. The reviewer
withdrew B1/B2/B4/B5 after line-by-line tracing (no reference bug, no resource leak, offsets
continuous across segments).

## Surviving findings

### Blocking
- **B6 — size-driven extend wanders into the next slide on a missed cut.** The plateau test
  `size >= maxSize*plateauFrac` over a *running* max is non-monotone across extends, and when
  the cut detector misses a soft fade (the spec's §10.1 risk, proven at the old threshold) the
  size profile reads "still building" and extends INTO the next slide, then picks a next-slide
  frame. The cut detector is the only boundary guard. **Fix:** plateau = *local stability*
  (size within `flatEps` of the prior frame for ≥2 consecutive frames), and bound wander to ≤1
  segment when no cut is seen.

### High
- **H1 — offset/index alignment.** Sampled-frame offsets assume `i/SAMPLE_FPS` from clip start;
  derive real per-frame offsets from `showinfo` on the fps pass so they share the scene pass's
  timestamp space.
- **H3 — `atTrailingEdge` fires on flat/single-frame windows** (flat branch + best==lastCand).
  Must require the *build* branch (size rising) was taken.
- **H4 — `noUncheckedIndexedAccess`** may make `frames[choice.bestIndex].path` fail `tsc`;
  verify config or guard.
- **H5 — behavior table claims 8 scenarios; only 4 tested.** Missing: 2 (fast-cut bounds, the
  motivating bug), 3 (plateau within base), 5 (safety-cap termination), 8 (token at endSec).
- **H6 — fs.statSync→size encoding across appended segments** exercised only via mock; mock must
  be realistic.

### Medium
- **M1 — `captureSlideFrame` trusts its `outPath`;** caller owns containment. Add a comment/guard.
- **M2 — worst case 5 yt-dlp/token = 15/section, not the spec's "2–3".** Bound extend count;
  reconcile the 403 rationale (small fast clips vs. one sustained huge transfer).
- **M3 — mock factories under-specified** (no invocation-index → size-profile → scene-stderr
  mapping); non-deterministic as written.
- **M4 — calibration-failure fallback** (spec §3.3 "frame-difference metric") has no task. Decide:
  threshold-only (acceptable once B6 bounds wander) or add the fallback.
- **M5 — `generate.test.ts:188` asserts `toBe(5)`;** Task 5 must update it to `6` or the suite
  goes red.

### Low
- **L1** parseSceneChanges correctness depends on `select` pre-filtering — add comment.
- **L2** stale comment references `tmpDirs` (code uses `segDir`'s own `finally`).
- **L4** `DIG_SEG` ambiguous → prefer `DIG_EXTEND_SEC`.

## Integration (confirmed safe)
- `resolveSlideTokens` signature unchanged → dig API route unaffected.
- `captureBestFrame`/`singleFrameCapture`/`parseFirstSceneChange`/`pickLargestFile` have no
  external callers → deletion safe.
- `DIG_GENERATOR_VERSION` consumed by `dig-merge.ts` (relative) + hard-coded in
  `generate.test.ts` (M5).

## Disposition
All Blocking + High addressed inline in the plan revision (rev 2). M1/M3/M5 + all Lows fixed
inline (clear corrections). M2 (extend cap value) and M4 (calibration fallback) raised to the
user as decisions.
