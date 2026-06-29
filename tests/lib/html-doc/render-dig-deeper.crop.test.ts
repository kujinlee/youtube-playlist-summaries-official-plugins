import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { renderDigDeeperDoc } from '../../../lib/html-doc/render-dig-deeper';
import type { CropBox } from '../../../lib/dig/slide-crop';

function makeDoc() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'digdoc-'));
  fs.mkdirSync(path.join(dir, 'assets', 'v'), { recursive: true });
  const assetAbs = path.join(dir, 'assets', 'v', '0-1-2.jpg');
  fs.writeFileSync(assetAbs, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  return { mdPath: path.join(dir, 'x-dig-deeper.md'), assetAbs };
}

const baseArgs = (mdPath: string, cropMap: Map<string, CropBox | null>) => ({
  summary: { title: 'T', sections: [] } as any,
  envelope: null,
  dug: [{ sectionId: 0, title: 'S', genVersion: 8, bodyMarkdown: '![a](assets/v/0-1-2.jpg)' }] as any,
  mdPath, videoId: 'v', language: 'en' as const, cropMap,
});

describe('renderDigDeeperDoc crop wrapper', () => {
  it('wraps a slide using NATIVE-dim aspect-ratio + object-position', () => {
    const { mdPath, assetAbs } = makeDoc();
    const box: CropBox = { trimTop: 0.25, trimBot: 0.05, width: 1280, height: 720 };
    const html = renderDigDeeperDoc(baseArgs(mdPath, new Map([[assetAbs, box]])));
    expect(html).toContain('class="dig-slide-crop"');
    // keepFrac=0.70 → keepH=504 → aspect 1280/504; object-position 0 83.3%
    expect(html).toMatch(/aspect-ratio:\s*1280\s*\/\s*504/);
    expect(html).toMatch(/object-position:\s*0 83\.3%/);
    expect(html).toContain('<img class="dig-slide"');
    // The inline figure style is aspect-ratio ONLY — the display-size cap lives in
    // CSS (width-based). A per-image width/height in the inline style would be the
    // capPx regression that inflated cropped frames to full width.
    expect(html).not.toMatch(/<(figure|div)[^>]*style="[^"]*width:/);
    expect(html).not.toMatch(/<(figure|div)[^>]*style="[^"]*capPx/);
  });

  it('caps cropped-figure display WIDTH in CSS (not height) so short crops stay modest', () => {
    const { mdPath, assetAbs } = makeDoc();
    const box: CropBox = { trimTop: 0.25, trimBot: 0.05, width: 1280, height: 720 };
    const html = renderDigDeeperDoc(baseArgs(mdPath, new Map([[assetAbs, box]])));
    expect(html).toMatch(/\.dg \.dig-slide-crop\{[^}]*width:min\(100%,540px\)/);
  });

  it('renders a plain dig-slide img (no wrapper) when box is null', () => {
    const { mdPath, assetAbs } = makeDoc();
    const html = renderDigDeeperDoc(baseArgs(mdPath, new Map([[assetAbs, null]])));
    expect(html).not.toContain('class="dig-slide-crop"');
    expect(html).toContain('<img class="dig-slide"');
  });

  it('renders plain img when cropMap omitted entirely (default new Map)', () => {
    const { mdPath } = makeDoc();
    const args = baseArgs(mdPath, new Map());
    delete (args as any).cropMap;
    const html = renderDigDeeperDoc(args);
    expect(html).not.toContain('class="dig-slide-crop"');
  });

  it('CSS contract overrides the bare-img cap and scopes cursor to the img', () => {
    const { mdPath, assetAbs } = makeDoc();
    const box: CropBox = { trimTop: 0.25, trimBot: 0.05, width: 1280, height: 720 };
    const html = renderDigDeeperDoc(baseArgs(mdPath, new Map([[assetAbs, box]])));
    expect(html).toMatch(/\.dig-slide-crop\s*>\s*img\.dig-slide\{[^}]*object-fit:cover/);
    expect(html).toMatch(/\.dig-slide-crop\s*>\s*img\.dig-slide\{[^}]*max-height:none/);
    expect(html).toMatch(/\.dig-slide-crop\s*>\s*img\.dig-slide\{[^}]*cursor:zoom-in/);
  });
});
