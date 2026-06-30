import fs from 'fs';
import path from 'path';
import { readIndex } from './index-store';
import { auditTimestamps, countLeadingTimestamps } from './timestamp-audit';
import { ensureHtmlDoc } from './html-doc/ensure';
import type { ProgressEvent } from '../types';

export interface RepairOptions { run: boolean; stuckOnly: boolean; ids?: string[]; }
export interface RepairItem { videoId: string; kind: 'summary'; reason: 'stuck' | 'would-regen'; }
export interface RepairOutcome { videoId: string; kind: 'summary'; before: number; after: number; }
export interface RepairSkip { videoId: string; kind: 'summary'; error: string; }
export interface RepairResult { dryRun: boolean; planned: RepairItem[]; repaired: RepairOutcome[]; skipped: RepairSkip[]; }

const noop = (_e: ProgressEvent): void => {};

// before/after ▶ counts are informational logging only — a read failure must NEVER abort the
// batch (and in unit tests, where ensure* is mocked, readIndex on a synthetic folder will throw).
function tsCount(folder: string, id: string): number {
  try {
    const v = readIndex(folder).videos.find((x) => x.id === id);
    const rel = v?.summaryMd;
    if (!rel) return 0;
    const abs = path.join(folder, rel);
    return fs.existsSync(abs) ? countLeadingTimestamps(fs.readFileSync(abs, 'utf8')) : 0;
  } catch {
    return 0;
  }
}

export async function repairTimestamps(folder: string, opts: RepairOptions): Promise<RepairResult> {
  const a = auditTimestamps(folder);
  const planned: RepairItem[] = [];
  const add = (ids: string[], reason: 'stuck' | 'would-regen') => {
    for (const id of ids) planned.push({ videoId: id, kind: 'summary', reason });
  };
  add(a.summaries.stuckIds, 'stuck');
  if (!opts.stuckOnly) {
    add(a.summaries.wouldRegenIds, 'would-regen');
  }
  const targets = opts.ids ? planned.filter((p) => opts.ids!.includes(p.videoId)) : planned;

  if (!opts.run) return { dryRun: true, planned: targets, repaired: [], skipped: [] };

  const repaired: RepairOutcome[] = [];
  const skipped: RepairSkip[] = [];
  let i = 0;
  for (const t of targets) {           // sequential — this loop is what serializes (the lib does not)
    i++;
    const before = tsCount(folder, t.videoId);
    try {
      await ensureHtmlDoc(t.videoId, folder, noop, undefined, true);
      const after = tsCount(folder, t.videoId);
      repaired.push({ videoId: t.videoId, kind: t.kind, before, after });
      console.log(`[repair] ${i}/${targets.length} ${t.videoId} ${t.kind}: ${before} → ${after}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      skipped.push({ videoId: t.videoId, kind: t.kind, error: msg });
      console.log(`[repair] ${i}/${targets.length} ${t.videoId} ${t.kind}: SKIPPED (${msg})`);
    }
  }
  return { dryRun: false, planned: targets, repaired, skipped };
}
