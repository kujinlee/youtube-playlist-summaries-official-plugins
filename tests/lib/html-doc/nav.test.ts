/** @jest-environment jsdom */
import {
  startSecFromTsUrl,
  digControl,
  wireDigLinks,
  scrollToHashSection,
  initDigControls,
} from '../../../lib/html-doc/nav';

describe('startSecFromTsUrl', () => {
  it('parses t=<sec>s', () => { expect(startSecFromTsUrl('https://y/watch?v=x&t=185s')).toBe(185); });
  it('parses t=0s', () => { expect(startSecFromTsUrl('https://y/watch?v=x&t=0s')).toBe(0); });
  it('returns null when absent/malformed', () => { expect(startSecFromTsUrl('https://y/watch?v=x')).toBeNull(); });
});

describe('digControl', () => {
  describe('summary-side (1-arg, nav-link)', () => {
    it('emits class="dig", data-section, data-t, and "dig deeper" label', () => {
      const h = digControl(16);
      expect(h).toContain('class="dig"');
      expect(h).toContain('data-section="16"');
      expect(h).toContain('data-t="16"');
      expect(h).toContain('dig deeper');
    });
    it('does NOT emit data-type (not a cross-doc link)', () => {
      expect(digControl(16)).not.toContain('data-type=');
    });
    it('handles startSec=0 (presence-gated, not truthiness)', () => {
      const h = digControl(0);
      expect(h).toContain('data-section="0"');
      expect(h).toContain('data-t="0"');
    });
  });

  describe('dig-deeper-side (2-arg "summary", cross-doc nav)', () => {
    it('builds a "↑ summary" control with data-type and data-t', () => {
      const h = digControl('summary', 0);
      expect(h).toContain('class="dig"');
      expect(h).toContain('data-type="summary"');
      expect(h).toContain('data-t="0"');
      expect(h).toContain('↑ summary');
    });
    it('carries the correct startSec in data-t', () => {
      expect(digControl('summary', 200)).toContain('data-t="200"');
    });
  });
});

describe('wireDigLinks', () => {
  it('rebuilds the href from the current URL, swapping type + setting #t, preserving outputFolder + id', () => {
    document.body.innerHTML = '<a class="dig" data-type="summary" data-t="200">↑ summary</a>';
    wireDigLinks(document, { href: 'http://h/api/html/vid9?outputFolder=%2FU%2Ff&type=dig-deeper' });
    const href = document.querySelector('a.dig')!.getAttribute('href')!;
    expect(href).toContain('/api/html/vid9');           // id preserved in path
    expect(href).toContain('type=summary');
    expect(href.endsWith('#t=200')).toBe(true);
    const u = new URL('http://h' + href);
    expect(u.searchParams.get('outputFolder')).toBe('/U/f'); // round-trips, no double-encode
  });

  it('does NOT touch summary-side a.dig that lack data-type (no type=undefined injected)', () => {
    document.body.innerHTML = '<a class="dig" data-section="135" data-t="135">dig deeper ▶</a>';
    wireDigLinks(document, { href: 'http://h/api/html/vid9?outputFolder=%2FU%2Ff&type=summary' });
    const el = document.querySelector('a.dig')!;
    const href = el.getAttribute('href');
    // href must remain unset (null) — wireDigLinks must leave summary-side controls alone
    expect(href).toBeNull();
    // Guard: the type=undefined corruption must not appear even if href were set
    expect(href ?? '').not.toContain('type=undefined');
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

// ── test helpers ─────────────────────────────────────────────────────────────
const VIDEO_ID = 'vid42';
const OUTPUT_FOLDER = '/Users/test/vault/playlist';
const ENC_FOLDER = encodeURIComponent(OUTPUT_FOLDER);
const LOC = {
  pathname: `/api/html/${VIDEO_ID}`,
  search: `?outputFolder=${ENC_FOLDER}&type=summary`,
};

function makeDoc(sectionsHTML: string): Document {
  const d = document.implementation.createHTMLDocument('test');
  d.body.innerHTML = sectionsHTML;
  return d;
}

function twoControls(): Document {
  return makeDoc(`
    <a class="dig" data-section="0" data-t="0">dig deeper ▶</a>
    <a class="dig" data-section="200" data-t="200">dig deeper ▶</a>
  `);
}

// ── B1: dug on load → "view detail ↓" nav link (same-tab, no target) ────────
describe('initDigControls — B1: dug on load', () => {
  it('renders "view detail ↓" with type=dig-deeper href and NO target for each dug sectionId', async () => {
    const doc = twoControls();
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sectionIds: [0, 200] }),
    } as any);

    await initDigControls(doc, LOC);

    const controls = doc.querySelectorAll('a.dig') as NodeListOf<HTMLAnchorElement>;
    for (const ctrl of controls) {
      expect(ctrl.textContent).toContain('view detail');
      const href = ctrl.getAttribute('href')!;
      expect(href).toBeTruthy();
      const u = new URL('http://host' + href);
      expect(u.pathname).toBe(`/api/html/${VIDEO_ID}`);
      expect(u.searchParams.get('outputFolder')).toBe(OUTPUT_FOLDER);
      expect(u.searchParams.get('type')).toBe('dig-deeper');
      // dug href has NO ?dig param
      expect(u.searchParams.get('dig')).toBeNull();
      // Fragment matches section startSec
      const sec = Number(ctrl.dataset.section);
      expect(u.hash).toBe(`#t=${sec}`);
      // Same-tab: no target attribute
      expect(ctrl.getAttribute('target')).toBeNull();
      expect(ctrl.getAttribute('rel')).toBeNull();
    }
  });

  it('only marks controls whose sectionId is in dig-state; others get un-dug nav href', async () => {
    const doc = twoControls();
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sectionIds: [200] }),  // only section 200 is dug
    } as any);

    await initDigControls(doc, LOC);

    const [ctrl0, ctrl200] = Array.from(doc.querySelectorAll('a.dig')) as HTMLAnchorElement[];

    // ctrl0: un-dug → "dig deeper ▶" with ?dig=0#t=0
    expect(ctrl0.textContent).toContain('dig deeper');
    const href0 = ctrl0.getAttribute('href')!;
    expect(href0).toBeTruthy();
    const u0 = new URL('http://host' + href0);
    expect(u0.searchParams.get('dig')).toBe('0');
    expect(u0.searchParams.get('type')).toBe('dig-deeper');
    expect(u0.hash).toBe('#t=0');
    expect(ctrl0.getAttribute('target')).toBeNull();

    // ctrl200: dug → "view detail ↓" with no ?dig
    expect(ctrl200.textContent).toContain('view detail');
    const href200 = ctrl200.getAttribute('href')!;
    const u200 = new URL('http://host' + href200);
    expect(u200.searchParams.get('dig')).toBeNull();
    expect(u200.searchParams.get('type')).toBe('dig-deeper');
    expect(u200.hash).toBe('#t=200');
    expect(ctrl200.getAttribute('target')).toBeNull();
  });
});

// ── B2: dig-state fetch failure → fail-open to un-dug nav href ───────────────
describe('initDigControls — B2: dig-state fetch fails → fail-open', () => {
  it('leaves controls with un-dug nav href (type=dig-deeper&dig=N) when fetch rejects', async () => {
    const doc = twoControls();
    global.fetch = jest.fn().mockRejectedValueOnce(new Error('network'));

    await initDigControls(doc, LOC);

    const controls = doc.querySelectorAll('a.dig') as NodeListOf<HTMLAnchorElement>;
    for (const ctrl of controls) {
      expect(ctrl.textContent).toContain('dig deeper');
      const href = ctrl.getAttribute('href')!;
      expect(href).toBeTruthy();
      const u = new URL('http://host' + href);
      expect(u.searchParams.get('type')).toBe('dig-deeper');
      expect(u.searchParams.get('dig')).toBe(ctrl.dataset.section);
      expect(ctrl.getAttribute('target')).toBeNull();
    }
  });

  it('leaves controls with un-dug nav href when fetch returns non-ok', async () => {
    const doc = twoControls();
    global.fetch = jest.fn().mockResolvedValueOnce({ ok: false, json: async () => ({}) } as any);

    await initDigControls(doc, LOC);

    const controls = doc.querySelectorAll('a.dig') as NodeListOf<HTMLAnchorElement>;
    for (const ctrl of controls) {
      expect(ctrl.textContent).toContain('dig deeper');
      const href = ctrl.getAttribute('href')!;
      expect(href).toBeTruthy();
      const u = new URL('http://host' + href);
      expect(u.searchParams.get('type')).toBe('dig-deeper');
      expect(u.searchParams.get('dig')).toBe(ctrl.dataset.section);
      expect(ctrl.getAttribute('target')).toBeNull();
    }
  });
});

// ── B3: un-dug control → has nav href with type=dig-deeper&dig=N, no POST on click ──
describe('initDigControls — B3: un-dug control is a nav link (no POST)', () => {
  it('un-dug control gets type=dig-deeper&dig=N#t=N href and NO target', async () => {
    const doc = makeDoc('<a class="dig" data-section="100" data-t="100">dig deeper ▶</a>');
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sectionIds: [] }),
    } as any);

    await initDigControls(doc, LOC);

    const ctrl = doc.querySelector('a.dig') as HTMLAnchorElement;
    expect(ctrl.textContent).toContain('dig deeper');
    const href = ctrl.getAttribute('href')!;
    expect(href).toBeTruthy();
    const u = new URL('http://host' + href);
    expect(u.pathname).toBe(`/api/html/${VIDEO_ID}`);
    expect(u.searchParams.get('outputFolder')).toBe(OUTPUT_FOLDER);
    expect(u.searchParams.get('type')).toBe('dig-deeper');
    expect(u.searchParams.get('dig')).toBe('100');
    expect(u.hash).toBe('#t=100');
    expect(ctrl.getAttribute('target')).toBeNull();
    expect(ctrl.getAttribute('rel')).toBeNull();
  });

  it('clicking the control does NOT call fetch a second time (no POST)', async () => {
    const doc = makeDoc('<a class="dig" data-section="100" data-t="100">dig deeper ▶</a>');
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sectionIds: [] }),
    } as any);

    await initDigControls(doc, LOC);

    // Click the link — nav follows href, no second fetch is expected
    const ctrl = doc.querySelector('a.dig') as HTMLAnchorElement;
    ctrl.click();
    await Promise.resolve();

    // Only 1 fetch: the dig-state GET; no POST
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(1);
  });
});

// ── B4: pageshow persisted → re-fetch dig-state and re-apply ─────────────────
// These tests use the global jsdom document (which has window as defaultView)
// so the pageshow listener registered by initDigControls actually fires.
describe('initDigControls — B4: pageshow persisted → re-fetch dig-state', () => {
  beforeEach(() => {
    // Reset global document body for each test
    document.body.innerHTML = '<a class="dig" data-section="100" data-t="100">dig deeper ▶</a>';
  });

  it('re-fetches dig-state on pageshow with persisted=true and updates controls', async () => {
    // First fetch: nothing dug
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ sectionIds: [] }) } as any)
      // Second fetch (pageshow): section 100 now dug
      .mockResolvedValueOnce({ ok: true, json: async () => ({ sectionIds: [100] }) } as any);

    await initDigControls(document, LOC);

    const ctrl = document.querySelector('a.dig') as HTMLAnchorElement;
    // Initially un-dug
    expect(ctrl.textContent).toContain('dig deeper');

    // Simulate bfcache restore via window (= document.defaultView in jsdom)
    const ev = new PageTransitionEvent('pageshow', { persisted: true });
    window.dispatchEvent(ev);

    // Allow microtasks to settle
    for (let i = 0; i < 4; i++) await Promise.resolve();

    // After re-fetch, should be dug
    expect(ctrl.textContent).toContain('view detail');
    const href = ctrl.getAttribute('href')!;
    const u = new URL('http://host' + href);
    expect(u.searchParams.get('type')).toBe('dig-deeper');
    expect(u.searchParams.get('dig')).toBeNull();
    expect(ctrl.getAttribute('target')).toBeNull();
  });

  it('does NOT re-fetch on pageshow with persisted=false', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sectionIds: [] }),
    } as any);

    await initDigControls(document, LOC);

    const ev = new PageTransitionEvent('pageshow', { persisted: false });
    window.dispatchEvent(ev);
    await Promise.resolve();

    // Still only 1 fetch (initial)
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(1);
  });
});
