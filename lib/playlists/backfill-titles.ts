import fs from 'fs';
import path from 'path';
import { readIndex, writeIndex, assertOutputFolder } from '../index-store';
import { fetchPlaylistTitle } from '../youtube';

function extractId(url: string): string | null {
  try { return new URL(url).searchParams.get('list'); } catch { return null; }
}

// Folders holding an index: <root>/<dir>/raw or <root>/<dir> (flat), excluding archived
function playlistFolders(root: string): string[] {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return []; }
  const out: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name === 'archived') continue;
    for (const c of [path.join(root, e.name, 'raw'), path.join(root, e.name)]) {
      if (fs.existsSync(path.join(c, 'playlist-index.json'))) { out.push(c); break; }
    }
  }
  return out;
}

export async function backfillPlaylistTitles(root: string, apiKey: string): Promise<{ updated: string[]; skipped: string[]; failed: string[] }> {
  assertOutputFolder(root); // within-home guard at the entry point
  const updated: string[] = [], skipped: string[] = [], failed: string[] = [];
  for (const folder of playlistFolders(root)) {
    let index;
    try { index = readIndex(folder); } catch { failed.push(folder); continue; }
    if (index.playlistTitle) { skipped.push(folder); continue; }
    const id = extractId(index.playlistUrl ?? '');
    if (!id) { failed.push(folder); continue; }
    try { writeIndex(folder, { ...index, playlistTitle: await fetchPlaylistTitle(id, apiKey) }); updated.push(folder); }
    catch { failed.push(folder); }
  }
  return { updated, skipped, failed };
}
