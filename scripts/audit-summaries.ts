/**
 * audit-summaries.ts — read-only completeness health-check over a corpus folder. NO Gemini.
 * Usage:  npm run audit-summaries -- --folder <outputFolder>
 *         (defaults to OUTPUT_FOLDER).
 * ALWAYS exits 0 — it is a report tool. Missing folder or a bad/unreadable index is printed to
 * stderr as a diagnostic, never a nonzero exit (so it can be piped/chained without gating).
 */
import { auditSummaries } from '../lib/summary-audit';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const folder = arg('folder') ?? process.env.OUTPUT_FOLDER ?? '';
if (!folder) {
  console.error('audit-summaries: set --folder <outputFolder> or OUTPUT_FOLDER — nothing to audit');
  process.exit(0);
}

try {
  const r = auditSummaries(folder);
  console.log(`[${folder}] total ${r.total}, suspects ${r.suspects.length}`);
  for (const s of r.suspects) {
    console.log(`  ${s.serial ?? '?'} | ${s.id} | ${s.reason} | ${s.confidence}`);
  }
} catch (e) {
  console.error(`audit-summaries: could not audit ${folder}: ${e instanceof Error ? e.message : String(e)}`);
}
process.exit(0); // read-only report tool — never gate on suspects or data errors
