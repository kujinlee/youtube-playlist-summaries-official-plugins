/** @jest-environment jsdom */
import { startSecFromTsUrl, digControl, wireDigLinks, scrollToHashSection } from '../../../lib/html-doc/nav';

describe('startSecFromTsUrl', () => {
  it('parses t=<sec>s', () => { expect(startSecFromTsUrl('https://y/watch?v=x&t=185s')).toBe(185); });
  it('parses t=0s', () => { expect(startSecFromTsUrl('https://y/watch?v=x&t=0s')).toBe(0); });
  it('returns null when absent/malformed', () => { expect(startSecFromTsUrl('https://y/watch?v=x')).toBeNull(); });
});

describe('digControl', () => {
  describe('summary-side (1-arg, POST-driven)', () => {
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

  describe('deep-dive-side (2-arg "summary", cross-doc nav)', () => {
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
