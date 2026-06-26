# Dig-Deeper Slide Selectivity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop dig-deeper from screenshotting text/code/title cards — transcribe code into fenced blocks and screenshot only true graphics — and version-gate existing dug sections so they can be deliberately refreshed.

**Architecture:** Two parts. **Part 1** (going-forward) is a pure prompt rewrite in `buildDigPrompt`; the capture pipeline is already reactive to whatever `[[SLIDE:]]` tokens Gemini emits, so fewer tokens ⇒ fewer captures with no pipeline change. **Part 2** (existing docs) adds a `DIG_GENERATOR_VERSION` + per-section `genVersion`, computes an `isStale` flag at merge time, and renders a deliberate `↻ outdated` refresh control on stale sections (no Gemini call until clicked).

**Tech Stack:** TypeScript, Next.js (App Router) API routes, Gemini REST (clip-grounded), jest + ts-jest, Playwright E2E.

**Spec:** `docs/superpowers/specs/2026-06-25-dig-slide-selectivity-design.md` (adversarial-reviewed; `docs/reviews/spec-dig-slide-selectivity-review.md`).

## Global Constraints

- `DIG_GENERATOR_VERSION = 2` (integer). Bumped when dig generation policy changes. Legacy/absent per-section `genVersion` ⇒ `0` ⇒ stale.
- The refresh control MUST use a **distinct class `.dig-refresh`** — never `.dig-trigger` or `.dig-toggle` — so `nav.ts` click delegation stays unambiguous (toggle ≠ trigger ≠ refresh).
- **No Gemini call fires on page load.** Stale sections show their existing content + a badge; cost only on an explicit click.
- The existing **≤3 slides-per-section ceiling** (`slide-tokens.ts:83`) and `[[TS:i]]` citation behavior are unchanged. Korean (`lang='ko'`) behavior unchanged (code blocks + captions still produced).
- `tsc --noEmit` is the real type gate (jest uses SWC and does not typecheck) — every task ends with a clean `tsc`.
- Line numbers below are from the current branch (`feat/dig-slide-selectivity`, base `c8ccefe`); match the actual code at implementation time — they may shift as earlier tasks edit a file.

---

### Task 1: Prompt rewrite + `DIG_GENERATOR_VERSION` constant

**Files:**
- Modify: `lib/dig/generate.ts` (the `buildDigPrompt` return string, currently the slide bullet at ~`:63`; add the version constant near the top exports)
- Test: **append to the existing** `tests/lib/dig/generate.test.ts` (it already has a `buildDigPrompt` describe ~`:36-53`; the existing `≤3` and `[[SLIDE:` assertions survive the new prompt). Do not create a new file.

**Interfaces:**
- Produces: `export const DIG_GENERATOR_VERSION = 2;` — consumed by Tasks 3 (route stamp) and 4 (dig-merge staleness).
- `buildDigPrompt(lang, startSec, endSec): string` signature unchanged.

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/dig/generate.test.ts
import { buildDigPrompt, DIG_GENERATOR_VERSION } from '@/lib/dig/generate';

describe('DIG_GENERATOR_VERSION', () => {
  it('is the integer 2', () => {
    expect(DIG_GENERATOR_VERSION).toBe(2);
  });
});

describe('buildDigPrompt — slide selectivity', () => {
  const p = () => buildDigPrompt('en', 0, 100);

  it('instructs transcribing code/commands into fenced code blocks', () => {
    expect(p()).toMatch(/transcribe[^.]*code block/i);
  });

  it('restricts [[SLIDE:]] to genuine visuals (diagram/chart/architecture/UI layout)', () => {
    const s = p();
    expect(s).toMatch(/\[\[SLIDE:/);
    expect(s).toMatch(/diagram|chart|architecture|data visualization|layout/i);
  });

  it('states that zero slides is the normal/preferred case', () => {
    expect(p()).toMatch(/most sections.*zero|zero.*normal|none.*preferred/i);
  });

  it('no longer invites a "code screen" screenshot', () => {
    expect(p()).not.toMatch(/code screen/i);
  });

  it('keeps the ≤3 ceiling wording and [[TS:i]] citations', () => {
    expect(p()).toMatch(/at most 3/i);
    expect(p()).toMatch(/\[\[TS:i\]\]/);
  });

  it('produces Korean instruction under lang=ko (unchanged)', () => {
    expect(buildDigPrompt('ko', 0, 100)).toMatch(/한국어/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/lib/dig/generate.test.ts -t "slide selectivity" -v`
Expected: FAIL — `DIG_GENERATOR_VERSION` not exported; "code screen" still present; transcribe/zero-slides wording absent.

- [ ] **Step 3: Implement**

Add the constant near the top of `lib/dig/generate.ts` (after imports, with the other module exports):

```ts
/** Dig generation policy version. Bump when the slide/code policy changes so existing
 *  dug sections become stale and can be deliberately refreshed. */
export const DIG_GENERATOR_VERSION = 2;
```

Replace the single slide bullet in `buildDigPrompt` (currently:
`- When a slide, diagram, chart, or code screen conveys information beyond what is spoken, emit [[SLIDE:M:SS|caption]] ... Use at most 3 [[SLIDE:]] tokens total.`)
with these three bullets (keep the surrounding bullets — task, [[TS:i]] citation, output-markdown-only — exactly as-is):

```
- If the clip shows a command, terminal/CLI, code, or config, transcribe it into a fenced code block inline in your prose — do not screenshot it. Transcribed code is sharper, copyable, and themed.
- Emit [[SLIDE:M:SS|caption]] ONLY when a genuine visual — a diagram, chart, architecture/flow figure, data visualization, or a UI/result screenshot whose spatial layout carries meaning — cannot be conveyed in words. NEVER for title cards, bullet lists, quotes, tips, or a speaker on camera. (example: [[SLIDE:3:51|Diagram showing four capabilities]])
- Most sections need ZERO slides; emitting none is the normal, preferred case. Use at most 3 [[SLIDE:]] tokens total.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/lib/dig/generate.test.ts -v` → PASS. Then `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add lib/dig/generate.ts tests/lib/dig/generate.test.ts
git commit -m "feat(dig): slide-selectivity prompt — transcribe code, screenshot only graphics; +DIG_GENERATOR_VERSION"
```

---

### Task 2: Per-section `genVersion` on `DugSection` (multi-site) + remove dead `digVersion`

**Files:**
- Modify: `lib/dig/companion-doc.ts` (7 enumerated sites below)
- Modify: `tests/api/html-serve.test.ts` (~`:140`, `:223`) and `tests/lib/dig/companion-doc.test.ts` (~`:345`) — fixtures embedding the dead `digVersion: { major: 1, minor: 0 }` literal
- Test: `tests/lib/dig/companion-doc.test.ts` (new round-trip + legacy + default cases)

**Interfaces:**
- Consumes: nothing new.
- Produces: `DugSection.genVersion: number` — consumed by Task 4 (`mergeDigDoc` staleness) and stamped by Task 3 (route). Absent in legacy docs ⇒ defaults to `0`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/lib/dig/companion-doc.test.ts — add to the existing describe block
import { parseDugSections, upsertDugSection } from '@/lib/dig/companion-doc';

it('round-trips genVersion through serialize → parse', async () => {
  // Use the existing temp-dir + upsert harness in this file. Upsert a section with genVersion: 5.
  // (If the file's helper omits genVersion, pass it explicitly in the section literal.)
  // Then re-read via parseDugSections and assert the section's genVersion === 5.
});

it('defaults genVersion to 0 when the frontmatter omits it (legacy doc)', () => {
  const legacy = [
    '---',
    'title: "T"', 'videoId: "v1"', 'language: "en"', 'sourceVideoUrl: "https://y/v1"',
    'digVersion: { major: 1, minor: 0 }',        // legacy doc-level line — must be ignored, not crash
    'sections:',
    '  - sectionId: 0',
    '    startSec: 0',
    '    title: "Intro"',
    '    generatedAt: "2026-01-01T00:00:00.000Z"',
    '---',
    '<!-- DUG:0:START -->',
    '## Intro',
    'body',
    '<!-- DUG:0:END -->',
    '',
  ].join('\n');
  const sections = parseDugSections(legacy);
  expect(sections).toHaveLength(1);
  expect(sections[0].genVersion).toBe(0);
});
```

(Match the DUG sentinel format the file actually uses — copy an existing fixture in `companion-doc.test.ts` and add the `genVersion` assertions. The point is: legacy line ignored, `genVersion` defaults to 0.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/lib/dig/companion-doc.test.ts -v`
Expected: FAIL — `genVersion` is `undefined` (not 0); TypeScript: `genVersion` not on `DugSection` (compile-time only; jest/SWC won't catch, so also run `npx tsc --noEmit` and expect the new test's `.genVersion` access to error until the field exists).

- [ ] **Step 3: Implement — all 7 sites**

1. **Interface** (`DugSection`, `generatedAt` at ~`:35`): add `genVersion: number;` after `generatedAt` (interface ends ~`:36`).
2. **`ParsedFrontmatter.sections` element** (~`:145`): add `genVersion: number` to the inline shape.
3. **`currentSection` Partial** (~`:159`): add `genVersion: number` to the `Partial<{…}>`.
4. **Serialize** (`serializeFrontmatter`, the per-section loop ~`:77-80`): after the `generatedAt` line push `lines.push(\`    genVersion: ${s.genVersion}\`);` (fixed position after `generatedAt` for test determinism).
5. **Parse regex** (after the `generatedAt` **match block** at ~`:200-204` — NOT `:188`, which is the `startSec` regex; order is otherwise free since parse is regex-keyed): add
   ```ts
   const genVersionMatch = line.match(/^\s{4}genVersion\s*:\s*(\d+)/);
   if (genVersionMatch && currentSection) {
     currentSection.genVersion = parseInt(genVersionMatch[1], 10);
     continue;
   }
   ```
6. **Two commit blocks** (list-item commit ~`:176-183` AND trailing-section commit ~`:239-245`): add `genVersion: currentSection.genVersion ?? 0,` to both pushed literals.
7. **`parseDugSections` return literal** (~`:315-323`): add `genVersion: s.genVersion ?? 0,` to the returned `DugSection`.

Then **remove the dead doc-level literal**: delete the `` `digVersion: { major: 1, minor: 0 }` `` line from `serializeFrontmatter` (~`:69`). It is written but never parsed (the scalar switch ignores it), so removal is safe — but it changes serialized output, so update the 3 fixtures.

- [ ] **Step 4: Update real serialize-output assertions (NOT the 3 input fixtures)**

The 3 `digVersion` literals at `tests/api/html-serve.test.ts:140,223` and `tests/lib/dig/companion-doc.test.ts:345` are **input** fixtures fed to the parser (which ignores the line) — they assert rendered-HTML `toContain` / `toEqual([])`, **not** serialized output, so removing the serializer's `digVersion` line does NOT break them and they need no `genVersion`. Leave them (or drop the now-ignored line cosmetically).

The genuine update target is any assertion in `tests/lib/dig/companion-doc.test.ts` that checks the exact `serializeFrontmatter`/`writeCompanionDoc` **output string** (search the file for assertions on serialized frontmatter lines / round-trip equality). Add the new `    genVersion: <n>` line (after `generatedAt`) to those expected strings, and add the new round-trip test from Step 1.

- [ ] **Step 5: Update shared `DugSection` test builders so `tsc` passes (REQUIRED — see review B2)**

Making `genVersion` required means every existing builder that returns a `DugSection` literal without it fails `tsc`. Add an optional `genVersion` param defaulting to `DIG_GENERATOR_VERSION` (import it) to each, so existing call sites stay valid (produce fresh sections) and later tasks can pass an older value for stale:
- `tests/lib/html-doc/dig-merge.test.ts` — `makeDug(sectionId, title, startSec?)` (~`:59`): add a 4th param `genVersion = DIG_GENERATOR_VERSION` and emit it; also fix inline `dugA`/`dugB` literals (~`:514`).
- `tests/lib/html-doc/render-dig-deeper.test.ts` — `makeDugWithBody(...)` (~`:46`): same.
- `tests/e2e/dig-deeper.spec.ts` — the dug fixtures used by `makeCompanionHtmlNoSlides`/`WithSlides`: emit `genVersion` (default current).

(Tasks 4 and 5 call these REAL signatures — e.g. `makeDug(0, 'Intro', 0, DIG_GENERATOR_VERSION - 1)` for a stale section — NOT an invented `dug({...})` helper.)

- [ ] **Step 6: Run tests + tsc**

Run: `npx jest tests/lib/dig/companion-doc.test.ts tests/api/html-serve.test.ts tests/lib/html-doc/dig-merge.test.ts tests/lib/html-doc/render-dig-deeper.test.ts -v` → PASS. `npx tsc --noEmit` → clean (this is the gate that B2 protects — confirm the shared builders compile).

- [ ] **Step 7: Commit**

```bash
git add lib/dig/companion-doc.ts tests/lib/dig/companion-doc.test.ts tests/lib/html-doc/dig-merge.test.ts tests/lib/html-doc/render-dig-deeper.test.ts tests/e2e/dig-deeper.spec.ts
git commit -m "feat(dig): persist per-section genVersion; remove dead doc-level digVersion; +genVersion in test builders"
```

---

### Task 3: Dig route stamps `genVersion`

**Files:**
- Modify: `app/api/videos/[id]/dig/[sectionId]/route.ts` (the `upsertDugSection({ … section: { … } })` literal, ~`:160-166`)
- Test: `tests/api/dig-post.test.ts` — the EXISTING dig-route test. **It mocks `lib/dig/companion-doc` (`jest.mock(...)` ~`:33`) and fs**, so `upsertDugSection` is a `jest.fn()`. Do NOT read the doc from disk; assert on the mock call (mirror the existing happy-path assertion ~`:284-300`).

**Interfaces:**
- Consumes: `DIG_GENERATOR_VERSION` (Task 1), `DugSection.genVersion` (Task 2).

- [ ] **Step 1: Write the failing test (append to `tests/api/dig-post.test.ts`)**

```ts
import { DIG_GENERATOR_VERSION } from '@/lib/dig/generate';
// mockUpsertDugSection is already the mocked companion-doc export in this file.

it('stamps the current DIG_GENERATOR_VERSION on the upserted section', async () => {
  // …reuse the file's existing success-path setup that drives the route to `done`…
  expect(mockUpsertDugSection).toHaveBeenCalledWith(
    expect.objectContaining({
      section: expect.objectContaining({ genVersion: DIG_GENERATOR_VERSION }),
    }),
  );
});
```

- [ ] **Step 2: Run → FAIL** (the route's section literal has no `genVersion`, so the mock is called without it).

- [ ] **Step 3: Implement**

In the `section: { … }` literal passed to `upsertDugSection` (~`:160-166`), add:

```ts
    section: {
      sectionId: sectionIdInt,
      startSec: window.startSec,
      title: section.title,
      bodyMarkdown: finalMd,
      generatedAt: new Date().toISOString(),
      genVersion: DIG_GENERATOR_VERSION,
    },
```

Add the import: `import { DIG_GENERATOR_VERSION } from '../../../../../../lib/dig/generate';` (match the route file's existing relative-import depth to `lib/`).

- [ ] **Step 4: Run → PASS. `npx tsc --noEmit` clean.**

- [ ] **Step 5: Commit**

```bash
git add "app/api/videos/[id]/dig/[sectionId]/route.ts" tests/api/dig-post.test.ts
git commit -m "feat(dig): stamp DIG_GENERATOR_VERSION on freshly dug sections"
```

---

### Task 4: `isStale` on `MergedSection` (both construction sites)

**Files:**
- Modify: `lib/html-doc/dig-merge.ts` (interface `:31`; the two `dug` construction sites `:100` and `:148`; import the version)
- Test: `tests/lib/html-doc/dig-merge.test.ts`

**Interfaces:**
- Consumes: `DIG_GENERATOR_VERSION` (Task 1), `DugSection.genVersion` (Task 2).
- Produces: `MergedSection.isStale: boolean` — consumed by Task 5 (render).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/lib/html-doc/dig-merge.test.ts
import { mergeDigDoc } from '@/lib/html-doc/dig-merge';
import { DIG_GENERATOR_VERSION } from '@/lib/dig/generate';
// Uses the file's REAL builder, now `makeDug(sectionId, title, startSec?, genVersion?)`
// after Task 2's builder update. Reuse the file's existing summary/envelope fixtures.

it('marks a matched section stale when its genVersion < current', () => {
  const { sections } = mergeDigDoc(summaryWithOneSection, envelope, [makeDug(0, 'Intro', 0, DIG_GENERATOR_VERSION - 1)]);
  expect(sections.find((x) => x.dug !== null)!.isStale).toBe(true);
});

it('marks a matched section fresh when genVersion === current', () => {
  const { sections } = mergeDigDoc(summaryWithOneSection, envelope, [makeDug(0, 'Intro', 0, DIG_GENERATOR_VERSION)]);
  expect(sections.find((x) => x.dug !== null)!.isStale).toBe(false);
});

it('treats a zero genVersion as stale (legacy doc)', () => {
  const { sections } = mergeDigDoc(summaryWithOneSection, envelope, [makeDug(0, 'Intro', 0, 0)]);
  expect(sections.find((x) => x.dug !== null)!.isStale).toBe(true);
});

it('non-dug sections are never stale', () => {
  const { sections } = mergeDigDoc(summaryWithOneSection, envelope, []);
  expect(sections.every((x) => x.isStale === false)).toBe(true);
});

// If the title-match path (mutation site, ~:148) is separately reachable via this
// file's fixtures, add one test that exercises it with a stale genVersion too.
```

- [ ] **Step 2: Run → FAIL** (`isStale` undefined / not on type).

- [ ] **Step 3: Implement**

Add to the interface (`:31`): `isStale: boolean;`

Import at top: `import { DIG_GENERATOR_VERSION } from '../dig/generate';`

At **construction site 1** (sectionId match, ~`:100`) — currently `dug_ = { bodyMarkdown: matched.bodyMarkdown };`. The `isStale` is per-section; compute it where the section object is returned. Simplest: capture a local `let isStale_ = false;` initialized with the section, and set it where `dug_` is assigned:
```ts
let dug_: MergedSection['dug'] = null;
let isStale_ = false;
if (startSec !== null) {
  const matched = dugBySectionId.get(startSec);
  if (matched !== undefined && !consumedIds.has(matched.sectionId)) {
    dug_ = { bodyMarkdown: matched.bodyMarkdown };
    isStale_ = matched.genVersion < DIG_GENERATOR_VERSION;
    consumedIds.add(matched.sectionId);
  }
}
// …include `isStale: isStale_` in the returned MergedSection literal.
```

At **construction site 2** (title match, ~`:148`) — this is a **mutation** of an already-built `MergedSection` (`ms.dug = { bodyMarkdown: matched.bodyMarkdown };`), not a literal. Add immediately after:
```ts
ms.isStale = matched.genVersion < DIG_GENERATOR_VERSION;
```

**Note (review M2):** there is exactly **one** `MergedSection` object literal in this file — the `.map` return (~`:105`). It must include `isStale: isStale_`. Site 2 (`:148`) mutates that same object. There is no separate non-dug return literal to update, and the orphan path (`:161-167`) builds plain `{sectionId,title,bodyMarkdown}` objects (not `MergedSection`), so it is unaffected. Because there is a single literal, `tsc` will flag it if `isStale` is missing.

- [ ] **Step 4: Run → PASS. `npx tsc --noEmit` clean** (compiler flags any `MergedSection` literal missing `isStale`).

- [ ] **Step 5: Commit**

```bash
git add lib/html-doc/dig-merge.ts tests/lib/html-doc/dig-merge.test.ts
git commit -m "feat(dig): compute isStale on MergedSection at both merge sites"
```

---

### Task 5: Render `.dig-refresh` control for stale sections

**Files:**
- Modify: `lib/html-doc/render-dig-deeper.ts` (the control block ~`:201-206`; CSS ~`:133-134`)
- Test: `tests/lib/html-doc/render-dig-deeper.test.ts` (build stale/fresh dug fixtures with the real `makeDugWithBody(...)`, now taking `genVersion` after Task 2 — pass `DIG_GENERATOR_VERSION - 1` for stale, `DIG_GENERATOR_VERSION` for fresh)

**Interfaces:**
- Consumes: `MergedSection.isStale` (Task 4).
- Produces: a `.dig-refresh[data-section="<startSec>"]` anchor in the heading of stale dug sections.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/lib/html-doc/render-dig-deeper.test.ts
it('renders a .dig-refresh control on a STALE dug section, keyed on startSec', () => {
  const html = renderDigDeeperDoc({ summary, envelope, dug: [stale dug @ startSec=312], mdPath, videoId });
  expect(html).toMatch(/class="dig-refresh"[^>]*data-section="312"|data-section="312"[^>]*class="dig-refresh"/);
});

it('does NOT render .dig-refresh on a FRESH dug section', () => {
  const html = renderDigDeeperDoc({ summary, envelope, dug: [fresh dug @ startSec=312], mdPath, videoId });
  expect(html).not.toContain('dig-refresh');
  // still has the show-summary toggle:
  expect(html).toContain('dig-toggle');
});

it('uses a class distinct from dig-trigger and dig-toggle for the refresh control', () => {
  const html = renderDigDeeperDoc({ summary, envelope, dug: [stale dug @ 312], mdPath, videoId });
  // the refresh control must not reuse trigger/toggle classes
  expect(html).toMatch(/class="dig-refresh"/);
});
```

(Build `stale`/`fresh` dug fixtures by setting `genVersion` 1 vs `DIG_GENERATOR_VERSION` — the same builders as Task 4. The dug section must match a summary section so it renders dug.)

- [ ] **Step 2: Run → FAIL** (no `dig-refresh` emitted).

- [ ] **Step 3: Implement**

In the control block (~`:201-206`), a dug section currently always renders the toggle (the real line `:203`):
```ts
control = ` <a class="dig-toggle">show summary ⌃</a>`;
```
Append the refresh control when stale. Replace with:
```ts
if (isDug) {
  control = ` <a class="dig-toggle">show summary ⌃</a>`;
  if (ms.isStale && startSec !== null) {
    control += ` <a class="dig-refresh" data-section="${startSec}">↻ outdated</a>`;
  }
} else if (startSec !== null) {
  control = ` <a class="dig-trigger" data-section="${startSec}">dig deeper ▶</a>`;
}
```
(Match the existing `control` variable shape; `startSec`/`isDug`/`ms` are already in scope at this point — see `:186-205`.)

Add CSS (extend the existing muted rule at `:133` so refresh matches toggle styling):
```css
.dg .dig-trigger,.dg .dig-toggle,.dg .dig-refresh{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--meta);font-size:.8rem;font-weight:400;text-decoration:none;white-space:nowrap;cursor:pointer}
.dg .dig-trigger:hover,.dg .dig-toggle:hover,.dg .dig-refresh:hover{text-decoration:underline}
```

- [ ] **Step 4: Run → PASS. Full render test file green. `npx tsc --noEmit` clean.**

- [ ] **Step 5: Commit**

```bash
git add lib/html-doc/render-dig-deeper.ts tests/lib/html-doc/render-dig-deeper.test.ts
git commit -m "feat(dig): render ↻ outdated .dig-refresh control on stale sections"
```

---

### Task 6: `nav.ts` click delegation — `.dig-refresh` branch

**Files:**
- Modify: `lib/html-doc/nav.ts` (the `_dg` click delegation ~`:318-329`)
- Test: `tests/e2e/dig-deeper.spec.ts`

**Interfaces:**
- Consumes: the `.dig-refresh[data-section]` control (Task 5) and the existing `_startDocDig(trigger)` function (`:252`), which expects an element with `data-section`.

- [ ] **Step 1: Write the failing E2E tests**

```ts
// tests/e2e/dig-deeper.spec.ts — fixtures: a doc with one STALE dug section (genVersion=1).
test('clicking ↻ outdated re-digs the section and the badge is gone after the swap', async ({ page }) => {
  // CRITICAL (review H1): the swap is `fetch(location.href)` → the /api/html route, NOT the
  // POST/SSE. The default stubHtmlRoutes returns FIXED stale HTML, so the re-GET would still
  // contain .dig-refresh and this test would fail. Two stubs are required:
  //   1. stub the dig POST → SSE to `done` (reuse the file's existing POST/SSE stub helper);
  //   2. re-route **/api/html/<videoId>** to FRESH companion HTML (genVersion=current, no
  //      .dig-refresh) BEFORE the click. Playwright applies the most-recently-registered
  //      matching route first (LIFO), so this overrides the initial stale stub for the swap.
  await page.goto(digDocUrlForStaleFixture);
  await expect(page.locator('.dig-refresh')).toHaveCount(1);
  await page.route('**/api/html/**', (route) => route.fulfill({ contentType: 'text/html', body: freshCompanionHtml }));
  await page.locator('.dig-refresh').click();
  // POST→SSE done → re-GET swap returns FRESH html → section has no badge:
  await expect(page.locator('.dig-refresh')).toHaveCount(0);
});

test('opening a doc with stale sections fires NO dig POST until a click', async ({ page }) => {
  let posted = false;
  await page.route('**/dig/**', (route) => { posted = true; route.continue(); });
  await page.goto(digDocUrlForStaleFixture);
  await page.waitForTimeout(300);
  expect(posted).toBe(false);
});
```

- [ ] **Step 2: Run → FAIL** (clicking `.dig-refresh` does nothing; no delegation branch).

Run: `npx playwright test --grep "outdated|NO dig POST"`

- [ ] **Step 3: Implement**

In the `_dg.addEventListener('click', …)` delegation (~`:318-329`), which currently handles `.dig-toggle` and `.dig-trigger[data-section]`, add a `.dig-refresh` branch BEFORE the trigger branch (so a refresh click is never mistaken for anything else):
```js
var refresh=(e.target.closest?e.target.closest('.dig-refresh[data-section]'):null);
if(refresh){e.preventDefault();_startDocDig(refresh);return;}
```
`_startDocDig` reads `data-section` and runs the existing POST→SSE→re-GET-swap path. The `?dig` already-dug guard (`:363-366`) gates only the URL auto-trigger, so it does not block this explicit click. The badge clears because the swap re-GETs `location.href` → server re-renders with `genVersion=current` → `isStale=false` → no `.dig-refresh` in the swapped section (relies on upsert-before-`done`, route `:154`/`:174`).

- [ ] **Step 4: Run → PASS.** `npx playwright test --grep "dig-deeper"` green; `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add lib/html-doc/nav.ts tests/e2e/dig-deeper.spec.ts
git commit -m "feat(dig): wire .dig-refresh click → deliberate re-dig (badge clears on swap)"
```

---

### Task 7: Refresh-all — include `.dig-refresh` in expand-all (separate task, spec H1)

**Files:**
- Modify: `lib/html-doc/nav.ts` (`_eaRunBatch` remaining-selector `:273`; the click-handler `triggers` selector `:297`; the cost/count math `:300-302`)
- Test: `tests/e2e/dig-deeper.spec.ts`

**Interfaces:**
- Consumes: `.dig-refresh[data-section]` controls (Task 5) + the existing batch loop.

- [ ] **Step 1: Write the failing E2E test**

```ts
test('expand-all (⤢) also refreshes STALE dug sections', async ({ page }) => {
  // fixture: 1 un-dug section (.dig-trigger) + 1 stale dug section (.dig-refresh).
  // stub dig POST→SSE for both.
  await page.goto(digDocUrlMixedFixture);
  // confirm dialog → accept; assert the cost count includes the stale section (2, not 1).
  page.on('dialog', (d) => { expect(d.message()).toMatch(/2 section/i); d.accept(); });
  await page.locator('[aria-label*="expand all"], text=⤢').first().click();
  // after batch: both controls resolved — no .dig-trigger and no .dig-refresh remain.
  await expect(page.locator('.dig-trigger, .dig-refresh')).toHaveCount(0);
});
```

- [ ] **Step 2: Run → FAIL** (expand-all selects `.dig-trigger` only; stale section ignored; count is 1).

- [ ] **Step 3: Implement**

Change all three `.dig-trigger[data-section]` selectors in the expand-all path to include refresh:
- `_eaRunBatch` remaining (`:273`): `document.querySelectorAll('.dig-trigger[data-section], .dig-refresh[data-section]')`
- click-handler `triggers` (`:297`): same union selector.
- count/cost (`:300-302`, `N*0.05` cost, `N*30/60` time): `N` is derived from the same `triggers` list, so it now counts stale sections automatically — verify the `N` it reads is the union-selector length, not a separate `.dig-trigger` query.

A refreshed section disappears from the DOM on swap (no `.dig-trigger`/`.dig-refresh`), so the `_next` loop's "filter out resolved" logic drops it naturally — confirm no separate `.dig-trigger`-only re-query exists in `_next`.

- [ ] **Step 4: Run → PASS.** Full `npx playwright test --grep "dig-deeper"` green; `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add lib/html-doc/nav.ts tests/e2e/dig-deeper.spec.ts
git commit -m "feat(dig): expand-all also refreshes stale sections (.dig-refresh)"
```

---

## Self-Review

**Spec coverage:** §3 prompt → Task 1. §4.1 version constant → Task 1. §4.2 per-section genVersion (all 7 sites + dead literal + 3 fixtures) → Task 2. route stamp (§5 row) → Task 3. §4.3 isStale at both sites → Task 4. §4.4 refresh control + distinct class → Task 5; click wiring + badge-clears-on-swap → Task 6. §4.5 refresh-all (H1) → Task 7. §4.6 fresh sections unchanged → covered by Task 5 "fresh does not emit" test. Edge cases #1–8 → covered across Tasks 2 (legacy/default), 4 (stale/fresh/missing), 5 (zero slides is just prose), 6 (no POST on load), Task 1 ko.

**Placeholder scan:** Test bodies that reuse an existing file's harness say so explicitly (e.g. "reuse the file's success-path setup", "same builders as Task 4") rather than inventing a parallel harness — acceptable because those harnesses already exist. All implementation steps show concrete code.

**Type consistency:** `DIG_GENERATOR_VERSION: number` (Task 1) consumed identically in 3, 4. `DugSection.genVersion: number` (Task 2) read in 4, stamped in 3. `MergedSection.isStale: boolean` (Task 4) read in 5. `.dig-refresh[data-section]` class+attr identical across 5/6/7. `_startDocDig(trigger)` signature unchanged.

**Ordering:** 1→2→3 build the data; 4 reads it; 5 renders; 6 wires per-section; 7 extends batch. No task references a later task's symbol.

## Execution Handoff

Execute via **superpowers:subagent-driven-development** (project default — `docs/dev-process.md`): fresh subagent per task, Claude + adversarial review between tasks. **Post-Plan Gate first** (`docs/dev-process.md`): run a Codex (or Claude-fallback) adversarial review of THIS plan, save to `docs/reviews/plan-dig-slide-selectivity-*.md`, address Blocking/High, get explicit user approval before dispatching Task 1.
