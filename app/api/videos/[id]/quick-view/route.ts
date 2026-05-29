import { NextResponse } from 'next/server';
import { assertOutputFolder, assertVideoId, readIndex } from '../../../../../lib/index-store';

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id: videoId } = await params;
  const { searchParams } = new URL(request.url);
  const outputFolder = searchParams.get('outputFolder');

  if (!outputFolder) {
    return NextResponse.json({ error: 'outputFolder is required' }, { status: 400 });
  }

  try {
    assertOutputFolder(outputFolder);
    assertVideoId(videoId);
  } catch {
    return NextResponse.json({ error: 'invalid request' }, { status: 400 });
  }

  const index = readIndex(outputFolder);
  const video = index.videos.find((v) => v.id === videoId);

  if (!video || !video.summaryMd || !video.tldr) {
    return NextResponse.json({ error: 'quick view not available' }, { status: 404 });
  }

  return NextResponse.json({
    tldr: video.tldr,
    takeaways: video.takeaways ?? [],
    tags: video.tags ?? [],
  });
}
