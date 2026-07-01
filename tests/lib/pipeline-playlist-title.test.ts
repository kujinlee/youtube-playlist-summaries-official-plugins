jest.mock('../../lib/youtube', () => ({
  fetchPlaylistVideos: jest.fn(async () => []),
  fetchPlaylistTitle: jest.fn(),
}));

import fs from 'fs';
import os from 'os';
import path from 'path';
import { runIngestion } from '../../lib/pipeline';
import { readIndex } from '../../lib/index-store';
import { fetchPlaylistTitle } from '../../lib/youtube';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.homedir(), '.pl-title-'));
  process.env.YOUTUBE_API_KEY = 'k';
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

it('stamps playlistTitle into the index on ingest', async () => {
  (fetchPlaylistTitle as jest.Mock).mockResolvedValue('Building with Claude');
  await runIngestion('https://youtube.com/playlist?list=PLabc', dir, () => {});
  expect(readIndex(dir).playlistTitle).toBe('Building with Claude');
});

it('omits playlistTitle (never the id) when the title fetch fails', async () => {
  (fetchPlaylistTitle as jest.Mock).mockRejectedValue(new Error('quota'));
  await runIngestion('https://youtube.com/playlist?list=PLabc', dir, () => {});
  expect(readIndex(dir).playlistTitle).toBeUndefined();
});
