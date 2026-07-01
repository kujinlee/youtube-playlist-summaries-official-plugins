import { listChannelPlaylists } from '../../../../lib/playlists/channel-provider';
import { ChannelNotFoundError } from '../../../../lib/youtube';

export async function GET(request: Request) {
  const handle = new URL(request.url).searchParams.get('handle');
  if (!handle) return Response.json({ error: 'handle is required' }, { status: 400 });
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return Response.json({ error: 'server missing YOUTUBE_API_KEY' }, { status: 500 });
  try {
    return Response.json(await listChannelPlaylists(handle, apiKey));
  } catch (err) {
    if (err instanceof ChannelNotFoundError) return Response.json({ error: `No channel found for '${handle}'` }, { status: 404 });
    return Response.json({ error: 'Could not reach YouTube' }, { status: 502 });
  }
}
