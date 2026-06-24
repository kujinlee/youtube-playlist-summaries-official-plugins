# Summary ↔ Deep-Dive Navigation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Timeline-based cross-navigation between summary and deep-dive HTML docs (render-only).

## Global Constraints
- `data-start` gated on PRESENCE of `timeRange`/`ts` (never truthiness on `startSec` — `0` is valid).
- Summary uses `s.timeRange.startSec`; deep-dive uses `startSecFromTsUrl(ts.url)`.
- `NAV_SCRIPT` injected end-of-body (after the DOM), alongside `THEME_TOGGLE_SCRIPT`.
- `hasDeepDive`/`hasSummary` default `false`; only the 4 production drivers pass them.
- Deep-dive version `{2,2}→{2,3}`; **summary version unchanged**.
- Full `npm test` + `npx tsc --noEmit` green before each commit.

---

### Task 1: `lib/html-doc/nav.ts` module

**Files:** Create `lib/html-doc/nav.ts`; Create `tests/lib/html-doc/nav.test.ts`

**Interfaces (Produces):**
- `startSecFromTsUrl(url: string): number | null`
- `digControl(targetType: 'summary' | 'deep-dive', startSec: number): string`
- `wireDigLinks(doc: Document, loc: { href: string }): void`
- `scrollToHashSection(doc: Document, loc: { hash: string }): void`
- `NAV_SCRIPT: string` (self-contained inline `<script>`, mirrors the two functions)
- `NAV_CSS: string` (the `.dig` rule)

- [ ] **Step 1: Write failing tests** `tests/lib/html-doc/nav.test.ts`. Two describes — a plain one (node) for the pure functions, and a jsdom one for the DOM functions:

```ts
/** @jest-environment jsdom */
import { startSecFromTsUrl, digControl, wireDigLinks, scrollToHashSection } from '../../../lib/html-doc/nav';

describe('startSecFromTsUrl', () => {
  it('parses t=<sec>s', () => { expect(startSecFromTsUrl('https://y/watch?v=x&t=185s')).toBe(185); });
  it('parses t=0s', () => { expect(startSecFromTsUrl('https://y/watch?v=x&t=0s')).toBe(0); });
  it('returns null when absent/malformed', () => { expect(startSecFromTsUrl('https://y/watch?v=x')).toBeNull(); });
});

describe('digControl', () => {
  it('builds a deep-dive control with data attrs', () => {
    const h = digControl('deep-dive', 16);
    expect(h).toContain('class="dig"');
    expect(h).toContain('data-type="deep-dive"');
    expect(h).toContain('data-t="16"');
    expect(h).toContain('dig deeper');
  });
  it('builds a summary control with data-t="0"', () => {
    expect(digControl('summary', 0)).toContain('data-t="0"');
  });
});

describe('wireDigLinks', () => {
  it('rebuilds the href from the current URL, swapping type + setting #t, preserving outputFolder + id', () => {
    document.body.innerHTML = '<a class="dig" data-type="deep-dive" data-t="200">x</a>';
    wireDigLinks(document, { href: 'http://h/api/html/vid9?outputFolder=%2FU%2Ff&type=summary' });
    const href = document.querySelector('a.dig')!.getAttribute('href')!;
    expect(href).toContain('/api/html/vid9');           // id preserved in path
    expect(href).toContain('type=deep-dive');
    expect(href.endsWith('#t=200')).toBe(true);
    const u = new URL('http://h' + href);
    expect(u.searchParams.get('outputFolder')).toBe('/U/f'); // round-trips, no double-encode
  });
});

describe('scrollToHashSection', () => {
  beforeEach(() => {
    document.body.innerHTML = '<section data-start="0">a</section><section data-start="200">b</section>';
    (HTMLElement.prototype as any).scrollIntoView = jest.fn();
  });
  it('scrolls to the section with the greatest data-start <= t', () => {
    scrollToHashSection(document, { hash: '#t=210' });
    expect((document.querySelector('[data-start="200"]') as any).scrollIntoView).toHaveBeenCalled();
  });
  it('lands on the start=0 section for a small t', () => {
    scrollToHashSection(document, { hash: '#t=5' });
    expect((document.querySelector('[data-start="0"]') as any).scrollIntoView).toHaveBeenCalled();
  });
  it('does nothing without a #t hash', () => {
    scrollToHashSection(document, { hash: '' });
    expect((document.querySelector('[data-start="0"]') as any).scrollIntoView).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — RED** (`npx jest html-doc/nav`).

- [ ] **Step 3: Implement `lib/html-doc/nav.ts`:**

```ts
/** Parse the `t=<sec>s` start time out of a ▶ link URL. */
export function startSecFromTsUrl(url: string): number | null {
  const m = url.match(/[?&]t=(\d+)s/);
  return m ? Number(m[1]) : null;
}

/** The cross-doc nav control (muted trailing link); href is computed client-side by wireDigLinks. */
export function digControl(targetType: 'summary' | 'deep-dive', startSec: number): string {
  const label = targetType === 'deep-dive' ? 'dig deeper ▾' : '↑ summary';
  return ` <a class="dig" data-type="${targetType}" data-t="${startSec}">${label}</a>`;
}

/** Rebuild each .dig href from the current serve URL: swap `type`, set `#t=`, inherit id+outputFolder. */
export function wireDigLinks(doc: Document, loc: { href: string }): void {
  doc.querySelectorAll('a.dig').forEach((a) => {
    const el = a as HTMLAnchorElement;
    const u = new URL(loc.href);
    u.searchParams.set('type', el.dataset.type as string);
    u.hash = 't=' + el.dataset.t;
    el.setAttribute('href', u.pathname + u.search + u.hash);
  });
}

/** Scroll to the section whose data-start is the greatest value <= the #t=<sec> in the URL. */
export function scrollToHashSection(doc: Document, loc: { hash: string }): void {
  const m = loc.hash.match(/^#t=(\d+)/);
  if (!m) return;
  const sec = Number(m[1]);
  const starts = Array.from(doc.querySelectorAll('[data-start]'))
    .map((e) => Number((e as HTMLElement).dataset.start));
  const target = Math.max(...starts.filter((s) => s <= sec), -1);
  if (target >= 0) (doc.querySelector(`[data-start="${target}"]`) as HTMLElement | null)?.scrollIntoView();
}

export const NAV_CSS =
  `.dig{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--meta);` +
  `font-size:.8rem;font-weight:400;text-decoration:none;white-space:nowrap;cursor:pointer}` +
  `.dig:hover{text-decoration:underline}`;

// Self-contained inline script (the browser can't import the module) — mirrors
// wireDigLinks + scrollToHashSection above. Injected at end-of-body (DOM ready).
export const NAV_SCRIPT = `<script>
(function(){
  document.querySelectorAll('a.dig').forEach(function(a){
    var u=new URL(location.href);
    u.searchParams.set('type',a.dataset.type);
    u.hash='t='+a.dataset.t;
    a.setAttribute('href',u.pathname+u.search+u.hash);
  });
  var m=location.hash.match(/^#t=(\\d+)/);
  if(m){
    var sec=+m[1];
    var starts=[].slice.call(document.querySelectorAll('[data-start]')).map(function(e){return +e.dataset.start;});
    var t=Math.max.apply(null,starts.filter(function(s){return s<=sec;}).concat([-1]));
    if(t>=0){var el=document.querySelector('[data-start="'+t+'"]'); if(el){el.scrollIntoView();}}
  }
})();
</script>`;
```

- [ ] **Step 4: Run — GREEN** (`npx jest html-doc/nav`). **Step 5: tsc + commit** — `feat(html-doc): nav.ts — cross-doc timeline navigation primitives`.

---

### Task 2: Wire nav into both renderers + drivers + version bump

**Files:** Modify `lib/html-doc/render.ts`, `lib/html-doc/render-deep-dive.ts`, `lib/html-doc/generate.ts`, `lib/html-doc/rerender.ts`, `lib/html-doc/generate-deep-dive.ts`, `lib/deep-dive/version.ts`; Tests: `tests/lib/html-doc/render.test.ts`, `render-deep-dive.test.ts`, `tests/lib/deep-dive/version.test.ts`, `tests/components/VideoMenu.test.tsx`

**Interfaces (Consumes):** `digControl`, `startSecFromTsUrl`, `NAV_SCRIPT`, `NAV_CSS` from Task 1.

- [ ] **Step 1: Failing tests.** Add the summary tests INSIDE the existing `describe('renderMagazineHtml — section timestamps')` block (so the file's `withTs` fixture — section0 `startSec:135`, section1 `timeRange:null` — and `model` are in scope):
```ts
it('emits data-start on the section + a dig-deeper control when hasDeepDive', () => {
  const html = renderMagazineHtml(withTs, model, true);
  expect(html).toMatch(/<section data-start="135">/);
  expect(html).toContain('class="dig" data-type="deep-dive" data-t="135"');
  expect(html).toContain('dig deeper');
  expect(html).toContain('a.dig'); // NAV_SCRIPT present (unique token)
});
it('omits the dig control when hasDeepDive is false (default)', () => {
  expect(renderMagazineHtml(withTs, model)).not.toContain('class="dig"');
});
it('emits data-start="0" for a 0:00 section (presence-gated, not truthiness)', () => {
  const zero = { ...withTs, sections: [
    { ...withTs.sections[0], timeRange: { ...withTs.sections[0].timeRange!, startSec: 0 } },
    withTs.sections[1],
  ] };
  expect(renderMagazineHtml(zero, model, true)).toMatch(/<section data-start="0">/);
});
it('puts data-start only on timeRange sections (section1 null → bare <section>)', () => {
  const html = renderMagazineHtml(withTs, model, true);
  expect((html.match(/<section data-start=/g) ?? []).length).toBe(1); // only section0
});
```
Add the deep-dive tests INSIDE the existing `describe('H3 subsection timestamps')` block (so `FM` is in scope), calling `renderDeepDiveHtml` directly with the 3rd arg:
```ts
it('emits data-start on <h2> + an "↑ summary" control when hasSummary', () => {
  const out = renderDeepDiveHtml(FM + '## Sec\n▶ [0:00–0:30](https://www.youtube.com/watch?v=v1&t=0s)\nbody\n', 'v1-deep-dive.md', true);
  expect(out).toMatch(/<h2 data-start="0"/);
  expect(out).toContain('class="dig" data-type="summary"');
  expect(out).toContain('a.dig'); // NAV_SCRIPT present
});
it('omits the dig control by default', () => {
  const out = renderDeepDiveHtml(FM + '## Sec\n▶ [0:00–0:30](https://www.youtube.com/watch?v=v1&t=0s)\nbody\n', 'v1-deep-dive.md');
  expect(out).not.toContain('class="dig"');
});
```
Update `tests/lib/deep-dive/version.test.ts` — BOTH the title at `:5` (`'current deep-dive version is 2.2'`→`'…2.3'`) AND the assertion at `:6` (`{ major: 2, minor: 3 }`). Update `tests/components/VideoMenu.test.tsx` deepDiveVersion fixtures `:34,:51,:67` `{2,2}→{2,3}` (leave the docVersion `{3,3}` fixtures at `:15,:27` untouched — summary version is NOT bumped).

- [ ] **Step 2: Run — RED.**

- [ ] **Step 3: Implement renderers.**
  - **render.ts:** import `{ digControl, NAV_SCRIPT, NAV_CSS }`. Signature → `renderMagazineHtml(parsed, model, hasDeepDive = false)`. In the sections map, build:
    ```ts
    const startSec = s.timeRange ? s.timeRange.startSec : null;
    const dataStart = startSec != null ? ` data-start="${startSec}"` : '';
    const dig = (hasDeepDive && startSec != null) ? digControl('deep-dive', startSec) : '';
    // …<section${dataStart}> … <h2>${esc(s.title)}${ts}${dig}</h2> …
    ```
    Append `${NAV_CSS}` to the `<style>` block; inject `${NAV_SCRIPT}` immediately before `${THEME_TOGGLE_SCRIPT}`.
  - **render-deep-dive.ts:** import `{ digControl, startSecFromTsUrl, NAV_SCRIPT, NAV_CSS }`. `renderDeepDiveHtml(mdContent, sourceMd, hasSummary = false)`; thread `hasSummary` into `renderSection` (add a param). In `renderSection`:
    ```ts
    const startSec = ts ? startSecFromTsUrl(ts.url) : null;
    const dataStart = startSec != null ? ` data-start="${startSec}"` : '';
    const dig = (hasSummary && startSec != null) ? digControl('summary', startSec) : '';
    const heading = `<h2${dataStart}>${md.renderInline(raw.heading)}${tsAnchor(ts)}${dig}</h2>`;
    ```
    Append `${NAV_CSS}` to STRUCTURAL_CSS-equivalent style; inject `${NAV_SCRIPT}` before the closing scripts (end-of-body).
  - **Drivers (4 call sites, all have `video` in scope):** `generate.ts` `runHtmlDoc` → `renderMagazineHtml(parsed, model, !!video.deepDiveMd)`; `rerender.ts:60` `reRenderSummaryHtml` → `renderMagazineHtml(parsed, envelope.model, !!video.deepDiveMd)`; `generate-deep-dive.ts:50` `runDeepDiveHtml` → `renderDeepDiveHtml(mdContent, md, !!video.summaryMd)`; `generate-deep-dive.ts:94` `reRenderDeepDiveHtml` → `renderDeepDiveHtml(mdContent, video.deepDiveMd, !!video.summaryMd)`.
  - **version.ts:** `CURRENT_DEEP_DIVE_VERSION = { major: 2, minor: 3 }` + comment `minor 3 = summary↔deep-dive nav controls`.

- [ ] **Step 4: Run — GREEN** (`npx jest render html-doc/render-deep-dive deep-dive/version VideoMenu`). Confirm existing render + H3 `section restructure` tests still pass.

- [ ] **Step 5: Full suite + tsc.** `grep -rn "minor: 2" tests/lib/deep-dive tests/components` to confirm no stray `{2,2}` deep-dive fixture left. (Summary `{3,3}` fixtures untouched — no summary bump.) All green.

- [ ] **Step 6: Commit** — `feat(html-doc): summary↔deep-dive nav controls; deep-dive version 2.3`. Trailers as usual.

## Post-implementation (migration — after merge)
1. **Deep-dive:** re-render all major-2 deep-dives via `reRenderDeepDiveHtml` (they gain `{2,3}` + "↑ summary").
2. **Summary:** for the 18 deep-dive videos, `reRenderSummaryHtml` each; expect ~13 `rerendered` (model present) and ~5 `skipped-no-model` (left partial — log them; NO Gemini).
3. Verify `uvg9UmI0PuQ` summary has `data-start` + "dig deeper", and the link resolves to `?type=deep-dive#t=<sec>`.

## Self-review notes
- Spec coverage: nav.ts (Task 1) + both renderers + 4 drivers + deep-dive bump (Task 2). No summary version bump (cost decision). Type consistency: `digControl`/`startSecFromTsUrl` signatures match usage; `hasDeepDive`/`hasSummary` appended (default false).
