import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { assertOutputFolder, assertVideoId, readIndex } from '../index-store';
import { renderDeepDiveHtml } from './render-deep-dive';

// Defense-in-depth: deepDiveMd is server-derived (writeDeepDiveDoc / the index, never a request
// param), but it is joined into filesystem paths below, so guard against a traversal payload
// reaching disk — mirrors the containment check in the html serve route. A bare .md filename
// (Unicode-aware for Korean slugs, no slashes → no "..") plus a resolved-path containment backstop.
const DEEP_DIVE_MD_RE = /^[\p{L}\p{N}._-]+\.md$/u;

function assertSafeDeepDiveMd(outputFolder: string, md: string): void {
  const root = path.resolve(outputFolder);
  const resolved = path.resolve(root, md);
  if (!DEEP_DIVE_MD_RE.test(md) || !resolved.startsWith(root + path.sep)) {
    throw new Error(`unsafe deep-dive md filename: ${md}`);
  }
}

/**
 * Render a video's deep-dive markdown to a self-contained HTML page, atomic-write it to
 * htmls/<base>.html (base = deepDiveMd minus .md), and return the rendered HTML string and
 * the relative path of the written file.
 * Does NOT touch the index — the serve route keys on the cache file's existence.
 *
 * `deepDiveMd` overrides the index lookup. The orchestrator stamps the index in ONE write
 * AFTER this render succeeds, so on a first-ever generation the just-written .md is not yet
 * in the index — the caller passes its filename here so we don't read a stale index field.
 * When omitted (e.g. the lazy serve route on an already-indexed deep dive) it falls back to
 * the index.
 */
export async function runDeepDiveHtml(
  videoId: string,
  outputFolder: string,
  deepDiveMd?: string,
): Promise<{ html: string; htmlPath: string }> {
  assertOutputFolder(outputFolder);
  assertVideoId(videoId);

  const index = readIndex(outputFolder);
  const video = index.videos.find((v) => v.id === videoId);
  if (!video) throw new Error(`Video not found in index: ${videoId}`);
  const md = deepDiveMd ?? video.deepDiveMd;
  if (!md) throw new Error('deep dive not available: video has no deepDiveMd');
  assertSafeDeepDiveMd(outputFolder, md);

  const mdPath = path.join(outputFolder, md);
  const mdContent = fs.readFileSync(mdPath, 'utf-8');
  const html = renderDeepDiveHtml(mdContent, md, !!video.summaryMd);

  const base = md.replace(/\.md$/, '');
  const htmlRel = `htmls/${base}.html`;
  const finalPath = path.join(outputFolder, htmlRel);
  fs.mkdirSync(path.dirname(finalPath), { recursive: true });
  const tmpPath = `${finalPath}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tmpPath, html, 'utf-8');
    fs.renameSync(tmpPath, finalPath);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    throw err;
  }
  return { html, htmlPath: htmlRel };
}

export type DeepDiveReRenderResult =
  | { status: 'rerendered'; htmlPath: string }
  | { status: 'skipped-not-eligible' }
  | { status: 'skipped-no-md' };

/**
 * Re-render one deep-dive's HTML from its existing .md — no Gemini, no transcript fetch.
 * The .md already contains resolved ▶ timestamp lines, so this is a cheap re-render.
 * Returns a status for every data condition; throws only on HTML write I/O failure.
 */
export function reRenderDeepDiveHtml(videoId: string, outputFolder: string): DeepDiveReRenderResult {
  assertOutputFolder(outputFolder);
  assertVideoId(videoId);

  const index = readIndex(outputFolder);
  const video = index.videos.find((v) => v.id === videoId);
  if (!video) return { status: 'skipped-not-eligible' };
  if (!video.deepDiveMd) return { status: 'skipped-no-md' };
  assertSafeDeepDiveMd(outputFolder, video.deepDiveMd);

  let mdContent: string;
  try {
    mdContent = fs.readFileSync(path.join(outputFolder, video.deepDiveMd), 'utf-8');
  } catch {
    return { status: 'skipped-no-md' };
  }

  const html = renderDeepDiveHtml(mdContent, video.deepDiveMd, !!video.summaryMd);
  const base = video.deepDiveMd.replace(/\.md$/, '');
  const htmlRel = `htmls/${base}.html`;
  const finalPath = path.join(outputFolder, htmlRel);
  fs.mkdirSync(path.dirname(finalPath), { recursive: true });
  const tmpPath = `${finalPath}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tmpPath, html, 'utf-8');
    fs.renameSync(tmpPath, finalPath);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    throw err;
  }
  return { status: 'rerendered', htmlPath: htmlRel };
}
