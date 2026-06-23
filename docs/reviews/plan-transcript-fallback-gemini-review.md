# Adversarial Review — Gemini Transcript Fallback Plan

**NOTE: Codex at usage limit (until Jul 18 2026); Claude adversarial review per docs/plugins.md fallback. Re-attempt Codex pass before merge if access returns.**

Reviewed: `docs/superpowers/plans/2026-06-22-transcript-fallback-gemini.md` against the design spec and the actual code in `lib/gemini.ts`, `lib/youtube.ts`, `lib/pipeline.ts`, `lib/transcript-timestamps.ts`, the two test files, and the SDK type at `node_modules/@google/generative-ai/dist/generative-ai.d.ts:678`.

## Verified correct (things a reviewer might doubt, but check out)

- **`mediaResolution` cast compiles.** `GenerationConfig` (SDK d.ts:678) has NO `mediaResolution` member. Compiled the plan's exact pattern under `--strict`: exit 0, no excess-property error (TS does not run excess-property checks through an `as` assertion). Fine.
- **`GenerationConfig` import** exists in the SDK's exported types; extending `lib/gemini.ts:2` is valid. Fine.
- **`getApiKey`, `REQUEST_TIMEOUT_MS`, `GoogleGenerativeAI`, `SchemaType`, `z`, `TranscriptSegment`, `ResponseSchema`** all already in scope. No missing import. Fine.
- **`clearAllMocks` vs re-set implementation.** `clearAllMocks` clears `mock.calls`/`mock.results` but NOT implementations set via `mockReturnValue` (only `resetAllMocks` does). The plan re-applies the `mockReturnValue` in `beforeEach` after the clear anyway. Robust. Fine.
- **Mock refactor breaks no existing test.** No test in `tests/lib/gemini.test.ts` inspects `getGenerativeModel`; the deep-dive assertion reads `mockGenerateContent` which stays wired identically. Fine.
- **SWC / no-typecheck-at-test-time.** `jest.config` uses `next/jest` (SWC transform) — strips types without checking. So `npx tsc --noEmit` IS the real type gate. Plan's assumption correct. Fine.
- **Step 6 mapping trace** verified by hand: output is exactly `[{first,0,10},{second,10,20},{last,30,5}]`, offsets strictly increasing → satisfies `resolveTranscriptTokens`. Correct.
- **Cascade fall-through on empty array** (`transcript-source` `if (segments.length) return…`): empty array falls through to Gemini with `captionErr` undefined. Matches spec M6. Fine.
- **`tsc --noEmit` is the right gate**; **task ordering** correct (Task 2 mocks `../../lib/gemini` so doesn't need the real export at runtime, and Task 1 runs first anyway).

## Findings

### High-1 — Existing pipeline test "continues to next video when one video fails" relies on coincidental behavior
`tests/lib/pipeline.test.ts` mocks `fetchTranscriptSegments` to **reject** for vid1. After Task 3, `writeSummaryDoc` calls the real `resolveTranscriptSegments`, which catches that rejection and falls through to `transcribeViaGemini`. Because `lib/gemini` is auto-mocked, `transcribeViaGemini` returns `undefined` by default; resolver evaluates `if (segments.length)` on `undefined` → `TypeError`, caught and re-thrown → vid1 still errors → test passes **by accident**. A future change to the gemini mock could silently break this regression test. **Fix:** make the cascade failure explicit — set `mockTranscribeViaGemini.mockRejectedValue(...)` so both sources genuinely fail, and note in Step 5 that the test now exercises the cascade.

### Medium-1 — Gated-path test placement/cleanup ambiguous
The new Task 3 test uses `…Once` mocks and is placed "near the other writeSummaryDoc tests." If it lands outside `describe('writeSummaryDoc')` (which has `afterEach` `clearAllMocks`), a leftover `…Once` could leak. **Fix:** specify the test goes *inside* `describe('writeSummaryDoc')`, and keep its own temp dir + cleanup explicit.

### Medium-2 — Coverage threshold edges untested
Only the 5% case is tested. **Fix:** add a `durationSeconds: 0` case asserting no warn + no div-by-zero (the `> 0` guard means silent return — confirm intended), per the enumerated-behaviors policy.

### Medium-3 — Error tests use persistent `mockResolvedValue` with `retries=1` — CONFIRMED CORRECT
With `retries=1` the loop runs 2 attempts; persistent `mockResolvedValue` serves both. Do NOT "fix" to `…Once` (would make attempt 2 return `undefined`). No change.

### Low-1 — Dedupe + drop-empty interaction untested for "first-after-sort is empty"
Filter precedes dedupe, so an empty row never wins dedupe — author's claim is correct but unverified. **Fix (optional, applied):** add an equal-startSec pair where the empty one would sort first, assert the non-empty survives.

### Low-2 — `mapGeminiTranscriptSegments` not exported; tested via public caller. Intentional (boundary-mock policy). No change.

### Low-3 — Spec "dup startSec → 0 duration (harmless)" row is stale vs the dedupe decision (M7). Cosmetic. **Fix:** update the spec row.

### Low-4 — `mimeType: 'video/mp4'` for the Flash transcribe path copied from the Pro deep-dive path; same fileData contract, almost certainly fine. Flagged only as the one runtime assumption not re-proven in the plan text.

## Verdict

`needs-rework` — no Blocking/compile defects. **High-1** + **Medium-1/2** addressed before execution (all localized to the test plan, not the production design). Low-1/Low-3 applied opportunistically.

## Resolution (applied 2026-06-22)
- High-1: Task 3 Step 5 updated — existing failing-video test sets `mockTranscribeViaGemini.mockRejectedValue(...)`; cascade failure made explicit.
- Medium-1: Task 3 gated-path test specified inside `describe('writeSummaryDoc')` with explicit temp-dir cleanup.
- Medium-2: Task 1 added a `durationSeconds: 0` coverage test (no warn, no div-by-zero).
- Low-1: Task 1 added an equal-startSec/first-empty dedupe test.
- Low-3: spec error-table row updated.
- Low-2/Low-4/Medium-3: no change (confirmed correct/intentional).
