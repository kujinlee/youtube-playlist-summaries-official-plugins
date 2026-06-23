# Adversarial Plan Review — deep-dive-transcript-fallback

**NOTE: Codex at usage limit (until Jul 18 2026); Claude (opus) adversarial review per docs/plugins.md fallback.**

Verdict: needs-rework → all Blocking/High/Medium applied; plan now ready-to-execute.

## Blocking
- **B1** `tests/lib/deep-dive/ensure-integration.test.ts` runs the REAL `writeDeepDiveDoc` with `lib/gemini` mocked but never stubs `transcribeViaGemini`; after the swap its empty-captions case routes into the resolver's Gemini branch → `undefined.length` TypeError. The plan claimed "no regressions in ensure*.test.ts" without analysis. → **Task 1 Step 4** added: stub `transcribeViaGemini.mockResolvedValue([])` in that test's `beforeEach` + fix the stale comment. (Verified siblings safe: `ensure.test.ts` mocks write-doc; `deep-dive-post.test.ts` mocks ensure; `deep-dive-html-pipeline.test.ts` doesn't run real write-doc with caption mocks.)
- **B2** No default `transcribeViaGemini` stub in `write-doc.test.ts` `beforeEach` left the resolver path undefined-unsafe. → **Task 1 Step 1** adds `mockTranscribeViaGemini.mockResolvedValue([])`. Bonus: this default makes `:168`/`:180` reach video-only with **no edit**, simplifying the plan.

## High
- **H1** Step 5 RED prediction was wrong: the floor test is green under current code (caption reject → video-only, transcribe never called), not red. → Step 5 corrected: **only** `:103`/`:116` go red; the rest are green pre- and post-fix.
- **H2** `:168`/`:180` predictions were hand-waved. → They pass under both old and new code; with the Step-1 default they need no edits. Stated precisely.

## Medium / Low
- **M3** Verification-repair (regen `v4F1gFy-hqg`) was demoted to a one-liner. → Promoted to **Task 2** with explicit before/after `grep -c '▶'` assertions + the regen command (temporarily set `deepDiveVersion` to PRE_FEATURE to force regen) + the corpus-wide open question.
- **M1/M2/L1/L2** verified-correct by the reviewer (arg order, complete test enumeration, `▶`-via-mock note, existing TranscriptSegment import) — no change needed; noted so the executor doesn't second-guess.

## Verified-correct (reviewer)
Production diff typechecks (`video.youtubeUrl`/`durationSeconds` in scope, arg order, `{segments}` destructure); removing the `fetchTranscriptSegments` import is safe (only use); empty-`[]` falls through; floor throws (not returns); `makeVideo` `durationSeconds:300` flows to the assertion.
