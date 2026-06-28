# Adversarial Review — Plan rev 3 (Gemini-window)

**Reviewer:** Claude adversarial subagent (fresh, full file access, adversarial mandate)
**Date:** 2026-06-27
**Subject:** `docs/superpowers/plans/2026-06-27-dig-window-capping.md` (rev 3) + spec
**Codex gap:** Codex CLI at usage limit; Claude adversarial review satisfies the Post-Plan Gate.
Re-attempt Codex before merge if access returns.

**Verdict:** Architecture sound (Gemini-supplied windows + `pickLargestFile`, cut-detector deletion
well-justified). Two real parser/design bugs + a vacuous test + a build-breaking import to fix first.

## Findings + disposition

### Blocking
- **B-1 — numeric two-field captions destroyed.** `[[SLIDE:333|2024]]` → grammar grabs `2024` as the
  end-time group → `caption=''`. Gemini emits short numeric captions. **Fix:** end is parsed ONLY in
  the three-field form — add a `(?=\|)` lookahead so the end group matches only when a caption field
  follows; two-field `start|X` always treats `X` as caption (exact old behavior). Add tests
  `333|2024`→caption preserved, `312|42`→caption preserved. → **fixed in plan rev 3.1.**
- **B-2 — per-token download amplification (1→N).** The 403 motivation was *one huge* transfer;
  per-token fires ≤3 `yt-dlp` calls/section. **Fix:** (a) justify in spec §10 — per-token is
  *deliberate* because slides can be spread across a long section, so one combined download would
  re-create the pathological span; each clip is now tiny (~6–10s) and the re-dig empirically showed
  small sequential downloads do NOT 403 (only the 19-min ones did); (b) add a yt-dlp-call-count test
  for a 3-token section to lock the cost visibly. → **fixed in plan rev 3.1 + spec §10.**

### High
- **H-1 — scenarios 1 & 2 assert the identical `*333-339`** (both window paths collide on the chosen
  numbers) → scenario 2 proves nothing. **Fix:** distinct values (scenario 1 end=341 → `*333-341`;
  null-end → `*333-339`). → **fixed.**
- **H-2 — stale module header** (lines 1–13 describe single-clip + scene detection). **Fix:** add a
  step to rewrite the header. → **fixed.**
- **H-3 — `slides-helpers.test.ts:4` imports `parseFirstSceneChange`;** deleting the function without
  editing the import breaks `tsc`. **Fix:** step explicitly removes it from the import. → **fixed.**

### Medium
- **M-1 — `DIG_DEFAULT_FWD=""`→0 / negative → degenerate window.** **Fix:** clamp
  `winEnd = max(winEnd, startSec + 1)`. → **fixed.**
- **M-3 — spec overstates "never wrong-slide"** for the null-end + fast-cut intersection (a blind
  `DEFAULT_FWD` window can contain a busier next slide). **Fix:** reduce `DEFAULT_FWD` 6→4 and soften
  the spec claim; note null-end is rare (Gemini emits end reliably) and is the residual risk. → **fixed.**
- **M-2** — small numeric end (`333|9`) → null + caption preserved (correct); no test needed. Noted.

### Low (accepted, no change)
- **L-1** bracket captions (`array[0]`) no-match — pre-existing, prompt forbids `[ ]`.
- **L-2** `1|2|3` triple always start|end|caption — fine.
- **L-3** `ytArgs()` `!` throws opaquely if no yt-dlp call — cosmetic.

## Verified sound (no change)
Triple/clock/old-format parsing; `perceive | plan` caption; end clamp + `end<=start`→null; asset
filename stable for re-dig; single caller (`route.ts:135`); companion-doc no per-slide schema
coupling; `DIG_GENERATOR_VERSION` coupling confined; containment before write; mkdtemp + finally
cleanup on all paths.
