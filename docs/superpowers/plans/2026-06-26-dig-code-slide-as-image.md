# Dig Code/Config Slides as Images — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flip the dig-deeper policy so code/config/terminal slides are shown as captured screenshots (via `[[SLIDE:]]`) instead of transcribed fenced code blocks.

**Architecture:** The change is confined to the generation prompt and version constant in `lib/dig/generate.ts`. The slide-capture pipeline (`slides.ts`), token parser (`slide-tokens.ts`), companion storage, and renderer already handle images — no change. Existing PR #28 staleness UI (`↻ outdated`) drives lazy re-dig of v2 sections after the version bump.

**Tech Stack:** TypeScript, Next.js (App Router), jest + ts-jest/SWC, Gemini REST.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-26-dig-code-slide-as-image-design.md`.
- `tsc --noEmit` must stay clean (jest uses SWC and does NOT typecheck — `tsc` is the real gate).
- Captions must never contain `[`, `]`, `(`, `)`, or `|` — `sanitizeCaption` strips them and `|`/`]` are `[[SLIDE:sec|caption]]` token delimiters.
- The ≤3 `[[SLIDE:]]` per-section cap is parser-enforced at `lib/dig/slide-tokens.ts:83`; do not weaken it.
- Policy is enforced by prompt wording only (Gemini is probabilistic); CI verifies the prompt text, manual re-dig verifies real behavior.

---

### Task 1: Flip prompt policy + caption constraint + version bump

**Files:**
- Modify: `lib/dig/generate.ts:13` (version constant) and `lib/dig/generate.ts:67-68` (prompt rules)
- Test: `tests/lib/dig/generate.test.ts:186-209` (version + slide-selectivity blocks)

**Interfaces:**
- Consumes: nothing new.
- Produces: `DIG_GENERATOR_VERSION = 3` (number, already exported); `buildDigPrompt(lang, startSec, endSec): string` (signature unchanged — only its returned text changes).

- [ ] **Step 1: Update the failing tests (RED) in `tests/lib/dig/generate.test.ts`**

Replace the `DIG_GENERATOR_VERSION` block (currently asserting `2`) and the `transcribe`/selectivity assertions. The exact current block:

```typescript
describe('DIG_GENERATOR_VERSION', () => {
  it('is the integer 2', () => {
    expect(DIG_GENERATOR_VERSION).toBe(2);
  });
});
```

becomes:

```typescript
describe('DIG_GENERATOR_VERSION', () => {
  it('is the integer 3', () => {
    expect(DIG_GENERATOR_VERSION).toBe(3);
  });
});
```

Then, in the `describe('buildDigPrompt — slide selectivity', ...)` block, **DELETE the entire existing transcribe test block at `tests/lib/dig/generate.test.ts:197-198`** (do not leave it — an appended negative assertion alongside the old positive one would leave the suite permanently red, review H5):

```typescript
  it('instructs transcribing code/commands into fenced code blocks', () => {
    expect(p()).toMatch(/transcribe[^.]*code block/i);
  });
```

and in its place add these tests:

```typescript
  it('no longer instructs transcribing code into fenced code blocks', () => {
    expect(p()).not.toMatch(/transcribe[^.]*code block/i);
  });

  it('lists code/command/terminal/config among [[SLIDE:]] triggers', () => {
    const s = p();
    expect(s).toMatch(/\[\[SLIDE:/);
    expect(s).toMatch(/\bcode\b/i);
    expect(s).toMatch(/\bcommand\b/i);
    expect(s).toMatch(/\bterminal\b|\bCLI\b/i);
    expect(s).toMatch(/\bconfig\b/i);
  });

  it('forbids [ ] ( ) and | characters in slide captions', () => {
    expect(p()).toMatch(/caption[\s\S]*MUST NOT contain/i);
  });

  it('forbids inventing a slide for code that is only spoken', () => {
    expect(p()).toMatch(/only when[\s\S]*shown|actually shown/i);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest dig/generate`
Expected: FAIL — `is the integer 3` (got 2), `no longer instructs transcribing…` (prompt still has it), and the new SLIDE/caption assertions fail.

- [ ] **Step 3: Bump the version constant (`lib/dig/generate.ts:13`)**

```typescript
export const DIG_GENERATOR_VERSION = 3;
```

- [ ] **Step 4: Rewrite the two prompt rules (`lib/dig/generate.ts:67-68`)**

Delete the current line 67 entirely:

```
- If the clip shows a command, terminal/CLI, code, or config, transcribe it into a fenced code block inline in your prose — do not screenshot it. Transcribed code is sharper, copyable, and themed.
```

Replace the current line 68:

```
- Emit [[SLIDE:M:SS|caption]] ONLY when a genuine visual — a diagram, chart, architecture/flow figure, data visualization, or a UI/result screenshot whose spatial layout carries meaning — cannot be conveyed in words. NEVER for title cards, bullet lists, quotes, tips, or a speaker on camera. (example: [[SLIDE:3:51|Diagram showing four capabilities]])
```

with:

```
- Emit [[SLIDE:M:SS|caption]] when an on-screen visual carries meaning words alone cannot fully convey — a diagram, chart, architecture/flow figure, data visualization, a UI/result screenshot whose spatial layout matters, OR a slide showing code, a command, terminal/CLI output, or config whose on-screen text is the point. Emit it ONLY when that content is actually shown on screen — do NOT transcribe code into a fenced block, and do NOT invent a slide for code that is merely spoken. NEVER for title cards, bullet lists, quotes, tips, or a speaker on camera.
- The caption is a short plain-English description of the slide. It MUST NOT contain the characters [ ] ( ) or | — describe the slide in words; never paste raw code, YAML, or shell into the caption. (example: [[SLIDE:3:51|Diagram showing four capabilities]])
```

(Line 69 — the "Most sections need ZERO slides … at most 3" rule — is unchanged.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest dig/generate`
Expected: PASS — all selectivity + version assertions green.

- [ ] **Step 6: Verify no other prompt tests regressed**

Run: `npx jest dig/generate` and confirm the existing `restricts [[SLIDE:]] to genuine visuals`, `states that zero slides is the normal/preferred case`, and `no longer invites a "code screen" screenshot` tests still pass (the new wording keeps the `diagram|chart|architecture` keywords, omits the literal phrase `code screen`, and retains the ZERO-slides sentence).

- [ ] **Step 7: Typecheck + full suite**

Run: `npx tsc --noEmit && npx jest`
Expected: tsc exit 0; all suites pass (staleness tests reference the imported `DIG_GENERATOR_VERSION`, so the bump is transparent).

- [ ] **Step 8: Commit**

```bash
git add lib/dig/generate.ts tests/lib/dig/generate.test.ts
git commit -m "feat(dig): code/config slides → screenshot, not transcribed fence (v3)"
```

---

### Task 2: Explicit shared ≤3 slide-budget coverage (review M2)

**Files:**
- Test: `tests/lib/dig/slide-tokens.test.ts`

**Interfaces:**
- Consumes: `parseSlideTokens(markdown, startSec, endSec)` (existing) — returns `SlideToken[]`, capped at 3 unique seconds in document order (`lib/dig/slide-tokens.ts:83`).
- Produces: nothing (test-only).

> **TDD note (review M1):** this task is a **regression guard** for already-shipped behavior, not new logic. The standard RED phase is **N/A** — the test passes immediately (Step 3). In the per-task checklist, mark the "Write failing tests (RED)" step **Skipped** with rationale "documents existing parser cap; no new code." If it fails RED, the cap regressed — stop and investigate.
>
> **Pre-flight (reviews M3/M4) — already verified, no sub-tasks needed:** `tests/lib/dig/companion-doc.test.ts` has zero `fenced`/`code block`/`transcribe` references; the only version-related `toBe(2)` is `generate.test.ts:188` (flipped in Task 1). All staleness tests reference the imported `DIG_GENERATOR_VERSION`, so the bump is transparent.

- [ ] **Step 1: Check whether a ≤3 cap test already exists**

Run: `grep -n "toHaveLength(3)\|at most 3\|cap" tests/lib/dig/slide-tokens.test.ts`
If a test already asserts the 3-token cap with a >3 input, mark this task complete and skip to its commit (note "already covered"). Otherwise continue.

- [ ] **Step 2: Add the failing cap test (RED)**

Append to `tests/lib/dig/slide-tokens.test.ts` (adjust the import line to match the file's existing `parseSlideTokens` import):

```typescript
// ── Shared budget: a mix of code + diagram slides is capped at 3 ──────────────
test('caps at 3 tokens when more than 3 distinct slides are emitted', () => {
  const md = [
    '[[SLIDE:10|Diagram one]]',
    '[[SLIDE:20|Code config slide]]',
    '[[SLIDE:30|Diagram two]]',
    '[[SLIDE:40|Terminal output]]',
    '[[SLIDE:50|Architecture]]',
  ].join('\n');
  const tokens = parseSlideTokens(md, 0, 100);
  expect(tokens).toHaveLength(3);
  expect(tokens.map((t) => t.sec)).toEqual([10, 20, 30]); // first 3, document order
});
```

- [ ] **Step 3: Run to verify it passes immediately (cap already enforced)**

Run: `npx jest dig/slide-tokens`
Expected: PASS (this documents existing parser behavior; it is a coverage/regression guard, not new logic). If it FAILS, the cap regressed — stop and investigate before proceeding.

- [ ] **Step 4: Commit**

```bash
git add tests/lib/dig/slide-tokens.test.ts
git commit -m "test(dig): assert shared ≤3 slide-budget cap across mixed slide types"
```

---

## Self-Review

**Spec coverage:**
- Policy flip (code/config → slide, no transcribe, no fabrication, exclusions): Task 1 Step 4 ✓
- Caption character constraint (H2): Task 1 Steps 1, 4 ✓
- Version bump 2→3 + migration via staleness UI (L1, transparent staleness tests): Task 1 Steps 3, 7 ✓
- Shared ≤3 budget (M2): Task 2 ✓
- Capture-failure / spoken-code / prose-only (M1, M3, L3): behavioral, enforced by prompt wording (Task 1 Step 4) + existing `slides.ts` strip logic; no new code, covered by spec edge-case table. Behaviors #9/#10 are prompt-wording + existing-pipeline, asserted via Task 1's "only when shown" test.
- Manual acceptance (re-dig OKF, L2): verification phase, not a code task.

**Placeholder scan:** none — all steps show real code/commands.

**Type consistency:** `DIG_GENERATOR_VERSION` (number), `buildDigPrompt(lang, startSec, endSec)`, `parseSlideTokens(markdown, startSec, endSec)` used consistently with their real signatures.
