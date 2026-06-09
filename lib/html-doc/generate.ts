import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { assertOutputFolder, assertVideoId, readIndex, updateVideoFields } from '../index-store';
import { generateMagazineModel } from '../gemini';
import { parseSummaryMarkdown } from './parse';
import { renderMagazineHtml } from './render';
import type { ProgressEvent } from '../../types';

export async function runHtmlDoc(
  videoId: string,
  outputFolder: string,
  onProgress: (event: ProgressEvent) => void,
): Promise<void> {
  assertOutputFolder(outputFolder);
  assertVideoId(videoId);

  const index = readIndex(outputFolder);
  const video = index.videos.find((v) => v.id === videoId);
  if (!video) throw new Error(`Video not found in index: ${videoId}`);
  if (!video.summaryMd) throw new Error('source note not found: video has no summaryMd');

  onProgress({ type: 'start' });
  onProgress({ type: 'step', videoId, step: 'Reading summary…', current: 1, total: 3 });

  const mdPath = path.join(outputFolder, video.summaryMd);
  let md: string;
  try {
    md = fs.readFileSync(mdPath, 'utf-8');
  } catch (err) {
    throw new Error(`source note not found on disk: ${video.summaryMd}`, { cause: err });
  }

  const parsed = parseSummaryMarkdown(md);
  parsed.sourceMd = video.summaryMd; // for the <meta name="source-md"> provenance field

  onProgress({ type: 'step', videoId, step: 'Transforming to skim view…', current: 2, total: 3 });
  const model = await generateMagazineModel(
    parsed.sections.map((s) => ({ title: s.title, prose: s.prose })),
    video.language,
  );

  onProgress({ type: 'step', videoId, step: 'Rendering HTML…', current: 3, total: 3 });
  const html = renderMagazineHtml(parsed, model);

  const base = video.summaryMd.replace(/\.md$/, '');
  const htmlFilename = `htmls/${base}.html`;
  const htmlDir = path.join(outputFolder, 'htmls');
  fs.mkdirSync(htmlDir, { recursive: true });

  // Atomic write: temp file → rename (mirrors index-store.writeIndex / pdf caller).
  const finalPath = path.join(outputFolder, htmlFilename);
  const tmpPath = `${finalPath}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tmpPath, html, 'utf-8');
    fs.renameSync(tmpPath, finalPath);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    throw err;
  }

  // Codex HIGH: if the index update fails, remove the just-written file so we don't leave an
  // orphan HTML the index doesn't reference (keeps cache ↔ index consistent).
  try {
    updateVideoFields(outputFolder, videoId, { summaryHtml: htmlFilename });
  } catch (err) {
    try { fs.unlinkSync(finalPath); } catch { /* ignore cleanup error */ }
    throw err;
  }
  onProgress({ type: 'done' });
}
