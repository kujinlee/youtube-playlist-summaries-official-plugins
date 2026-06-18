# Adversarial Review — Clickable Section Timestamps Plan

**Date:** 2026-06-17
**Reviewer:** Fresh Claude subagent (Codex usage-limited until 2026-07-03 → fallback per `docs/plugins.md`; **manual Codex pass owed before merge**).
**Target:** `docs/superpowers/plans/2026-06-17-clickable-section-timestamps.md` against `docs/superpowers/specs/2026-06-17-clickable-section-timestamps-design.md` and current code.

**Verdict (as received):** NOT safe to implement as written — B1 and H1 must be fixed first; H2 and M1 should be addressed before the wiring task lands.

---

## Blocking

**B1 — Task 8 pipeline mock migration is incomplete; breaks the error-injection test.**
`tests/lib/pipeline.test.ts` "continues to next video when one video fails" sets
`mockFetchTranscript.mockRejectedValueOnce(...)` to drive the per-video error path. After the pipeline
switches to `fetchTranscriptSegments`, that rejection never fires, the `beforeEach` segment mock makes
the video succeed, and the test's error-count assertions fail. The plan's "add to the setup block"
does not convert this test, and ~17 individual `mockFetchTranscript.mockResolvedValue('transcript')`
sites become dead.
**Fix:** convert the error-injection test to `mockFetchTranscriptSegments.mockRejectedValueOnce(...)`
and remove/convert the dead `mockFetchTranscript` sites. → **Resolved by merging Tasks 7+8 with an explicit mock-migration step (see updated plan).**

## High

**H1 — `resolveTranscriptTokens` early-return leaks inline-only stray tokens (violates spec §8 row 3).**
`if (tokenLines.length === 0) return markdown;` returns untouched when the only token is inline
(not own-line), leaving a raw `[[TS:2]]` in reader-facing output.
**Fix:** scrub stray inline tokens even on the no-own-line-token path; add an inline-only test. → **Resolved in updated Task 2 (fence-aware line-by-line rebuild strips inline tokens).**

**H2 — `resolveTranscriptTokens` is not fence-aware; a token inside a ``` code block is resolved.**
Unlike `parse.ts:parseSections`, the resolver scans every line, so a `[[TS:1]]` inside a fenced block
is counted toward strict-increasing validation and rewritten — corrupting code samples and able to
flip monotonicity and silently degrade an otherwise-valid doc.
**Fix:** make the resolver fence-aware (reuse the `isFenceLine` toggle); leave fenced content verbatim;
add a fenced-token test. → **Resolved in updated Task 2.**

## Medium

**M1 — Broken `tsc`/`next build` between the Task 7 and Task 8 commits.**
Task 7 changed `generateSummary` to 3 args and committed while `pipeline.ts` still called it with 2.
`next/jest` uses SWC (no typecheck), so `npm test` stayed green but `npm run build` would fail at that
commit.
**Fix:** fold the pipeline source change into the same commit as the signature change. → **Resolved by merging Tasks 7+8 into one producer-wiring task (no mismatched commit).**

**M2 — Plan skipped the full suite before the Task 7 commit.**
Only Task 8 ran `npm test`. → **Resolved: merged Task 7 runs the full suite once before its single commit.**

## Low (noted, no action required)

- **L1** — `extractTimeRange` falls back `endSec = startSec` when the label has no en dash; acceptable degradation, undocumented in spec §8. (Left as-is.)
- **L2** — single-section/one-token "last = duration" path is correct but only tested indirectly via the Conclusion token. (Optional hardening; the updated Task 2 tests exercise the last-token path.)

## Verified solid (no action)

- All plan line-number claims accurate (`fetchTranscript` ends L78; `generateSummary` L35–76; `.lead` L33; render `sections` L60; parse `flush` L22).
- `generateSummary` has exactly one source caller (`pipeline.ts:250`); `deep-dive.ts` does not call it. 18 call sites in `gemini.test.ts`.
- En dash is U+2013 on both producer (`timestampLine`) and consumer (`parse.ts` split).
- `detectLanguage` input is byte-identical before/after (`map(s=>s.text).join(' ')`).
- Re-render preserves timestamps: `timeRange` is re-derived from re-parsing the `.md`; the drift guard compares section titles only, which the `▶` line does not change; the magazine model never saw the `▶` line. **Confirmed.**
- Duplicate indices and `index === segments.length` both correctly degrade.
