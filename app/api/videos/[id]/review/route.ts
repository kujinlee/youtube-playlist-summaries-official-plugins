import { NextResponse } from 'next/server';
import { assertVideoId } from '../../../../../lib/index-store';
import { getPrincipal, getMetadataStore } from '../../../../../lib/storage/resolve';
import type { Video } from '../../../../../types';

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id: videoId } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const outputFolder = body?.outputFolder;

  if (!outputFolder || typeof outputFolder !== 'string') {
    return NextResponse.json({ error: 'outputFolder is required' }, { status: 400 });
  }

  const hasScore = body !== null && 'personalScore' in body;
  const hasNote  = body !== null && 'personalNote'  in body;

  if (!hasScore && !hasNote) {
    return NextResponse.json({ error: 'at least one field required' }, { status: 400 });
  }

  // Validate personalScore: must be 1–5 integer, or null (to clear)
  if (hasScore) {
    const score = body!.personalScore;
    if (
      score !== null &&
      (typeof score !== 'number' || !Number.isInteger(score) || score < 1 || score > 5)
    ) {
      return NextResponse.json({ error: 'personalScore must be 1–5 or null' }, { status: 400 });
    }
  }

  // Validate personalNote: must be string ≤ 500 chars (empty string = clear)
  if (hasNote) {
    const note = body!.personalNote;
    if (typeof note !== 'string') {
      return NextResponse.json({ error: 'personalNote must be a string' }, { status: 400 });
    }
    if (note.length > 500) {
      return NextResponse.json({ error: 'personalNote must be 500 characters or fewer' }, { status: 400 });
    }
  }

  let principal;
  try {
    principal = getPrincipal(outputFolder);
    assertVideoId(videoId);
  } catch {
    return NextResponse.json({ error: 'invalid request' }, { status: 400 });
  }

  // Map null → undefined (score deletion) and "" → undefined (note deletion)
  const patch: Partial<Pick<Video, 'personalScore' | 'personalNote'>> = {};
  if (hasScore) {
    patch.personalScore = (body!.personalScore === null) ? undefined : (body!.personalScore as number);
  }
  if (hasNote) {
    patch.personalNote = (body!.personalNote === '') ? undefined : (body!.personalNote as string);
  }

  try {
    getMetadataStore().updateVideoFields(principal, videoId, patch);
  } catch (err) {
    const e = err as Error;
    if (e.message.startsWith('Video not found in index')) {
      return NextResponse.json({ error: 'video not found' }, { status: 404 });
    }
    return NextResponse.json({ error: 'internal error' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
