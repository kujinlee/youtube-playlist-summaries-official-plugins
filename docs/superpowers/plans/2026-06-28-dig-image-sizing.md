# Dig Slide Image Sizing (Resize + Click-to-Zoom) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shrink dug slide images so they sit inside the prose flow (centered, height-capped), with click-to-zoom for full-resolution detail.

**Architecture:** Render-time only, entirely in `lib/html-doc/render-dig-deeper.ts`. The markdown-it image rule tags the successfully-inlined slide `<img>` with `class="dig-slide"`; CSS caps its display size; a self-contained inline `<script>` opens a full-screen lightbox on click. No image processing, no new dependency, no asset mutation, no `DIG_GENERATOR_VERSION` bump — the dig-deeper serve branch renders fresh on every GET (`route.ts:195`), so the change is live on every existing doc immediately.

**Tech Stack:** TypeScript, markdown-it, plain inline DOM JS, jest (string assertions), Playwright (interactive behavior).

## Global Constraints

- Feature is render-only: no `DIG_GENERATOR_VERSION` bump, no asset files written, no new npm dependency. (Spec: Feature 1 §3.)
- Auto-crop is OUT (spike-disproven). Do NOT add image processing. (Spec: Empirical finding.)
- `.dg-zoom` overlay uses `z-index:9500` (above the existing `9000` overlays `#_dg-ea-dlg`/`#_dg-ea-prog`). (Spec H2.)
- The zoom `Esc` handler MUST early-return unless the lightbox is open, and MUST NOT `stopPropagation` — it coexists with the expand-all dialog's `document` Esc handler (`nav.ts:304`). (Spec H1.)
- Only the success branch of `buildRenderer`'s image rule gets `class="dig-slide"`. Missing-slide `<span>`, containment-fail `''`, and non-asset `<img>` are unchanged and are NOT zoomable. (Spec M1.)
- `inline-script` interactive behavior is NOT jest-testable (jsdom does not run the doc's `<script>` strings); cover it with Playwright E2E. jest covers presence + the markdown-it class application. (Spec H3.)

---

### Task 1: Resize CSS + `.dig-slide` class on inlined slides

**Files:**
- Modify: `lib/html-doc/render-dig-deeper.ts` — `DIG_DOC_CSS` (line 132, the `.dug img{margin:2em 0}` rule); `buildRenderer` success branch (line 118).
- Test: `tests/lib/html-doc/render-dig-deeper.test.ts` — update the existing `.dug img` assertion (846–847); add three new assertions.

**Interfaces:**
- Consumes: nothing new.
- Produces: inlined slide `<img>` now carries `class="dig-slide"`; CSS rule `.dg img.dig-slide{…max-height:360px…}`. Task 2 relies on the `.dig-slide` class as its click target.

- [ ] **Step 1: Write the failing tests**

In `tests/lib/html-doc/render-dig-deeper.test.ts`, **replace** the existing test at lines 844–847:

```ts
    it('includes generous margin (2em) around .dug img for screenshot breathing room', () => {
      expect(html).toContain('.dug img{margin:2em 0}');
    });
```

with:

```ts
    it('caps dug slide display size via .dg img.dig-slide (centered, height-capped, zoom cursor)', () => {
      expect(html).toContain('.dg img.dig-slide{');
      expect(html).toContain('max-height:360px');
      expect(html).toContain('cursor:zoom-in');
      expect(html).not.toContain('.dug img{margin:2em 0}'); // old generic rule removed
    });
```

Then add a new describe block at the end of the file (before the final closing lines), exercising the image rule's success vs missing branches via a temp asset dir (reuse the file's existing `MINIMAL_JPEG` + `makeTempDir`):

```ts
describe('renderDigDeeperDoc — slide image class (dig-slide)', () => {
  function summaryWithImageSection(): ParsedSummary {
    return {
      title: 'T', channel: null, duration: null,
      url: 'https://www.youtube.com/watch?v=vid123', lang: 'EN', videoId: 'vid123',
      tldr: null, takeaways: [], sourceMd: 'test.md',
      sections: [{ numeral: '1', title: 'S', prose: 'p', timeRange: { startSec: 10, endSec: 20 } }],
    } as unknown as ParsedSummary;
  }
  const dug = (md: string): DugSection[] => [{
    sectionId: 10, startSec: 10, title: 'S', bodyMarkdown: md,
    generatedAt: 'g', genVersion: DIG_GENERATOR_VERSION,
  } as unknown as DugSection];

  it('adds class="dig-slide" to a successfully inlined slide <img>', () => {
    const dir = makeTempDir();
    fs.mkdirSync(path.join(dir, 'assets', 'vid123'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'assets', 'vid123', 's.jpg'), MINIMAL_JPEG);
    const html = renderDigDeeperDoc({
      summary: summaryWithImageSection(), envelope: null,
      dug: dug('![cap](assets/vid123/s.jpg)'),
      mdPath: path.join(dir, 'doc.md'), videoId: 'vid123',
    });
    expect(html).toMatch(/<img class="dig-slide" src="data:image\/jpeg;base64,/);
  });

  it('does NOT add dig-slide to a missing-asset slide (renders missing-slide span)', () => {
    const dir = makeTempDir();
    const html = renderDigDeeperDoc({
      summary: summaryWithImageSection(), envelope: null,
      dug: dug('![cap](assets/vid123/nope.jpg)'),
      mdPath: path.join(dir, 'doc.md'), videoId: 'vid123',
    });
    expect(html).toContain('class="missing-slide"');
    expect(html).not.toContain('dig-slide');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest render-dig-deeper -t "dig-slide"` and `npx jest render-dig-deeper -t "caps dug slide"`
Expected: FAIL — the CSS rule and the `class="dig-slide"` attribute do not exist yet (and the old `.dug img` string is still present).

- [ ] **Step 3: Implement the CSS change**

In `lib/html-doc/render-dig-deeper.ts`, in `DIG_DOC_CSS`, replace this line (≈132):

```ts
.dug img{margin:2em 0}
```

with:

```ts
.dg img.dig-slide{margin:2em auto;max-height:360px;border:1px solid var(--rule);cursor:zoom-in}
```

(`.dg img.dig-slide` — specificity 0,0,2,1 — beats the generic `.dg img` rule at line 48, so the `max-height` cap and centered `margin` actually apply. `height:auto` + `max-width:100%` are inherited from `.dg img`, so the image scales down preserving aspect.)

- [ ] **Step 4: Implement the class on the inlined `<img>`**

In `buildRenderer`, the success branch (≈118) currently returns:

```ts
      return `<img src="data:image/jpeg;base64,${b64}" alt="${esc(altAttr)}">`;
```

Change it to:

```ts
      return `<img class="dig-slide" src="data:image/jpeg;base64,${b64}" alt="${esc(altAttr)}">`;
```

Leave the other three branches untouched: containment-fail `return ''` (≈108), missing-file `<span class="missing-slide">` (≈115), non-asset `<img>` (≈122).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest render-dig-deeper`
Expected: PASS (all, including the updated `.dug img`/`.dig-slide` assertion and the two new class tests).

- [ ] **Step 6: Run the full suite**

Run: `npm test` then `npx tsc --noEmit`
Expected: all green, tsc clean.

- [ ] **Step 7: Commit**

```bash
git add lib/html-doc/render-dig-deeper.ts tests/lib/html-doc/render-dig-deeper.test.ts
git commit -m "feat(dig): cap slide image display size; tag inlined slides .dig-slide"
```

---

### Task 2: Click-to-zoom lightbox

**Files:**
- Modify: `lib/html-doc/render-dig-deeper.ts` — add zoom CSS to `DIG_DOC_CSS`; add `ZOOM_OVERLAY` markup + `ZOOM_SCRIPT` const; include both in the page shell (alongside `expandAllDialogs` / `NAV_SCRIPT`).
- Test: `tests/lib/html-doc/render-dig-deeper.test.ts` — presence assertions.
- Test (E2E): `tests/e2e/dig-deeper.spec.ts` — open + three dismissal paths + Esc-when-closed no-op.

**Interfaces:**
- Consumes: the `.dig-slide` class from Task 1 (click target).
- Produces: a `#_dg-zoom` overlay + inline script; no exported symbols.

- [ ] **Step 1: Write the failing jest presence tests**

Add to `tests/lib/html-doc/render-dig-deeper.test.ts` (inside the existing top-level describe that builds `html`, near the other CSS/markup assertions):

```ts
    it('includes the zoom overlay markup and script (z-index 9500)', () => {
      expect(html).toContain('class="dg-zoom"');
      expect(html).toContain('id="_dg-zoom-img"');
      expect(html).toContain('z-index:9500');
      expect(html).toContain("getElementById('_dg-zoom')"); // ZOOM_SCRIPT wired
    });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest render-dig-deeper -t "zoom overlay"`
Expected: FAIL — no zoom markup/script yet.

- [ ] **Step 3: Implement zoom CSS**

In `lib/html-doc/render-dig-deeper.ts`, append to `DIG_DOC_CSS` (before its closing backtick):

```ts
.dg-zoom{display:none;position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:9500;align-items:center;justify-content:center;cursor:zoom-out}
.dg-zoom[data-open]{display:flex}
.dg-zoom img{max-width:95vw;max-height:95vh;object-fit:contain;border-radius:4px}
.dg-zoom-close{position:fixed;top:1rem;right:1.2rem;font-size:1.6rem;line-height:1;color:#fff;background:none;border:none;cursor:pointer;z-index:9501}
```

- [ ] **Step 4: Add the overlay markup + script constants**

In `lib/html-doc/render-dig-deeper.ts`, after the `expandAllDialogs` template literal (≈263), add:

```ts
  const zoomOverlay = `
<div class="dg-zoom" id="_dg-zoom" role="dialog" aria-modal="true" aria-label="Enlarged slide">
  <button class="dg-zoom-close" id="_dg-zoom-close" aria-label="Close">✕</button>
  <img id="_dg-zoom-img" alt="">
</div>`;

  const zoomScript = `<script>(function(){
  var ov=document.getElementById('_dg-zoom'),im=document.getElementById('_dg-zoom-img');
  if(!ov||!im)return;
  function close(){ov.removeAttribute('data-open');im.removeAttribute('src');}
  document.addEventListener('click',function(e){
    var t=e.target;
    if(t&&t.classList&&t.classList.contains('dig-slide')){im.src=t.getAttribute('src');im.alt=t.getAttribute('alt')||'';ov.setAttribute('data-open','');return;}
    if(t===ov||(t&&t.id==='_dg-zoom-close')){close();}
  });
  document.addEventListener('keydown',function(e){
    if(e.key==='Escape'&&ov.hasAttribute('data-open')){close();}
  });
})();</script>`;
```

- [ ] **Step 5: Include overlay + script in the page shell**

In the returned HTML template (≈277–283), add `${zoomOverlay}` next to `${expandAllDialogs}` and `${zoomScript}` next to `${NAV_SCRIPT}${THEME_TOGGLE_SCRIPT}`:

```ts
<article class="dg">
${bodyHtml}
</article>
${expandAllDialogs}${zoomOverlay}
${NAV_SCRIPT}${THEME_TOGGLE_SCRIPT}${zoomScript}
</body>
</html>`;
```

- [ ] **Step 6: Run the jest presence test**

Run: `npx jest render-dig-deeper -t "zoom overlay"`
Expected: PASS.

- [ ] **Step 7: Write the failing E2E behavior tests**

In `tests/e2e/dig-deeper.spec.ts`, add a test that reuses the existing `makeCompanionHtmlWithSlides()` helper (line 78 — it renders the dig-deeper doc for `VIDEO_ID_SLIDES` with a base64 slide `<img>`, now a `.dig-slide`). Mirror the direct `page.route` + `page.goto` pattern used by `F5a` (≈542–548):

```ts
test('Z1 (zoom lightbox): click .dig-slide opens overlay; backdrop, Esc, and ✕ all close; Esc-when-closed is a no-op', async ({ page }) => {
  const html = makeCompanionHtmlWithSlides();
  await page.route(`**/api/html/${VIDEO_ID_SLIDES}**`, (route) =>
    route.fulfill({ status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: html }),
  );
  await page.goto(`http://localhost:3000/api/html/${VIDEO_ID_SLIDES}?outputFolder=${encodeURIComponent(OUTPUT_FOLDER)}&type=dig-deeper`);

  const overlay = page.locator('#_dg-zoom');
  const slide = page.locator('img.dig-slide').first();
  await expect(slide).toBeVisible();

  // Esc with the lightbox CLOSED must not throw or open anything.
  await page.keyboard.press('Escape');
  await expect(overlay).toBeHidden();

  // open → backdrop click closes
  await slide.click();
  await expect(overlay).toBeVisible();
  await overlay.click({ position: { x: 5, y: 5 } }); // backdrop (corner, not the image)
  await expect(overlay).toBeHidden();

  // open → Esc closes
  await slide.click();
  await expect(overlay).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(overlay).toBeHidden();

  // open → ✕ closes
  await slide.click();
  await expect(overlay).toBeVisible();
  await page.locator('#_dg-zoom-close').click();
  await expect(overlay).toBeHidden();
});
```

Note: `makeCompanionHtmlWithSlides()` already exists in this spec (line 78) and writes a temp asset + renders the dig-deeper doc with a base64 slide — reuse it, do not invent a new renderer. The `.dg-zoom` CSS uses `display:none → flex`, so Playwright's `toBeVisible()`/`toBeHidden()` track the `[data-open]` state correctly.

- [ ] **Step 8: Run the E2E test**

Run: `npx playwright test dig-deeper --grep "Z1"`
Expected: PASS (overlay opens on click; all three dismissal paths close it; Esc-when-closed leaves it hidden).

- [ ] **Step 9: Run the full suite**

Run: `npm test` then `npx tsc --noEmit`
Expected: all green, tsc clean.

- [ ] **Step 10: Commit**

```bash
git add lib/html-doc/render-dig-deeper.ts tests/lib/html-doc/render-dig-deeper.test.ts tests/e2e/dig-deeper.spec.ts
git commit -m "feat(dig): click-to-zoom lightbox for slide images (Esc/backdrop/✕ dismiss)"
```

---

## Notes for the implementer
- If `npx playwright test` needs a dev server (`webServer` in `playwright.config`), follow the repo's existing E2E run convention — the other dig-deeper E2E tests already run under it; do not add a new server.
- Do NOT touch `lib/dig/slides.ts` or any capture/asset code — this feature is render-only.
- Keep the inline `zoomScript` ES5-plain (no arrow fns/`const`) to match `NAV_SCRIPT`'s style and avoid any transpile assumptions in the served doc.
