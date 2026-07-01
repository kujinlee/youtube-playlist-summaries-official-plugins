import fs from 'fs';
import path from 'path';
import { assertOutputFolder } from '../index-store';
import type { PlaylistOption } from './types';

function extractId(url: string): string | null {
  try { return new URL(url).searchParams.get('list'); } catch { return null; }
}

/** Read one playlist folder's index (nested raw/ or flat). Returns null if none/invalid. */
function readCandidate(dir: string): { index: { playlistUrl?: string; playlistTitle?: string; videos?: unknown[] } } | null {
  for (const candidate of [path.join(dir, 'raw'), dir]) {
    const file = path.join(candidate, 'playlist-index.json');
    if (!fs.existsSync(file)) continue;
    try { return { index: JSON.parse(fs.readFileSync(file, 'utf-8')) }; } catch { return null; }
  }
  return null;
}

export function listRecentPlaylists(root: string): PlaylistOption[] {
  assertOutputFolder(root); // within-home + realpath guard (throws → route returns 400)
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return []; } // missing dir → []

  const rows: { option: PlaylistOption; mtimeMs: number }[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'archived') continue;
    const dir = path.join(root, entry.name);
    const found = readCandidate(dir);
    if (!found) continue;
    const id = extractId(found.index.playlistUrl ?? '');
    if (!id) continue;
    const title = found.index.playlistTitle || entry.name || 'Untitled playlist'; // never the id
    const videoCount = Array.isArray(found.index.videos) ? found.index.videos.length : undefined;
    let mtimeMs = 0;
    try { mtimeMs = fs.statSync(dir).mtimeMs; } catch { /* keep 0 */ } // playlist-folder mtime
    rows.push({
      option: { id, title, url: `https://youtube.com/playlist?list=${id}`, source: 'recent', meta: { videoCount } },
      mtimeMs,
    });
  }
  return rows.sort((a, b) => b.mtimeMs - a.mtimeMs).map((r) => r.option);
}
