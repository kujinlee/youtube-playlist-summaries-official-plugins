/**
 * audit-timestamps.ts — read-only ▶-timestamp health-check over a corpus folder. NO Gemini.
 * Usage:  npm run audit-timestamps -- --folder <outputFolder>
 *         (defaults to OUTPUT_FOLDER). Exits non-zero if any SUMMARY is stuck (current major, no ▶).
 */
import { auditTimestamps, type KindAudit } from '../lib/timestamp-audit';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function line(label: string, k: KindAudit): void {
  console.log(`${label}: total ${k.total}, with ▶ ${k.withTs}, no-▶ would-regen ${k.noTsWouldRegen}, no-▶ STUCK ${k.noTsStuck}, md-missing ${k.mdMissing}`);
  if (k.stuckIds.length) console.log(`  stuck: ${k.stuckIds.join(', ')}`);
}

const folder = arg('folder') ?? process.env.OUTPUT_FOLDER ?? '';
if (!folder) { console.error('Set --folder <outputFolder> or OUTPUT_FOLDER'); process.exit(1); }

const r = auditTimestamps(folder);
console.log(`[${folder}]`);
line('Summaries', r.summaries);
process.exit(r.summaries.noTsStuck > 0 ? 1 : 0);
