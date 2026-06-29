# Dig Section Sub-Headings Implementation Plan (PR 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Have Gemini structure long dug-section prose with `###` sub-headings so the elaboration reads as labeled subsections, and style those sub-headings as distinct in-prose sub-headings.

**Architecture:** Two changes. (1) Generation: add a length-conditional `###` sub-heading instruction to the dig prompt (`lib/dig/generate.ts`) and bump `DIG_GENERATOR_VERSION` 8→9 (existing dug sections show the existing "↻ outdated" badge → lazy on-demand re-dig). (2) Render: a distinct `.dg .dug h3` CSS rule, plus wrap orphan dug bodies in `.dug` so their sub-headings get the same treatment.

**Tech Stack:** TypeScript, Next.js, markdown-it, Jest+ts-jest.

**Spec:** `docs/superpowers/specs/2026-06-29-dig-doc-readability-design.md` (Part B)

## Global Constraints

- **Generation change:** Task 1 bumps `DIG_GENERATOR_VERSION` 8→9. Existing dug sections across all 3 playlists become stale (show the existing "↻ outdated" badge, `render-dig-deeper.ts`/`dig-merge.ts`). **Lazy on-demand re-dig** — NO bulk job, no serve-route version check (matches the established pattern). Captions (PR 1, merged) are unaffected.
- **`###` ONLY** — never `#`/`##` (those collide with the `<h2>` section title). Sub-headings are length-conditional (long sections only; short sections get none).
- **Same language as the response** — the prompt already mandates the ENTIRE response in Korean when `lang==='ko'` (`generate.ts:57-60`). The sub-heading instruction MUST say "same language as the response", NOT "English" (a Korean doc gets Korean sub-headings). Do NOT repeat the pre-existing "plain-English" wording the slide-caption bullet uses.
- **No new dependency.** No `DugSection` schema/frontmatter change (only `bodyMarkdown` *content* gains `###` on re-dig; still valid markdown; the sentinel-comment wrapper in `companion-doc.ts` is unchanged).
- **Render distinctness:** `.dg .dug h3` (specificity 0,2,1) overrides the generic `.dg h3` (0,1,1) regardless of source order.
- **Tests under `tests/`**: `tests/lib/dig/generate.test.ts`, `tests/lib/html-doc/render-dig-deeper.test.ts`.

---

## Task 1: Prompt sub-heading instruction + version bump (generate.ts)

**Files:**
- Modify: `lib/dig/generate.ts` (`DIG_GENERATOR_VERSION` :13; the version-history comment ~:47; `buildDigPrompt` prompt body, add a bullet before the "Output markdown only" line :75)
- Test: `tests/lib/dig/generate.test.ts`

**Interfaces:**
- Consumes: existing `buildDigPrompt(lang, startSec, endSec)` and `DIG_GENERATOR_VERSION`.
- Produces: a prompt that instructs length-conditional `###` sub-headings in the response language; `DIG_GENERATOR_VERSION === 9`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/lib/dig/generate.test.ts`:

```ts
describe('buildDigPrompt — section sub-headings (PR2)', () => {
  it('instructs length-conditional ### sub-headings', () => {
    const p = buildDigPrompt('en', 0, 300);
    expect(p).toMatch(/###/);
    expect(p).toMatch(/sub-heading/i);
    expect(p).toMatch(/long/i);                 // length-conditional
  });

  it('restricts sub-headings to ### only (never # or ##)', () => {
    const p = buildDigPrompt('en', 0, 300);
    expect(p).toMatch(/never `#` or `##`|`###` ONLY|only `###`/i);
  });

  it('requires sub-headings in the SAME language as the response, not English (Korean-safe)', () => {
    const p = buildDigPrompt('en', 0, 300);
    expect(p).toMatch(/same language as (the rest of )?your response/i);
    expect(p).toContain('do NOT switch to English');   // exact Korean-safety anchor (Codex Low)
    // Must NOT force English for the sub-heading text (would break the lang=ko contract).
    expect(p).not.toMatch(/sub-headings? (in|must be in) english/i);
  });

  it('still mandates Korean output overall under lang=ko (unchanged)', () => {
    expect(buildDigPrompt('ko', 0, 300)).toMatch(/한국어/);
  });
});
```

And update the existing version test (currently `it('is the integer 8', …)` in the `DIG_GENERATOR_VERSION` describe block, ~:190-191):

```ts
  it('is the integer 9', () => {
    expect(DIG_GENERATOR_VERSION).toBe(9);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/lib/dig/generate.test.ts`
Expected: FAIL — no sub-heading instruction yet; version is still 8.

- [ ] **Step 3: Add the sub-heading bullet to the prompt**

In `buildDigPrompt` (`lib/dig/generate.ts`), insert this bullet immediately BEFORE the final `- Output markdown only — no preamble, no headings for the section title, no meta-commentary.` line:

```ts
- For a LONG elaboration, structure the prose with short \`###\` sub-headings (e.g. "How it works", "Where it breaks down", "What to use instead") that group it into labeled subsections. Use \`###\` ONLY — never \`#\` or \`##\` (the section title is rendered separately). Keep each sub-heading short, plain, and descriptive, in the SAME language as the rest of your response (do NOT switch to English), with no markdown, code, or the characters [ ] ( ) |. Add sub-headings ONLY when the section is long enough to benefit — a short one-or-two-paragraph section needs none. Sub-headings group THIS section's elaboration; they do not restate the section title or the summary's bullet points.
```

(Note the escaped backticks `\`###\`` inside the template literal.)

- [ ] **Step 4: Bump the version + update the history comment**

`lib/dig/generate.ts:13`: `export const DIG_GENERATOR_VERSION = 8;` → `export const DIG_GENERATOR_VERSION = 9;`

Update the version-history comment (~:47, which documents the v8 change) by appending a v9 line, e.g.:
```ts
 * Note: v9 adds length-conditional ### sub-headings to long sections (re-dig to apply).
```
(Keep the existing v8 note; just add the v9 line in the same comment block.)

- [ ] **Step 5: Run the tests + typecheck**

Run: `npx jest tests/lib/dig/generate.test.ts`
Expected: PASS (new sub-heading tests + version is 9).
Run the **version blast-radius suites** (Codex M1 — these import `DIG_GENERATOR_VERSION` and exercise staleness/route-stamping/companion-doc paths):
`npx jest render-dig-deeper tests/lib/html-doc/dig-merge.test.ts tests/api/dig-post.test.ts tests/lib/dig/companion-doc.test.ts`
Expected: PASS — these compute stale/fresh relative to the constant (`DIG_GENERATOR_VERSION - 1`, etc.) and stamp with the imported constant, so they auto-track the bump. The ONLY test asserting a literal version is `generate.test.ts` (updated to 9 in Step 1); confirm no other suite asserts a literal `8`.
Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add lib/dig/generate.ts tests/lib/dig/generate.test.ts
git commit -m "feat(dig): prompt length-conditional ### sub-headings (same-language); DIG_GENERATOR_VERSION 8→9"
```

---

## Task 2: Render distinct in-prose sub-headings + orphan-body coverage (render-dig-deeper.ts)

**Files:**
- Modify: `lib/html-doc/render-dig-deeper.ts` (`DIG_DOC_CSS` — add `.dg .dug h3`; orphan rendering ~:316-317 — wrap orphan body in `.dug`)
- Test: `tests/lib/html-doc/render-dig-deeper.test.ts`

**Interfaces:**
- Consumes: the merge renderer; markdown-it renders `###` → `<h3>` inside `.dug`.
- Produces: a distinct `.dg .dug h3` style; orphan rendered bodies wrapped in `<div class="dug">` so their `###` sub-headings get the same style.

- [ ] **Step 1: Write the failing tests**

Add to `tests/lib/html-doc/render-dig-deeper.test.ts` (reuse the file's existing `makeDugWithBody` / render helpers; mirror an existing render test's setup):

```ts
describe('dig section sub-headings (PR2 render)', () => {
  it('emits a distinct .dg .dug h3 sub-heading rule', () => {
    // render any doc; assert the CSS rule is present with its distinct properties
    const html = renderDocWith(makeDugWithBody(312, '### How it works\n\nBody.'));
    expect(html).toMatch(/\.dg \.dug h3\{[^}]*font-weight:700/);
    // ONE structural assertion (Codex M2) — proves the h3 is INSIDE .dug, not merely both-present:
    expect(html).toMatch(/<div class="dug">[\s\S]*<h3>How it works<\/h3>/);
  });

  it('wraps orphan dug bodies in .dug so their ### sub-headings are covered', () => {
    // build an orphan (a dug section whose startSec matches no summary section)
    const html = renderDocWithOrphan(makeDugWithBody(99999, '### Orphan sub\n\nBody.'));
    // orphan body rendered inside a .dug wrapper (so .dg .dug h3 applies)
    expect(html).toMatch(/<div class="dug">[\s\S]*<h3>Orphan sub<\/h3>/);
  });
});
```

NOTE for the implementer: use the helpers/fixtures already in `render-dig-deeper.test.ts` (it has `makeDugWithBody` at :47 and existing render-invocation patterns + an orphan-rendering test). Match an existing test's exact `renderDigDeeperDoc({...})` call shape rather than inventing `renderDocWith`/`renderDocWithOrphan` — those names are illustrative; wire them to the real helper. For the orphan case, use a `dug` section whose `startSec`/`sectionId` does NOT match any summary section so it lands in the orphan region (see the file's existing orphan test for the exact fixture).

- [ ] **Step 2: Run to verify failure**

Run: `npx jest render-dig-deeper`
Expected: FAIL — no `.dg .dug h3` rule; orphan body not wrapped in `.dug`.

- [ ] **Step 3: Add the distinct sub-heading CSS**

In `DIG_DOC_CSS`, add after the existing `.dg h3` rule (`:39`):

```css
.dg .dug h3{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:.95rem;font-weight:700;letter-spacing:.02em;margin:1.8em 0 .4em;color:var(--ink)}
```

(Specificity 0,2,1 beats the generic `.dg h3` at 0,1,1, so the in-prose sub-headings render as a bold sans-serif label — clearly sub-level vs the serif `<h2>` section title — regardless of source order.)

- [ ] **Step 4: Wrap orphan rendered bodies in `.dug`**

In the orphan rendering (`render-dig-deeper.ts` ~:316-317), the orphan currently emits `<h3>${esc(o.title)}</h3>` then the rendered body directly. Wrap ONLY the rendered body in `.dug` (the orphan TITLE h3 stays outside `.dug` — it is the orphan's title, not an in-prose sub-heading):

```ts
        `<h3>${esc(o.title)}</h3>`,
        `<div class="dug">${rendered}</div>`,
        `<p class="dg-orphan-note">…unchanged…</p>`,
```
(Only the `rendered` line changes — from `rendered` to `\`<div class="dug">${rendered}</div>\``. Keep the title h3 and the note exactly as they are.)

- [ ] **Step 5: Run tests + full suite + typecheck**

Run: `npx jest render-dig-deeper`
Expected: PASS (new sub-heading + orphan tests; existing tests still green — wrapping orphan body in `.dug` is additive; confirm no existing orphan test asserts the body is NOT inside `.dug`).
Run: `npm test`
Expected: green (pdf.test.ts may flake under parallel load — confirm in isolation if it fails).
Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add lib/html-doc/render-dig-deeper.ts tests/lib/html-doc/render-dig-deeper.test.ts
git commit -m "feat(dig): distinct .dug h3 in-prose sub-heading style; wrap orphan bodies in .dug"
```

---

## Self-Review

**Spec coverage (Part B):** B1 prompt `###`-only, length-conditional, same-language (Task 1 Step 3) ✓; B2 version bump 8→9 + lazy re-dig (Task 1 Step 4; no bulk job, no serve-route check — established pattern) ✓; B3 `.dug h3` styling + orphan-body coverage M3 (Task 2 Steps 3-4) ✓; B4 prompt-contract tests + version test + `.dug h3`/orphan render tests (both tasks) ✓.

**Placeholder scan:** no TBD/TODO; full code/text in every step. The Task 2 test helper names (`renderDocWith`/`renderDocWithOrphan`) are explicitly flagged as illustrative — the implementer wires them to the real `makeDugWithBody` + `renderDigDeeperDoc` helpers already in the file.

**Type consistency:** `DIG_GENERATOR_VERSION` (now 9) consumed by generate.test + render tests (which compute relative to it); CSS selector `.dg .dug h3`; orphan wrapper class `.dug` matches the section dug wrapper class.

**Korean-safety:** the sub-heading instruction says "same language as the rest of your response" and the test asserts it does NOT force English — directly addressing the spec's H3 finding.

**Version policy:** Task 1 bumps 8→9 (generation change). Existing docs go stale → lazy re-dig. Captions (PR 1) unaffected.
