import { assertOutputFolder } from '../../../../lib/index-store';
import { listRecentPlaylists } from '../../../../lib/playlists/recent-provider';

export async function GET(request: Request) {
  const root = new URL(request.url).searchParams.get('root');
  if (!root) return Response.json({ error: 'root is required' }, { status: 400 });
  try {
    assertOutputFolder(root); // within-home + realpath guard
    return Response.json({ playlists: listRecentPlaylists(root) });
  } catch {
    return Response.json({ error: 'invalid root' }, { status: 400 });
  }
}
