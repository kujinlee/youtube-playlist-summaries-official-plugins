import { PlaylistIndexSchema } from '../../types/index';

describe('PlaylistIndexSchema playlistTitle', () => {
  const base = { playlistUrl: 'https://youtube.com/playlist?list=PLabc', outputFolder: '/tmp/x/raw', videos: [] };
  it('accepts an index with playlistTitle', () => {
    expect(PlaylistIndexSchema.parse({ ...base, playlistTitle: 'Building with Claude' }).playlistTitle).toBe('Building with Claude');
  });
  it('accepts an index without playlistTitle (optional, legacy)', () => {
    expect(PlaylistIndexSchema.parse(base).playlistTitle).toBeUndefined();
  });
});
