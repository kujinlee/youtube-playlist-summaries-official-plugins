const channelsList = jest.fn();
const playlistsList = jest.fn();
jest.mock('googleapis', () => ({
  google: { youtube: () => ({ channels: { list: channelsList }, playlists: { list: playlistsList } }) },
}));
import { parseChannelHandle, resolveChannelId, fetchChannelPlaylists, buildPlaylistUrl, ChannelNotFoundError } from '../../lib/youtube';

beforeEach(() => { channelsList.mockReset(); playlistsList.mockReset(); });

describe('parseChannelHandle (strict, YouTube-host-only)', () => {
  it('accepts @handle and bare handle', () => {
    expect(parseChannelHandle('@Anthropic')).toEqual({ handle: 'Anthropic' });
    expect(parseChannelHandle('Anthropic')).toEqual({ handle: 'Anthropic' });
  });
  it('accepts a youtube.com/@handle URL', () => {
    expect(parseChannelHandle('https://youtube.com/@Anthropic')).toEqual({ handle: 'Anthropic' });
    expect(parseChannelHandle('https://www.youtube.com/@Anthropic')).toEqual({ handle: 'Anthropic' });
  });
  it('accepts a /channel/UC… URL and a bare channel id', () => {
    expect(parseChannelHandle('https://youtube.com/channel/UC1234567890abcdefghijkl')).toEqual({ channelId: 'UC1234567890abcdefghijkl' });
    expect(parseChannelHandle('UC1234567890abcdefghijkl')).toEqual({ channelId: 'UC1234567890abcdefghijkl' });
  });
  it('rejects a non-YouTube host → {}', () => {
    expect(parseChannelHandle('https://evil.example/@Anthropic')).toEqual({});
  });
  it('rejects embedded @ / illegal chars / oversized → {}', () => {
    expect(parseChannelHandle('x@y')).toEqual({});
    expect(parseChannelHandle('bad name!')).toEqual({});
    expect(parseChannelHandle('a'.repeat(31))).toEqual({});
  });
});

it('resolveChannelId returns id+title for a known handle', async () => {
  channelsList.mockResolvedValue({ data: { items: [{ id: 'UC1', snippet: { title: 'Anthropic' } }] } });
  await expect(resolveChannelId('@Anthropic', 'k')).resolves.toEqual({ channelId: 'UC1', channelTitle: 'Anthropic' });
  expect(channelsList).toHaveBeenCalledWith(expect.objectContaining({ forHandle: 'Anthropic' }));
});
it('resolveChannelId throws ChannelNotFoundError on empty result', async () => {
  channelsList.mockResolvedValue({ data: { items: [] } });
  await expect(resolveChannelId('@nope', 'k')).rejects.toBeInstanceOf(ChannelNotFoundError);
});
it('resolveChannelId throws ChannelNotFoundError on unparseable input (no API call)', async () => {
  await expect(resolveChannelId('https://evil.example/@x', 'k')).rejects.toBeInstanceOf(ChannelNotFoundError);
  expect(channelsList).not.toHaveBeenCalled();
});
it('fetchChannelPlaylists maps snippet + contentDetails', async () => {
  playlistsList.mockResolvedValue({ data: { items: [
    { id: 'PLa', snippet: { title: 'A', thumbnails: { medium: { url: 'http://t/a.jpg' } } }, contentDetails: { itemCount: 7 } },
  ] } });
  await expect(fetchChannelPlaylists('UC1', 'k')).resolves.toEqual([{ id: 'PLa', title: 'A', itemCount: 7, thumbnailUrl: 'http://t/a.jpg' }]);
});
it('buildPlaylistUrl is canonical', () => { expect(buildPlaylistUrl('PLa')).toBe('https://youtube.com/playlist?list=PLa'); });
