// tests/lib/html-doc/render-dig-deeper.size.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderDigDeeperDoc } from '@/lib/html-doc/render-dig-deeper';
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
    expect(html).toMatch(/@media print\{[^}]*\.dg-size\{display:none!important\}/);
    expect(html).toContain('.dg-topbar{display:flex;flex-wrap:wrap');
  });
});
