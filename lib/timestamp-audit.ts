import fs from 'fs';
import path from 'path';
import { readIndex } from './index-store';
import { CURRENT_DOC_VERSION } from './doc-version';
import { CURRENT_DEEP_DIVE_VERSION } from './deep-dive/version';

const PRE_FEATURE = { major: 1, minor: 0 };

export function hasLeadingTimestamp(md: string): boolean { return /^▶/m.test(md); }
export function countLeadingTimestamps(md: string): number { return (md.match(/^▶/gm) ?? []).length; }

export interface KindAudit {
  total: number; withTs: number; noTsWouldRegen: number; noTsStuck: number; mdMissing: number;
  stuckIds: string[]; wouldRegenIds: string[];
}
export interface AuditReport { folder: string; summaries: KindAudit; deepDives: KindAudit; }

function emptyKind(): KindAudit {
  return { total: 0, withTs: 0, noTsWouldRegen: 0, noTsStuck: 0, mdMissing: 0, stuckIds: [], wouldRegenIds: [] };
}

function classify(
  acc: KindAudit, folder: string, id: string, mdRel: string,
  storedMajor: number, currentMajor: number,
): void {
  acc.total++;
  const abs = path.join(folder, mdRel);
  if (!fs.existsSync(abs)) { acc.mdMissing++; return; }
  if (hasLeadingTimestamp(fs.readFileSync(abs, 'utf8'))) { acc.withTs++; return; }
  if (storedMajor >= currentMajor) { acc.noTsStuck++; acc.stuckIds.push(id); }
  else { acc.noTsWouldRegen++; acc.wouldRegenIds.push(id); }
}

export function auditTimestamps(folder: string): AuditReport {
  const { videos } = readIndex(folder);
  const summaries = emptyKind();
  const deepDives = emptyKind();
  for (const v of videos) {
    if (v.summaryMd) {
      const ver = v.docVersion ?? PRE_FEATURE;
      classify(summaries, folder, v.id, v.summaryMd, ver.major, CURRENT_DOC_VERSION.major);
    }
    if (v.deepDiveMd) {
      const ver = v.deepDiveVersion ?? PRE_FEATURE;
      classify(deepDives, folder, v.id, v.deepDiveMd, ver.major, CURRENT_DEEP_DIVE_VERSION.major);
    }
  }
  return { folder, summaries, deepDives };
}
