# Dig-Slide Image-Size Control — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A reader-facing top-bar control that uniformly scales all in-flow dig-deeper slide images 50–150%, persisted across docs via localStorage, with no flash-at-wrong-size and no print bleed.

**Architecture:** One CSS custom property `--dig-slide-scale` (default `1`) consumed by both slide sizing rules. A pre-paint head script sets it from sanitized localStorage (no FOUC); a body-end script syncs the control and wires events; a `@media print` override keeps print at base size. Pure additions to the live-rendered `render-dig-deeper.ts` — no new dependency, no version bump.

**Tech Stack:** TypeScript, Next.js, vanilla JS (no React on the served doc), Jest+ts-jest, Playwright.

**Design spec:** `docs/superpowers/specs/2026-06-29-dig-slide-size-control-design.md`
**Adversarial review (addressed):** `docs/reviews/spec-dig-slide-size-control-codex.md`

## Global Constraints

- **DEPENDS ON PR #41 (auto-crop) being merged to master.** This plan modifies the `.dg img.dig-slide` (post-#41: `max-height:300px`) and `.dg figure.dig-slide-crop` (post-#41: `width:min(100%,540px)`) rules and the `.dg-topbar`, all introduced/finalized by #41. **Before Task 1: rebase this branch onto the post-#41 master** so those rules exist. Locate code by content (the rules, `topBar`, the head/body script assembly), not by the line numbers below (which are approximate for the post-#41 file).
- **No new npm dependency.** Vanilla JS only.
- **Render-only.** No `DIG_GENERATOR_VERSION`/doc-version bump, no re-dig. The dig-deeper route live-renders per GET (`route.ts` → `serveHtml(renderDigDeeperDoc(...))`), so changes reach all docs on next load.
- **Locked values:** range `50–150`, step `10`, default `100`; CSS var = percent/100; localStorage key `digSlideScale`.
- **Sanitizer — define ONCE, interpolate into both scripts (PM1); the null/'' guard is mandatory and FIRST (PB1):**
  ```ts
  const DIG_SLIDE_SANITIZE_JS = "function s(raw){if(raw==null||raw===''){return 100;}var n=Number(raw);if(!Number.isFinite(n)){return 100;}n=Math.round(n/10)*10;return Math.min(150,Math.max(50,n));}";
  ```
  `Number(null)===0`/`Number('')===0` would snap to 50, so missing/empty MUST short-circuit to 100 before `Number()`. `Number` (not `parseInt`) so `"120px"`/NaN/Infinity → 100; else snap-to-10, clamp [50,150]. Both `SIZE_HEAD_SCRIPT` and `sizeScript` embed `${DIG_SLIDE_SANITIZE_JS}` and call `s(...)`.
- **Fail-safe:** all localStorage access in try/catch; CSS `var(--dig-slide-scale,1)` fallback renders at 100% if JS never runs.
- **Tests under `tests/`** (Jest `testMatch`): unit at `tests/lib/html-doc/`, E2E at `tests/e2e/`.

---

### Task 1: CSS scale variable + control markup + head/body scripts (render-dig-deeper.ts)

**Files:**
- Modify: `lib/html-doc/render-dig-deeper.ts` (`DIG_DOC_CSS`; `topBar`; add `SIZE_HEAD_SCRIPT` + inject in `<head>`; add `sizeScript` + inject in body)
- Test: `tests/lib/html-doc/render-dig-deeper.size.test.ts`

**Interfaces:**
- Consumes: the post-#41 `renderDigDeeperDoc(args)` (cropMap optional) and its `DIG_DOC_CSS`, `topBar`, head/body assembly.
- Produces: rendered HTML carrying the `--dig-slide-scale` rules, the `.dg-size` control, a pre-paint head script, and a body `sizeScript`.

- [ ] **Step 1: Write the failing unit/DOM tests**

```ts
// tests/lib/html-doc/render-dig-deeper.size.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderDigDeeperDoc } from '@/lib/html-doc/render-dig-deeper';
import type { ParsedSummary } from '@/lib/html-doc/types';
import type { DugSection } from '@/lib/dig/companion-doc';

function render(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-size-'));
  const summary = { title: 'T', channel: null, duration: null, url: 'u', lang: 'EN',
    videoId: 'v', tldr: null, takeaways: [], sourceMd: 'x.md',
    sections: [{ numeral: '1', title: 'S', prose: 'p',
      timeRange: { startSec: 60, endSec: 120, label: '1:00–2:00', url: 'u&t=60s' } }] } as ParsedSummary;
  const dug = [{ sectionId: 60, startSec: 60, title: 'S', bodyMarkdown: 'body',
    generatedAt: '2026-01-01T00:00:00.000Z', genVersion: 1 }] as unknown as DugSection[];
  return renderDigDeeperDoc({ summary, envelope: null, dug, mdPath: path.join(dir, 'x-dig-deeper.md'), videoId: 'v' });
}

describe('dig slide size control', () => {
  const html = render();

  it('scales the uncropped slide rule by --dig-slide-scale and guards overflow', () => {
    expect(html).toContain('max-height:calc(300px * var(--dig-slide-scale, 1))');
    expect(html).toMatch(/\.dg img\.dig-slide\{[^}]*max-width:100%/);
  });

  it('scales the cropped figure width by --dig-slide-scale', () => {
    expect(html).toContain('width:min(100%, calc(540px * var(--dig-slide-scale, 1)))');
  });

  it('renders the .dg-size control: range 50-150 step 10 default 100, dec/inc, and a reset <button>', () => {
    expect(html).toMatch(/<input class="dg-size-range" type="range" min="50" max="150" step="10" value="100"/);
    expect(html).toContain('class="dg-size-dec"');
    expect(html).toContain('class="dg-size-inc"');
    expect(html).toContain('aria-label="Smaller slides">−</button>'); // U+2212 minus, not ASCII hyphen (PL1)
    expect(html).toMatch(/<button class="dg-size-val" type="button"[^>]*>100%<\/button>/);
  });

  it('includes a pre-paint head script (before <style>) and a body sizeScript, both keyed on digSlideScale', () => {
    const headIdx = html.indexOf('digSlideScale');
    const styleIdx = html.indexOf('<style>');
    expect(headIdx).toBeGreaterThan(-1);
    expect(headIdx).toBeLessThan(styleIdx);                 // head script before the stylesheet
    expect(html).toContain("setProperty('--dig-slide-scale'");
    expect((html.match(/digSlideScale/g) || []).length).toBeGreaterThanOrEqual(2); // head + body
  });

  it('hides the control and resets slide size in print', () => {
    expect(html).toMatch(/@media print\{[^}]*\.dg-size\{display:none!important\}/);
    expect(html).toContain('.dg-topbar{display:flex;flex-wrap:wrap');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest render-dig-deeper.size`
Expected: FAIL — none of the new strings present yet.

- [ ] **Step 3: Update the two slide CSS rules + topbar in `DIG_DOC_CSS`**

Find the post-#41 rules and edit:
```
.dg img.dig-slide{margin:2em auto;max-height:360px;...}      ← actually post-#41 = max-height:300px
```
Replace the uncropped rule with (adds `max-width:100%` + scale):
```css
.dg img.dig-slide{margin:2em auto;max-width:100%;max-height:calc(300px * var(--dig-slide-scale, 1));border:1px solid var(--rule);cursor:zoom-in}
```
Replace the cropped figure rule's `width:min(100%,540px)` with the scaled form:
```css
.dg figure.dig-slide-crop{display:block;overflow:hidden;margin:2em auto;width:min(100%, calc(540px * var(--dig-slide-scale, 1)));border:1px solid var(--rule);border-radius:6px}
```
Add `flex-wrap:wrap` to the existing `.dg-topbar` rule:
```css
.dg-topbar{display:flex;flex-wrap:wrap;align-items:center;gap:1em;margin-bottom:1.6em;font-size:.85rem}
```

- [ ] **Step 4: Append the `.dg-size` styles + print override to `DIG_DOC_CSS`**

```css
.dg-size{display:inline-flex;align-items:center;gap:.3em;color:var(--meta);font-size:.85rem}
.dg-size button{background:none;border:1px solid var(--rule);border-radius:4px;cursor:pointer;color:var(--meta);font-size:.85rem;line-height:1;padding:.15em .45em}
.dg-size-range{width:7rem;flex:0 0 auto}
.dg-size-val{min-width:3.2em;text-align:center;flex:0 0 auto}
@media print{.dg-size{display:none!important}.dg img.dig-slide{max-height:300px}.dg figure.dig-slide-crop{width:min(100%,540px)}}
```

- [ ] **Step 5: Add the control markup to `topBar`**

Define just above the `topBar` line, then append it:
```ts
  const sizeControl = `<span class="dg-size" role="group" aria-label="Slide image size">` +
    `<button class="dg-size-dec" type="button" aria-label="Smaller slides">−</button>` +
    `<input class="dg-size-range" type="range" min="50" max="150" step="10" value="100" aria-label="Slide image size percent">` +
    `<button class="dg-size-inc" type="button" aria-label="Larger slides">+</button>` +
    `<button class="dg-size-val" type="button" aria-label="Reset slide image size to 100%">100%</button></span>`;
  const topBar = `<div class="dg-topbar">${summaryLink} <button class="dg-expand-all">⤢ expand all</button> ${wholeAsk} ${sizeControl}</div>`;
```

- [ ] **Step 6: Add the shared sanitizer const + the pre-paint head script; inject in `<head>`**

Define near the other module-level script consts (the sanitizer is shared by both scripts — PM1):
```ts
const DIG_SLIDE_SANITIZE_JS = "function s(raw){if(raw==null||raw===''){return 100;}var n=Number(raw);if(!Number.isFinite(n)){return 100;}n=Math.round(n/10)*10;return Math.min(150,Math.max(50,n));}";

// Pre-paint: set --dig-slide-scale from sanitized localStorage BEFORE first paint (no FOUC).
const SIZE_HEAD_SCRIPT = `<script>(function(){try{${DIG_SLIDE_SANITIZE_JS}` +
  `var v=s(localStorage.getItem('digSlideScale'));` +
  `document.documentElement.style.setProperty('--dig-slide-scale',v/100);` +
  `}catch(e){}})();</script>`;
```
Inject it in the `<head>` immediately after `${THEME_HEAD_SCRIPT}`:
```
${THEME_HEAD_SCRIPT}
${SIZE_HEAD_SCRIPT}
<style>...
```

- [ ] **Step 7: Add the body `sizeScript` and inject it after `${askAiScript}`**

```ts
  const sizeScript = `<script>(function(){
  var root=document.documentElement;
  var range=document.querySelector('.dg-size-range');
  var dec=document.querySelector('.dg-size-dec');
  var inc=document.querySelector('.dg-size-inc');
  var val=document.querySelector('.dg-size-val');
  if(!range||!val)return;
  ${DIG_SLIDE_SANITIZE_JS}
  function read(){try{return s(localStorage.getItem('digSlideScale'));}catch(e){return 100;}}
  function apply(p,persist){p=s(p);root.style.setProperty('--dig-slide-scale',p/100);range.value=String(p);val.textContent=p+'%';if(persist){try{localStorage.setItem('digSlideScale',String(p));}catch(e){}}}
  apply(read(),false);
  range.addEventListener('input',function(){apply(range.value,true);});
  if(dec)dec.addEventListener('click',function(){apply(Number(range.value)-10,true);});
  if(inc)inc.addEventListener('click',function(){apply(Number(range.value)+10,true);});
  val.addEventListener('click',function(){apply(100,true);});
})();</script>`;
```
Inject in the body script line:
```
${NAV_SCRIPT}${THEME_TOGGLE_SCRIPT}${zoomScript}${askAiScript}${sizeScript}
```

- [ ] **Step 8: Run the new tests + the full render-dig-deeper suite**

Run: `npx jest render-dig-deeper`
Expected: PASS — new size tests green; existing render-dig-deeper tests still green (additive change; the only existing test touching slide CSS asserted `max-height:300px`, which is now inside the `calc(...)` and `@media print` — confirm that assertion: if a test does `toContain('max-height:300px')`, it still passes because the print rule contains the literal `max-height:300px`. If it instead asserted the *whole* rule string, update it to the `calc(...)` form).

- [ ] **Step 9: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 10: Commit**

```bash
git add lib/html-doc/render-dig-deeper.ts tests/lib/html-doc/render-dig-deeper.size.test.ts
git commit -m "feat(dig): reader image-size control — --dig-slide-scale var, pre-paint head script, print reset"
```

---

### Task 2: E2E — interactivity, persistence, print, a11y

**Files:**
- Create: `tests/e2e/dig-slide-size.spec.ts`

**Interfaces:**
- Consumes: the running app + a dig-deeper doc HTML built via `renderDigDeeperDoc` and served with `page.route(...).fulfill(...)`, mirroring `tests/e2e/dig-deeper.spec.ts`.

- [ ] **Step 1: Write the E2E spec (mirror the existing dig-deeper harness)**

```ts
// tests/e2e/dig-slide-size.spec.ts
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { expect, test } from '@playwright/test';
import { renderDigDeeperDoc } from '../../lib/html-doc/render-dig-deeper';
import type { ParsedSummary } from '../../lib/html-doc/types';
import type { DugSection } from '../../lib/dig/companion-doc';
import type { CropBox } from '../../lib/dig/slide-crop';

const B64 = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKwAB/9k=';

function buildHtml(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-size-e2e-'));
  fs.mkdirSync(path.join(dir, 'assets', 'v'), { recursive: true });
  const assetAbs = path.join(dir, 'assets', 'v', '0-0.jpg');
  fs.writeFileSync(assetAbs, Buffer.from(B64, 'base64'));
  const summary = { title: 'Size Test', channel: null, duration: null, url: 'u', lang: 'EN',
    videoId: 'v', tldr: null, takeaways: [], sourceMd: 'x.md',
    sections: [{ numeral: '1', title: 'S', prose: 'p',
      timeRange: { startSec: 60, endSec: 120, label: '1:00–2:00', url: 'u&t=60s' } }] } as ParsedSummary;
  const dug = [{ sectionId: 60, startSec: 60, title: 'S', bodyMarkdown: '![a](assets/v/0-0.jpg)',
    generatedAt: '2026-01-01T00:00:00.000Z', genVersion: 1 }] as unknown as DugSection[];
  // PB2: pass a cropMap so a `figure.dig-slide-crop` is actually emitted (S7 needs it).
  // mdPath's dir == the asset dir, so the renderer resolves the ref to exactly assetAbs.
  const cropMap = new Map<string, CropBox | null>([[assetAbs, { trimTop: 0.25, trimBot: 0.05, width: 1280, height: 720 }]]);
  return renderDigDeeperDoc({ summary, envelope: null, dug, mdPath: path.join(dir, 'vid-size-test-dig-deeper.md'), videoId: 'v', cropMap });
}

const ROUTE = '**/api/html/vid-size-test**';
const URL = 'http://localhost:3000/api/html/vid-size-test?type=dig-deeper';

async function stub(page) {
  const html = buildHtml();
  await page.route(ROUTE, (r) => r.fulfill({ contentType: 'text/html', body: html }));
}
const scale = (page) => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--dig-slide-scale').trim());

test('S1 set range to 50 shrinks scale + updates readout', async ({ page }) => {
  await stub(page); await page.goto(URL);
  await page.locator('.dg-size-range').fill('50');
  await page.locator('.dg-size-range').dispatchEvent('input');
  expect(await scale(page)).toBe('0.5');
  await expect(page.locator('.dg-size-val')).toHaveText('50%');
});

test('S2 + button steps to 110', async ({ page }) => {
  await stub(page); await page.goto(URL);
  await page.locator('.dg-size-inc').click();
  expect(await scale(page)).toBe('1.1');
  await expect(page.locator('.dg-size-val')).toHaveText('110%');
});

test('S3 head script applies the saved scale PRE-PAINT, before the control exists (PH1)', async ({ page }) => {
  await stub(page);
  await page.addInitScript(() => {
    (window as any).__firstScaleSet = null;
    const orig = CSSStyleDeclaration.prototype.setProperty;
    CSSStyleDeclaration.prototype.setProperty = function (prop: string, ...rest: any[]) {
      if (prop === '--dig-slide-scale' && (window as any).__firstScaleSet === null) {
        (window as any).__firstScaleSet = {
          ready: document.readyState,
          hasControl: !!document.querySelector('.dg-size-range'),
        };
      }
      return (orig as any).call(this, prop, ...rest);
    };
    localStorage.setItem('digSlideScale', '120');
  });
  await page.goto(URL);
  const first = await page.evaluate(() => (window as any).__firstScaleSet);
  expect(first).not.toBeNull();
  expect(first.hasControl).toBe(false);                  // proves the HEAD script set it, not the body fallback
  expect(await scale(page)).toBe('1.2');
  await expect(page.locator('.dg-size-range')).toHaveValue('120');
});

test('S4 reset button works by click AND keyboard', async ({ page }) => {
  await stub(page); await page.goto(URL);
  await page.locator('.dg-size-inc').click();            // 110
  await page.locator('.dg-size-val').click();            // reset
  expect(await scale(page)).toBe('1');
  await page.locator('.dg-size-inc').click();            // 110 again
  await page.locator('.dg-size-val').focus();
  await page.keyboard.press('Enter');                    // keyboard reset
  expect(await scale(page)).toBe('1');
  await expect(page.locator('.dg-size-val')).toHaveText('100%');
});

// S5 table-driven sanitizer contract (PM2): snap-to-10 + clamp [50,150]; bad/missing → 100.
for (const [stored, expected] of ([['999', '1.5'], ['-1', '0.5'], ['44', '0.5'], ['120px', '1'], ['', '1']] as const)) {
  test(`S5 sanitize stored "${stored}" → scale ${expected}`, async ({ page }) => {
    await stub(page);
    await page.addInitScript((v) => localStorage.setItem('digSlideScale', v as string), stored);
    await page.goto(URL);
    expect(await scale(page)).toBe(expected);
  });
}
test('S5 missing storage → 100% (PB1 — Number(null) must NOT default to 50)', async ({ page }) => {
  await stub(page); await page.goto(URL);
  expect(await scale(page)).toBe('1');
  await expect(page.locator('.dg-size-range')).toHaveValue('100');
});

test('S6 survives blocked localStorage and proves it is actually blocked (PM3)', async ({ page }) => {
  await stub(page);
  await page.addInitScript(() => {
    const thrower = () => { throw new Error('blocked'); };
    try {
      Object.defineProperty(window, 'localStorage', { configurable: true, get: () => ({ getItem: thrower, setItem: thrower }) });
      (window as any).__lsBlocked = true;
    } catch { (window as any).__lsBlocked = false; }
  });
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  await page.goto(URL);
  expect(await page.evaluate(() => (window as any).__lsBlocked)).toBe(true);         // override took
  expect(await page.evaluate(() => { try { (window as any).localStorage.getItem('x'); return 'no-throw'; } catch { return 'throws'; } })).toBe('throws'); // really blocked
  expect(await scale(page)).toBe('1');                   // defaulted, no FOUC crash
  await page.locator('.dg-size-inc').click();
  expect(await scale(page)).toBe('1.1');                 // still operable for the session
  expect(pageErrors).toEqual([]);                        // no uncaught errors leaked
});

test('S7 print keeps base size + hides control, on a locked wide viewport (PH2)', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 900 });   // wide enough that 150% > base cap
  await stub(page);
  await page.addInitScript(() => localStorage.setItem('digSlideScale', '150'));
  await page.goto(URL);
  const fig = page.locator('figure.dig-slide-crop').first();
  const before = parseFloat(await fig.evaluate((el) => getComputedStyle(el).width));
  expect(before).toBeGreaterThan(541);                   // 150% genuinely inflates (precondition, not vacuous)
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.dg-size')).toBeHidden();
  const after = parseFloat(await fig.evaluate((el) => getComputedStyle(el).width));
  expect(after).toBeLessThanOrEqual(541);                // print override → base 540 cap, not 150%
});
```

- [ ] **Step 2: Run the E2E spec**

Run: `npx playwright test dig-slide-size`
Expected: PASS (S1–S7). If the route/goto pattern needs adjusting, mirror exactly how `tests/e2e/dig-deeper.spec.ts` fulfills its route.

- [ ] **Step 3: Full suite + typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: all green (pdf.test.ts may flake under parallel load — confirm it passes in isolation), no type errors.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/dig-slide-size.spec.ts
git commit -m "test(dig): E2E — size control interactivity, persistence, print, a11y"
```

---

## Self-Review

**Spec coverage:** scale var + max-width guard (Task 1 Steps 3) ✓; control markup incl. reset button (Step 5) ✓; pre-paint head script H1 (Step 6) ✓; body sync/listeners (Step 7) ✓; print H2 (Step 4) ✓; topbar flex-wrap M3 (Step 3) ✓; sanitizer M4 (Steps 6,7 verbatim) ✓; unit assertions 1–8 (Step 1) ✓; E2E S1–S7 incl. storage-blocked L1 (S6) and clamp L2 (S5) ✓.

**Placeholder scan:** no TBD/TODO; full code in every step. The one judgment note (Step 8, existing `max-height:300px` assertion) is explicit with the resolution.

**Type consistency:** localStorage key `digSlideScale`, var `--dig-slide-scale`, control classes `dg-size-range/dec/inc/val`, and the sanitizer body are identical across head script, body script, control markup, and tests.

**Dependency:** Global Constraints state the rebase-onto-post-#41 prerequisite and locate-by-content guidance, since line numbers shift after the #41 merge.

**Codex plan-review items (`docs/reviews/plan-dig-slide-size-control-codex.md`) addressed:** PB1 sanitizer null/'' guard (was a real 50%-default bug) ✓; PB2 E2E fixture now passes `cropMap` so a figure exists ✓; PH1 S3 instruments `setProperty` to prove the head script ran pre-control ✓; PH2 S7 locks a wide viewport + asserts pre-print inflation ✓; PM1 sanitizer DRYed to one `DIG_SLIDE_SANITIZE_JS` const ✓; PM2 S5 table-driven ✓; PM3 S6 proves storage actually blocked + no page errors ✓; PL1 U+2212 minus asserted ✓.
