# PR2 (dig sub-headings) Task 1 — Claude Code Review

**Diff:** 2dcc9ef..ab4747e (`lib/dig/generate.ts` prompt + version + comment; `generate.test.ts`).
**Verdict:** Task quality **Approved** — 0 Critical/Important.

## Spec Compliance — ✅
DIG_GENERATOR_VERSION 8→9 (test updated to `toBe(9)`); v9 history-comment line appended (v8 kept); sub-heading bullet inserted immediately before "Output markdown only"; `\`###\` ONLY — never \`#\` or \`##\`` (escaped backticks render literal); Korean-safety "same language…(do NOT switch to English)" present + lang=ko Korean instruction intact; length-conditional ("ONLY when long enough"); scope limited to generate.ts + generate.test.ts (no DugSection/render change).

## Strengths
Verbatim brief transcription (no drift); Korean-safety test is positive+negative+anchor (3 orthogonal assertions); lang=ko regression guard; clean comment placement; blast-radius suites import the constant (auto-track, 219/219).

## Issues
Critical/Important: none.
### Minor (test-strength, → final triage)
- `generate.test.ts` `###`-only regex has 3 OR-branches; would still pass if a future soft-edit dropped the "ONLY" half. Composite with /long/+/sub-heading/ is adequate. Tighter: `/`###` ONLY.*never `#`.*`##`/`.
- standalone `/###/` assertion is trivially satisfied (anchored by sibling matchers; adds little signal).

## Note
Codex adversarial review (recorded in task-dig-subheadings-t1-codex.md) specifically scrutinized whether the existing "no headings for the section title" line contradicts the new `###` sub-heading instruction.
