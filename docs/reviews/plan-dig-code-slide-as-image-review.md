# Adversarial Review — `2026-06-26-dig-code-slide-as-image` Implementation Plan

**Date:** 2026-06-26
**Reviewer:** Claude (Codex unavailable — usage limit hit; resets 2026-07-18 11:04 AM)
**Codex gap noted:** Codex adversarial review was attempted but rate-limited. This Claude adversarial review satisfies the gate for proceeding per project fallback policy (docs/plugins.md).
**Files read:**
- `docs/superpowers/plans/2026-06-26-dig-code-slide-as-image.md`
- `docs/superpowers/specs/2026-06-26-dig-code-slide-as-image-design.md`
- `lib/dig/generate.ts`
- `lib/dig/slide-tokens.ts`
- `tests/lib/dig/generate.test.ts`
- `tests/lib/dig/slide-tokens.test.ts`

---

## BLOCKING

### B1 — Caption-constraint assertion will NEVER match the proposed prompt text

**Plan step:** Task 1, Step 1 (test) and Step 4 (implementation)

**Plan's test assertion:**
```typescript
it('forbids [ ] ( ) and | characters in slide captions', () => {
  expect(p()).toMatch(/caption[\s\S]*MUST NOT contain/i);
});
```

**Plan's proposed prompt text (Step 4):**
```
The caption is a short plain-English description of the slide. It MUST NOT contain the characters [ ] ( ) or | — describe the slide in words; never paste raw code, YAML, or shell into the caption. (example: [[SLIDE:3:51|Diagram showing four capabilities]])
```

The sentence `It MUST NOT contain` does appear in the proposed prompt text, so `MUST NOT contain` is present. However the regex `/caption[\s\S]*MUST NOT contain/i` also requires the word `caption` to appear *before* `MUST NOT contain` in the returned string. The proposed sentence starts with "The caption is …" and continues "It MUST NOT contain …" — the word "caption" appears at the start of this sentence, well before "MUST NOT contain", so `[\s\S]*` spans the gap. **This assertion will pass once Step 4 is implemented.**

However: this same test is written in Step 1 (RED phase), meaning it is expected to FAIL before Step 4. The current prompt (generate.ts lines 67-68) does NOT contain the caption constraint sentence. The test WILL correctly fail in RED. This is fine.

**Status: NOT actually blocking — re-checked. See Medium M1 instead for the subtle ordering issue.**

---

## HIGH

### H1 — `only when[\s\S]*shown|actually shown` assertion will not match proposed prompt text

**Plan step:** Task 1, Step 1 (fourth new test) and Step 4 (implementation)

**Plan's test assertion:**
```typescript
it('forbids inventing a slide for code that is only spoken', () => {
  expect(p()).toMatch(/only when[\s\S]*shown|actually shown/i);
});
```

**Plan's proposed prompt text (Step 4, the new SLIDE rule):**
> "Emit `[[SLIDE:M:SS|caption]]` when an on-screen visual carries meaning words alone cannot fully convey … Emit it ONLY when that content is actually shown on screen — do NOT transcribe code into a fenced block…"

The phrase `actually shown on screen` is present, so `actually shown` will match the second alternative. **This assertion passes once Step 4 is implemented.**

**RED phase check:** The current prompt (generate.ts line 68) says "ONLY when a genuine visual … cannot be conveyed in words." That text does NOT match `only when[\s\S]*shown` (no `shown` follows `only when`), and does NOT match `actually shown`. So this test correctly fails RED. Fine.

**Status: No flaw — verified. Downgraded to None.**

### H2 — `restricts [[SLIDE:]] to genuine visuals` assertion — risk of breakage with new prompt wording

**Plan step:** Task 1, Step 6 (verify no other prompt tests regressed)

**Existing test (generate.test.ts:199-204):**
```typescript
it('restricts [[SLIDE:]] to genuine visuals (diagram/chart/architecture/UI layout)', () => {
  const s = p();
  expect(s).toMatch(/\[\[SLIDE:/);
  expect(s).toMatch(/diagram|chart|architecture|data visualization|layout/i);
});
```

**Plan's proposed new prompt text:** "a diagram, chart, architecture/flow figure, data visualization, a UI/result screenshot whose spatial layout matters, OR a slide showing code…"

The new text retains `diagram`, `chart`, `architecture`, `data visualization`, and `layout` (via "spatial layout") — all matched terms. This test WILL still pass. **No breakage.**

**Status: Not a flaw. Plan's Step 6 claim is correct.**

### H3 — `states that zero slides is the normal/preferred case` assertion — verify new prompt retains wording

**Plan step:** Task 1, Step 6

**Existing test (generate.test.ts:207):**
```typescript
it('states that zero slides is the normal/preferred case', () => {
  expect(p()).toMatch(/most sections.*zero|zero.*normal|none.*preferred/i);
});
```

**Plan's proposed prompt text (Step 4):** The plan says "(Line 69 — the 'Most sections need ZERO slides … at most 3' rule — is unchanged)". Current generate.ts line: `"Most sections need ZERO slides; emitting none is the normal, preferred case. Use at most 3 [[SLIDE:]] tokens total."`

This matches `most sections.*zero` (case-insensitive, `ZERO` is uppercased). Fine.

**Status: No flaw — confirmed retained.**

### H4 — `no longer invites a "code screen" screenshot` test — new prompt must not contain "code screen"

**Plan step:** Task 1, Step 6

**Existing test (generate.test.ts:209):**
```typescript
it('no longer invites a "code screen" screenshot', () => {
  expect(p()).not.toMatch(/code screen/i);
});
```

**Plan's proposed new prompt wording:** Reviewed all proposed text in Step 4. The phrase `code screen` does not appear anywhere in the new wording. The new text says "code, a command, terminal/CLI output, or config" and "code into a fenced block". Neither contains the bigram `code screen`. **No breakage.**

**Status: No flaw.**

### H5 — `instructs transcribing code/commands into fenced code blocks` test not explicitly deleted from file

**Plan step:** Task 1, Step 1

**Existing test (generate.test.ts:193-195):**
```typescript
it('instructs transcribing code/commands into fenced code blocks', () => {
  expect(p()).toMatch(/transcribe[^.]*code block/i);
});
```

The plan says to **replace** this test with `no longer instructs transcribing code into fenced code blocks`. The plan is clear: "Replace the transcribe test" with the new set of tests. If a subagent reads this as "add the new tests alongside the old one" rather than "replace", both a positive and negative assertion about the same prompt text would be present — one would fail after implementation.

The plan wording says "replace the transcribe test" explicitly, so a careful subagent will delete it. However, the plan does not show the deletion operation explicitly (no `// DELETE THIS BLOCK` marker or line range to remove). The original test is at lines 193-195 of generate.test.ts. The plan cites the block (shows the current test verbatim) and says "replace … with these tests:" — this is sufficiently clear, but a subagent that patches by appending rather than replacing would create a permanently-failing suite (the old positive assertion would fail after Step 4 flips the prompt, making the new negative assertion pass but the old positive one fail).

**Fix:** In Task 1 Step 1, add an explicit note: "Delete the existing test block (lines 193-195) before adding the four replacement tests below."

**Severity: High** — a missed deletion creates a permanently contradictory test pair that would make the suite red after implementation with no clear error message.

---

## MEDIUM

### M1 — Task 2 Step 3 TDD ordering: test is expected to PASS immediately (not a RED/GREEN cycle)

**Plan step:** Task 2, Step 3

The plan says: "Run to verify it **passes immediately** (cap already enforced). Expected: PASS (this documents existing parser behavior; it is a coverage/regression guard, not new logic). **If it FAILS, the cap regressed** — stop and investigate."

This is a deliberate deviation from strict TDD (no RED phase). For a pure regression guard this is acceptable, but the plan's own Per-Task Checklist mandates "Write failing tests (RED) → Run tests — confirm failure for the right reason → Implement (GREEN)." If the test passes immediately, the "failing tests (RED)" and "confirm failure for the right reason" checklist steps cannot be checked off, which creates ambiguity about whether those steps are simply skipped or marked done incorrectly.

**Fix:** In Task 2, add a note: "TDD RED phase N/A — this is a regression guard for existing behavior. Mark the 'Write failing tests (RED)' checklist step as 'Skipped — coverage guard only' with this explanation."

**Severity: Medium** — process compliance issue; the test itself is correct.

### M2 — The `code/command/terminal/config among [[SLIDE:]] triggers` assertion uses `\bCLI\b` — verify prompt contains `CLI`

**Plan step:** Task 1, Step 1 (second new test) and Step 4

**Test assertion:**
```typescript
expect(s).toMatch(/\bterminal\b|\bCLI\b/i);
```

**Plan's proposed new prompt text (Step 4):** "a slide showing code, a command, terminal/CLI output, or config"

The phrase `terminal/CLI` contains both `terminal` and `CLI`. The regex `/\bterminal\b|\bCLI\b/i` will match `terminal` from `terminal/CLI`. Fine, even if `CLI` is the part after a slash (word boundary may not be clean due to `/`), `terminal` provides the match.

However, if the implementer writes `terminal output` without `CLI`, the `/\bCLI\b/i` part would fail but `\bterminal\b` would match. The assertion is `OR` (`|`), so it passes either way. **No functional breakage.**

**Status: No flaw — the OR handles it.**

### M3 — No spec requirement for updating `companion-doc.test.ts` or other fixtures encoding "code → fence"

**Spec (Testing table, row 3):** "tests/lib/dig/slide-tokens.test.ts, tests/lib/dig/companion-doc.test.ts — update any fixtures/assertions that encoded 'code → fence' to reflect 'code → slide'."

The plan has no task to update `tests/lib/dig/companion-doc.test.ts`. The plan's architecture note says "Existing PR #28 staleness UI ... The slide-capture pipeline, token parser, companion storage, and renderer already handle images — no change." If companion-doc.test.ts has a fixture that expects a fenced code block (the code-transcription path), that test will start failing after Step 4 changes the prompt — but since the prompt change is probabilistic (Gemini output is mocked in tests), companion-doc tests likely don't pattern-match against Gemini's markdown output. They test storage/retrieval, not content generation.

**Action:** Verify that `tests/lib/dig/companion-doc.test.ts` has no assertion matching `/transcribe[^.]*code block/i` or similar. If clean, this is a non-issue. If it does contain such assertions, a task is missing.

**Severity: Medium** — needs a quick grep before proceeding. Run: `grep -n "fenced\|code block\|transcribe" tests/lib/dig/companion-doc.test.ts`

### M4 — `staleness` spec requirement has no explicit plan task

**Spec (Testing table, row 4):** "Adjust/add a test so a `genVersion: 2` section computes `isStale` against `3` (the existing route-stamps-`DIG_GENERATOR_VERSION` test stays green)."

The plan's Task 1, Step 7 says "tsc exit 0; all suites pass (staleness tests reference the imported `DIG_GENERATOR_VERSION`, so the bump is transparent)." This implies the staleness tests already import the constant and automatically pick up the new value — no test change needed. If the staleness tests do `expect(DIG_GENERATOR_VERSION).toBe(2)` that would break, but likely they import the constant and compare `genVersion !== DIG_GENERATOR_VERSION`, so bumping the constant auto-fixes them.

**Action:** Verify the staleness test file imports `DIG_GENERATOR_VERSION` by reference (not hardcoded `2`). Run: `grep -n "genVersion\|DIG_GENERATOR_VERSION\|isStale\|toBe(2)" tests/lib/dig/*.test.ts` before Task 1 Step 3.

**Severity: Medium** — if hardcoded, a hidden test failure will appear at Step 7 instead of Step 2 (wrong TDD ordering: version bump at Step 3 should surface this in Step 5, not Step 7).

---

## LOW

### L1 — Plan cites `lib/dig/generate.ts:67-68` — verify actual line numbers before editing

**Plan step:** Task 1, Step 4

The plan references "Delete the current line 67 entirely" and "Replace the current line 68." The actual line numbers of these rules in the current `lib/dig/generate.ts` are:

- Line 67: `- If the clip shows a command, terminal/CLI, code, or config, transcribe it into a fenced code block inline in your prose — do not screenshot it. Transcribed code is sharper, copyable, and themed.`
- Line 68: `- Emit [[SLIDE:M:SS|caption]] ONLY when a genuine visual…`

Verified against the actual file content above — line numbers 67-68 are correct as of the current file state. **No flaw if no other edits occur first.**

**Note:** If Task 1 Step 1 (test edits) happens to change generate.test.ts line numbers, that does not affect generate.ts. Safe.

### L2 — `[[TS:i]]` syntax in plan Step 4 prompt text — verify not escaped differently than current prompt

**Plan step:** Task 1, Step 4

The plan writes `[[TS:i]]` inline in the prompt text (the unchanged last line: "Use at most 3 [[SLIDE:]] tokens total" and the unchanged TS citation line). The existing test:

```typescript
it('keeps the ≤3 ceiling wording and [[TS:i]] citations', () => {
  expect(p()).toMatch(/at most 3/i);
  expect(p()).toMatch(/\[\[TS:i\]\]/);
});
```

Since the plan says "Line 69 … is unchanged," this test continues to pass. **No flaw.**

### L3 — Plan commit message in Task 2 Step 4 uses `test(dig):` prefix — matches project conventions

Checked against recent git log (`git log --oneline` shows `test(dig): remove dead makeExpandAllMixedHtml fixture`). Prefix matches. Fine.

---

## Summary

| Severity | Count | Items |
|---|---|---|
| Blocking | 0 | — |
| High | 1 | H5 (old "transcribe" test not explicitly deleted — risks contradictory suite) |
| Medium | 3 | M1 (TDD checklist N/A not documented), M3 (companion-doc.test.ts grep needed), M4 (staleness test hardcode check needed) |
| Low | 2 | L1 (line numbers correct, no action needed), L2 (TS:i syntax correct, no action needed) |

## Required actions before implementation

1. **H5 fix:** In Task 1 Step 1, add explicit deletion instruction: "Delete the existing `it('instructs transcribing code/commands into fenced code blocks', ...)` test block (generate.test.ts lines 193-195) before adding the replacement tests."
2. **M3 verify:** Run `grep -n "fenced\|code block\|transcribe" tests/lib/dig/companion-doc.test.ts` before starting Task 1. If any matches, add a sub-task to update those assertions.
3. **M4 verify:** Run `grep -n "genVersion\|DIG_GENERATOR_VERSION\|isStale\|toBe(2)" tests/lib/dig/*.test.ts` before Task 1 Step 3. If hardcoded `2` appears in staleness tests, update those assertions in Step 1 alongside the version test.
