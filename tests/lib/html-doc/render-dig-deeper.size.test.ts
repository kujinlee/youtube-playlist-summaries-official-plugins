// tests/lib/html-doc/render-dig-deeper.size.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderDigDeeperDoc, DIG_SLIDE_SANITIZE_JS } from '@/lib/html-doc/render-dig-deeper';
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
    expect(html).toContain('@media print{');
    expect(html).toContain('.dg-size{display:none!important}');
    expect(html).toContain('.dg img.dig-slide{max-height:300px}');
    expect(html).toContain('.dg .dig-slide-crop{width:min(100%,540px)}');
    expect(html).toContain('.dg-topbar{display:flex;flex-wrap:wrap');
  });
});

describe('DIG_SLIDE_SANITIZE_JS', () => {
  // Build the sanitizer function once from the exported JS source string.
  // The source defines `function s(raw){...}` — we append `return s(raw);` to
  // make it callable as a regular Function.
  const s = new Function('raw', DIG_SLIDE_SANITIZE_JS + ' return s(raw);') as (raw: unknown) => number;

  const cases: [unknown, number][] = [
    // null / empty / whitespace → 100 (default)
    [null, 100],
    ['', 100],
    ['  ', 100],
    // non-numeric strings → 100
    ['120px', 100],
    ['abc', 100],
    // clamp: values outside [50,150] snap to nearest 10 then clamp
    ['999', 150],
    ['-5', 50],
    ['44', 50],
    // snap to nearest 10 (Math.round)
    ['125', 130],
    ['135', 140],
    // in-range: pass through (string and number inputs)
    ['100', 100],
    [100, 100],
    [50, 50],
    [150, 150],
  ];

  it.each(cases)('s(%p) === %i', (input, expected) => {
    expect(s(input)).toBe(expected);
  });
});
