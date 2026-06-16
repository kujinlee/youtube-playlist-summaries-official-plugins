# Dark-Mode Toggle for HTML Exports — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a system-following, toggle-able light/dark theme to both HTML export documents (magazine-skim summary and deep-dive), each with a palette true to its own light identity.

**Architecture:** A new pure module `lib/html-doc/theme.ts` generates the theming CSS (light defaults + explicit overrides + `prefers-color-scheme` dark + toggle button styling) from two palette objects, and exports the FOUC-safe head script, toggle button markup, and toggle handler script. The two existing renderers refactor their hardcoded hex to CSS `var(--…)` references, define their own light/dark palette objects, and inject the four theme pieces. No I/O, parse, or route changes.

**Tech Stack:** TypeScript, Jest + ts-jest (unit/component), @testing-library not needed (string assertions), Playwright (E2E). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-16-darkmode-html-export-design.md`

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `lib/html-doc/theme.ts` | Theme CSS generator + head script + toggle button + toggle handler. Pure, no user data. | **Create** |
| `tests/lib/html-doc/theme.test.ts` | Unit tests for the generator + script constants. | **Create** |
| `lib/html-doc/render.ts` | Magazine renderer — refactor hex→vars, define palettes, inject theme. | **Modify** |
| `tests/lib/html-doc/render.test.ts` | Add no-regression + injection assertions. | **Modify** |
| `lib/html-doc/render-deep-dive.ts` | Deep-dive renderer — same treatment, cool/purple dark. | **Modify** |
| `tests/lib/html-doc/render-deep-dive.test.ts` | Add no-regression + injection assertions. | **Modify** |
| `tests/e2e/darkmode-html.spec.ts` | E2E: system default, toggle, persistence, print. | **Create** |
| `prototype-darkmode/` | Throwaway spike. | **Delete (final task)** |

---

## Enumerated Behaviors

`# | Behavior | Trigger | Expected`

**theme.ts generator (`themeStyleBlock`)**
1 | Light vars on `:root` | call with `light`,`dark` | output contains `:root{--page:#…;…}` with every light key
2 | Explicit light override | — | output contains `[data-theme="light"]{…light…}`
3 | Explicit dark override | — | output contains `[data-theme="dark"]{…dark…}`
4 | System-dark for un-toggled doc | — | output contains `@media(prefers-color-scheme:dark){:root:not([data-theme]){…dark…}}`
5 | Toggle button styled | — | output contains `#theme-toggle{` with `position:fixed` and `var(--card)`/`var(--ink)`
6 | Transition gated to post-load | — | output contains `html.theme-ready` + `transition:background-color .2s,color .2s` (no fade on dark load — H1)
7 | Print forces light + hides toggle | — | print block re-applies light vars to `:root,[data-theme="light"],[data-theme="dark"]` and hides `#theme-toggle` (H3)
8 | Empty-key safety (edge) | `light={}` | does not throw; emits `:root{}`

**theme.ts head script (`THEME_HEAD_SCRIPT`)**
9 | Reads stored key | page load | script string contains `localStorage.getItem('html-doc-theme')`
10 | Accepts only dark/light | — | script contains `t==='dark'||t==='light'`
11 | Storage failure is silent | localStorage throws | script wraps access in `try{…}catch(e){}`
12 | Applies override before paint | — | script sets `document.documentElement.setAttribute('data-theme',t)`

**theme.ts toggle button (`THEME_TOGGLE_BUTTON`)**
13 | Accessible button | — | contains `id="theme-toggle"`, `aria-label`, `type="button"`

**theme.ts toggle script (`THEME_TOGGLE_SCRIPT`)**
14 | Effective theme uses system when unset | — | script references `matchMedia` and `prefers-color-scheme: dark`
15 | Click flips + saves | click | script sets `data-theme` and `localStorage.setItem('html-doc-theme',next)` inside try/catch
16 | Icon sync on load | load | script calls a sync that sets ☀/🌙 by effective theme

**render.ts (magazine) / render-deep-dive.ts (deep-dive)**
17 | No light regression | render | output contains each light value as `--key:hex` matching the OLD hardcoded hex
18 | Structural CSS references vars | render | e.g. `background:var(--page)`, `color:var(--ink)`
19 | `<html>` has no hardcoded data-theme | render | output does NOT contain `data-theme=` on the `<html>` tag
20 | Head script injected | render | output contains the head `<script>` with `html-doc-theme` inside `<head>`
21 | Toggle button after body | render | output contains `id="theme-toggle"` after `<body>`
22 | Toggle handler before /body | render | output contains the toggle `<script>` before `</body>`
23 | Existing behavior intact | render | all prior assertions (meta, escaping, KO, ghost) still pass

**E2E**
24 | System dark default | OS `colorScheme:dark`, no override | `document.body` computed background = dark page color
25 | System light default | OS `colorScheme:light`, no override | computed background = light page color
26 | Toggle flips | click `#theme-toggle` | `data-theme` becomes opposite of system; bg changes
27 | Override remembered | toggle then reload | `data-theme` reflects the saved choice after reload
28 | Print hides toggle | emulate print media | `#theme-toggle` not visible
29 | Explicit light beats dark OS | OS dark + toggle to light | `data-theme="light"`, body bg = light (regression for the `:not([data-theme])` guard — M1/MT1)
30 | No-override reload follows system | reload without toggling | `data-theme` null, body bg = system color (proves persistence is real, not system-following)
31 | Deep-dive follows system dark | OS dark, deep-dive doc | deep-dive body bg = `#0f1115`; toggle visible (M6)

---

## Task 1: `theme.ts` — theming module (unit TDD)

**Files:**
- Create: `lib/html-doc/theme.ts`
- Test: `tests/lib/html-doc/theme.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/html-doc/theme.test.ts`:

```ts
import {
  themeStyleBlock,
  THEME_HEAD_SCRIPT,
  THEME_TOGGLE_BUTTON,
  THEME_TOGGLE_SCRIPT,
  type Palette,
} from '../../../lib/html-doc/theme';

const LIGHT: Palette = { page: '#ffffff', card: '#fafafa', ink: '#111111', shadow: '0 1px 3px rgba(0,0,0,.08)' };
const DARK: Palette = { page: '#0f1115', card: '#16181d', ink: '#e3e6ea', shadow: '0 1px 3px rgba(0,0,0,.5)' };

describe('themeStyleBlock', () => {
  const css = themeStyleBlock(LIGHT, DARK);

  it('emits light vars on :root', () => {
    expect(css).toContain(':root{--page:#ffffff;--card:#fafafa;--ink:#111111;--shadow:0 1px 3px rgba(0,0,0,.08)}');
  });

  it('emits an explicit light override selector', () => {
    expect(css).toContain('[data-theme="light"]{--page:#ffffff');
  });

  it('emits an explicit dark override selector', () => {
    expect(css).toContain('[data-theme="dark"]{--page:#0f1115;--card:#16181d;--ink:#e3e6ea');
  });

  it('emits the system-dark media query for un-toggled documents', () => {
    expect(css).toContain('@media(prefers-color-scheme:dark){:root:not([data-theme]){--page:#0f1115');
  });

  it('styles the fixed toggle button using theme vars', () => {
    expect(css).toContain('#theme-toggle{');
    expect(css).toContain('position:fixed');
    expect(css).toContain('background:var(--card)');
    expect(css).toContain('color:var(--ink)');
  });

  it('gates the color transition behind a post-load readiness class (no load fade)', () => {
    expect(css).toContain('html.theme-ready');
    expect(css).toContain('transition:background-color .2s,color .2s');
  });

  it('forces the LIGHT palette and hides the toggle when printing', () => {
    // Print must re-apply light vars regardless of data-theme so a dark doc prints a light card.
    expect(css).toContain('@media print{:root,[data-theme="light"],[data-theme="dark"]{--page:#ffffff');
    expect(css).toContain('#theme-toggle{display:none}');
  });

  it('does not throw on an empty palette', () => {
    expect(() => themeStyleBlock({}, {})).not.toThrow();
    expect(themeStyleBlock({}, {})).toContain(':root{}');
  });
});

describe('THEME_HEAD_SCRIPT', () => {
  it('reads only the dark/light values from localStorage inside try/catch', () => {
    expect(THEME_HEAD_SCRIPT).toContain("localStorage.getItem('html-doc-theme')");
    expect(THEME_HEAD_SCRIPT).toContain("t==='dark'||t==='light'");
    expect(THEME_HEAD_SCRIPT).toContain('try{');
    expect(THEME_HEAD_SCRIPT).toContain('catch');
    expect(THEME_HEAD_SCRIPT).toContain("setAttribute('data-theme',t)");
  });
});

describe('THEME_TOGGLE_BUTTON', () => {
  it('is an accessible, typed button', () => {
    expect(THEME_TOGGLE_BUTTON).toContain('id="theme-toggle"');
    expect(THEME_TOGGLE_BUTTON).toContain('type="button"');
    expect(THEME_TOGGLE_BUTTON).toContain('aria-label=');
  });
});

describe('THEME_TOGGLE_SCRIPT', () => {
  it('computes effective theme from system when unset and persists toggles', () => {
    expect(THEME_TOGGLE_SCRIPT).toContain('prefers-color-scheme: dark');
    expect(THEME_TOGGLE_SCRIPT).toContain('matchMedia');
    expect(THEME_TOGGLE_SCRIPT).toContain("setItem('html-doc-theme',next)");
    expect(THEME_TOGGLE_SCRIPT).toContain('try{');
  });

  it('enables transitions only after first paint (requestAnimationFrame → theme-ready)', () => {
    expect(THEME_TOGGLE_SCRIPT).toContain('requestAnimationFrame');
    expect(THEME_TOGGLE_SCRIPT).toContain("classList.add('theme-ready')");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest theme.test`
Expected: FAIL — `Cannot find module '../../../lib/html-doc/theme'`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/html-doc/theme.ts`:

```ts
/** A flat set of CSS custom-property values, keyed by variable name (without the leading `--`). */
export type Palette = Record<string, string>;

const STORAGE_KEY = 'html-doc-theme';

/** Serialize a palette into a `--key:value;…` declaration list (no surrounding braces). */
function vars(palette: Palette): string {
  return Object.entries(palette)
    .map(([k, v]) => `--${k}:${v}`)
    .join(';');
}

/**
 * Emit the full theming CSS: light defaults (`:root` + explicit `[data-theme="light"]`),
 * explicit dark (`[data-theme="dark"]`), system-dark for un-toggled docs
 * (`@media prefers-color-scheme:dark` scoped to `:root:not([data-theme])`), the fixed
 * toggle button styling, the color transition, and the print rule hiding the toggle.
 *
 * The dark palette is emitted in BOTH the attribute selector and the media query so a
 * document the reader never toggled still follows the OS preference.
 *
 * Two correctness details:
 *  - The color transition is gated behind `html.theme-ready` (added by the toggle script on
 *    the first requestAnimationFrame) so a doc that loads in dark does NOT fade in from light.
 *  - The print block re-applies the LIGHT palette to every theme state so a dark doc prints a
 *    legible light card (the structural print rule additionally whitens the body / drops shadow).
 */
export function themeStyleBlock(light: Palette, dark: Palette): string {
  const l = vars(light);
  const d = vars(dark);
  return `
:root{${l}}
[data-theme="light"]{${l}}
[data-theme="dark"]{${d}}
@media(prefers-color-scheme:dark){:root:not([data-theme]){${d}}}
html.theme-ready,html.theme-ready *{transition:background-color .2s,color .2s}
#theme-toggle{position:fixed;top:1rem;right:1rem;width:2.4rem;height:2.4rem;border-radius:50%;border:1px solid rgba(128,128,128,.35);background:var(--card);color:var(--ink);font-size:1.1rem;line-height:1;cursor:pointer;box-shadow:var(--shadow);display:flex;align-items:center;justify-content:center;z-index:10}
@media print{:root,[data-theme="light"],[data-theme="dark"]{${l}}#theme-toggle{display:none}}
`;
}

/**
 * Inline `<head>` script — runs before first paint. Applies a saved override ONLY; absence
 * of a valid stored value leaves `data-theme` unset so the CSS media query follows the OS.
 * All storage access is wrapped so a throw (sandboxed/disabled storage) is a silent no-op.
 */
export const THEME_HEAD_SCRIPT =
  `<script>(function(){try{var t=localStorage.getItem('${STORAGE_KEY}');` +
  `if(t==='dark'||t==='light')document.documentElement.setAttribute('data-theme',t)}catch(e){}})();</script>`;

/** Toggle button markup, injected immediately after `<body>`. Icon is set by the handler. */
export const THEME_TOGGLE_BUTTON =
  `<button id="theme-toggle" type="button" aria-label="Toggle light and dark theme" title="Toggle light/dark">\u{1F319}</button>`;

/**
 * End-of-`<body>` handler. Effective theme = explicit `data-theme`, else system preference.
 * Click flips it, sets `data-theme`, persists to localStorage (try/catch), and syncs the icon.
 * After the first paint it adds `theme-ready` to <html> so subsequent theme changes animate
 * but the initial load does not (kills the light→dark fade for dark-default readers).
 */
export const THEME_TOGGLE_SCRIPT =
  `<script>(function(){` +
  `var root=document.documentElement,btn=document.getElementById('theme-toggle');if(!btn)return;` +
  `function systemDark(){return!!(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)}` +
  `function effective(){var a=root.getAttribute('data-theme');return a==='dark'||a==='light'?a:(systemDark()?'dark':'light')}` +
  `function syncIcon(){btn.textContent=effective()==='dark'?'☀️':'\u{1F319}'}` +
  `btn.addEventListener('click',function(){var next=effective()==='dark'?'light':'dark';` +
  `root.setAttribute('data-theme',next);try{localStorage.setItem('${STORAGE_KEY}',next)}catch(e){}syncIcon()});` +
  `syncIcon();requestAnimationFrame(function(){root.classList.add('theme-ready')})})();</script>`;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest theme.test`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add lib/html-doc/theme.ts tests/lib/html-doc/theme.test.ts
git commit -m "feat(html-doc): theming module — generator + toggle script/button"
```

---

## Task 2: Wire the magazine renderer (`render.ts`)

**Files:**
- Modify: `lib/html-doc/render.ts`
- Test: `tests/lib/html-doc/render.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/lib/html-doc/render.test.ts` (inside the existing `describe('renderMagazineHtml', …)`):

```ts
  it('keeps light-mode colors identical (no visual regression) via CSS vars', () => {
    const html = renderMagazineHtml(parsed, model);
    // EVERY light palette value must equal the previously-hardcoded hex (exhaustive — H4).
    const LIGHT_EXPECTED: Record<string, string> = {
      page: '#eef0f3', card: '#fbf9f6', ink: '#2a2622', meta: '#8a8276', rule: '#ece7df',
      ghost: '#f0e7d6', gold: '#b07700', goldline: '#e0a800', li: '#4a463f', foot: '#9a917f',
      shadow: '0 1px 3px rgba(0,0,0,.08)',
    };
    for (const [k, v] of Object.entries(LIGHT_EXPECTED)) {
      expect(html).toContain(`--${k}:${v}`);
    }
    // Structural rules now reference the vars
    expect(html).toContain('background:var(--page)');
    expect(html).toContain('color:var(--ink)');
  });

  it('ships warm Dark A values and a system-dark media query', () => {
    const html = renderMagazineHtml(parsed, model);
    expect(html).toContain('[data-theme="dark"]{--page:#1a1714');
    expect(html).toContain('--gold:#e6b54d');
    expect(html).toContain('@media(prefers-color-scheme:dark){:root:not([data-theme])');
  });

  it('injects the theme toggle + scripts and never hardcodes data-theme on <html>', () => {
    const html = renderMagazineHtml(parsed, model);
    expect(html).toContain('id="theme-toggle"');
    expect(html).toContain("localStorage.getItem('html-doc-theme')");
    expect(html).toContain("setItem('html-doc-theme',next)");
    expect(html).not.toMatch(/<html[^>]*data-theme=/);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest render.test -t "Dark A"`
Expected: FAIL — output still contains hardcoded `#eef0f3` background, no `var(--page)`, no toggle.

- [ ] **Step 3: Write minimal implementation**

Edit `lib/html-doc/render.ts`. Add the import at the top:

```ts
import type { ParsedSummary, MagazineModel } from './types';
import { themeStyleBlock, THEME_HEAD_SCRIPT, THEME_TOGGLE_BUTTON, THEME_TOGGLE_SCRIPT, type Palette } from './theme';
```

Add the palette objects above `CSS` (replace the existing `const CSS = …` block):

```ts
const LIGHT: Palette = {
  page: '#eef0f3', card: '#fbf9f6', ink: '#2a2622', meta: '#8a8276', rule: '#ece7df',
  ghost: '#f0e7d6', gold: '#b07700', goldline: '#e0a800', li: '#4a463f', foot: '#9a917f',
  shadow: '0 1px 3px rgba(0,0,0,.08)',
};
const DARK: Palette = {
  page: '#1a1714', card: '#221d18', ink: '#e8e2d6', meta: '#9a9082', rule: '#332c24',
  ghost: '#2e2820', gold: '#e6b54d', goldline: '#e0a800', li: '#cfc8ba', foot: '#8a8174',
  shadow: '0 1px 3px rgba(0,0,0,.5)',
};

const STRUCTURAL_CSS = `
*{box-sizing:border-box}
body{margin:0;background:var(--page);color:var(--ink);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",'Apple SD Gothic Neo',Helvetica,Arial,sans-serif}
.v4{max-width:50rem;margin:0 auto;background:var(--card);padding:2.8rem 3rem 4rem;box-shadow:var(--shadow)}
html.theme-ready .v4{transition:background-color .2s,color .2s}
.doc-title{font-family:${SERIF};font-size:2rem;line-height:1.2;margin:0 0 .15em}
.doc-meta{color:var(--meta);font-size:.9rem;margin:0 0 1.8em}
.callout{margin:0 0 2.4em;border-top:2px solid var(--goldline);border-bottom:2px solid var(--goldline);padding:1em 0}
.callout .lbl{color:var(--gold);letter-spacing:.12em;text-transform:uppercase;font-size:.7rem;font-weight:700;margin-bottom:.5em}
.callout p{margin:.2em 0 .8em}
.callout ul{padding-left:1.1em;margin:.4em 0 0}
.callout li{margin:.25em 0}
section{position:relative;padding:1.6em 0 1.2em;border-bottom:1px solid var(--rule)}
.ghost{font:700 4.5rem/1 Georgia,serif;color:var(--ghost);position:absolute;right:0;top:.1em;pointer-events:none;user-select:none}
h2{font-family:${SERIF};font-size:1.3rem;margin:.1em 0 .35em}
.lead{font-size:1.12rem;line-height:1.5;color:var(--gold);font-weight:600;margin:.2em 0 .8em;max-width:90%}
ul{padding-left:1.15em;margin:0}
li{margin:.4em 0;line-height:1.6;color:var(--li)}
footer{margin-top:2.5em;color:var(--foot);font-size:.8rem}
@media print{body{background:#fff}.v4{box-shadow:none}}
`;
```

Then update the returned template — change the `<head>` and `<body>` wiring. Replace the `<head>…</head>` `<style>` line and the `<body>` open/close:

```ts
  return `<!DOCTYPE html>
<html lang="${esc((parsed.lang || 'en').toLowerCase())}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="magazine-skim v1">
<meta name="source-md" content="${esc(sourceMd)}">
<meta name="video-id" content="${esc(parsed.videoId ?? '')}">
<title>${esc(parsed.title)}</title>
${THEME_HEAD_SCRIPT}
<style>${themeStyleBlock(LIGHT, DARK)}${STRUCTURAL_CSS}</style>
</head>
<body>
${THEME_TOGGLE_BUTTON}
<article class="v4">
  <h1 class="doc-title">${esc(parsed.title)}</h1>
  <p class="doc-meta">${metaLine}</p>
  ${callout}
  ${sections}
  <footer>Skim view — generated from the source note${footerSource}. Full text lives in the source <code>.md</code>.</footer>
</article>
${THEME_TOGGLE_SCRIPT}
</body>
</html>`;
```

(Delete the now-unused `const CSS = …`; `SERIF` stays.)

- [ ] **Step 4: Run the magazine tests**

Run: `npx jest render.test`
Expected: PASS — new assertions green AND all pre-existing assertions (meta, escaping, ghost, KO) still pass.

- [ ] **Step 5: Commit**

```bash
git add lib/html-doc/render.ts tests/lib/html-doc/render.test.ts
git commit -m "feat(html-doc): warm dark mode + toggle for magazine export"
```

---

## Task 3: Wire the deep-dive renderer (`render-deep-dive.ts`)

**Files:**
- Modify: `lib/html-doc/render-deep-dive.ts`
- Test: `tests/lib/html-doc/render-deep-dive.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/lib/html-doc/render-deep-dive.test.ts` (inside the existing `describe`):

```ts
  it('keeps light-mode colors identical via CSS vars (no regression)', () => {
    // EVERY light palette value must equal the previously-hardcoded hex (exhaustive — H4).
    const LIGHT_EXPECTED: Record<string, string> = {
      page: '#f3f4f6', card: '#fff', ink: '#1e1e22', h1: '#111', h2: '#5b46d6', h3: '#2a2540',
      h4: '#3a3550', link: '#5b46d6', hr: '#e6e6ea', strong: '#111', codebg: '#f5f4fb',
      preborder: '#e6e6ea', quote: '#6b7280', shadow: '0 1px 3px rgba(0,0,0,.07)',
    };
    for (const [k, v] of Object.entries(LIGHT_EXPECTED)) {
      expect(html).toContain(`--${k}:${v}`);
    }
    expect(html).toContain('background:var(--page)');
    expect(html).toContain('color:var(--ink)');
  });

  it('ships the cool/purple dark palette + system-dark media query', () => {
    expect(html).toContain('[data-theme="dark"]{--page:#0f1115');
    expect(html).toContain('--h2:#a99bf0');
    expect(html).toContain('@media(prefers-color-scheme:dark){:root:not([data-theme])');
  });

  it('injects the toggle + scripts and never hardcodes data-theme on <html>', () => {
    expect(html).toContain('id="theme-toggle"');
    expect(html).toContain("localStorage.getItem('html-doc-theme')");
    expect(html).not.toMatch(/<html[^>]*data-theme=/);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest render-deep-dive.test -t "dark palette"`
Expected: FAIL — no `var(--page)`, no dark selector, no toggle.

- [ ] **Step 3: Write minimal implementation**

Edit `lib/html-doc/render-deep-dive.ts`. Add the import after the markdown-it import:

```ts
import { themeStyleBlock, THEME_HEAD_SCRIPT, THEME_TOGGLE_BUTTON, THEME_TOGGLE_SCRIPT, type Palette } from './theme';
```

Replace the existing `const CSS = …` block with palettes + structural CSS:

```ts
const LIGHT: Palette = {
  page: '#f3f4f6', card: '#fff', ink: '#1e1e22', h1: '#111', h2: '#5b46d6', h3: '#2a2540', h4: '#3a3550',
  link: '#5b46d6', hr: '#e6e6ea', strong: '#111', codebg: '#f5f4fb', preborder: '#e6e6ea', quote: '#6b7280',
  shadow: '0 1px 3px rgba(0,0,0,.07)',
};
const DARK: Palette = {
  page: '#0f1115', card: '#16181d', ink: '#d8dbe0', h1: '#f2f3f5', h2: '#a99bf0', h3: '#cfc9ec', h4: '#b9b4dc',
  link: '#a99bf0', hr: '#2a2d34', strong: '#f2f3f5', codebg: '#20222a', preborder: '#2a2d34', quote: '#9aa0ab',
  shadow: '0 1px 3px rgba(0,0,0,.5)',
};

const STRUCTURAL_CSS = `
*{box-sizing:border-box}
body{margin:0;background:var(--page);color:var(--ink);line-height:1.65;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",'Apple SD Gothic Neo','Malgun Gothic',Helvetica,Arial,sans-serif}
.dd{max-width:52rem;margin:0 auto;background:var(--card);padding:2.6rem 3rem 4rem;box-shadow:var(--shadow)}
html.theme-ready .dd{transition:background-color .2s,color .2s}
.dd h1{font-size:1.9rem;line-height:1.25;margin:.2em 0 .5em;color:var(--h1)}
.dd h2{font-size:1.4rem;margin:1.8em 0 .4em;color:var(--h2)}
.dd h3{font-size:1.18rem;margin:1.5em 0 .3em;color:var(--h3)}
.dd h4{font-size:1.02rem;margin:1.2em 0 .3em;color:var(--h4)}
.dd p{margin:.7em 0}
.dd a{color:var(--link)}
.dd ul,.dd ol{padding-left:1.4em}
.dd li{margin:.3em 0}
.dd hr{border:0;border-top:1px solid var(--hr);margin:1.6em 0}
.dd strong{color:var(--strong)}
.dd code{font-family:'SF Mono',Menlo,Monaco,Consolas,monospace;font-size:.88em;background:var(--codebg);padding:.1em .35em;border-radius:4px}
.dd pre{background:var(--codebg);border:1px solid var(--preborder);border-radius:8px;padding:1em;overflow:auto;line-height:1.4}
.dd pre code{background:none;padding:0;font-size:.85em;white-space:pre}
.dd blockquote{border-left:3px solid var(--h2);margin:1em 0;padding:.2em 1em;color:var(--quote)}
@media print{body{background:#fff}.dd{box-shadow:none}}
`;
```

Then update the returned template `<head>`/`<body>` wiring:

```ts
  return `<!DOCTYPE html>
<html lang="${esc(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="deep-dive-html v1">
<meta name="source-md" content="${esc(sourceMd)}">
<meta name="video-id" content="${esc(videoId)}">
<title>${esc(title)}</title>
${THEME_HEAD_SCRIPT}
<style>${themeStyleBlock(LIGHT, DARK)}${STRUCTURAL_CSS}</style>
</head>
<body>
${THEME_TOGGLE_BUTTON}
<article class="dd">
${bodyHtml}</article>
${THEME_TOGGLE_SCRIPT}
</body>
</html>`;
```

- [ ] **Step 4: Run the deep-dive tests**

Run: `npx jest render-deep-dive.test`
Expected: PASS — new + all pre-existing assertions (frontmatter strip, headings, ASCII, escaping, CRLF, KO) green.

- [ ] **Step 5: Commit**

```bash
git add lib/html-doc/render-deep-dive.ts tests/lib/html-doc/render-deep-dive.test.ts
git commit -m "feat(html-doc): cool dark mode + toggle for deep-dive export"
```

---

## Task 4: E2E — runtime theme behavior (Playwright)

**Files:**
- Create: `tests/e2e/darkmode-html.spec.ts`

This serves REAL renderer output at an intercepted same-origin URL and drives the browser. Same-origin http guarantees reliable `localStorage` (the `file://` quirk of §6/§8 is covered by the try/catch fallback and Phase-4 manual check — not exercised here).

- [ ] **Step 1: Write the failing test**

Create `tests/e2e/darkmode-html.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
// Relative imports (NOT '@/…'): the '@/' alias is unproven for RUNTIME (value) imports under
// Playwright's loader — the only existing E2E '@/' import is `import type` (erased). (Review B1)
import { renderMagazineHtml } from '../../lib/html-doc/render';
import { renderDeepDiveHtml } from '../../lib/html-doc/render-deep-dive';
import type { ParsedSummary, MagazineModel } from '../../lib/html-doc/types';

const parsed: ParsedSummary = {
  title: 'Dark Mode Demo', channel: 'Chan', duration: '10:00', url: 'https://youtu.be/x',
  lang: 'EN', videoId: 'dm1', tldr: 'A summary.', takeaways: ['One point.'],
  sections: [{ numeral: '1', title: 'Section', prose: 'p' }], sourceMd: 'dark-mode-demo.md',
};
const model: MagazineModel = {
  sections: [{ lead: 'Lead.', bullets: [
    { label: 'A', text: 'x.' }, { label: 'B', text: 'y.' }, { label: 'C', text: 'z.' },
  ] }],
};

const DD_MD = `---
video_id: "dd-e2e"
lang: EN
---

# Deep Dive Dark Demo

Body paragraph for the dark-mode runtime check.
`;

const DOC_URL = 'https://example.test/doc.html';
const DD_URL = 'https://example.test/deepdive.html';

/** Intercept DOC_URL and return freshly-rendered magazine HTML. */
async function serveDoc(page: import('@playwright/test').Page) {
  const html = renderMagazineHtml(parsed, model);
  await page.route(DOC_URL, (route) =>
    route.fulfill({ status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: html }),
  );
}

/** Intercept DD_URL and return freshly-rendered deep-dive HTML (M6 — deep-dive coverage). */
async function serveDeepDive(page: import('@playwright/test').Page) {
  const html = renderDeepDiveHtml(DD_MD, 'deep-dive-dark-demo.md');
  await page.route(DD_URL, (route) =>
    route.fulfill({ status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: html }),
  );
}

const LIGHT_BG = 'rgb(238, 240, 243)'; // magazine #eef0f3
const DARK_BG = 'rgb(26, 23, 20)';     // magazine #1a1714
const DD_DARK_BG = 'rgb(15, 17, 21)';  // deep-dive #0f1115

test.describe('exported HTML dark mode', () => {
  test('follows system dark preference when never toggled', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await serveDoc(page);
    await page.goto(DOC_URL);
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe(DARK_BG);
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBeNull();
  });

  test('follows system light preference when never toggled', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await serveDoc(page);
    await page.goto(DOC_URL);
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe(LIGHT_BG);
  });

  test('toggle flips theme against the system preference', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await serveDoc(page);
    await page.goto(DOC_URL);
    await page.locator('#theme-toggle').click();
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('dark');
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe(DARK_BG);
  });

  test('explicit LIGHT override beats a dark OS preference (regression for the :not guard)', async ({ page }) => {
    // M1/MT1 — highest-value gap: OS dark + user explicitly chose light → light must win.
    await page.emulateMedia({ colorScheme: 'dark' });
    await serveDoc(page);
    await page.goto(DOC_URL);
    // System dark → first toggle flips to light (effective was 'dark').
    await page.locator('#theme-toggle').click();
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('light');
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe(LIGHT_BG);
  });

  test('remembers a manual override across reloads', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await serveDoc(page);
    await page.goto(DOC_URL);
    await page.locator('#theme-toggle').click(); // → dark, saved to localStorage
    await page.reload();
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('dark');
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe(DARK_BG);
  });

  test('without a prior toggle, reload stays on the system theme (persistence is real)', async ({ page }) => {
    // Proves the remembered-dark above came from storage, not from system-following.
    await page.emulateMedia({ colorScheme: 'light' });
    await serveDoc(page);
    await page.goto(DOC_URL);
    await page.reload();
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBeNull();
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(LIGHT_BG);
  });

  test('hides the toggle when printing', async ({ page }) => {
    await serveDoc(page);
    await page.goto(DOC_URL);
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('#theme-toggle')).toBeHidden();
  });

  test('deep-dive export follows system dark (M6 — deep-dive runtime coverage)', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await serveDeepDive(page);
    await page.goto(DD_URL);
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(DD_DARK_BG);
    // Toggle is wired in the deep-dive doc too.
    await expect(page.locator('#theme-toggle')).toBeVisible();
  });
});
```

- [ ] **Step 2: Run test to confirm the layer**

Task 4 is a **confirmation / E2E layer, not red-green TDD** — per the project TDD policy E2E/UI wiring is explicitly "No" for strict TDD (see `docs/dev-process.md` → TDD Policy). Because Tasks 1–3 commit the feature first, this spec is expected **GREEN on first run** after Task 3.

Run: `npx playwright test darkmode-html`
Expected: PASS (all scenarios).

To observe a meaningful RED instead, run this spec **after Task 1 but before Task 2** → FAIL: no `#theme-toggle`, body background stays light under emulated dark.

- [ ] **Step 3: Implementation**

No new code — behavior is delivered by Tasks 1–3. If a test fails, fix the renderer/theme module, not the test.

- [ ] **Step 4: Run E2E to verify it passes**

Run: `npx playwright test darkmode-html`
Expected: PASS — all 5 scenarios.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/darkmode-html.spec.ts
git commit -m "test(html-doc): E2E for dark-mode default, toggle, persistence, print"
```

---

## Task 5: Full suite + prototype cleanup

**Files:**
- Delete: `prototype-darkmode/`

- [ ] **Step 1: Run the full unit/component suite**

Run: `npm test`
Expected: PASS — no regressions across the whole jest suite.

- [ ] **Step 2: Run the full E2E suite**

Run: `npx playwright test`
Expected: PASS — existing html-doc/deep-dive E2E unaffected; new darkmode spec green.

- [ ] **Step 3: Remove the throwaway prototype**

```bash
git rm -r prototype-darkmode/ 2>/dev/null || rm -rf prototype-darkmode/
```
(The folder is untracked, so `rm -rf` is the likely path.)

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(html-doc): remove dark-mode prototype spike"
```

---

## Review Gates (per docs/dev-process.md)

After each implementation task: Claude code review (`superpowers:requesting-code-review`) → save `docs/reviews/task-N-darkmode-<name>-review.md`; Codex adversarial review (`codex:rescue --fresh`) → save `docs/reviews/task-N-darkmode-<name>-codex.md`; address all High/P1 before marking done.

Phase 4 verification (manual, on real `file://`): open a generated summary `.html` and deep-dive `.html` directly from disk; confirm (a) follows OS theme on first open, (b) toggle flips and the icon updates, (c) reload remembers the override, (d) Cmd-P preview hides the toggle and shows the light card. Save screenshots to `.screenshots/`, delete after.

---

## Self-Review

**Spec coverage:** D1 warm magazine dark → Task 2 palette ✓. D2 cool deep-dive dark → Task 3 palette ✓. D3 system default → behaviors #4/#24/#25, media query ✓. D4 remember override → behaviors #15/#27 ✓. D5 both exports → Tasks 2+3 ✓. D6 each-true-to-itself → distinct palettes per renderer ✓. D7 generator module → Task 1 ✓. §3 no hardcoded data-theme → behaviors #19, tests in Tasks 2/3 ✓. §6 global key → single `html-doc-theme` constant ✓. §7 error handling → try/catch in head + toggle scripts ✓. §8 testing layers → Tasks 1/2/3 (unit/component) + Task 4 (E2E) + Phase-4 manual ✓. §9 YAGNI (no proto-bar, no per-doc memory) → not built ✓.

**Placeholder scan:** no TBD/TODO; every code step shows full code; every run step shows command + expected output.

**Type consistency:** `Palette` type defined in Task 1, imported in Tasks 2/3. Function `themeStyleBlock(light, dark)` and constants `THEME_HEAD_SCRIPT`/`THEME_TOGGLE_BUTTON`/`THEME_TOGGLE_SCRIPT` named identically across all tasks. Storage key `'html-doc-theme'` identical in head script, toggle script, and tests.

---

## Revision Log — Adversarial Review (2026-06-16)

Review: `docs/reviews/plan-darkmode-html-export-adversarial.md` (Claude fallback; Codex usage-limited
until 2026-07-03 — **a manual Codex adversarial pass is still owed before merge**).

Addressed in this plan revision:
- **B1** — E2E uses relative imports (`../../lib/html-doc/…`), not the unproven `@/` runtime alias.
- **H1** — Color transition gated behind `html.theme-ready` (added on first `requestAnimationFrame`); removed the ungated `transition` from `.v4`/`.dd`. Kills the light→dark fade for dark-default readers. New behavior #6 + unit assertions.
- **H3** — `themeStyleBlock` print block re-applies the **light** palette to all theme states so a dark doc prints a light card (spec §7). New behavior #7 + unit assertion.
- **H4** — No-regression assertions now exhaustive (loop over every palette key) in Tasks 2 and 3.
- **M1/MT1** — Added E2E #29: OS dark + explicit light override → light wins (guards the `:not([data-theme])` invariant).
- **M3** — Task 4 reframed as a confirmation/E2E layer with an explicit RED recipe (run after Task 1, before Task 2).
- **M6** — Added E2E #31: deep-dive follows system dark + toggle present.
- **M2** (bonus) — Added E2E #30: no-override reload stays system, proving persistence is real.

Verified clean by the review, no change needed: **L1** (all shared vars present in all four palettes), **L2** (try/catch has no uncaught path), **L3** (rgb mapping correct), specificity/explicit-light cascade (correct via selector non-match).

**M4** (reuse fixture verbatim): the E2E `ParsedSummary`/`ParsedSection`/`MagazineModel` fixture shape was cross-checked against `lib/html-doc/types.ts` and matches — retained as written.
