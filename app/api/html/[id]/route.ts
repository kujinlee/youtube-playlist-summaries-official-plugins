import fs from 'fs';
import path from 'path';
import { assertOutputFolder, assertVideoId, readIndex } from '../../../../lib/index-store';
import { runDeepDiveHtml } from '../../../../lib/html-doc/generate-deep-dive';

type Params = { params: Promise<{ id: string }> };

// B-1: Unicode-aware so Korean-slug filenames are admitted. The resolved-path containment check
// below is the real traversal backstop; this regex still forbids slashes (no "../").
const HTML_REL_RE = /^htmls\/[\p{L}\p{N}._-]+\.html$/u;

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
  if (type !== 'summary' && type !== 'deep-dive') {
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
    try {
      return serveHtml(fs.readFileSync(path.resolve(outputFolder, htmlFile), 'utf-8'));
    } catch {
      return new Response(JSON.stringify({ error: 'file not found' }), { status: 404 });
    }
  }

  // type === 'deep-dive' — lazy generate-on-view, no index field.
  if (!video.deepDiveMd) {
    return new Response(JSON.stringify({ error: 'deep dive not available' }), { status: 404 });
  }
  const base = video.deepDiveMd.replace(/\.md$/, '');
  const rel = `htmls/${base}.html`;
  const bad = guard(rel);
  if (bad) return bad;

  try {
    return serveHtml(fs.readFileSync(path.resolve(outputFolder, rel), 'utf-8')); // cached
  } catch {
    // Not cached → render now, serve the in-memory bytes (H-2: no write-then-re-read).
    try {
      const html = await runDeepDiveHtml(videoId, outputFolder);
      return serveHtml(html);
    } catch {
      return new Response(JSON.stringify({ error: 'failed to render deep dive html' }), { status: 500 });
    }
  }
}
