import { NextResponse } from 'next/server';
import { assertOutputFolder, readIndex } from '../../../lib/index-store';
import { recoverOrphanedVideos, migrateToSlugFilenames } from '../../../lib/pipeline';
import type { SortColumn, SortOrder, Video } from '../../../types';

const AUDIENCE_ORDER: Record<string, number> = { Beginner: 1, Intermediate: 2, Advanced: 3 };

function sortVideos(videos: Video[], column: SortColumn, order: SortOrder): Video[] {
  const sorted = [...videos].sort((a, b) => {
    let aVal: string | number;
    let bVal: string | number;
    if (column === 'name') {
      aVal = a.title.toLowerCase();
      bVal = b.title.toLowerCase();
    } else if (column === 'overall') {
      aVal = a.overallScore;
      bVal = b.overallScore;
    } else if (column === 'language') {
      aVal = a.language ?? '';
      bVal = b.language ?? '';
    } else if (column === 'videoType') {
      aVal = a.videoType ?? '';
      bVal = b.videoType ?? '';
    } else if (column === 'audience') {
      aVal = AUDIENCE_ORDER[a.audience ?? ''] ?? 0;
      bVal = AUDIENCE_ORDER[b.audience ?? ''] ?? 0;
    } else if (column === 'playlistIndex') {
      aVal = a.playlistIndex ?? 0;
      bVal = b.playlistIndex ?? 0;
    } else if (column === 'videoPublishedAt') {
      aVal = a.videoPublishedAt ?? '';
      bVal = b.videoPublishedAt ?? '';
    } else if (column === 'addedToPlaylistAt') {
      aVal = a.addedToPlaylistAt ?? '';
      bVal = b.addedToPlaylistAt ?? '';
    } else {
      aVal = a.ratings[column as keyof typeof a.ratings];
      bVal = b.ratings[column as keyof typeof b.ratings];
    }
    if (aVal < bVal) return order === 'asc' ? -1 : 1;
    if (aVal > bVal) return order === 'asc' ? 1 : -1;
    return 0;
  });
  return sorted;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const outputFolder = searchParams.get('outputFolder');
  if (!outputFolder) {
    return NextResponse.json({ error: 'outputFolder is required' }, { status: 400 });
  }

  try {
    assertOutputFolder(outputFolder);
  } catch {
    return NextResponse.json({ error: 'invalid outputFolder' }, { status: 400 });
  }

  // Best-effort: recover orphaned MD files and migrate legacy prefixed filenames.
  try { recoverOrphanedVideos(outputFolder); } catch { /* non-fatal */ }
  try { migrateToSlugFilenames(outputFolder); } catch { /* non-fatal */ }

  const sortColumn = (searchParams.get('sortColumn') ?? 'name') as SortColumn;
  const sortOrder = (searchParams.get('sortOrder') ?? 'asc') as SortOrder;

  let index;
  try {
    index = readIndex(outputFolder);
  } catch (err) {
    const e = err as { statusCode?: number; message?: string };
    if (e.statusCode === 400) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw err;
  }
  const videos = sortVideos(index.videos, sortColumn, sortOrder);
  return NextResponse.json({ videos, playlistUrl: index.playlistUrl });
}
