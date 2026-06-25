import fs from 'fs';
import path from 'path';
import { assertOutputFolder, assertVideoId, readIndex } from '../../../../lib/index-store';
import { runDeepDiveHtml } from '../../../../lib/html-doc/generate-deep-dive';
import { renderDigDeeperDoc } from '../../../../lib/html-doc/render-dig-deeper';
import { GENERATOR_VERSION } from '../../../../lib/html-doc/render';
import { reRenderSummaryHtml } from '../../../../lib/html-doc/rerender';
import { readModelEnvelope } from '../../../../lib/html-doc/model-store';
import { parseDugSections } from '../../../../lib/dig/companion-doc';
import { parseSummaryMarkdown } from '../../../../lib/html-doc/parse';

type Params = { params: Promise<{ id: string }> };

// B-1: Unicode-aware so Korean-slug filenames are admitted. The resolved-path containment check
// below is the real traversal backstop; this regex still forbids slashes (no "../").
const HTML_REL_RE = /^htmls\/[\p{L}\p{N}._-]+\.html$/u;

/**
 * Generic path-containment check for any file (not just htmls/).
 * Throws if resolvedPath is not at or under root.
 * root must be an absolute resolved path (no trailing sep).
 */
function assertWithin(root: string, resolvedPath: string): void {
  if (resolvedPath !== root && !resolvedPath.startsWith(root + path.sep)) {
    throw Object.assign(new Error(`path outside output folder: ${resolvedPath}`), { statusCode: 400 });
  }
}

export async function GET(request: Request, { params }: Params) {
  const { id: videoId } = await params;
  const { searchParams } = new URL(request.url);
  const outputFolder = searchParams.get('outputFolder');

  if (!outputFolder) {
    return new Response(JSON.stringify({ error: 'outputFolder is required' }), { status: 400 });
  }
  try {
    assertOutputFolder(outputFolder);
    assertVideoId(videoId);
  } catch {
    return new Response(JSON.stringify({ error: 'invalid request' }), { status: 400 });
  }

  const type = searchParams.get('type');
  if (type !== 'summary' && type !== 'deep-dive' && type !== 'dig-deeper') {
    return new Response(JSON.stringify({ error: 'unsupported or missing type' }), { status: 400 });
  }

  let video;
  try {
    const index = readIndex(outputFolder);
    video = index.videos.find((v) => v.id === videoId);
    if (!video) return new Response(JSON.stringify({ error: 'video not found' }), { status: 404 });
  } catch (err) {
    const e = err as { statusCode?: number; message?: string };
    if (e.statusCode === 400) return new Response(JSON.stringify({ error: e.message }), { status: 400 });
    throw err;
  }

  const htmlDir = path.resolve(outputFolder, 'htmls');
  // Returns an error Response if the relative path is unsafe, else null.
  const guard = (rel: string): Response | null => {
    if (!HTML_REL_RE.test(rel)) {
      return new Response(JSON.stringify({ error: 'html not available' }), { status: 404 });
    }
    const abs = path.resolve(outputFolder, rel);
    if (abs !== htmlDir && !abs.startsWith(htmlDir + path.sep)) {
      return new Response(JSON.stringify({ error: 'invalid path' }), { status: 400 });
    }
    return null;
  };
  const serveHtml = (body: string) =>
    new Response(body, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });

  if (type === 'summary') {
    const htmlFile = video.summaryHtml;
    if (!htmlFile) return new Response(JSON.stringify({ error: 'html not available' }), { status: 404 });
    const bad = guard(htmlFile);
    if (bad) return bad;
    let cachedHtml: string;
    try {
      cachedHtml = fs.readFileSync(path.resolve(outputFolder, htmlFile), 'utf-8');
    } catch {
      return new Response(JSON.stringify({ error: 'file not found' }), { status: 404 });
    }
    // Extract generator version from cached HTML.
    const generatorMatch = cachedHtml.match(/<meta name="generator" content="([^"]*)">/);
    const cachedVersion = generatorMatch ? generatorMatch[1] : null;
    if (cachedVersion === GENERATOR_VERSION) {
      return serveHtml(cachedHtml);
    }
    // Cached HTML is stale — attempt re-render.
    const result = reRenderSummaryHtml(videoId, outputFolder);
    switch (result.status) {
      case 'rerendered':
        return serveHtml(result.html);
      case 'skipped-not-eligible':
        return serveHtml(cachedHtml);
      default:
        // skipped-no-model, skipped-no-md, skipped-unparseable, skipped-drift:
        // serve stale cached artifact; never 500 when a cached file exists.
        console.warn(`[html/summary] rerender skipped (${result.status}) for video ${videoId}`);
        return serveHtml(cachedHtml);
    }
  }

  if (type === 'dig-deeper') {
    // Companion doc path containment — checked first so it has independent coverage.
    // This must fire before we derive summaryMdPath (which shares relDir), giving the
    // companion-path assertWithin its own reachable 400 path.
    let digDeeperPath: string | null = null;
    if (video.digDeeperMd) {
      digDeeperPath = path.resolve(outputFolder, video.digDeeperMd);
      try {
        assertWithin(outputFolder, digDeeperPath);
      } catch {
        return new Response(JSON.stringify({ error: 'invalid path' }), { status: 400 });
      }
    }

    // Derive base from index fields only (never from URL).
    // If digDeeperMd is set: strip trailing "-dig-deeper.md"; else use summaryMd sans ".md".
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
      // No summaryMd either → graceful unavailable page
      return serveHtml(
        `<!DOCTYPE html><html><body><p>Summary unavailable — regenerate the summary first.</p></body></html>`
      );
    }

    // Resolve paths and apply containment checks.
    const summaryMdPath = path.resolve(outputFolder, relDir, `${base}.md`);
    try {
      assertWithin(outputFolder, summaryMdPath);
    } catch {
      return new Response(JSON.stringify({ error: 'invalid path' }), { status: 400 });
    }

    // Model path containment (readModelEnvelope resolves internally; check derived path).
    const modelFilePath = path.resolve(outputFolder, 'models', `${base}.json`);
    try {
      assertWithin(outputFolder, modelFilePath);
    } catch {
      return new Response(JSON.stringify({ error: 'invalid path' }), { status: 400 });
    }

    // Read summary markdown — missing → graceful "unavailable" page.
    let summaryMdContent: string;
    try {
      summaryMdContent = fs.readFileSync(summaryMdPath, 'utf-8');
    } catch {
      return serveHtml(
        `<!DOCTYPE html><html><body><p>Summary unavailable — regenerate the summary first.</p></body></html>`
      );
    }

    // Parse summary — if it throws (no sections) treat as unavailable.
    let parsed;
    try {
      parsed = parseSummaryMarkdown(summaryMdContent);
    } catch {
      return serveHtml(
        `<!DOCTYPE html><html><body><p>Summary unavailable — regenerate the summary first.</p></body></html>`
      );
    }

    // Read model envelope (null when absent).
    const envelope = readModelEnvelope(outputFolder, base);

    // Read dug sections (empty when companion absent, digDeeperMd null, or file missing on disk).
    // A stale index entry pointing to a deleted file is treated as "nothing dug yet" — skeleton 200.
    let dug: ReturnType<typeof parseDugSections> = [];
    if (digDeeperPath !== null) {
      try {
        dug = parseDugSections(fs.readFileSync(digDeeperPath, 'utf8'));
      } catch {
        // ENOENT or other read error: companion is missing → render skeleton (dug = []).
        // containment was already asserted above, so this cannot be a traversal violation.
      }
    }

    return serveHtml(renderDigDeeperDoc({ summary: parsed, envelope, dug, mdPath: summaryMdPath, videoId }));
  }

  // type === 'deep-dive'
  const stored = video.deepDiveHtml;
  if (stored) {
    const bad = guard(stored);
    if (bad) return bad;
    try {
      return serveHtml(fs.readFileSync(path.resolve(outputFolder, stored), 'utf-8'));
    } catch {
      /* fall through to lazy render */
    }
  }
  if (!video.deepDiveMd) {
    return new Response(JSON.stringify({ error: 'deep dive not available' }), { status: 404 });
  }
  try {
    const { html } = await runDeepDiveHtml(videoId, outputFolder);
    return serveHtml(html);
  } catch {
    return new Response(JSON.stringify({ error: 'failed to render deep dive html' }), { status: 500 });
  }
}
