# Claude Code Review — Summary Truncation Guard

**Branch:** `fix/summary-truncation-guard`
**Date:** 2026-06-30
**Scope:** `lib/gemini.ts` finishReason guard in `generateJson` + 2 tests.

## Verdict: no Critical. Three Important findings.

### Important
1. **`transcribeViaGemini` bypasses the guard (conf 90)** — `gemini.ts:435` calls `generateContent` directly with its own retry loop; the guard in `generateJson` doesn't apply. A MAX_TOKENS-truncated transcript maps cleanly and passes the `segments.length===0` + `<0.6` coverage warn (warn-only). A truncated transcript feeds both summary and dig timestamps → at least as damaging. Add the same finishReason check after line 435.
2. **`fixSummary` bypasses the guard, no retry (conf 85)** — `gemini.ts:292-295` calls `generateContent` directly; only guard is `if (!corrected)` (empty only). A truncated correction is non-empty → silently persists a half-corrected doc. Add finishReason check + a single retry for parity.
3. **Retry test doesn't assert the warn (conf 82)** — `gemini.test.ts:374` suppresses `console.warn` but never asserts `[gemini-retry]` fired; a swallowed error before the retry warn would still pass. The analogous timestamp-guard test does assert. Add the assertion.

### Confirmed correct
- Guard condition `finishReason && !== 'STOP' && !== 'FINISH_REASON_UNSPECIFIED'` — truthiness handles absent telemetry; UNSPECIFIED whitelist matches proto-default. Necessary and sufficient.
- Throw-inside-try re-enters the retry loop; `lastErr` re-thrown after exhaustion. Sound.

### Out of scope (follow-up)
- `lib/dig/generate.ts` `generateDig` uses raw `fetch` and never reads `candidates[0].finishReason` — pre-existing gap, not introduced here.

## Resolution
Addressing #1, #2, #3 (Important). #dig follow-up noted for a later PR.
