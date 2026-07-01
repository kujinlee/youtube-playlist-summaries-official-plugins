jest.mock('../../lib/playlists/channel-provider', () => ({ listChannelPlaylists: jest.fn() }));
jest.mock('../../lib/youtube', () => ({ ChannelNotFoundError: class extends Error {} }));
import { GET } from '../../app/api/playlists/channel/route';
import { ChannelNotFoundError } from '../../lib/youtube';
import { listChannelPlaylists } from '../../lib/playlists/channel-provider';
const mockListChannelPlaylists = listChannelPlaylists as jest.MockedFunction<typeof listChannelPlaylists>;

const req = (u: string) => new Request(u);
const OLD = process.env.YOUTUBE_API_KEY;
beforeEach(() => { mockListChannelPlaylists.mockReset(); process.env.YOUTUBE_API_KEY = 'k'; });
afterAll(() => { process.env.YOUTUBE_API_KEY = OLD; });

it('400 when handle missing', async () => {
  expect((await GET(req('http://x/api/playlists/channel'))).status).toBe(400);
});
it('500 when YOUTUBE_API_KEY is unset', async () => {
  delete process.env.YOUTUBE_API_KEY;
  expect((await GET(req('http://x/api/playlists/channel?handle=@x'))).status).toBe(500);
});
it('200 with results', async () => {
  mockListChannelPlaylists.mockResolvedValue({ channelTitle: 'Anthropic', playlists: [{ id: 'PLa', title: 'T', url: 'https://youtube.com/playlist?list=PLa', source: 'channel' }] });
  const res = await GET(req('http://x/api/playlists/channel?handle=@Anthropic'));
  expect(res.status).toBe(200);
  expect((await res.json()).channelTitle).toBe('Anthropic');
});
it('404 on ChannelNotFoundError', async () => {
  mockListChannelPlaylists.mockRejectedValue(new ChannelNotFoundError('nope'));
  expect((await GET(req('http://x/api/playlists/channel?handle=@nope'))).status).toBe(404);
});
it('502 on upstream error', async () => {
  mockListChannelPlaylists.mockRejectedValue(new Error('quota'));
  expect((await GET(req('http://x/api/playlists/channel?handle=@x'))).status).toBe(502);
});
