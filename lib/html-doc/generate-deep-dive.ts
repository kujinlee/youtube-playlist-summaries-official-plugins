import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { assertOutputFolder, assertVideoId, readIndex } from '../index-store';
import { renderDeepDiveHtml } from './render-deep-dive';

/**
 * Render a video's deep-dive markdown to a self-contained HTML page, atomic-write it to
 * htmls/<base>.html (base = deepDiveMd minus .md), and return the rendered HTML string.
 * Does NOT touch the index — the serve route keys on the cache file's existence.
 */
export async function runDeepDiveHtml(videoId: string, outputFolder: string): Promise<string> {
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
  const htmlDir = path.join(outputFolder, 'htmls');
  fs.mkdirSync(htmlDir, { recursive: true });
  const finalPath = path.join(htmlDir, `${base}.html`);
  const tmpPath = `${finalPath}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tmpPath, html, 'utf-8');
    fs.renameSync(tmpPath, finalPath);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    throw err;
  }
  return html;
}
