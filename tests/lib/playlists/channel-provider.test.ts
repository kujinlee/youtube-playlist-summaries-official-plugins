jest.mock('../../../lib/youtube', () => ({
  resolveChannelId: jest.fn(async () => ({ channelId: 'UC1', channelTitle: 'Anthropic' })),
  fetchChannelPlaylists: jest.fn(async () => [{ id: 'PLa', title: 'A', itemCount: 7, thumbnailUrl: 'http://t/a.jpg' }]),
  buildPlaylistUrl: (id: string) => `https://youtube.com/playlist?list=${id}`,
  ChannelNotFoundError: class extends Error {},
}));
import { listChannelPlaylists } from '../../../lib/playlists/channel-provider';

it('normalizes channel playlists into PlaylistOption[]', async () => {
  const out = await listChannelPlaylists('@Anthropic', 'k');
  expect(out.channelTitle).toBe('Anthropic');
  expect(out.playlists).toEqual([{
    id: 'PLa', title: 'A', url: 'https://youtube.com/playlist?list=PLa', source: 'channel',
    meta: { videoCount: 7, channelTitle: 'Anthropic', thumbnailUrl: 'http://t/a.jpg' },
  }]);
});
