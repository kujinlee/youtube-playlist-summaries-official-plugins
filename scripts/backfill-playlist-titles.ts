// NOTE: relative imports — ts-node (CommonJS override) does NOT resolve `@/*` at runtime.
import { backfillPlaylistTitles } from '../lib/playlists/backfill-titles';

async function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf('--root');
  const root = i !== -1 ? args[i + 1] : process.cwd();
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) { console.error('YOUTUBE_API_KEY is not set'); process.exit(1); }
  console.log('⚠️  Writes playlist-index.json in place — do NOT run concurrently with ingestion/sync.');
  const res = await backfillPlaylistTitles(root, apiKey);
  console.log(`Backfill: ${res.updated.length} updated, ${res.skipped.length} skipped, ${res.failed.length} failed`);
  for (const f of res.failed) console.log(`  FAILED: ${f}`);
}
main();
