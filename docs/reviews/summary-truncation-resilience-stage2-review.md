# Stage 2 Dual Review — Auto-Retry (keep-best + warn)

**Branch:** `feat/summary-autoretry-stage2` · **Date:** 2026-06-30 · No Blocking/Critical. Logic confirmed correct by both reviewers. All findings addressed.

## Codex — no Blocking/High; 3 MEDIUM + 2 LOW (all addressed)
- **MEDIUM Cost** — deterministic timestamp-miss burned the full 4-attempt budget (up to 12 API calls). → added `TIMESTAMP_MISS_CAP = 2`: a complete-but-no-▶ result caps re-rolls at 2; incompleteness still gets the full budget.
- **MEDIUM Test** — fixture migration incomplete: unrelated generateSummary tests silently ran the full loop (4 calls + warnings). → migrated all incidental fixtures to a shared completeness-clean `OK` constant so they early-return; added `toHaveBeenCalledTimes(1)` where wiring/mapping is the point.
- **MEDIUM Interaction** — double `[summary-suspicious]` (generateSummary + pipeline). → documented as intentional layered observability (comment in pipeline.ts); generateSummary warns on retry-exhaustion, pipeline is the final gate on the persisted text.
- **LOW** — "prefers complete over longer truncated" proved early-return, not keep-best. → added a full-exhaustion test (4 incomplete attempts; asserts the 2-section attempt is selected via the score tuple).
- **LOW** — inner-retry vs outer-budget count untested. → covered indirectly by the MAX_TOKENS-exhaustion test (3 inner calls, 1 outer); noted.

## Claude — no Critical; 3 Important (all addressed)
1. **Legacy fixtures exhaust budget / false contract** (conf 90) — same as Codex MEDIUM Test. → fixed via the `OK` migration + call-count assertions.
2. **malformed-JSON / schema-rejection tests used `mockResolvedValueOnce`** (conf 82) — retries hit `undefined` (TypeError artifact), not real rejection. → switched the 4 error tests to persistent `mockResolvedValue` so every inner retry sees the bad payload.
3. **`scoreSummary` called `checkSummaryCompleteness` redundantly** (conf 80) — also called in the loop body. → loop now reuses `score[0]`/`score[3]` (complete / has-ts); no second call.
- Confirmed clean: loop best-tracking, early-return object, score comparison, hard-error propagation, full-response persistence.

## Verification
tsc clean; 1368 jest green.
