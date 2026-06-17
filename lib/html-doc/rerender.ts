import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { assertOutputFolder, assertVideoId, readIndex } from '../index-store';
import { parseSummaryMarkdown } from './parse';
import { renderMagazineHtml } from './render';
import { readModelEnvelope } from './model-store';

export type ReRenderResult =
  | { status: 'rerendered'; htmlPath: string }
  | { status: 'skipped-no-model' }
  | { status: 'skipped-no-md' }
  | { status: 'skipped-unparseable' }
  | { status: 'skipped-drift'; mdSections: string[]; modelSections: string[] };

function sameTitles(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((t, i) => t === b[i]);
}

/**
 * Re-render one summary's HTML from its cached model + the current .md — no Gemini.
 * Deterministic: same model + same .md → same HTML under the current renderer.
 * Only refreshes summaries that already have an HTML; guards section-title alignment.
 * Total: returns a status for every data condition; throws only on an HTML write I/O failure.
 */
export function reRenderSummaryHtml(videoId: string, outputFolder: string): ReRenderResult {
  assertOutputFolder(outputFolder);
  assertVideoId(videoId);

  const index = readIndex(outputFolder);
  const video = index.videos.find((v) => v.id === videoId);
  // Re-render refreshes an EXISTING doc: needs a source note AND a current HTML.
  if (!video || !video.summaryMd || !video.summaryHtml) return { status: 'skipped-no-model' };

  const base = video.summaryMd.replace(/\.md$/, '');
  const envelope = readModelEnvelope(outputFolder, base);
  if (!envelope) return { status: 'skipped-no-model' };

  let md: string;
  try {
    md = fs.readFileSync(path.join(outputFolder, video.summaryMd), 'utf-8');
  } catch {
    return { status: 'skipped-no-md' };
  }

  let parsed;
  try {
    parsed = parseSummaryMarkdown(md);
  } catch {
    return { status: 'skipped-unparseable' };
  }
  parsed.sourceMd = video.summaryMd;

  const mdTitles = parsed.sections.map((s) => s.title);
  if (!sameTitles(mdTitles, envelope.sourceSections)) {
    return { status: 'skipped-drift', mdSections: mdTitles, modelSections: envelope.sourceSections };
  }

  const html = renderMagazineHtml(parsed, envelope.model);
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
