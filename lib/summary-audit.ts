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
    // `summaryMd` is index-controlled; a corrupt/hand-edited entry could contain `../`. Only accept
    // paths that stay within the corpus root (covers both raw/ and archived/). Reject traversal.
    const root = path.resolve(folder);
    const contained = (p: string) => {
      const abs = path.resolve(folder, p);
      return abs === root || abs.startsWith(root + path.sep) ? abs : null;
    };
    // Validate the raw summaryMd first — a `../` here is an unsafe (traversal) index entry. Only
    // once it's known-safe do we also try the archived/ subfolder (archived videos keep their base
    // name but the file moves under archived/). This ordering stops `../x` from collapsing to an
    // in-root path via the archived join and being mislabeled md-missing.
    const direct = contained(v.summaryMd);
    if (!direct) {
      suspects.push({ id: v.id, serial, reason: 'unsafe path (outside corpus)', confidence: 'high' });
      continue;
    }
    const candidates = [direct, contained(path.join('archived', v.summaryMd))]
      .filter((p): p is string => p !== null);
    const abs = candidates.find((p) => fs.existsSync(p));
    if (!abs) {
      suspects.push({ id: v.id, serial, reason: 'md-missing', confidence: 'high' });
      continue;
    }
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
