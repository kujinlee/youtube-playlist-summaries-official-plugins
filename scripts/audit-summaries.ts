/**
 * audit-summaries.ts — read-only completeness health-check over a corpus folder. NO Gemini.
 * Usage:  npm run audit-summaries -- --folder <outputFolder>
 *         (defaults to OUTPUT_FOLDER). Always exits 0 — it is a report tool.
 */
import { auditSummaries } from '../lib/summary-audit';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const folder = arg('folder') ?? process.env.OUTPUT_FOLDER ?? '';
if (!folder) {
  console.error('Set --folder <outputFolder> or OUTPUT_FOLDER');
  process.exit(1);
}

const r = auditSummaries(folder);
console.log(`[${folder}] total ${r.total}, suspects ${r.suspects.length}`);
for (const s of r.suspects) {
  console.log(`  ${s.serial ?? '?'} | ${s.id} | ${s.reason} | ${s.confidence}`);
}
process.exit(0); // read-only report tool — never gate on suspects
