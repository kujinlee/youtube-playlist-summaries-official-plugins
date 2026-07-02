import path from 'path';
import { assertVideoId } from '../../../../../lib/index-store';
import { getPrincipal, getMetadataStore } from '../../../../../lib/storage/resolve';
import { readDugSectionIds } from '../../../../../lib/dig/companion-doc';

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id: videoId } = await params;
  const { searchParams } = new URL(request.url);
  const outputFolder = searchParams.get('outputFolder');

  if (!outputFolder) {
    return new Response(JSON.stringify({ error: 'outputFolder is required' }), { status: 400 });
  }

  let principal;
  try {
    principal = getPrincipal(outputFolder);
    assertVideoId(videoId);
  } catch {
    return new Response(JSON.stringify({ error: 'invalid request' }), { status: 400 });
  }

  let video;
  try {
    const index = getMetadataStore().readIndex(principal);
    video = index.videos.find((v) => v.id === videoId);
    if (!video) {
      return new Response(JSON.stringify({ error: 'video not found' }), { status: 404 });
    }
  } catch (err) {
    const e = err as { statusCode?: number; message?: string };
    if (e.statusCode === 400) {
      return new Response(JSON.stringify({ error: e.message }), { status: 400 });
    }
    throw err;
  }

  const digDeeperMd = video.digDeeperMd;
  if (!digDeeperMd) {
    return new Response(JSON.stringify({ sectionIds: [] }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const digDeeperPath = path.join(outputFolder, digDeeperMd);
  const sectionIds = await readDugSectionIds(digDeeperPath);

  return new Response(JSON.stringify({ sectionIds }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
