# Dig Slide Captions Implementation Plan (PR 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface each slide's existing caption (Gemini's description, currently hidden in alt text) as a visible `<figcaption>` beneath the slide, with a top-bar show/hide toggle (default shown, persisted in localStorage, no FOUC).

**Architecture:** Render-only changes to `lib/html-doc/render-dig-deeper.ts`. The markdown-it image rule wraps every inlined slide in a semantic `<figure class="dig-slide-fig">` carrying the image (or crop `<div>`) plus a `<figcaption class="dig-cap">`. A global toggle (mirroring the size-slider pattern) adds/removes a `dg-hide-caps` class on `<html>`; CSS hides `.dig-cap` under it. The zoom lightbox gains a caption populated via `textContent`.

**Tech Stack:** TypeScript, Next.js, markdown-it, vanilla JS (served doc), Jest+ts-jest, Playwright.

**Spec:** `docs/superpowers/specs/2026-06-29-dig-doc-readability-design.md` (Part A)
**Spec adversarial review (addressed):** `docs/reviews/spec-dig-doc-readability-codex.md`

## Global Constraints

- **Render-only.** NO `DIG_GENERATOR_VERSION` bump, no `DugSection` change, no new npm dependency, vanilla JS only. The dig route live-renders per GET, so changes reach all docs on next load. (Part B / sub-headings is a SEPARATE later PR — do not touch `lib/dig/generate.ts` here.)
- **Caption source = existing alt text**, HTML-escaped at render via the existing `esc()`. Stored captions are NOT trusted as HTML. Empty caption is a supported state → emit NO `<figcaption>`.
- **Missing-asset placeholder UNCHANGED:** a missing asset still renders `<span class="missing-slide">${esc(altAttr)}</span>` — no figure, no figcaption.
- **Slide caption** (always qualified) is the canonical term — distinct from YouTube transcript "captions" (per `CONTEXT.md`).
- **Toggle:** localStorage key `digCaptions`, values `'on'`/`'off'`, **default `'on'`** (shown) when unset/invalid. Pre-paint head script adds `dg-hide-caps` to `<html>` when `'off'` (no FOUC). All localStorage access in try/catch; fail-safe = captions shown.
- **Selector rename:** the cropped slide's wrapper changes from `<figure class="dig-slide-crop">` to `<div class="dig-slide-crop">` (now nested inside the semantic `<figure class="dig-slide-fig">`). Every reference must move together (see Task 1).
- **Tests under `tests/`** (Jest `testMatch`): unit at `tests/lib/html-doc/`, E2E at `tests/e2e/`.

---

## File Structure

- Modify: `lib/html-doc/render-dig-deeper.ts` — image rule (figure/figcaption + crop→div), `DIG_DOC_CSS` (rename + `.dig-slide-fig`/`.dig-cap`/`.dg-hide-caps`/toggle/zoom-cap styles), topbar (toggle control), head (`CAPTIONS_HEAD_SCRIPT`), body (`captionsScript`), zoom overlay + `zoomScript` (caption node).
- Create: `tests/lib/html-doc/render-dig-deeper.captions.test.ts`, `tests/e2e/dig-slide-captions.spec.ts`.
- Update (selector rename): `tests/lib/html-doc/render-dig-deeper.crop.test.ts`, `tests/lib/html-doc/render-dig-deeper.size.test.ts`, `tests/e2e/dig-slide-size.spec.ts`, `tests/e2e/dig-slide-crop.spec.ts`.

---

## Task 1: Figure/figcaption restructure + crop→div rename + render captions

**Files:**
- Modify: `lib/html-doc/render-dig-deeper.ts` (`buildRenderer` image rule ~:95-140; `DIG_DOC_CSS` ~:149-183)
- Create: `tests/lib/html-doc/render-dig-deeper.captions.test.ts`
- Update: `tests/lib/html-doc/render-dig-deeper.crop.test.ts`, `tests/lib/html-doc/render-dig-deeper.size.test.ts`, `tests/e2e/dig-slide-size.spec.ts`, `tests/e2e/dig-slide-crop.spec.ts`

**Interfaces:**
- Consumes: existing `buildRenderer(mdPath, cropMap)`, `esc()`, `CropBox`.
- Produces: each inlined slide renders as `<figure class="dig-slide-fig">` → (`<div class="dig-slide-crop">…<img class="dig-slide">…</div>` | `<img class="dig-slide">`) → optional `<figcaption class="dig-cap">`. Missing-asset/external unchanged.

- [ ] **Step 1: Write the failing unit test**

```ts
// tests/lib/html-doc/render-dig-deeper.captions.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderDigDeeperDoc } from '@/lib/html-doc/render-dig-deeper';
import type { ParsedSummary } from '@/lib/html-doc/types';
import type { DugSection } from '@/lib/dig/companion-doc';
import type { CropBox } from '@/lib/dig/slide-crop';

// 1x1 JPEG
const B64 = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKwAB/9k=';

function render(body: string, opts: { crop?: boolean } = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-cap-'));
  fs.mkdirSync(path.join(dir, 'assets', 'v'), { recursive: true });
  const assetAbs = path.join(dir, 'assets', 'v', '0-0.jpg');
  fs.writeFileSync(assetAbs, Buffer.from(B64, 'base64'));
  const summary = { title: 'T', channel: null, duration: null, url: 'u', lang: 'EN',
    videoId: 'v', tldr: null, takeaways: [], sourceMd: 'x.md',
    sections: [{ numeral: '1', title: 'S', prose: 'p',
      timeRange: { startSec: 60, endSec: 120, label: '1:00–2:00', url: 'u&t=60s' } }] } as ParsedSummary;
  const dug = [{ sectionId: 60, startSec: 60, title: 'S', bodyMarkdown: body,
    generatedAt: '2026-01-01T00:00:00.000Z', genVersion: 1 }] as unknown as DugSection[];
  const cropMap = opts.crop
    ? new Map<string, CropBox | null>([[assetAbs, { trimTop: 0.25, trimBot: 0.05, width: 1280, height: 720 }]])
    : undefined;
  return renderDigDeeperDoc({ summary, envelope: null, dug, mdPath: path.join(dir, 'x-dig-deeper.md'), videoId: 'v', cropMap });
}

describe('dig slide captions render', () => {
  it('uncropped slide → figure.dig-slide-fig > img.dig-slide + figcaption.dig-cap', () => {
    const html = render('![A diagram](assets/v/0-0.jpg)');
    expect(html).toMatch(/<figure class="dig-slide-fig"><img class="dig-slide"[^>]*><figcaption class="dig-cap">A diagram<\/figcaption><\/figure>/);
  });

  it('cropped slide → figure.dig-slide-fig > div.dig-slide-crop > img + figcaption', () => {
    const html = render('![Cropped chart](assets/v/0-0.jpg)', { crop: true });
    expect(html).toContain('<figure class="dig-slide-fig"><div class="dig-slide-crop"');
    expect(html).toMatch(/<\/div><figcaption class="dig-cap">Cropped chart<\/figcaption><\/figure>/);
    expect(html).not.toContain('<figure class="dig-slide-crop"');
  });

  it('empty caption → figure + img but NO figcaption', () => {
    const html = render('![](assets/v/0-0.jpg)');
    expect(html).toContain('<figure class="dig-slide-fig"><img class="dig-slide"');
    expect(html).not.toContain('dig-cap');
  });

  it('HTML-escapes the caption in figcaption (no raw markup)', () => {
    const html = render('![a <b>&"x](assets/v/0-0.jpg)');
    expect(html).toContain('<figcaption class="dig-cap">a &lt;b&gt;&amp;&quot;x</figcaption>');
    expect(html).not.toContain('<figcaption class="dig-cap">a <b>');
  });

  it('missing asset → span.missing-slide, no figure/figcaption', () => {
    const html = render('![cap](assets/v/does-not-exist.jpg)');
    expect(html).toContain('<span class="missing-slide">cap</span>');
    expect(html).not.toContain('dig-slide-fig');
  });

  it('external image → plain img, no figure wrap', () => {
    const html = render('![ext](https://example.com/a.png)');
    expect(html).toMatch(/<img src="https:\/\/example.com\/a.png" alt="ext">/);
    expect(html).not.toContain('dig-slide-fig');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest render-dig-deeper.captions`
Expected: FAIL — current renderer emits `<figure class="dig-slide-crop">` / bare `<img class="dig-slide">` with no `dig-slide-fig` or `figcaption`.

- [ ] **Step 3: Rewrite the image rule to emit figure + figcaption**

In `lib/html-doc/render-dig-deeper.ts`, replace the `assets/`-branch body of `rules.image` (currently `:103-134`) with:

```ts
    if (srcAttr.startsWith('assets/')) {
      const absPath = path.resolve(docDir, srcAttr);
      if (!absPath.startsWith(assetsRoot + path.sep)) return '';
      let data: Buffer | null = null;
      try {
        data = fs.readFileSync(absPath);
      } catch {
        // Benign missing file — visible placeholder, UNCHANGED (no figure/figcaption).
        return `<span class="missing-slide">${esc(altAttr)}</span>`;
      }
      const b64 = data.toString('base64');
      const box = cropMap.get(absPath) ?? null;
      // figcaption only when a caption is present (empty caption is a supported state).
      const cap = altAttr ? `<figcaption class="dig-cap">${esc(altAttr)}</figcaption>` : '';
      let inner: string;
      if (box) {
        const keepFrac = 1 - box.trimTop - box.trimBot;
        const keepH = Math.round(box.height * keepFrac);
        const posPct = (box.trimTop / (box.trimTop + box.trimBot)) * 100;
        const cropStyle = `aspect-ratio:${box.width} / ${keepH}`;
        inner = `<div class="dig-slide-crop" style="${cropStyle}">` +
                `<img class="dig-slide" style="object-position:0 ${posPct.toFixed(1)}%" ` +
                `src="data:image/jpeg;base64,${b64}" alt="${esc(altAttr)}"></div>`;
      } else {
        inner = `<img class="dig-slide" src="data:image/jpeg;base64,${b64}" alt="${esc(altAttr)}">`;
      }
      return `<figure class="dig-slide-fig">${inner}${cap}</figure>`;
    }
```

(The external-URL `return` line and the containment-`return ''` line are unchanged.)

- [ ] **Step 4: Update `DIG_DOC_CSS` — rename crop selector, move margins to the figure, add `.dig-cap`**

In `DIG_DOC_CSS`, replace the three slide rules (`:149-151`) with:

```css
.dig-slide-fig{margin:2em auto;max-width:100%}
.dg img.dig-slide{display:block;margin:0 auto;max-width:100%;max-height:calc(300px * var(--dig-slide-scale, 1));border:1px solid var(--rule);cursor:zoom-in}
.dg .dig-slide-crop{display:block;margin:0 auto;overflow:hidden;width:min(100%, calc(540px * var(--dig-slide-scale, 1)));border:1px solid var(--rule);border-radius:6px}
.dg .dig-slide-crop>img.dig-slide{display:block;width:100%;height:100%;max-height:none;margin:0;border:0;border-radius:0;object-fit:cover;cursor:zoom-in}
.dig-cap{margin:.5em auto 0;text-align:center;font-size:.8rem;color:var(--meta);line-height:1.4}
```

NOTE (intentional cascade): `.dg img.dig-slide` deliberately does NOT set `border-radius` — it inherits `border-radius:6px` from the existing `STRUCTURAL_CSS .dg img{…border-radius:6px}` rule (unchanged from current behavior; uncropped slides keep rounded corners). The crop child rule `.dg .dig-slide-crop>img.dig-slide` explicitly sets `border-radius:0` (the crop div owns the corner radius).

And update the `@media print` rule (`:182`) — rename `figure.dig-slide-crop` → `.dig-slide-crop` (NOTE: do NOT add `.dg-caps-toggle` here — that is added in Task 2):

```css
@media print{.dg-size{display:none!important}.dg img.dig-slide{max-height:300px}.dg .dig-slide-crop{width:min(100%,540px)}}
```

- [ ] **Step 5: Run the new captions test — confirm GREEN**

Run: `npx jest render-dig-deeper.captions`
Expected: PASS (all 6).

- [ ] **Step 6: Update the existing tests that reference the old crop structure**

Verified occurrences (grepped). Apply EXACTLY these — the breaking ones are explicit; the "unchanged" ones are listed so you do NOT mistakenly alter them.

**`tests/lib/html-doc/render-dig-deeper.crop.test.ts`:**
- `:43` (BREAKS — element-qualified selector): change
  `expect(html).toMatch(/\.dg figure\.dig-slide-crop\{[^}]*width:min\(100%,540px\)/);`
  → `expect(html).toMatch(/\.dg \.dig-slide-crop\{[^}]*width:min\(100%,540px\)/);`
- `:35` and `:36` (vacuous after rename — the crop wrapper is now a `<div>`; widen the guard so it still catches an inline width/capPx on the crop div):
  `expect(html).not.toMatch(/<figure[^>]*style="[^"]*width:/);` → `expect(html).not.toMatch(/<(figure|div)[^>]*style="[^"]*width:/);`
  `expect(html).not.toMatch(/<figure[^>]*style="[^"]*capPx/);` → `expect(html).not.toMatch(/<(figure|div)[^>]*style="[^"]*capPx/);`
- `:27`, `:49`, `:58` (UNCHANGED — `class="dig-slide-crop"` substring survives the figure→div change; `:27` positive still matches the div, `:49`/`:58` negatives still hold for uncropped/external). Leave as-is.
- `:65-67` (UNCHANGED — `/\.dig-slide-crop\s*>\s*img\.dig-slide\{…/` has no `figure` prefix, matches `.dg .dig-slide-crop>img…`). Leave as-is.

**`tests/lib/html-doc/render-dig-deeper.size.test.ts`:**
- `:50` (BREAKS, and is brittle across Task 2) — REPLACE the single whole-print-block `toContain` with order-independent per-declaration substrings (these survive Task 2 adding `.dg-caps-toggle`):
  Remove: `expect(html).toContain('@media print{.dg-size{display:none!important}.dg img.dig-slide{max-height:300px}.dg figure.dig-slide-crop{width:min(100%,540px)}}');`
  Add:
  ```ts
  expect(html).toContain('@media print{');
  expect(html).toContain('.dg-size{display:none!important}');
  expect(html).toContain('.dg img.dig-slide{max-height:300px}');
  expect(html).toContain('.dg .dig-slide-crop{width:min(100%,540px)}');
  ```

**`tests/e2e/dig-slide-size.spec.ts`:**
- `:133` (BREAKS — locator): `page.locator('figure.dig-slide-crop')` → `page.locator('.dig-slide-crop')`. The S7 `before>541` / `after<=541` width reads stay on this element (the `div.dig-slide-crop` carries the `width:min(...)` cap).
- `:23` comment and `:139` comment: change `figure.dig-slide-crop` → `.dig-slide-crop` (text only; keeps output honest).

**`tests/e2e/dig-slide-crop.spec.ts`:**
- `:110` (BREAKS — locator): `page.locator('figure.dig-slide-crop')` → `page.locator('.dig-slide-crop')`.
- `:122` (BREAKS — locator): `page.locator('figure.dig-slide-crop img.dig-slide')` → `page.locator('.dig-slide-crop img.dig-slide')`.
- `:109` test title: `'Z1 (crop wrapper in flow): figure.dig-slide-crop visible; overflow hidden; img object-fit cover'` → replace `figure.dig-slide-crop` with `.dig-slide-crop` (user-visible in test output).
- `:105`, `:118`, `:139` comments: `figure.dig-slide-crop` → `.dig-slide-crop` (text only).
- `:141` (UNCHANGED — `el.closest('.dig-slide-crop')` still works; the `.dig-slide-crop` class persists on the div). Leave as-is.
- The Z1 `overflow:hidden` assertion relies on the `.dg .dig-slide-crop` rule keeping `overflow:hidden` — confirmed present in Step 4.

- [ ] **Step 7: Run the full render-dig-deeper jest suite + crop/size E2E**

Run: `npx jest render-dig-deeper`
Expected: PASS (captions + crop + size unit suites all green with updated selectors).
Run: `npx playwright test dig-slide-crop dig-slide-size`
Expected: PASS (locators updated to `.dig-slide-crop`).

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add lib/html-doc/render-dig-deeper.ts tests/lib/html-doc/render-dig-deeper.captions.test.ts tests/lib/html-doc/render-dig-deeper.crop.test.ts tests/lib/html-doc/render-dig-deeper.size.test.ts tests/e2e/dig-slide-size.spec.ts tests/e2e/dig-slide-crop.spec.ts
git commit -m "feat(dig): render slide captions as figcaption; crop wrapper figure→div"
```

---

## Task 2: Caption visibility toggle (default shown, persisted, no FOUC)

**Files:**
- Modify: `lib/html-doc/render-dig-deeper.ts` (`DIG_CAPTIONS_SANITIZE_JS` + `CAPTIONS_HEAD_SCRIPT` near the size consts; `capsControl` in topbar; `captionsScript` in body; CSS for toggle + `.dg-hide-caps`)
- Test: `tests/lib/html-doc/render-dig-deeper.captions.test.ts` (extend), `tests/e2e/dig-slide-captions.spec.ts` (create)

**Interfaces:**
- Consumes: Task 1's `.dig-cap` figcaptions.
- Produces: a `.dg-caps-toggle` button in `.dg-topbar`; root class `dg-hide-caps` toggling caption visibility; localStorage key `digCaptions`; exported `DIG_CAPTIONS_SANITIZE_JS`.

- [ ] **Step 1: Write the failing tests (markup + sanitizer + head script + CSS)**

Add to `tests/lib/html-doc/render-dig-deeper.captions.test.ts`:

```ts
import { renderDigDeeperDoc, DIG_CAPTIONS_SANITIZE_JS } from '@/lib/html-doc/render-dig-deeper';

describe('dig captions toggle', () => {
  const html = render('![cap](assets/v/0-0.jpg)');

  it('renders a default-on toggle button in the topbar', () => {
    expect(html).toMatch(/<button class="dg-caps-toggle" type="button" aria-pressed="true"[^>]*>▣ captions<\/button>/);
  });

  it('includes a pre-paint head script keyed on digCaptions, before <style>', () => {
    const headIdx = html.indexOf('digCaptions');
    const styleIdx = html.indexOf('<style>');
    expect(headIdx).toBeGreaterThan(-1);
    expect(headIdx).toBeLessThan(styleIdx);
    expect(html).toContain("classList.add('dg-hide-caps')");
    expect((html.match(/digCaptions/g) || []).length).toBeGreaterThanOrEqual(2); // head + body
  });

  it('hides captions via .dg-hide-caps and hides the toggle in print', () => {
    expect(html).toContain('.dg-hide-caps .dig-cap{display:none}');
    // Plain substring (NOT a cross-brace regex): the print block is `@media print{.dg-size{…}.dg-caps-toggle{…}…}`,
    // so a /@media print\{[^}]*\.dg-caps-toggle/ pattern cannot match (a `}` precedes .dg-caps-toggle).
    expect(html).toContain('.dg-caps-toggle{display:none!important}');
  });
});

describe('DIG_CAPTIONS_SANITIZE_JS', () => {
  const c = new Function('raw', DIG_CAPTIONS_SANITIZE_JS + ' return c(raw);') as (raw: unknown) => string;
  it.each([
    [null, 'on'], [undefined, 'on'], ['', 'on'], ['garbage', 'on'], ['ON', 'on'],
    ['on', 'on'], ['off', 'off'],
  ] as [unknown, string][])('c(%p) === %s', (input, expected) => {
    expect(c(input)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest render-dig-deeper.captions`
Expected: FAIL — no toggle markup, no `DIG_CAPTIONS_SANITIZE_JS` export, no head script.

- [ ] **Step 3: Add the sanitizer + pre-paint head script**

In `lib/html-doc/render-dig-deeper.ts`, just below the size consts (`SIZE_HEAD_SCRIPT`, ~:192):

```ts
// Shared captions sanitizer — used in both CAPTIONS_HEAD_SCRIPT (head) and captionsScript (body).
export const DIG_CAPTIONS_SANITIZE_JS = "function c(raw){return raw==='off'?'off':'on';}";

// Pre-paint: hide captions BEFORE first paint when stored 'off' (no FOUC). Default shown.
const CAPTIONS_HEAD_SCRIPT = `<script>(function(){try{${DIG_CAPTIONS_SANITIZE_JS}` +
  `if(c(localStorage.getItem('digCaptions'))==='off'){document.documentElement.classList.add('dg-hide-caps');}` +
  `}catch(e){}})();</script>`;
```

Inject it in `<head>` immediately after `${SIZE_HEAD_SCRIPT}` (~:413):

```
${SIZE_HEAD_SCRIPT}
${CAPTIONS_HEAD_SCRIPT}
<style>...
```

- [ ] **Step 4: Add the toggle control to the topbar**

Define just below `sizeControl` (~:239) and append to `topBar`:

```ts
  const capsControl = `<button class="dg-caps-toggle" type="button" aria-pressed="true" aria-label="Toggle slide captions">▣ captions</button>`;
  const topBar = `<div class="dg-topbar">${summaryLink} <button class="dg-expand-all">⤢ expand all</button> ${wholeAsk} ${sizeControl} ${capsControl}</div>`;
```

- [ ] **Step 5: Add CSS — toggle button, `.dg-hide-caps`, print hide**

Append to `DIG_DOC_CSS` (after the `.dg-size-val` rule, before the print comment):

```css
.dg-caps-toggle{background:none;border:1px solid var(--rule);border-radius:4px;cursor:pointer;color:var(--meta);font-size:.85rem;line-height:1;padding:.2em .6em}
.dg-hide-caps .dig-cap{display:none}
```

And add `.dg-caps-toggle{display:none!important}` to the `@media print` rule:

```css
@media print{.dg-size{display:none!important}.dg-caps-toggle{display:none!important}.dg img.dig-slide{max-height:300px}.dg .dig-slide-crop{width:min(100%,540px)}}
```

- [ ] **Step 6: Add the body `captionsScript`**

Define just below `sizeScript` (~:402):

```ts
  const captionsScript = `<script>(function(){
  var root=document.documentElement;
  var btn=document.querySelector('.dg-caps-toggle');
  if(!btn)return;
  ${DIG_CAPTIONS_SANITIZE_JS}
  function read(){try{return c(localStorage.getItem('digCaptions'));}catch(e){return 'on';}}
  function apply(state,persist){
    var on=state!=='off';
    if(on){root.classList.remove('dg-hide-caps');}else{root.classList.add('dg-hide-caps');}
    btn.setAttribute('aria-pressed',on?'true':'false');
    btn.textContent=(on?'▣':'▢')+' captions';
    if(persist){try{localStorage.setItem('digCaptions',on?'on':'off');}catch(e){}}
  }
  // REQUIRED, not redundant: the pre-paint head script set ONLY the dg-hide-caps class.
  // This initial apply() syncs aria-pressed + button text to the persisted state. Do not remove.
  apply(read(),false);
  // Toggle off the CURRENT visible state (the class), not a re-read, to avoid any read race.
  btn.addEventListener('click',function(){apply(root.classList.contains('dg-hide-caps')?'on':'off',true);});
})();</script>`;
```

Inject in the body script line (~:422), after `${sizeScript}`:

```
${NAV_SCRIPT}${THEME_TOGGLE_SCRIPT}${zoomScript}${askAiScript}${sizeScript}${captionsScript}
```

- [ ] **Step 7: Run unit tests + typecheck**

Run: `npx jest render-dig-deeper.captions`
Expected: PASS (markup, head-script ordering, sanitizer table, CSS).
Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 8: Write the E2E spec**

```ts
// tests/e2e/dig-slide-captions.spec.ts
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { expect, test } from '@playwright/test';
import { renderDigDeeperDoc } from '../../lib/html-doc/render-dig-deeper';
import type { ParsedSummary } from '../../lib/html-doc/types';
import type { DugSection } from '../../lib/dig/companion-doc';

const B64 = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKwAB/9k=';

function buildHtml(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-cap-e2e-'));
  fs.mkdirSync(path.join(dir, 'assets', 'v'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'assets', 'v', '0-0.jpg'), Buffer.from(B64, 'base64'));
  const summary = { title: 'Cap Test', channel: null, duration: null, url: 'u', lang: 'EN',
    videoId: 'v', tldr: null, takeaways: [], sourceMd: 'x.md',
    sections: [{ numeral: '1', title: 'S', prose: 'p',
      timeRange: { startSec: 60, endSec: 120, label: '1:00–2:00', url: 'u&t=60s' } }] } as ParsedSummary;
  const dug = [{ sectionId: 60, startSec: 60, title: 'S', bodyMarkdown: '![A clear caption](assets/v/0-0.jpg)',
    generatedAt: '2026-01-01T00:00:00.000Z', genVersion: 1 }] as unknown as DugSection[];
  return renderDigDeeperDoc({ summary, envelope: null, dug, mdPath: path.join(dir, 'vid-cap-test-dig-deeper.md'), videoId: 'v' });
}

const ROUTE = '**/api/html/vid-cap-test**';
const URL = 'http://localhost:3000/api/html/vid-cap-test?type=dig-deeper';
async function stub(page: import('@playwright/test').Page) {
  const html = buildHtml();
  await page.route(ROUTE, (r) => r.fulfill({ contentType: 'text/html', body: html }));
}

test('C1 captions shown by default', async ({ page }) => {
  await stub(page); await page.goto(URL);
  await expect(page.locator('.dig-cap')).toHaveText('A clear caption');
  await expect(page.locator('.dig-cap')).toBeVisible();
  await expect(page.locator('.dg-caps-toggle')).toHaveAttribute('aria-pressed', 'true');
});

test('C2 toggle hides captions and persists across reload', async ({ page }) => {
  await stub(page); await page.goto(URL);
  await page.locator('.dg-caps-toggle').click();
  await expect(page.locator('.dig-cap')).toBeHidden();
  await expect(page.locator('.dg-caps-toggle')).toHaveAttribute('aria-pressed', 'false');
  await page.reload();
  await expect(page.locator('.dig-cap')).toBeHidden();        // persisted
  await expect(page.locator('.dg-caps-toggle')).toHaveAttribute('aria-pressed', 'false');
});

test('C3 pre-paint hides captions BEFORE the toggle exists (no FOUC, PH1)', async ({ page }) => {
  await stub(page);
  await page.addInitScript(() => {
    (window as any).__capState = null;
    const orig = DOMTokenList.prototype.add;
    DOMTokenList.prototype.add = function (...cls: string[]) {
      if (cls.indexOf('dg-hide-caps') !== -1 && (window as any).__capState === null) {
        (window as any).__capState = { ready: document.readyState, hasToggle: !!document.querySelector('.dg-caps-toggle') };
      }
      return (orig as any).apply(this, cls);
    };
    localStorage.setItem('digCaptions', 'off');
  });
  await page.goto(URL);
  const first = await page.evaluate(() => (window as any).__capState);
  expect(first).not.toBeNull();
  if (!first) return;                            // guard: avoid TypeError on null (clean fail via the assertion above)
  expect(first.hasToggle).toBe(false);          // HEAD script ran before the control parsed
  expect(first.ready).toBe('loading');
  await expect(page.locator('.dig-cap')).toBeHidden();
});

test('C4 survives blocked localStorage (default shown, no page errors)', async ({ page }) => {
  await stub(page);
  await page.addInitScript(() => {
    const thrower = () => { throw new Error('blocked'); };
    Object.defineProperty(window, 'localStorage', { configurable: true, get: () => ({ getItem: thrower, setItem: thrower }) });
  });
  const errs: string[] = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(URL);
  await expect(page.locator('.dig-cap')).toBeVisible();       // defaulted to shown
  expect(errs).toEqual([]);
});
```

- [ ] **Step 9: Run the E2E + full suite + typecheck**

Run: `npx playwright test dig-slide-captions`
Expected: PASS (C1–C4).
Run: `npm test && npx tsc --noEmit`
Expected: green (pdf.test.ts may flake under parallel load — confirm in isolation if it fails), no type errors.

- [ ] **Step 10: Commit**

```bash
git add lib/html-doc/render-dig-deeper.ts tests/lib/html-doc/render-dig-deeper.captions.test.ts tests/e2e/dig-slide-captions.spec.ts
git commit -m "feat(dig): caption show/hide toggle — digCaptions, pre-paint, default shown"
```

---

## Task 3: Caption in the zoom lightbox

**Files:**
- Modify: `lib/html-doc/render-dig-deeper.ts` (`zoomOverlay` markup ~:334; `zoomScript` ~:342; `.dg-zoom` + `.dg-zoom-cap` CSS ~:169-172)
- Test: `tests/e2e/dig-slide-captions.spec.ts` (extend)

**Interfaces:**
- Consumes: Task 1's `.dig-slide-fig` / `.dig-cap`; Task 2's `dg-hide-caps` class.
- Produces: an overlay caption element `#_dg-zoom-cap` populated via `textContent`, respecting the toggle.

- [ ] **Step 1: Write the failing E2E**

Add to `tests/e2e/dig-slide-captions.spec.ts`:

```ts
test('C5 zoom overlay shows the slide caption', async ({ page }) => {
  await stub(page); await page.goto(URL);
  await page.locator('.dig-slide').click();
  await expect(page.locator('#_dg-zoom')).toHaveAttribute('data-open', '');
  await expect(page.locator('#_dg-zoom-cap')).toHaveText('A clear caption');
  await expect(page.locator('#_dg-zoom-cap')).toBeVisible();
});

test('C6 zoom caption hidden when captions toggled off', async ({ page }) => {
  await stub(page); await page.goto(URL);
  await page.locator('.dg-caps-toggle').click();      // captions off
  await page.locator('.dig-slide').click();
  await expect(page.locator('#_dg-zoom')).toHaveAttribute('data-open', '');
  await expect(page.locator('#_dg-zoom-cap')).toBeHidden();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx playwright test dig-slide-captions --grep "C5|C6"`
Expected: FAIL — no `#_dg-zoom-cap` element.

- [ ] **Step 3: Add the caption node to the zoom overlay**

Replace `zoomOverlay` (~:334-337) with:

```ts
  const zoomOverlay = `
<div class="dg-zoom" id="_dg-zoom" role="dialog" aria-modal="true" aria-label="Enlarged slide">
  <button class="dg-zoom-close" id="_dg-zoom-close" aria-label="Close">✕</button>
  <div class="dg-zoom-cap" id="_dg-zoom-cap"></div>
</div>`;
```

- [ ] **Step 4: Populate the caption in `zoomScript` (textContent, respect toggle)**

In `zoomScript` (~:342-355), update the open branch and `close()`:

```ts
  const zoomScript = `<script>(function(){
  var ov=document.getElementById('_dg-zoom');
  if(!ov)return;
  var cap=document.getElementById('_dg-zoom-cap');
  // img is inserted BEFORE the caption node so the overlay stacks img-over-caption (flex column).
  var im=document.createElement('img');im.id='_dg-zoom-img';im.alt='';ov.insertBefore(im,cap);
  // close() fully resets the caption; because any click while open closes first, opening a
  // different slide is always a fresh open (consecutive-slide zoom = two clicks: close, then open).
  function close(){ov.removeAttribute('data-open');im.removeAttribute('src');if(cap){cap.textContent='';cap.style.display='none';}}
  document.addEventListener('click',function(e){
    var t=e.target;
    if(t&&t.classList&&t.classList.contains('dig-slide')){
      im.src=t.getAttribute('src');im.alt=t.getAttribute('alt')||'';
      if(cap){
        var fig=t.closest?t.closest('.dig-slide-fig'):null;
        var capEl=fig?fig.querySelector('.dig-cap'):null;
        var txt=capEl?capEl.textContent:'';
        cap.textContent=txt||'';
        cap.style.display=(txt&&!document.documentElement.classList.contains('dg-hide-caps'))?'':'none';
      }
      ov.setAttribute('data-open','');return;
    }
    if(ov.hasAttribute('data-open')){close();}
  });
  document.addEventListener('keydown',function(e){
    if(e.key==='Escape'&&ov.hasAttribute('data-open')){close();}
  });
})();</script>`;
```

- [ ] **Step 5: Add zoom-caption CSS + make the overlay stack vertically**

Update the `.dg-zoom` rule (~:169) to add `flex-direction:column` and add a `.dg-zoom-cap` rule:

```css
.dg-zoom{display:none;position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:9500;flex-direction:column;align-items:center;justify-content:center;cursor:zoom-out}
.dg-zoom-cap{color:#fff;font-size:.85rem;line-height:1.4;margin-top:1rem;max-width:95vw;text-align:center}
```

(The `.dg-zoom[data-open]{display:flex}`, `.dg-zoom img`, and `.dg-zoom-close` rules are unchanged.)

- [ ] **Step 6: Run the E2E + full suite + typecheck**

Run: `npx playwright test dig-slide-captions`
Expected: PASS (C1–C6).
Run: `npm test && npx tsc --noEmit`
Expected: green, no type errors.

- [ ] **Step 7: Commit**

```bash
git add lib/html-doc/render-dig-deeper.ts tests/e2e/dig-slide-captions.spec.ts
git commit -m "feat(dig): show slide caption in zoom lightbox (textContent, respects toggle)"
```

---

## Self-Review

**Spec coverage (Part A):** A1 reuse alt text/no bump (Task 1) ✓; A2 figure+figcaption, crop→div, esc(), empty→no figcaption, missing-asset unchanged, external unchanged (Task 1 Steps 3-4 + tests) ✓; A3 toggle digCaptions default-on, pre-paint, fail-safe (Task 2) ✓; A4 zoom caption via textContent + respects toggle + empty (Task 3) ✓; A5 print: captions follow toggle (`.dg-hide-caps` on `<html>` applies in print), toggle control hidden in print (Task 2 Step 5) ✓; A6 UI control + caption styling (Task 1 Step 4, Task 2 Steps 4-5) ✓; A7 tests incl. escaping + missing-asset + zoom-off (all tasks) ✓. Selector-rename full set incl. crop+size unit and crop+size E2E (Task 1 Step 6) ✓ (M1/M2).

**Placeholder scan:** no TBD/TODO; complete code in every code step; test-update step gives exact string transformations.

**Type consistency:** `DIG_CAPTIONS_SANITIZE_JS` exported (Task 2) and consumed by the captions unit test + both scripts; classes `dig-slide-fig`/`dig-slide-crop`/`dig-cap`/`dg-hide-caps`/`dg-caps-toggle`, id `_dg-zoom-cap`, key `digCaptions` identical across renderer, scripts, and tests.

**Version policy:** render-only — NO `DIG_GENERATOR_VERSION` bump (confirmed; generate.ts untouched). Part B (sub-headings) is a separate PR.

**Deferred minor (from plan review #12):** caption *visibility-in-print* is covered by the CSS-string unit assertion + the toggle E2E, but there is no E2E that emulates print media and asserts `.dig-cap` is visible when captions are on. Acceptable to defer; add a print-emulation E2E later if desired.
