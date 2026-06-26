// NOTE: relative imports — ts-node (CommonJS override) does NOT resolve `@/*` at runtime
// (only jest's moduleNameMapper does). Scripts in this repo all use relative imports.
import { readIndex } from '../lib/index-store';
import { planMigration } from '../lib/serial-migrate';
import { runPhaseA, runPhaseBUntilStable, resolveOnDisk } from '../lib/serial-migrate-exec';

export function dryRunReport(outputFolder: string): string {
  const { assignments, perVideo } = planMigration(readIndex(outputFolder).videos);
  const lines: string[] = [`DRY RUN — ${assignments.length} new serial(s) to assign`];
  for (const p of perVideo) {
    for (const op of p.renames) {
      // Skip phantom ops: the planner derives ops from index fields regardless of whether
      // the source file exists, so an index entry pointing at a deleted/never-written file
      // (e.g. a dropped PDF, an on-demand-rendered HTML) would otherwise show as a forever-
      // pending rename. Only list ops whose source actually resolves on disk.
      if (resolveOnDisk(outputFolder, op.from)) lines.push(`  [${p.serial}] ${op.from}  ->  ${op.to}`);
    }
  }
  return lines.join('\n');
}

function main(): void {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const folderArg = args.indexOf('--folder');
  const outputFolder = folderArg !== -1 ? args[folderArg + 1] : process.cwd();
  if (!apply) { console.log(dryRunReport(outputFolder)); console.log('\n(dry run — pass --apply to execute. Do NOT run concurrently with ingestion.)'); return; }
  const a = runPhaseA(outputFolder);
  const b = runPhaseBUntilStable(outputFolder);
  console.log(`Applied: assigned ${a.assigned}, renamed ${b.renamed}, conflicts ${b.conflicts.length} (converged in ${b.passes} pass${b.passes === 1 ? '' : 'es'})`);
  if (b.conflicts.length) console.error('Conflicts (not renamed):', b.conflicts.join(', '));
}

// Run only when invoked directly (not when imported by tests).
if (require.main === module) main();
