import fs from 'fs';
import os from 'os';
import path from 'path';
import { listRecentPlaylists } from '../../../lib/playlists/recent-provider';

function writePlaylist(root: string, dir: string, index: object) {
  const raw = path.join(root, dir, 'raw');
  fs.mkdirSync(raw, { recursive: true });
  fs.writeFileSync(path.join(raw, 'playlist-index.json'), JSON.stringify(index));
}

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.homedir(), '.recent-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

it('returns titled options for playlists with playlistTitle', () => {
  writePlaylist(root, 'agentic', { playlistUrl: 'https://youtube.com/playlist?list=PLa&si=z', playlistTitle: 'Building with Claude', videos: [{ id: 'a' }, { id: 'b' }] });
  expect(listRecentPlaylists(root)).toEqual([
    { id: 'PLa', title: 'Building with Claude', url: 'https://youtube.com/playlist?list=PLa', source: 'recent', meta: { videoCount: 2 } },
  ]);
});

it('falls back to folder slug when playlistTitle is missing (never the id)', () => {
  writePlaylist(root, 'cs146s-modern-software', { playlistUrl: 'https://youtube.com/playlist?list=PLb', videos: [] });
  expect(listRecentPlaylists(root)[0].title).toBe('cs146s-modern-software');
});

it('sorts by playlist-folder mtime, newest first', () => {
  writePlaylist(root, 'older', { playlistUrl: 'https://youtube.com/playlist?list=PLold', playlistTitle: 'Old', videos: [] });
  writePlaylist(root, 'newer', { playlistUrl: 'https://youtube.com/playlist?list=PLnew', playlistTitle: 'New', videos: [] });
  fs.utimesSync(path.join(root, 'older'), new Date(1000), new Date(1000));
  fs.utimesSync(path.join(root, 'newer'), new Date(9000), new Date(9000));
  expect(listRecentPlaylists(root).map((o) => o.id)).toEqual(['PLnew', 'PLold']);
});

it('skips archived/ and corrupt/indexless folders', () => {
  fs.mkdirSync(path.join(root, 'archived', 'raw'), { recursive: true });
  fs.writeFileSync(path.join(root, 'archived', 'raw', 'playlist-index.json'), '{"playlistUrl":"https://youtube.com/playlist?list=PLarch","videos":[]}');
  fs.mkdirSync(path.join(root, 'empty'), { recursive: true });
  fs.mkdirSync(path.join(root, 'corrupt', 'raw'), { recursive: true });
  fs.writeFileSync(path.join(root, 'corrupt', 'raw', 'playlist-index.json'), '{ not json');
  writePlaylist(root, 'good', { playlistUrl: 'https://youtube.com/playlist?list=PLgood', playlistTitle: 'Good', videos: [] });
  expect(listRecentPlaylists(root).map((o) => o.id)).toEqual(['PLgood']);
});

it('returns [] for a missing root (within home)', () => {
  expect(listRecentPlaylists(path.join(root, 'nope'))).toEqual([]);
});
