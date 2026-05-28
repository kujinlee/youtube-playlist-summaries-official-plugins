/**
 * migrate-pdfs-to-subfolder.ts
 *
 * Moves existing PDF files from the playlist root into a pdfs/ subdirectory
 * and updates playlist-index.json accordingly.
 *
 * This is a one-time migration — run it after deploying the pipeline change
 * that writes new PDFs to pdfs/. Existing playlists are left unchanged until
 * this script runs; the app continues to serve PDFs correctly in the interim
 * because /api/pdf reads the path from the index.
 *
 * Usage (run from project root):
 *   npx ts-node scripts/migrate-pdfs-to-subfolder.ts [baseOutputFolder]
 *
 * If baseOutputFolder is omitted, the script reads it from settings.json.
 */

import * as fs from 'fs';
import * as path from 'path';

interface VideoEntry {
  summaryPdf?: string | null;
  deepDivePdf?: string | null;
  [key: string]: unknown;
}

interface PlaylistIndex {
  videos: VideoEntry[];
  [key: string]: unknown;
}

/**
 * Migrates PDFs in a single playlist folder.
 * Returns true if any changes were made, false if the folder was already up-to-date.
 */
export function migratePdfsInPlaylistFolder(playlistFolder: string): boolean {
  const indexPath = path.join(playlistFolder, 'playlist-index.json');
  if (!fs.existsSync(indexPath)) return false;

  const index: PlaylistIndex = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
  const pdfsDir = path.join(playlistFolder, 'pdfs');
  let anyChanged = false;

  const videos = index.videos.map((video) => {
    const updates: Partial<VideoEntry> = {};

    for (const field of ['summaryPdf', 'deepDivePdf'] as const) {
      const current = video[field];
      if (!current || current.startsWith('pdfs/')) continue;

      const src = path.join(playlistFolder, current);
      const dest = path.join(playlistFolder, 'pdfs', current);

      if (fs.existsSync(src)) {
        fs.mkdirSync(pdfsDir, { recursive: true });
        fs.renameSync(src, dest);
      }
      updates[field] = `pdfs/${current}`;
    }

    if (Object.keys(updates).length > 0) {
      anyChanged = true;
      return { ...video, ...updates };
    }
    return video;
  });

  if (anyChanged) {
    const updated = JSON.stringify({ ...index, videos }, null, 2) + '\n';
    const tmpPath = `${indexPath}.tmp`;
    fs.writeFileSync(tmpPath, updated, 'utf-8');
    fs.renameSync(tmpPath, indexPath);
  }

  return anyChanged;
}

// CLI entry point — only runs when invoked directly
if (require.main === module) {
  function getBaseFolder(): string {
    const arg = process.argv[2];
    if (arg) return arg;
    try {
      const settings = JSON.parse(fs.readFileSync('settings.json', 'utf-8'));
      const folder = settings.baseOutputFolder ?? settings.outputFolder;
      if (!folder) throw new Error('no folder found in settings.json');
      return folder;
    } catch {
      throw new Error(
        'Pass base folder as first argument, or run from project root with settings.json present.\n' +
        'Usage: npx ts-node scripts/migrate-pdfs-to-subfolder.ts [baseOutputFolder]',
      );
    }
  }

  const baseFolder = getBaseFolder();
  console.log(`Migrating PDFs under: ${baseFolder}\n`);

  const entries = fs.readdirSync(baseFolder, { withFileTypes: true });
  let migratedCount = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const playlistFolder = path.join(baseFolder, entry.name);
    try {
      const changed = migratePdfsInPlaylistFolder(playlistFolder);
      if (changed) {
        console.log(`  ✓ ${entry.name}`);
        migratedCount++;
      }
    } catch (err) {
      console.error(`  ✗ ${entry.name}: ${err}`);
    }
  }

  console.log(`\nDone. ${migratedCount} playlist(s) migrated.`);
}
