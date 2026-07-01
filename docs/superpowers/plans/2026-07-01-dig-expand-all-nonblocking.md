# Dig-Deeper Non-Blocking Expand-All — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the dig-deeper doc's full-screen expand-all progress overlay into a non-blocking bottom status bar so the reader can keep scrolling/reading while sections generate.

**Architecture:** Presentation-only change to the exported dig-deeper HTML doc. Split the shared `#_dg-ea-dlg,#_dg-ea-prog` CSS rule so the confirm dialog stays a centered blocking modal while the progress element (`#_dg-ea-prog`) becomes a `position:fixed;bottom:0` full-width bar. The `_eaRunBatch` loop state machine (`nav.ts`) is unchanged except for progress copy; it keeps the same element IDs and `[data-open]` open/close mechanism, so existing E1–E6 E2E tests continue to pass.

**Tech Stack:** Next.js, TypeScript, inline ES5 JS in render templates, Jest (render-string tests), Playwright (E2E). Test runner: SWC (no typecheck) — `tsc --noEmit` is the real type gate.

## Global Constraints

- No generator/version bump — this is render-only; existing docs pick up the bar on next render/serve.
- No new dependency, API route, or server change.
- Bar must use the doc's theme CSS variables (`--card`, `--rule`, `--ink`, `--meta`) so it renders in both light and dark exports (same variables `#_dg-ai-toast` already uses).
- Preserve element IDs `#_dg-ea-prog`, `#_dg-ea-prog-msg`, `#_dg-ea-fail-msg`, `#_dg-ea-cancel-prog` and the `[data-open]` mechanism (existing E2E depends on them).
- Progress copy: running = `Expanding — section k of N…`; failure = `Done with M failure(s).` + `Failed sections: …`.
- Embedded JS is ES5-plain (matches NAV_SCRIPT) — no `let`/`const`/arrow/template-literal in `nav.ts` script string.

---

### Task 1: Restyle progress overlay as a non-blocking bottom bar

**Files:**
- Modify: `lib/html-doc/render-dig-deeper.ts:165-171` (split CSS rule; add bar styles), `:337-343` (progress markup → bar layout)
- Modify: `lib/html-doc/nav.ts:289` (progress copy prefix)
- Test: `tests/lib/html-doc/render-dig-deeper.test.ts` (new describe block)

**Interfaces:**
- Consumes: existing `renderDigDeeperDoc(...)` → full HTML string (tests already build `html` via `makeSummaryWithDugSection` / `makeDugWithBody`).
- Produces: same HTML string; `#_dg-ea-prog` now a bottom bar, `#_dg-ea-dlg` unchanged.

- [ ] **Step 1: Write the failing render-string tests**

Append to `tests/lib/html-doc/render-dig-deeper.test.ts`:

```typescript
describe('Expand-all progress is a non-blocking bottom bar', () => {
  // renderDigDeeperDoc embeds the full <style> block; assert on the raw CSS/markup.
  let html: string;
  beforeAll(() => {
    const dir = makeTempDir();
    html = renderDigDeeperDoc({
      summary: makeSummaryWithDugSection(10),
      dug: [makeDugWithBody(10, 'Body prose.')],
      videoId: 'vid_test',
      outputFolder: dir,
    } as Parameters<typeof renderDigDeeperDoc>[0]);
  });

  it('progress overlay is pinned to the bottom (bottom:0)', () => {
    expect(html).toContain('#_dg-ea-prog{display:none;position:fixed;left:0;right:0;bottom:0');
  });

  it('progress overlay does NOT use a full-viewport inset:0 backdrop', () => {
    // The only inset:0 fixed overlays left are the confirm dialog and the zoom lightbox,
    // never the progress bar. Assert the progress selector is not part of an inset:0 rule.
    expect(html).not.toContain('#_dg-ea-prog{display:none;position:fixed;inset:0');
    expect(html).not.toContain('#_dg-ea-dlg,#_dg-ea-prog{');
  });

  it('confirm dialog is still a centered inset:0 blocking modal', () => {
    expect(html).toContain('#_dg-ea-dlg{display:none;position:fixed;inset:0');
  });

  it('progress bar markup uses a flat bar container, not the centered card', () => {
    expect(html).toContain('id="_dg-ea-prog"');
    expect(html).toContain('class="_dg-bar"');
    expect(html).toContain('id="_dg-ea-prog-msg"');
    expect(html).toContain('id="_dg-ea-cancel-prog"');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest render-dig-deeper -t "non-blocking bottom bar"`
Expected: FAIL — current HTML still contains `#_dg-ea-dlg,#_dg-ea-prog{...inset:0...}` and `class="_dg-box"` in the progress block, not `_dg-bar`.

- [ ] **Step 3: Split the CSS rule in `render-dig-deeper.ts`**

Replace the shared rule (lines 165-166):

```
#_dg-ea-dlg,#_dg-ea-prog{display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9000;align-items:center;justify-content:center}
#_dg-ea-dlg[data-open],#_dg-ea-prog[data-open]{display:flex}
```

with:

```
#_dg-ea-dlg{display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9000;align-items:center;justify-content:center}
#_dg-ea-dlg[data-open]{display:flex}
#_dg-ea-prog{display:none;position:fixed;left:0;right:0;bottom:0;z-index:9000}
#_dg-ea-prog[data-open]{display:block}
._dg-bar{display:flex;align-items:center;gap:1em;background:var(--card,#fff);border-top:1px solid var(--rule);padding:.7em 1.2em;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:.9rem;color:var(--ink);box-shadow:0 -2px 12px rgba(0,0,0,.12)}
._dg-bar #_dg-ea-prog-msg{flex:1;margin:0}
._dg-bar #_dg-ea-fail-msg{margin:0}
._dg-bar button{margin-left:auto;padding:.3em .9em;border-radius:4px;font-size:.85rem;cursor:pointer;border:1px solid var(--rule)}
```

(Keep lines 167-171 unchanged: `._dg-box` styles the dialog card; `#_dg-ea-cancel-dlg,#_dg-ea-cancel-prog{background:none;color:var(--meta)}` still colors the progress Cancel button.)

- [ ] **Step 4: Change the progress markup to a bar in `render-dig-deeper.ts`**

Replace the progress overlay block (lines 337-343):

```
<div id="_dg-ea-prog" role="status">
  <div class="_dg-box">
    <p id="_dg-ea-prog-msg">Starting…</p>
    <p id="_dg-ea-fail-msg" style="color:#c00;display:none"></p>
    <button id="_dg-ea-cancel-prog">Cancel</button>
  </div>
</div>
```

with:

```
<div id="_dg-ea-prog" role="status">
  <div class="_dg-bar">
    <span id="_dg-ea-prog-msg">Starting…</span>
    <span id="_dg-ea-fail-msg" style="color:#c00;display:none"></span>
    <button id="_dg-ea-cancel-prog">Cancel</button>
  </div>
</div>
```

(Confirm dialog block at lines 330-336 stays `._dg-box` — unchanged.)

- [ ] **Step 5: Update the progress copy in `nav.ts`**

At `lib/html-doc/nav.ts:289`, change:

```javascript
_eaProgMsg.textContent='section '+k+' of '+N+'\\u2026';
```

to:

```javascript
_eaProgMsg.textContent='Expanding \\u2014 section '+k+' of '+N+'\\u2026';
```

(`—` = em dash. Still contains `of N`, so existing E2E `toContainText('of 3')` at dig-deeper.spec.ts:1516 stays green.)

- [ ] **Step 6: Run the new render-string tests**

Run: `npx jest render-dig-deeper -t "non-blocking bottom bar"`
Expected: PASS (all 4).

- [ ] **Step 7: Run the full render-dig-deeper + nav suites (no regressions)**

Run: `npx jest render-dig-deeper nav`
Expected: PASS.

- [ ] **Step 8: Type gate**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add lib/html-doc/render-dig-deeper.ts lib/html-doc/nav.ts tests/lib/html-doc/render-dig-deeper.test.ts
git commit -m "feat: non-blocking bottom bar for dig-deeper expand-all progress"
```

---

### Task 2: E2E — document stays scrollable and bar is bottom-pinned during expand-all

**Files:**
- Test: `tests/e2e/dig-deeper.spec.ts` (new test in the ⤢ expand-all describe region near line 1307)

**Interfaces:**
- Consumes: existing expand-all E2E harness — `stubHtmlRoutes`, the per-section POST/SSE stubs used by E1–E6 (see lines 1307–1815). Reuse the same fixture builders and route stubs that back the existing `#_dg-ea-prog` tests.

- [ ] **Step 1: Write the failing E2E test**

Add near the other expand-all tests in `tests/e2e/dig-deeper.spec.ts` (reuse the exact fixture + route-stub setup pattern from the existing E2 "confirm → progress" test around line 1490):

```typescript
test('E7 (non-blocking): during expand-all the progress element is a bottom bar and the doc stays scrollable', async ({ page }) => {
  // ── reuse the same fixture + stubs as the E2 progress test ──
  // (copy the setup lines from the existing "confirm → progress overlay" test:
  //  build the 3-section summary+companion, call the expand-all route stubs,
  //  and navigate to the dig-deeper doc URL.)
  // <SETUP: identical to E2 — do not paraphrase; copy the concrete setup block>

  await page.locator('.dg-expand-all').click();
  await expect(page.locator('#_dg-ea-dlg[data-open]')).toBeVisible({ timeout: 3000 });
  await page.locator('#_dg-ea-confirm').click();

  const prog = page.locator('#_dg-ea-prog[data-open]');
  await expect(prog).toBeVisible({ timeout: 3000 });

  // (a) progress element is a bottom bar, not a full-viewport overlay
  const box = await prog.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box).not.toBeNull();
  // bar sits at/near the bottom edge…
  expect(box!.y + box!.height).toBeGreaterThan(viewport.height - 4);
  // …and is short (does NOT cover the whole viewport height)
  expect(box!.height).toBeLessThan(viewport.height / 2);

  // (b) the document is scrollable while the batch runs (page not covered)
  const before = await page.evaluate(() => window.scrollY);
  await page.mouse.wheel(0, 600);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before);

  // (c) progress copy reads "Expanding — section N of 3…"
  await expect(page.locator('#_dg-ea-prog-msg')).toContainText('Expanding', { timeout: 5000 });
  await expect(page.locator('#_dg-ea-prog-msg')).toContainText('of 3');

  // let the batch finish and auto-dismiss
  await expect(page.locator('#_dg-ea-prog[data-open]')).toHaveCount(0, { timeout: 15000 });
});
```

> Implementer note: the summary must be tall enough to scroll. If the 3-section fixture is short, add filler prose to a section body (the existing fixtures render full magazine bodies, which are typically taller than the viewport at default width). If it still doesn't scroll, shrink the viewport via `page.setViewportSize({ width: 900, height: 500 })` before navigating.

- [ ] **Step 2: Run it to confirm it fails first (pre-implementation baseline)**

If Task 1 is already committed, this test should PASS. To confirm the test is meaningful, temporarily `git stash` Task 1's `render-dig-deeper.ts`/`nav.ts` changes, run, and observe failure on the bounding-box / scroll assertions, then `git stash pop`.

Run: `npx playwright test dig-deeper --grep "E7"`
Expected (pre-Task-1): FAIL on bottom-bar / scrollable assertions. (post-Task-1): PASS.

- [ ] **Step 3: Run the full expand-all E2E group (no regressions)**

Run: `npx playwright test dig-deeper --grep "expand"`
Expected: PASS (E1–E7).

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/dig-deeper.spec.ts
git commit -m "test(e2e): expand-all progress is non-blocking bottom bar (E7)"
```

---

## Self-Review

- **Spec coverage:** Behaviors 1–3 (dialog blocking / bar not full-screen / doc scrollable) → Task 1 render tests + Task 2 E2E. Behavior 4 (copy) → Task 1 Step 5 + Task 2 (c). Behaviors 5–8 (live swap, cancel, auto-dismiss, failure summary) → unchanged loop, covered by existing E2–E6. Behaviors 9–11 (N=0 guard, manual dig skip, thin bar) → unchanged logic / existing guards; no new code, verified by existing suite staying green.
- **Placeholder scan:** The only deliberate `<SETUP: …>` marker in Task 2 Step 1 instructs copying the existing E2 setup verbatim rather than paraphrasing (avoids drift from the real route stubs). All other steps carry concrete code.
- **Type consistency:** Element IDs (`#_dg-ea-prog`, `#_dg-ea-prog-msg`, `#_dg-ea-fail-msg`, `#_dg-ea-cancel-prog`) and class `_dg-bar` are used consistently across CSS, markup, and tests. `renderDigDeeperDoc` argument shape is passed through from existing test helpers.
