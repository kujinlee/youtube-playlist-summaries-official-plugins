# Codex Adversarial Review — Stage 2 Plan (Auto-Retry)

**Date:** 2026-06-30 · **Verdict:** No Blocking. 1 HIGH + 3 MEDIUM + LOWs — all folded into plan v2.

## HIGH — test-migration blast radius understated
Gating early-return on completeness means EVERY generateSummary test is affected, not just the timestamp-guard block. Fixtures with zero `## ` sections or non-terminal endings are now "incomplete" → extra outer attempts; `mockResolvedValueOnce` fixtures throw when exhausted; call-count assertions change (timestamp-miss 2→4). Affected incl. gemini.test.ts:297-309, 327-353, 374-395.
→ Plan v2 Step 5 expanded: migrate ALL generateSummary fixtures to completeness-clean markdown (`## 1. …\n[[TS:0]]\n…\n## Conclusion\n[[TS:1]]\n…done.`) unless the test explicitly exercises incompleteness/errors; update call counts.

## MEDIUM
1. **Deterministic timestamp-miss burns 4 attempts** (cost regression vs old single re-roll) — documented but untested. → add test: complete summary, no resolvable ▶, all attempts → 4 calls, `[timestamp-miss]` warn, no throw.
2. **Full-response persistence untested** — snippet keeps full `GeminiSummaryResponse`, but tests only check `.summary`. → add test: attempts with differing ratings/tldr; assert returned metadata is the selected attempt's.
3. **Hard failure after a soft-miss discards best** — a late `attempt()` throw propagates, losing the earlier soft-best. → documented as intended (hard errors propagate; keep-best applies only to soft misses).

## LOW
- Warn format diverges from the spec's standardized shape → include attempts + reason + confidence + len + sections.
- `MAX_SUMMARY_ATTEMPTS` "test-injectable" vs private const → drop the claim; private const + black-box call-count assertions.
- Conclusion regex `^##\s+(Conclusion|결론)` matches the prompt — OK.
- Double `[summary-suspicious]` (generateSummary + pipeline) — intentional; accepted.

## Resolution
Plan v2 addresses HIGH + all MEDIUM + LOWs. AFK: approval satisfied by this review.
