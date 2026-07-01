import fs from 'fs';
import path from 'path';
import { readIndex } from './index-store';
import { checkSummaryCompleteness } from './summary-completeness';

export interface SummaryAuditReport {
  folder: string;
  total: number;
  suspects: Array<{ id: string; serial: number | null; reason: string; confidence: string }>;
}

/**
 * Read-only corpus sweep for truncated/suspicious summaries. Iterates the index; serial is
 * resolved from the index record (v.serialNumber), NOT the filename. Never throws per-file.
 */
export function auditSummaries(folder: string): SummaryAuditReport {
  const { videos } = readIndex(folder);
  const suspects: SummaryAuditReport['suspects'] = [];
  let total = 0;
  for (const v of videos) {
    if (!v.summaryMd) continue;
    total++;
    const serial = v.serialNumber ?? null;
    const abs = path.join(folder, v.summaryMd);
    let md: string;
    try {
      md = fs.readFileSync(abs, 'utf8');
    } catch {
      suspects.push({ id: v.id, serial, reason: 'md-missing', confidence: 'high' });
      continue;
    }
    const r = checkSummaryCompleteness(md);
    if (!r.complete) {
      suspects.push({ id: v.id, serial, reason: r.reason ?? 'suspicious', confidence: r.confidence ?? 'high' });
    }
  }
  return { folder, total, suspects };
}
