/**
 * rerender-html.ts
 *
 * Offline restyle of summary HTML from cached magazine models — NO Gemini calls.
 * Run this after changing the renderer (lib/html-doc/render.ts) to refresh every summary
 * whose model has been cached. Summaries with no cached model are reported (regenerate once
 * via the app to enable them); section-drifted summaries are flagged for regeneration.
 *
 * Usage:  npx ts-node scripts/rerender-html.ts <outputFolder> [<outputFolder2> ...]
 */
import { reRenderAll } from '../lib/html-doc/rerender';

function run(outputFolder: string): void {
  const t = reRenderAll(outputFolder);
  // Headline counts only the actionable outcomes; "not eligible" (videos with no summary to
  // refresh) is irrelevant to a restyle and stays silent.
  const skipped = t.skippedNoModel + t.skippedNoMd + t.skippedUnparseable + t.skippedDrift;
  console.log(`[${outputFolder}] re-rendered ${t.rerendered}, skipped ${skipped}, errors ${t.errors}`);
  for (const d of t.details) {
    if (d.status === 'rerendered' || d.status === 'skipped-not-eligible') continue;
    if (d.status === 'skipped-drift') {
      console.log(`  skipped-drift:    ${d.summaryMd} (sections [${d.mdSections?.join(', ')}] ≠ model [${d.modelSections?.join(', ')}] — regenerate)`);
    } else if (d.status === 'skipped-no-model') {
      console.log(`  skipped-no-model: ${d.summaryMd} (regenerate once to enable)`);
    } else if (d.status === 'skipped-no-md') {
      console.log(`  skipped-no-md:    ${d.summaryMd} (.md missing on disk)`);
    } else if (d.status === 'skipped-unparseable') {
      console.log(`  skipped-unparse:  ${d.summaryMd} (.md has no sections — regenerate)`);
    } else if (d.status === 'error') {
      console.log(`  error:            ${d.summaryMd} (${d.message})`);
    }
  }
}

const folders = process.argv.slice(2);
if (folders.length === 0) {
  console.error('Usage: npx ts-node scripts/rerender-html.ts <outputFolder> [<outputFolder2> ...]');
  process.exit(1);
}
for (const folder of folders) run(folder);
