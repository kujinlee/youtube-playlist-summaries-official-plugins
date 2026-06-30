/**
 * fix-duplicate-summaries.ts
 *
 * One-time data migration: removes -2.md / -2.pdf duplicate files caused by
 * concurrent ingestion runs, restoring canonical slug-based filenames.
 *
 * For each video in the index whose summaryMd ends with -2.md:
 *   1. Rename <slug>-2.md  → <slug>.md  (and delete the orphaned base .md if present)
 *   2. Update index entry: summaryMd → canonical name
 *
 * Usage:  npx ts-node scripts/fix-duplicate-summaries.ts <outputFolder> [<outputFolder2> ...]
 *         (pass one or more playlist output folders)
 */

import * as fs from 'fs';
import * as path from 'path';

interface VideoEntry {
  id: string;
  summaryMd?: string | null;
  [key: string]: unknown;
}

interface PlaylistIndex {
  videos: VideoEntry[];
  [key: string]: unknown;
}

function readIndex(folder: string): PlaylistIndex {
  const p = path.join(folder, 'playlist-index.json');
  return JSON.parse(fs.readFileSync(p, 'utf-8')) as PlaylistIndex;
}

function writeIndex(folder: string, index: PlaylistIndex): void {
  const p = path.join(folder, 'playlist-index.json');
  fs.writeFileSync(p, JSON.stringify(index, null, 2) + '\n', 'utf-8');
}

function stripDupSuffix(name: string, ext: string): string {
  // "slug-2.pdf" → "slug.pdf",  "slug-2.md" → "slug.md"
  const suffixPattern = new RegExp(`-2\\.${ext}$`);
  return name.replace(suffixPattern, `.${ext}`);
}

function fixFolder(folder: string): void {
  console.log(`\nProcessing: ${folder}`);
  const index = readIndex(folder);
  let changed = false;

  index.videos = index.videos.map((video) => {
    const updates: Partial<VideoEntry> = {};

    for (const [field, ext] of [['summaryMd', 'md']] as const) {
      const current = video[field];
      if (!current || !current.endsWith(`-2.${ext}`)) continue;

      const dupPath  = path.join(folder, current);
      const baseName = stripDupSuffix(current, ext);
      const basePath = path.join(folder, baseName);

      if (!fs.existsSync(dupPath)) {
        console.log(`  SKIP  ${current} — file not found on disk`);
        continue;
      }

      // Remove the orphaned base file (written by the first concurrent run, now superseded).
      if (fs.existsSync(basePath)) {
        fs.unlinkSync(basePath);
        console.log(`  DEL   ${baseName} (orphan)`);
      }

      // Rename the -2 file to the canonical base name.
      fs.renameSync(dupPath, basePath);
      console.log(`  REN   ${current} → ${baseName}`);

      updates[field] = baseName;
    }

    if (Object.keys(updates).length > 0) {
      changed = true;
      return { ...video, ...updates };
    }
    return video;
  });

  if (changed) {
    writeIndex(folder, index);
    console.log(`  INDEX updated`);
  } else {
    console.log(`  Nothing to fix.`);
  }
}

const folders = process.argv.slice(2);
if (folders.length === 0) {
  console.error('Usage: npx ts-node scripts/fix-duplicate-summaries.ts <outputFolder> [...]');
  process.exit(1);
}

for (const folder of folders) {
  try {
    fixFolder(folder);
  } catch (err) {
    console.error(`ERROR processing ${folder}:`, err);
  }
}

console.log('\nDone.');
