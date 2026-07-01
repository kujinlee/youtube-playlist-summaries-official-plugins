# Summary Truncation Resilience — Stage 2 (Auto-Retry) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Status:** draft — pending Codex plan review + AFK adversarial approval.

**Goal:** In `generateSummary`, auto-retry a truncated (or timestamp-missing) generation within one bounded attempt budget, keeping the best result and warning on exhaustion — never throwing for a soft quality miss.

**Architecture:** Replace the current single timestamp re-roll with an outer loop of up to `MAX_SUMMARY_ATTEMPTS` *successful* parsed attempts. Each attempt still uses `generateJson`'s own inner retries for hard failures (malformed JSON / schema / non-STOP finishReason / transient). Re-roll on a **soft** miss: `!checkSummaryCompleteness(summary).complete` OR (segments present AND no ▶). Return early when both pass; otherwise keep the best-scored attempt and `console.warn('[summary-suspicious] …')`.

**Tech Stack:** TypeScript, jest.

## Global Constraints
- Reuses `checkSummaryCompleteness` (Stage 1) — no new fingerprint logic.
- Never throws for truncation/timestamp miss (keep-best + warn). Hard errors from `generateJson` still propagate (wrapped as today).
- One budget: timestamp-miss and completeness share `MAX_SUMMARY_ATTEMPTS`; they do NOT each add a separate re-roll.
- `MAX_SUMMARY_ATTEMPTS = 4`, a named test-injectable constant.
- `tsc --noEmit` clean + full `npm test` green before commit.

---

### Task 1: bounded retry + keep-best + warn in `generateSummary`

**Files:**
- Modify: `lib/gemini.ts` (`generateSummary` try-block; add `selectBestSummary` helper + `MAX_SUMMARY_ATTEMPTS`)
- Test: `tests/lib/gemini.test.ts` (extend the `generateSummary — timestamp guard` / new `— auto-retry` describe)

**Interfaces:**
- Consumes: `checkSummaryCompleteness` (from `./summary-completeness`), existing `hasTimestamp`, `warnTimestampMiss`, `attempt()`.
- Produces: unchanged return type `GeminiSummaryResponse`.

- [ ] **Step 1: Write failing tests**

```ts
// import already: generateSummary; add checkSummaryCompleteness-driven fixtures.
const complete = '## 1. A\n[[TS:0]]\n\nbody\n\n## Conclusion\n[[TS:1]]\n\nAll done.';
const truncated = '## 1. A\n[[TS:0]]\n\nbody that is cut off mid';
const ratings = { usefulness: 3, depth: 3, originality: 3, recency: 3, completeness: 3 };
const resp = (summary: string) => ({ response: { candidates: [{ finishReason: 'STOP' }], text: () => JSON.stringify({ summary, ratings }) } });

describe('generateSummary — auto-retry (completeness)', () => {
  it('re-rolls a truncated (STOP) summary and returns the complete one', async () => {
    mockGenerateContent.mockResolvedValueOnce(resp(truncated)).mockResolvedValueOnce(resp(complete));
    const r = await generateSummary(SEGS, 'en', 'vid1');
    expect(r.summary).toContain('All done.');
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
  });

  it('keeps the best attempt and warns (never throws) when all attempts are truncated', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockGenerateContent.mockResolvedValue(resp(truncated));
    const r = await generateSummary(SEGS, 'en', 'vid1');            // must resolve, not reject
    expect(r.summary).toContain('cut off mid');                     // best (only) attempt kept
    expect(mockGenerateContent).toHaveBeenCalledTimes(4);           // MAX_SUMMARY_ATTEMPTS
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[summary-suspicious] vid1'));
    warn.mockRestore();
  });

  it('prefers a complete attempt over a longer truncated one when exhausted', async () => {
    const longTruncated = '## 1. A\n[[TS:0]]\n\n' + 'x '.repeat(200) + 'still going';
    const shortComplete = '## 1. A\n[[TS:0]]\n\nShort but done.';
    // attempt order: long-truncated, short-complete, truncated, truncated → early-return at #2
    mockGenerateContent.mockResolvedValueOnce(resp(longTruncated)).mockResolvedValueOnce(resp(shortComplete));
    const r = await generateSummary(SEGS, 'en', 'vid1');
    expect(r.summary).toContain('Short but done.');
  });

  it('returns immediately when the first attempt is complete with timestamps', async () => {
    mockGenerateContent.mockResolvedValue(resp(complete));
    const r = await generateSummary(SEGS, 'en', 'vid1');
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    expect(r.summary).toContain('All done.');
  });
});
```

- [ ] **Step 2: Run → FAIL** (`npx jest gemini.test -t "auto-retry"`) — current code re-rolls only for timestamps, accepts truncated-with-▶ on attempt 1.

- [ ] **Step 3: Implement** — replace the current try-block re-roll with:

```ts
const MAX_SUMMARY_ATTEMPTS = 4;

// Higher score = better. Tuple compared left→right: complete, #sections, has-conclusion,
// has-timestamp, length. (resolveTranscriptTokens already strips stray [[TS:i]], so that
// spec criterion is always satisfied and omitted here.)
function scoreSummary(r: GeminiSummaryResponse, hasSegments: boolean): number[] {
  const s = r.summary;
  const complete = checkSummaryCompleteness(s).complete ? 1 : 0;
  const sections = (s.match(/^## /gm) ?? []).length;
  const conclusion = /^##\s+(Conclusion|결론)/im.test(s) ? 1 : 0;
  const ts = !hasSegments || hasTimestamp(s) ? 1 : 0;
  return [complete, sections, conclusion, ts, s.length];
}
function betterThan(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) return a[i] > b[i]; }
  return false;
}
```

```ts
  try {
    const hasSegments = segments.length > 0;
    let best: GeminiSummaryResponse | null = null;
    let bestScore: number[] | null = null;
    for (let i = 0; i < MAX_SUMMARY_ATTEMPTS; i++) {
      const r = await attempt();
      const score = scoreSummary(r, hasSegments);
      if (best === null || betterThan(score, bestScore as number[])) { best = r; bestScore = score; }
      const complete = checkSummaryCompleteness(r.summary).complete;
      const hasTs = !hasSegments || hasTimestamp(r.summary);
      if (complete && hasTs) return r;      // both soft-quality goals met
    }
    // Exhausted — persist the best-scored attempt wholesale; warn on the residual miss.
    const chosen = best as GeminiSummaryResponse;
    const c = checkSummaryCompleteness(chosen.summary);
    if (!c.complete) {
      console.warn(`[summary-suspicious] ${videoId} attempts=${MAX_SUMMARY_ATTEMPTS} reason=${c.reason} confidence=${c.confidence} len=${chosen.summary.length}`);
    }
    if (hasSegments && !hasTimestamp(chosen.summary)) warnTimestampMiss(videoId, segments.length, MAX_SUMMARY_ATTEMPTS);
    return chosen;
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(`Gemini summary failed: ${cause}`, { cause: err });
  }
```

- [ ] **Step 4: Run → PASS** (`npx jest gemini.test -t "auto-retry"`)
- [ ] **Step 5: Run the existing `— timestamp guard` describe** — confirm the folded budget didn't break timestamp-miss behavior (the "retries once … attempt 2 does" test may now assert differently; update to the new single-budget semantics if needed, preserving intent: a timestamp-miss re-rolls within the budget).
- [ ] **Step 6: Full suite + tsc** → green/clean
- [ ] **Step 7: Commit** — `feat(summary): auto-retry truncated generations (keep-best + warn)`

---

## Self-Review
- **Spec coverage:** bounded budget (MAX_SUMMARY_ATTEMPTS=4), re-roll on !complete OR timestamp-miss in one loop, keep-best + warn never-throws, full response persisted (early-return returns the whole `r`; exhaustion returns whole `chosen`). ✓
- **Interaction with Stage 1 warn:** `writeSummaryDoc` still warns on the persisted summary — so an exhausted keep-best truncation is warned at BOTH generateSummary and pipeline level (acceptable; both are observability).
- **Hard-error path unchanged:** `attempt()` throwing (from generateJson exhaustion) still propagates and is wrapped.
- **Cost note:** a deterministic timestamp-miss (segments present, LIS drops all) burns the full budget each generation. Documented; acceptable (rare) — completeness is the priority; warnTimestampMiss surfaces it.
