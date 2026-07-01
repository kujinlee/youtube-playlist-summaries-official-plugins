import fs from 'fs';
import path from 'path';
import type { Video } from '@/types';
import { renderDigDeeperDoc } from './render-dig-deeper';
import { GENERATOR_VERSION } from './render';
import { reRenderSummaryHtml } from './rerender';
import { readModelEnvelope } from './model-store';
import { parseDugSections } from '../dig/companion-doc';
import { parseSummaryMarkdown } from './parse';
import { prepareSlideCropMap } from '../dig/slide-crop-map';
import { assertIndexRelPathWithin } from '../paths/assert-within';

export type BuildResult =
  | { ok: true; html: string }
  | { ok: false; reason: 'missing-html' | 'missing-summary' | 'invalid-path' | 'unparseable' };

// Unicode-aware so Korean-slug filenames are admitted. The resolved-path containment check below is the
// real traversal backstop; this regex still forbids slashes (no "../"). Kept verbatim from the serve
// route so the stronger htmls/ guard is NOT downgraded to generic output-folder containment.
const HTML_REL_RE = /^htmls\/[\p{L}\p{N}._-]+\.html$/u;

const UNAVAILABLE_HTML =
  `<!DOCTYPE html><html><body><p>Summary unavailable — regenerate the summary first.</p></body></html>`;

/**
 * Build the self-contained HTML for a doc, identically to what `GET /api/html/[id]` serves.
 * Returns a domain result — callers (serve route, PDF route) map reasons to HTTP.
 *
 * `video` must already be resolved from the index by the caller (both routes read the index anyway).
 * Input validation (outputFolder/videoId/type) stays in the route (an HTTP concern).
 */
export async function buildDocHtml(
  video: Video,
  outputFolder: string,
  type: 'summary' | 'dig-deeper',
): Promise<BuildResult> {
  const htmlDir = path.resolve(outputFolder, 'htmls');

  if (type === 'summary') {
    const htmlFile = video.summaryHtml;
    if (!htmlFile) return { ok: false, reason: 'missing-html' };
    // Preserve the stronger htmls/*.html guard (regex + htmlDir containment).
    if (!HTML_REL_RE.test(htmlFile)) return { ok: false, reason: 'missing-html' };
    const abs = path.resolve(outputFolder, htmlFile);
    if (abs !== htmlDir && !abs.startsWith(htmlDir + path.sep)) return { ok: false, reason: 'invalid-path' };

    let cachedHtml: string;
    try {
      cachedHtml = fs.readFileSync(abs, 'utf-8');
    } catch {
      return { ok: false, reason: 'missing-html' };
    }
    const generatorMatch = cachedHtml.match(/<meta name="generator" content="([^"]*)">/);
    const cachedVersion = generatorMatch ? generatorMatch[1] : null;
    if (cachedVersion === GENERATOR_VERSION) return { ok: true, html: cachedHtml };

    // Cached HTML is stale — attempt re-render; serve the stale artifact on any skip (never fail when
    // a cached file exists).
    const result = reRenderSummaryHtml(video.id, outputFolder);
    switch (result.status) {
      case 'rerendered':
        return { ok: true, html: result.html };
      case 'skipped-not-eligible':
        return { ok: true, html: cachedHtml };
      default:
        console.warn(`[html/summary] rerender skipped (${result.status}) for video ${video.id}`);
        return { ok: true, html: cachedHtml };
    }
  }

  // dig-deeper
  // Companion-path containment first, so it keeps independent 400 coverage before summaryMd derivation.
  let digDeeperPath: string | null = null;
  if (video.digDeeperMd) {
    try {
      digDeeperPath = assertIndexRelPathWithin(outputFolder, video.digDeeperMd);
    } catch {
      return { ok: false, reason: 'invalid-path' };
    }
  }

  // Derive base + relDir from index fields only (never from URL).
  let base: string;
  let relDir: string;
  if (video.digDeeperMd) {
    const digRel = video.digDeeperMd;
    relDir = path.dirname(digRel);
    const digBase = path.basename(digRel);
    base = digBase.endsWith('-dig-deeper.md')
      ? digBase.slice(0, -'-dig-deeper.md'.length)
      : digBase.replace(/\.md$/, '');
  } else if (video.summaryMd) {
    const sumRel = video.summaryMd;
    relDir = path.dirname(sumRel);
    const sumBase = path.basename(sumRel);
    base = sumBase.endsWith('.md') ? sumBase.slice(0, -'.md'.length) : sumBase;
  } else {
    return { ok: true, html: UNAVAILABLE_HTML };
  }

  let summaryMdPath: string;
  try {
    summaryMdPath = assertIndexRelPathWithin(outputFolder, path.join(relDir, `${base}.md`));
    assertIndexRelPathWithin(outputFolder, path.join('models', `${base}.json`));
  } catch {
    return { ok: false, reason: 'invalid-path' };
  }

  let summaryMdContent: string;
  try {
    summaryMdContent = fs.readFileSync(summaryMdPath, 'utf-8');
  } catch {
    return { ok: true, html: UNAVAILABLE_HTML };
  }

  let parsed;
  try {
    parsed = parseSummaryMarkdown(summaryMdContent);
  } catch {
    return { ok: true, html: UNAVAILABLE_HTML };
  }

  const envelope = readModelEnvelope(outputFolder, base);

  let dug: ReturnType<typeof parseDugSections> = [];
  if (digDeeperPath !== null) {
    try {
      dug = parseDugSections(fs.readFileSync(digDeeperPath, 'utf8'));
    } catch {
      // Companion missing on disk → skeleton (dug = []). Containment already asserted above.
    }
  }

  const cropMap = await prepareSlideCropMap(dug, summaryMdPath);
  return {
    ok: true,
    html: renderDigDeeperDoc({
      summary: parsed,
      envelope,
      dug,
      mdPath: summaryMdPath,
      videoId: video.id,
      language: video.language,
      cropMap,
    }),
  };
}
