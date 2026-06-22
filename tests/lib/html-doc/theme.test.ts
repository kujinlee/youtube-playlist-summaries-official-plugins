/** @jest-environment jsdom */
import {
  themeStyleBlock,
  THEME_HEAD_SCRIPT,
  THEME_TOGGLE_BUTTON,
  THEME_TOGGLE_SCRIPT,
  PRINT_BUTTON,
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
    expect(css).toContain('#theme-toggle,#print-btn{');
    expect(css).toContain('position:fixed');
    expect(css).toContain('background:var(--card)');
    expect(css).toContain('color:var(--ink)');
  });

  it('gates the color transition behind a post-load readiness class (no load fade)', () => {
    expect(css).toContain('html.theme-ready');
    expect(css).toContain('transition:background-color .2s,color .2s');
  });

  it('forces the LIGHT palette and hides the toggle when printing', () => {
    // The print selector MUST include :root:not([data-theme]) — otherwise the system-dark rule
    // (0,2,0) outranks a bare :root (0,1,0) and a never-toggled doc prints dark on a dark OS.
    expect(css).toContain('@media print{:root,:root:not([data-theme]),[data-theme="light"],[data-theme="dark"]{--page:#ffffff');
    expect(css).toContain('#theme-toggle,#print-btn{display:none}');
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

describe('PRINT_BUTTON', () => {
  it('exports a print button with a window.print() handler', () => {
    expect(PRINT_BUTTON).toContain('id="print-btn"');
    expect(PRINT_BUTTON).toContain('onclick="window.print()"');
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

// --- Executable behavior tests (scripts run in jsdom) ---

/** Strip the <script>…</script> wrapper so the inner JS can be executed. */
function scriptBody(s: string): string {
  return s.replace(/^<script>/, '').replace(/<\/script>$/, '');
}

const MOON = '\u{1F319}';
const SUN = '☀️';

/**
 * Override `localStorage` so the executed scripts' bare `localStorage` reference resolves to
 * our mock. jsdom defines `localStorage` as an own accessor on the window, so a plain
 * `global.localStorage = …` assignment is ignored — `defineProperty` is required.
 */
function mockLocalStorage(impl: Pick<Storage, 'getItem' | 'setItem'>): void {
  Object.defineProperty(window, 'localStorage', { configurable: true, value: impl });
}

describe('THEME_HEAD_SCRIPT (executed)', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
  });

  it('applies a stored "dark" override', () => {
    const store: Record<string, string> = { 'html-doc-theme': 'dark' };
    mockLocalStorage({ getItem: (k: string) => store[k] ?? null, setItem: () => {} });
    new Function(scriptBody(THEME_HEAD_SCRIPT))();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('ignores an invalid stored value', () => {
    const store: Record<string, string> = { 'html-doc-theme': 'midnight' };
    mockLocalStorage({ getItem: (k: string) => store[k] ?? null, setItem: () => {} });
    new Function(scriptBody(THEME_HEAD_SCRIPT))();
    expect(document.documentElement.getAttribute('data-theme')).toBeNull();
  });

  it('no-ops (does not throw) when localStorage access throws', () => {
    mockLocalStorage({ getItem: () => { throw new Error('blocked'); }, setItem: () => {} });
    expect(() => new Function(scriptBody(THEME_HEAD_SCRIPT))()).not.toThrow();
    expect(document.documentElement.getAttribute('data-theme')).toBeNull();
  });
});

describe('THEME_TOGGLE_SCRIPT (executed)', () => {
  let store: Record<string, string>;

  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.className = '';
    document.body.innerHTML = '<button id="theme-toggle"></button>';
    store = {};
    mockLocalStorage({ getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } });
    global.requestAnimationFrame = (cb: (t: number) => void) => { cb(0); return 0; };
  });

  function setSystemDark(dark: boolean) {
    window.matchMedia = (q: string) => ({ matches: dark, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } });
  }

  it('shows the sun icon on first load when following system dark, and marks theme-ready', () => {
    setSystemDark(true);
    new Function(scriptBody(THEME_TOGGLE_SCRIPT))();
    expect(document.getElementById('theme-toggle')!.textContent).toBe(SUN);
    expect(document.documentElement.classList.contains('theme-ready')).toBe(true);
  });

  it('shows the moon icon on first load when following system light', () => {
    setSystemDark(false);
    new Function(scriptBody(THEME_TOGGLE_SCRIPT))();
    expect(document.getElementById('theme-toggle')!.textContent).toBe(MOON);
  });

  it('first click from system-dark flips to explicit light and persists', () => {
    setSystemDark(true);
    new Function(scriptBody(THEME_TOGGLE_SCRIPT))();
    document.getElementById('theme-toggle')!.dispatchEvent(new Event('click'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(store['html-doc-theme']).toBe('light');
    expect(document.getElementById('theme-toggle')!.textContent).toBe(MOON);
  });

  it('does not crash when setItem throws on click (still flips the attribute)', () => {
    setSystemDark(false);
    mockLocalStorage({ getItem: () => null, setItem: () => { throw new Error('blocked'); } });
    new Function(scriptBody(THEME_TOGGLE_SCRIPT))();
    const btn = document.getElementById('theme-toggle')!;
    expect(() => btn.dispatchEvent(new Event('click'))).not.toThrow();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});
