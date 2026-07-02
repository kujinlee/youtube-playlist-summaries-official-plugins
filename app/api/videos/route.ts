import { NextResponse } from 'next/server';
import { getPrincipal, getMetadataStore } from '../../../lib/storage/resolve';
import { recoverOrphanedVideos } from '../../../lib/pipeline';
import type { SortColumn, SortOrder, Video } from '../../../types';

const AUDIENCE_ORDER: Record<string, number> = { Beginner: 1, Intermediate: 2, Advanced: 3 };

// Accepted values for the `sortColumn` query param. Keep in sync with the SortColumn
// union in types/index.ts (the literal types here are compile-time-checked against it).
// An unrecognized value (e.g. a stale `playlistIndex` from an old bookmark) falls back
// to 'name' instead of silently producing an unsorted list.
const SORT_COLUMNS = new Set<SortColumn>([
  'name', 'overall', 'usefulness', 'depth', 'originality', 'recency', 'completeness',
  'language', 'videoType', 'audience', 'serialNumber', 'videoPublishedAt', 'addedToPlaylistAt', 'personalScore',
  'channel', 'durationSeconds',
]);

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
    } else if (column === 'serialNumber') {
      // Videos with no summary yet have no serial — always sort them last, regardless of direction.
      if (a.serialNumber === undefined && b.serialNumber === undefined) return 0;
      if (a.serialNumber === undefined) return 1;
      if (b.serialNumber === undefined) return -1;
      const cmp = a.serialNumber - b.serialNumber;
      return order === 'asc' ? cmp : -cmp;
    } else if (column === 'videoPublishedAt' || column === 'addedToPlaylistAt') {
      const aDate = a[column];
      const bDate = b[column];
      if (!aDate && !bDate) return 0;
      if (!aDate) return 1;  // nulls always to bottom
      if (!bDate) return -1;
      const cmp = aDate.localeCompare(bDate);
      return order === 'asc' ? cmp : -cmp;
    } else if (column === 'personalScore') {
      // Unscored videos (undefined) always sort last, regardless of direction
      if (a.personalScore === undefined && b.personalScore === undefined) return 0;
      if (a.personalScore === undefined) return 1;
      if (b.personalScore === undefined) return -1;
      const cmp = a.personalScore - b.personalScore;
      return order === 'asc' ? cmp : -cmp;
    } else if (column === 'channel') {
      // Optional field — videos with no channel always sort to the bottom, regardless of direction.
      const aCh = a.channel ?? '';
      const bCh = b.channel ?? '';
      if (!aCh && !bCh) return 0;
      if (!aCh) return 1;
      if (!bCh) return -1;
      const cmp = aCh.localeCompare(bCh);
      return order === 'asc' ? cmp : -cmp;
    } else if (column === 'durationSeconds') {
      const cmp = a.durationSeconds - b.durationSeconds;
      return order === 'asc' ? cmp : -cmp;
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

  let principal;
  try {
    principal = getPrincipal(outputFolder);
  } catch {
    return NextResponse.json({ error: 'invalid outputFolder' }, { status: 400 });
  }

  // Best-effort: recover orphaned MD files.
  try { recoverOrphanedVideos(outputFolder); } catch { /* non-fatal */ }

  const rawSortColumn = searchParams.get('sortColumn');
  const sortColumn: SortColumn =
    rawSortColumn && SORT_COLUMNS.has(rawSortColumn as SortColumn) ? (rawSortColumn as SortColumn) : 'name';
  const sortOrder = (searchParams.get('sortOrder') ?? 'asc') as SortOrder;

  let index;
  try {
    index = getMetadataStore().readIndex(principal);
  } catch (err) {
    const e = err as { statusCode?: number; message?: string };
    if (e.statusCode === 400) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw err;
  }
  const videos = sortVideos(index.videos, sortColumn, sortOrder);
  return NextResponse.json({ videos, playlistUrl: index.playlistUrl, playlistTitle: index.playlistTitle });
}
