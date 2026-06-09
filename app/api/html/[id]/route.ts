import fs from 'fs';
import path from 'path';
import { assertOutputFolder, assertVideoId, readIndex } from '../../../../lib/index-store';

type Params = { params: Promise<{ id: string }> };

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

  // Codex HIGH: enforce the type=summary URL contract (pilot supports summary only).
  if (searchParams.get('type') !== 'summary') {
    return new Response(JSON.stringify({ error: 'unsupported or missing type' }), { status: 400 });
  }

  let htmlFile: string | null | undefined;
  try {
    const index = readIndex(outputFolder);
    const video = index.videos.find((v) => v.id === videoId);
    if (!video) return new Response(JSON.stringify({ error: 'video not found' }), { status: 404 });
    htmlFile = video.summaryHtml;
  } catch (err) {
    const e = err as { statusCode?: number; message?: string };
    if (e.statusCode === 400) return new Response(JSON.stringify({ error: e.message }), { status: 400 });
    throw err;
  }

  // Codex BLOCKING (path traversal): only serve a strict htmls/<name>.html relative path, and
  // verify the resolved path stays inside <outputFolder>/htmls. Defense in depth — the regex
  // already forbids extra slashes, so "../" cannot appear; the prefix check is a backstop.
  const HTML_REL_RE = /^htmls\/[A-Za-z0-9._-]+\.html$/;
  if (!htmlFile || !HTML_REL_RE.test(htmlFile)) {
    return new Response(JSON.stringify({ error: 'html not available' }), { status: 404 });
  }
  const htmlDir = path.resolve(outputFolder, 'htmls');
  const htmlPath = path.resolve(outputFolder, htmlFile);
  if (htmlPath !== htmlDir && !htmlPath.startsWith(htmlDir + path.sep)) {
    return new Response(JSON.stringify({ error: 'invalid path' }), { status: 400 });
  }

  try {
    const buffer = fs.readFileSync(htmlPath);
    return new Response(buffer, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  } catch {
    return new Response(JSON.stringify({ error: 'file not found' }), { status: 404 });
  }
}
