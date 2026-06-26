# Final Whole-Branch Review — dig code/config slides as images

Branch: `feat/dig-code-slide-as-image`
Reviewer: Claude (opus, whole-branch)
Date: 2026-06-26

## Verdict: READY TO MERGE

No Critical or Important findings. Policy flip correct, prompt internally consistent,
migration sound, suite green (tsc exit 0; 1371 jest pass).

## Verified
- **Policy flip:** old transcribe-to-fence rule fully removed; code/config added to `[[SLIDE:]]`
  triggers; downstream pipeline (`parseSlideTokens`, `resolveSlideTokens`, companion store,
  renderer) is content-agnostic — a code-slide token is handled identically to a diagram token.
  "No pipeline change needed" verified file-by-file.
- **Prompt consistency:** the "OR a slide showing code…" trigger and the "do NOT transcribe / do
  NOT invent a slide for spoken code" guards are complementary, not contradictory. Exclusion list
  (title cards, bullets, quotes, tips, speaker) preserved. No residual "code screen" phrasing.
- **Migration:** `DIG_GENERATOR_VERSION = 3`; staleness is `genVersion < DIG_GENERATOR_VERSION`
  against the imported constant; route stamps `genVersion: DIG_GENERATOR_VERSION` on regen. v2
  sections → stale → re-dig → v3 → badge clears. Lazy, no bulk Gemini, no data script. Legacy
  `genVersion: 0` correctly flagged.
- **Caption constraint:** prompt forbids `[ ] ( ) |`; `sanitizeCaption` strips exactly those as a
  total fallback. Worst case if Gemini ignores the rule = lossy/empty caption, never a broken
  token or injection. Correct layered design.
- **No PR #28 regression:** genuine-graphic selectivity, ≤3 parser cap, security/escaping
  (`assertVideoId`, execFile argv, containment guard), "zero slides normal" guidance all intact.

## Minors — all DEFER (optional test-quality polish; no runtime/security/migration impact)
- **M-a:** negative test `not.toMatch(/transcribe[^.]*code block/i)` passes only because the prompt
  says "fenced block" not "fenced code block" — brittle but currently correct; the positive
  companion test anchors intent. If hardening later, assert presence of new SLIDE-trigger wording.
- **M-b:** spoken-code regex `/only when[\s\S]*shown|actually shown/i` is broad-but-correct.
- **M-c:** ~330-char prompt line, consistent with surrounding prompt style.

## Out-of-scope awareness (pre-existing, NOT introduced here, do not block)
- Prompt example uses clock form `[[SLIDE:3:51]]` while windows are absolute seconds; a
  clip-relative `M:SS` would be silently dropped by `parseSlideTokens`' range filter. Unchanged
  from PR #28, governed by the existing strip-and-log path. Flagged for awareness only.

## Acceptance status
- CI-automated (prompt assertions, version, ≤3 cap): **green**.
- Manual-once (re-dig the OKF section `P_E29-87THI`/149 and confirm the slide image replaces the
  `type: metric` fence): **deferred** — requires a real Gemini call + yt-dlp/ffmpeg capture, not
  run autonomously. Recommended as the post-merge confirmation step.

## Review chain (Codex at usage limit until Jul 18 → Claude adversarial substituted throughout)
- Spec review: `docs/reviews/spec-dig-code-slide-as-image-review.md`
- Plan review: `docs/reviews/plan-dig-code-slide-as-image-review.md`
- Task 1 review: Spec ✅, Approved (in-session)
- Final whole-branch: this doc
