// tests/lib/html-doc/render-dig-deeper.captions.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderDigDeeperDoc } from '@/lib/html-doc/render-dig-deeper';
import type { ParsedSummary } from '@/lib/html-doc/types';
import type { DugSection } from '@/lib/dig/companion-doc';
import type { CropBox } from '@/lib/dig/slide-crop';

// 1x1 JPEG
const B64 = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKwAB/9k=';

function render(body: string, opts: { crop?: boolean } = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-cap-'));
  fs.mkdirSync(path.join(dir, 'assets', 'v'), { recursive: true });
  const assetAbs = path.join(dir, 'assets', 'v', '0-0.jpg');
  fs.writeFileSync(assetAbs, Buffer.from(B64, 'base64'));
  const summary = { title: 'T', channel: null, duration: null, url: 'u', lang: 'EN',
    videoId: 'v', tldr: null, takeaways: [], sourceMd: 'x.md',
    sections: [{ numeral: '1', title: 'S', prose: 'p',
      timeRange: { startSec: 60, endSec: 120, label: '1:00–2:00', url: 'u&t=60s' } }] } as ParsedSummary;
  const dug = [{ sectionId: 60, startSec: 60, title: 'S', bodyMarkdown: body,
    generatedAt: '2026-01-01T00:00:00.000Z', genVersion: 1 }] as unknown as DugSection[];
  const cropMap = opts.crop
    ? new Map<string, CropBox | null>([[assetAbs, { trimTop: 0.25, trimBot: 0.05, width: 1280, height: 720 }]])
    : undefined;
  return renderDigDeeperDoc({ summary, envelope: null, dug, mdPath: path.join(dir, 'x-dig-deeper.md'), videoId: 'v', cropMap });
}

describe('dig slide captions render', () => {
  it('uncropped slide → figure.dig-slide-fig > img.dig-slide + figcaption.dig-cap', () => {
    const html = render('![A diagram](assets/v/0-0.jpg)');
    expect(html).toMatch(/<figure class="dig-slide-fig"><img class="dig-slide"[^>]*><figcaption class="dig-cap">A diagram<\/figcaption><\/figure>/);
  });

  it('cropped slide → figure.dig-slide-fig > div.dig-slide-crop > img + figcaption', () => {
    const html = render('![Cropped chart](assets/v/0-0.jpg)', { crop: true });
    expect(html).toContain('<figure class="dig-slide-fig"><div class="dig-slide-crop"');
    expect(html).toMatch(/<\/div><figcaption class="dig-cap">Cropped chart<\/figcaption><\/figure>/);
    expect(html).not.toContain('<figure class="dig-slide-crop"');
  });

  it('empty caption → figure + img but NO figcaption', () => {
    const html = render('![](assets/v/0-0.jpg)');
    expect(html).toContain('<figure class="dig-slide-fig"><img class="dig-slide"');
    expect(html).not.toContain('<figcaption');
  });

  it('HTML-escapes the caption in figcaption (no raw markup)', () => {
    const html = render('![a <b>&"x](assets/v/0-0.jpg)');
    expect(html).toContain('<figcaption class="dig-cap">a &lt;b&gt;&amp;&quot;x</figcaption>');
    expect(html).not.toContain('<figcaption class="dig-cap">a <b>');
  });

  it('missing asset → span.missing-slide, no figure/figcaption', () => {
    const html = render('![cap](assets/v/does-not-exist.jpg)');
    expect(html).toContain('<span class="missing-slide">cap</span>');
    expect(html).not.toContain('<figure class="dig-slide-fig"');
  });

  it('external image → plain img, no figure wrap', () => {
    const html = render('![ext](https://example.com/a.png)');
    expect(html).toMatch(/<img src="https:\/\/example.com\/a.png" alt="ext">/);
    expect(html).not.toContain('<figure class="dig-slide-fig"');
  });
});
