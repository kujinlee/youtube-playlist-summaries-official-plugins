import path from 'path';
import fs from 'node:fs/promises';
import { assertOutputFolder, assertVideoId, readIndex } from '../index-store';
import { ensureHtmlDoc } from './ensure';
import { summaryNeedsWork } from './eligibility';
import { parseSummaryMarkdown } from './parse';
import { parseDugSections } from '../dig/companion-doc';
import { digSection } from '../dig/dig-section';
import { DIG_GENERATOR_VERSION } from '../dig/generate';
import type { ProgressEvent, Video } from '../../types';

export type BatchMode = 'summary' | 'summary-dig';

type WorkItem =
  | { kind: 'summary'; videoId: string; title?: string }
  | { kind: 'dig'; videoId: string; title?: string; sectionId: number; sectionTitle: string };

/** Dig-eligible sections (have a timeRange) that are missing or stale in the companion doc. */
async function missingDigSections(video: Video, outputFolder: string): Promise<{ sectionId: number; title: string }[]> {
  if (!video.summaryMd) return [];
  let eligible: { sectionId: number; title: string }[];
  try {
    const md = await fs.readFile(path.join(outputFolder, video.summaryMd), 'utf8');
    // parseSummaryMarkdown THROWS on a summary with no `##` sections — treat as 0 dig sections,
    // never let it reject the whole pre-pass.
    eligible = parseSummaryMarkdown(md).sections
      .filter((s) => s.timeRange)
      .map((s) => ({ sectionId: s.timeRange!.startSec, title: s.title }));
  } catch {
    return [];
  }
  if (eligible.length === 0) return [];
  // Use the INDEXED companion path when present (it may differ from the derived name); else derive.
  const companionRel = video.digDeeperMd ?? `${path.basename(video.summaryMd, '.md')}-dig-deeper.md`;
  let dug: { sectionId: number; genVersion: number }[] = [];
  try {
    const content = await fs.readFile(path.join(outputFolder, companionRel), 'utf8');
    dug = parseDugSections(content).map((s) => ({ sectionId: s.sectionId, genVersion: s.genVersion }));
  } catch { /* no companion yet → all eligible are missing */ }
  const versionById = new Map(dug.map((s) => [s.sectionId, s.genVersion]));
  return eligible.filter((s) => {
    const gv = versionById.get(s.sectionId);
    return gv === undefined || gv < DIG_GENERATOR_VERSION;
  });
}

export async function runBatchDocs(
  videoIds: string[],
  mode: BatchMode,
  outputFolder: string,
  onProgress: (e: ProgressEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  assertOutputFolder(outputFolder);
  const index = readIndex(outputFolder);
  const byId = new Map(index.videos.map((v) => [v.id, v]));

  // PRE-PASS (no Gemini): build a flat work list, skipping current items.
  const work: WorkItem[] = [];
  for (const id of videoIds) {
    const v = byId.get(id);
    if (!v) continue;
    if (summaryNeedsWork(v)) work.push({ kind: 'summary', videoId: id, title: v.title });
    if (mode === 'summary-dig') {
      for (const s of await missingDigSections(v, outputFolder)) {
        work.push({ kind: 'dig', videoId: id, title: v.title, sectionId: s.sectionId, sectionTitle: s.title });
      }
    }
  }

  onProgress({ type: 'start', total: work.length });

  let succeeded = 0;
  let failed = 0;
  for (let i = 0; i < work.length; i++) {
    if (signal?.aborted) { onProgress({ type: 'cancelled' }); return; }
    const item = work[i];
    assertVideoId(item.videoId);
    const stepText = item.kind === 'summary' ? 'Generating HTML doc…' : `Digging "${item.sectionTitle}"…`;
    onProgress({ type: 'step', videoId: item.videoId, title: item.title, step: stepText, current: i + 1, total: work.length });
    try {
      if (item.kind === 'summary') {
        await ensureHtmlDoc(item.videoId, outputFolder, () => {});
      } else {
        // CRITICAL: digSection EMITS {type:'error'} and RETURNS for failures (missing video/section,
        // null window, abort-before-write) — it does NOT throw. Capture that error and rethrow so the
        // catch below counts it as failed (otherwise failures become silent successes).
        let digErr: string | null = null;
        await digSection(item.videoId, item.sectionId, outputFolder, signal, (e) => {
          if (e.type === 'error') digErr = e.log;
        });
        if (digErr) throw new Error(digErr);
      }
      succeeded++;
    } catch (err) {
      failed++;
      // eslint-disable-next-line no-console
      console.warn(`[batch-docs] ${item.videoId} (${item.kind}) failed: ${err instanceof Error ? err.message : String(err)}`);
      onProgress({ type: 'error', videoId: item.videoId, title: item.title, log: err instanceof Error ? err.message : String(err) });
    }
  }

  onProgress({ type: 'done', succeeded, failed, total: work.length });
}
