# Codex Adversarial Review — Summary Truncation Guard

**Branch:** `fix/summary-truncation-guard`
**Date:** 2026-06-30
**Verdict:** Safe to merge with named fixes. No Blocking.

## HIGH
- **`transcribeViaGemini` accepts non-STOP truncated JSON** (`gemini.ts:435`) — direct `generateContent` + `JSON.parse`, no finishReason check. MAX_TOKENS-truncated transcript with early segments is silently accepted; low-coverage path only warns. Feeds downstream summaries → fix before merge. Apply the guard inside the transcription retry loop.

## MEDIUM
- **`fixSummary` accepts truncated markdown** (`gemini.ts:292`) — only guard is `if (!corrected)`; a non-empty truncated correction passes. Add finishReason check.

## LOW
- **No all-retries-exhausted test** (`gemini.test.ts:374`) — new tests cover MAX_TOKENS→STOP and plain STOP, but not 3× MAX_TOKENS → thrown error. Add a `generateJson` test: 3 MAX_TOKENS mocks, assert 3 calls + thrown "response not complete".

## Confirmed correct
- `generateJson` guard correctly covers `generateSummary`, `extractQuickView`, `generateMagazineModel`.

## Resolution
Extract `assertNotTruncated()` helper; apply at all three SDK call sites (generateJson, transcribeViaGemini, fixSummary — the latter gets a retry loop for parity). Add retry-exhaustion + transcribe + fixSummary + warn-assertion tests. `generateDig` raw-REST path noted as a separate follow-up (both reviews; pre-existing).
