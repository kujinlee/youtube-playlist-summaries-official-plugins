jest.mock('../../../lib/youtube', () => ({
  fetchPlaylistTitle: jest.fn(async (id: string) => id === 'PLbad' ? Promise.reject(new Error('quota')) : `Title ${id}`),
}));
import fs from 'fs';
import os from 'os';
import path from 'path';
import { backfillPlaylistTitles } from '../../../lib/playlists/backfill-titles';

function writePlaylist(root: string, dir: string, index: object) {
  const raw = path.join(root, dir, 'raw');
  fs.mkdirSync(raw, { recursive: true });
  const file = path.join(raw, 'playlist-index.json');
  fs.writeFileSync(file, JSON.stringify(index));
  return file;
}
let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.homedir(), '.bf-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

it('writes titles for missing, skips populated, records failures', async () => {
  const f1 = writePlaylist(root, 'a', { playlistUrl: 'https://youtube.com/playlist?list=PLa', videos: [] });
  writePlaylist(root, 'b', { playlistUrl: 'https://youtube.com/playlist?list=PLb', playlistTitle: 'Already', videos: [] });
  writePlaylist(root, 'c', { playlistUrl: 'https://youtube.com/playlist?list=PLbad', videos: [] });
  const res = await backfillPlaylistTitles(root, 'k');
  expect(JSON.parse(fs.readFileSync(f1, 'utf-8')).playlistTitle).toBe('Title PLa');
  expect(res.updated.some((p) => p.includes(`${path.sep}a${path.sep}`))).toBe(true);
  expect(res.skipped.some((p) => p.includes(`${path.sep}b${path.sep}`))).toBe(true);
  expect(res.failed.some((p) => p.includes(`${path.sep}c${path.sep}`))).toBe(true);
});
