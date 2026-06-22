/** A flat set of CSS custom-property values, keyed by variable name (without the leading `--`). */
export type Palette = Record<string, string>;

/**
 * Shared magazine palette prefix (keys: page, card, ink).
 * Both renderers agree on these values and key order.
 * render.ts inserts `meta` after `ink` (between PRE and POST); render-deep-dive.ts appends
 * `meta` after its renderer-specific keys.
 * Split into pre/post to allow byte-identical insertion.
 */
export const BASE_PALETTE_LIGHT_PRE: Palette = {
  page: '#eef0f3', card: '#fbf9f6', ink: '#2a2622',
};
/**
 * Shared magazine palette suffix (keys: rule, ghost, gold, goldline, li, foot, shadow).
 * Used by both renderers after any renderer-specific mid-keys.
 */
export const BASE_PALETTE_LIGHT_POST: Palette = {
  rule: '#ece7df', ghost: '#f0e7d6', gold: '#b07700', goldline: '#e0a800',
  li: '#4a463f', foot: '#9a917f', shadow: '0 1px 3px rgba(0,0,0,.08)',
};

/** Dark counterpart to BASE_PALETTE_LIGHT_PRE. */
export const BASE_PALETTE_DARK_PRE: Palette = {
  page: '#1a1714', card: '#221d18', ink: '#e8e2d6',
};
/** Dark counterpart to BASE_PALETTE_LIGHT_POST. */
export const BASE_PALETTE_DARK_POST: Palette = {
  rule: '#332c24', ghost: '#2e2820', gold: '#e6b54d', goldline: '#e0a800',
  li: '#cfc8ba', foot: '#8a8174', shadow: '0 1px 3px rgba(0,0,0,.5)',
};

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
 *  - The print block re-applies the LIGHT palette to every theme state — including the
 *    un-toggled system-dark case `:root:not([data-theme])`, which must be listed explicitly
 *    because it outranks a bare `:root` (0,2,0 vs 0,1,0) and would otherwise keep the dark
 *    palette when printing on a dark OS — so a dark doc always prints a legible light card
 *    (the structural print rule additionally whitens the body / drops shadow).
 */
export function themeStyleBlock(light: Palette, dark: Palette): string {
  const l = vars(light);
  const d = vars(dark);
  return `
:root{${l}}
[data-theme="light"]{${l}}
[data-theme="dark"]{${d}}
@media(prefers-color-scheme:dark){:root:not([data-theme]){${d}}}
html.theme-ready body,html.theme-ready #theme-toggle{transition:background-color .2s,color .2s}
#theme-toggle{position:fixed;top:1rem;right:1rem;width:2.4rem;height:2.4rem;border-radius:50%;border:1px solid rgba(128,128,128,.35);background:var(--card);color:var(--ink);font-size:1.1rem;line-height:1;cursor:pointer;box-shadow:var(--shadow);display:flex;align-items:center;justify-content:center;z-index:10}
@media print{:root,:root:not([data-theme]),[data-theme="light"],[data-theme="dark"]{${l}}#theme-toggle{display:none}}
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
  `function syncIcon(){btn.textContent=effective()==='dark'?'\u{2600}\u{FE0F}':'\u{1F319}'}` +
  `btn.addEventListener('click',function(){var next=effective()==='dark'?'light':'dark';` +
  `root.setAttribute('data-theme',next);try{localStorage.setItem('${STORAGE_KEY}',next)}catch(e){}syncIcon()});` +
  `syncIcon();requestAnimationFrame(function(){root.classList.add('theme-ready')})})();</script>`;
