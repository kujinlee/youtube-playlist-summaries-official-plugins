// lib/dig/slide-crop-map.ts
import path from 'node:path';
import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';
import type { DugSection } from './companion-doc';
import { lookupOrComputeBox, type CropResult } from './slide-crop-cache';
import type { CropBox } from './slide-crop';

function collectImageSrcs(tokens: Token[], out: string[] = []): string[] {
  for (const tok of tokens) {
    if (tok.type === 'image') { const src = tok.attrGet('src'); if (src) out.push(src); }
    if (tok.children) collectImageSrcs(tok.children, out);
  }
  return out;
}

/**
 * Build the render-time crop map. Mirrors the renderer's inlining rule:
 * only `assets/…` refs resolving inside `<docDir>/assets`. Key = resolved
 * absolute path; missing files omitted. Empty map when DIG_CROP=off.
 */
export async function prepareSlideCropMap(
  dug: DugSection[],
  mdPath: string,
  lookup: (p: string) => Promise<CropResult> = lookupOrComputeBox,
): Promise<Map<string, CropBox | null>> {
  const map = new Map<string, CropBox | null>();
  if (process.env.DIG_CROP === 'off') return map;

  const docDir = path.dirname(mdPath);
  const assetsRoot = path.resolve(docDir, 'assets');
  const md = new MarkdownIt({ html: false });

  const absPaths = new Set<string>();
  for (const section of dug) {
    for (const src of collectImageSrcs(md.parse(section.bodyMarkdown ?? '', {}))) {
      if (!src.startsWith('assets/')) continue;
      const abs = path.resolve(docDir, src);
      if (!abs.startsWith(assetsRoot + path.sep)) continue;   // containment (matches renderer)
      absPaths.add(abs);
    }
  }

  await Promise.all([...absPaths].map(async (abs) => {
    const r = await lookup(abs);
    if (r !== 'missing') map.set(abs, r);
  }));
  return map;
}
