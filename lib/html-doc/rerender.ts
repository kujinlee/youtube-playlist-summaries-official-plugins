import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { assertOutputFolder, assertVideoId, readIndex } from '../index-store';
import { parseSummaryMarkdown } from './parse';
import { renderMagazineHtml } from './render';
import { readModelEnvelope } from './model-store';

export type ReRenderResult =
  | { status: 'rerendered'; htmlPath: string }
  | { status: 'skipped-not-eligible' }   // no video / no summaryMd / no summaryHtml — nothing to refresh
  | { status: 'skipped-no-model' }        // eligible but the model file is absent/invalid — regenerate to enable
  | { status: 'skipped-no-md' }
  | { status: 'skipped-unparseable' }
  | { status: 'skipped-drift'; mdSections: string[]; modelSections: string[] };

export function sameTitles(a: string[], b: string[]): boolean {
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
  if (!video || !video.summaryMd || !video.summaryHtml) return { status: 'skipped-not-eligible' };

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

  const html = renderMagazineHtml(parsed, envelope.model, !!video.deepDiveMd);
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

export interface ReRenderDetail {
  summaryMd: string | null;
  status: ReRenderResult['status'] | 'error';
  message?: string;
  mdSections?: string[];
  modelSections?: string[];
}

export interface ReRenderTally {
  rerendered: number;
  skippedNotEligible: number;
  skippedNoModel: number;
  skippedNoMd: number;
  skippedUnparseable: number;
  skippedDrift: number;
  errors: number;
  details: ReRenderDetail[];
}

/** Re-render every summary in a playlist. Per-video errors are isolated, never abort the batch. */
export function reRenderAll(outputFolder: string): ReRenderTally {
  assertOutputFolder(outputFolder);
  const index = readIndex(outputFolder);
  const tally: ReRenderTally = {
    rerendered: 0, skippedNotEligible: 0, skippedNoModel: 0, skippedNoMd: 0,
    skippedUnparseable: 0, skippedDrift: 0, errors: 0, details: [],
  };
  for (const video of index.videos) {
    try {
      const res = reRenderSummaryHtml(video.id, outputFolder);
      switch (res.status) {
        case 'rerendered': tally.rerendered++; break;
        case 'skipped-not-eligible': tally.skippedNotEligible++; break;
        case 'skipped-no-model': tally.skippedNoModel++; break;
        case 'skipped-no-md': tally.skippedNoMd++; break;
        case 'skipped-unparseable': tally.skippedUnparseable++; break;
        case 'skipped-drift': tally.skippedDrift++; break;
      }
      tally.details.push({
        summaryMd: video.summaryMd,
        status: res.status,
        ...(res.status === 'skipped-drift'
          ? { mdSections: res.mdSections, modelSections: res.modelSections }
          : {}),
      });
    } catch (err) {
      tally.errors++;
      tally.details.push({ summaryMd: video.summaryMd, status: 'error', message: (err as Error).message });
    }
  }
  return tally;
}
