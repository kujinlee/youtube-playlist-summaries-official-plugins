import { resolveChannelId, fetchChannelPlaylists, buildPlaylistUrl } from '../youtube';
import type { PlaylistOption } from './types';

export async function listChannelPlaylists(handle: string, apiKey: string): Promise<{ channelTitle: string; playlists: PlaylistOption[] }> {
  const { channelId, channelTitle } = await resolveChannelId(handle, apiKey);
  const raw = await fetchChannelPlaylists(channelId, apiKey);
  const playlists: PlaylistOption[] = raw.map((p) => ({
    id: p.id, title: p.title, url: buildPlaylistUrl(p.id), source: 'channel',
    meta: { videoCount: p.itemCount, channelTitle, thumbnailUrl: p.thumbnailUrl },
  }));
  return { channelTitle, playlists };
}
