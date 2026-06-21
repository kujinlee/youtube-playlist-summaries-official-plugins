import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { assertOutputFolder, assertVideoId, readIndex } from '../index-store';
import { renderDeepDiveHtml } from './render-deep-dive';

/**
 * Render a video's deep-dive markdown to a self-contained HTML page, atomic-write it to
 * htmls/<base>.html (base = deepDiveMd minus .md), and return the rendered HTML string and
 * the relative path of the written file.
 * Does NOT touch the index — the serve route keys on the cache file's existence.
 */
export async function runDeepDiveHtml(
  videoId: string,
  outputFolder: string,
): Promise<{ html: string; htmlPath: string }> {
  assertOutputFolder(outputFolder);
  assertVideoId(videoId);

  const index = readIndex(outputFolder);
  const video = index.videos.find((v) => v.id === videoId);
  if (!video) throw new Error(`Video not found in index: ${videoId}`);
  if (!video.deepDiveMd) throw new Error('deep dive not available: video has no deepDiveMd');

  const mdPath = path.join(outputFolder, video.deepDiveMd);
  const mdContent = fs.readFileSync(mdPath, 'utf-8');
  const html = renderDeepDiveHtml(mdContent, video.deepDiveMd);

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

  let mdContent: string;
  try {
    mdContent = fs.readFileSync(path.join(outputFolder, video.deepDiveMd), 'utf-8');
  } catch {
    return { status: 'skipped-no-md' };
  }

  const html = renderDeepDiveHtml(mdContent, video.deepDiveMd);
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
