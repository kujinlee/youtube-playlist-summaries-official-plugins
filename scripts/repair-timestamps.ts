/**
 * repair-timestamps.ts — re-generate timestamp-less docs (drives the guarded lib path). Dry-run by default.
 * Usage:  npm run repair-timestamps -- --folder <f> [--run] [--stuck-only] [--ids a,b,c]
 * WARNING: do not run while the dev server is processing the same folder (both write playlist-index.json).
 */
import { repairTimestamps } from '../lib/timestamp-repair';

function flag(name: string): boolean { return process.argv.includes(`--${name}`); }
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const folder = arg('folder') ?? process.env.OUTPUT_FOLDER ?? '';
if (!folder) { console.error('Set --folder <outputFolder> or OUTPUT_FOLDER'); process.exit(1); }
const ids = arg('ids')?.split(',').map((s) => s.trim()).filter(Boolean);

repairTimestamps(folder, { run: flag('run'), stuckOnly: flag('stuck-only'), ids }).then((r) => {
  if (r.dryRun) {
    console.log(`[dry-run] would repair ${r.planned.length}:`);
    for (const p of r.planned) console.log(`  ${p.videoId} ${p.kind} (${p.reason})`);
    console.log('Re-run with --run to regenerate.');
  } else {
    console.log(`Repaired ${r.repaired.length}, skipped ${r.skipped.length}.`);
  }
}).catch((e) => { console.error(e); process.exit(1); });
