'use client';

import type { SortColumn, SortOrder, Video } from '@/types';
import VideoRow from './VideoRow';

interface VideoListProps {
  videos: Video[];
  outputFolder: string;
  baseOutputFolder: string;
  showArchive: boolean;
  minPersonalScore?: number;
  onDeepDive: (videoId: string) => void;
  onArchive: (videoId: string, action: 'archive' | 'unarchive') => void;
  onAnnotationChange?: (videoId: string, patch: Partial<Pick<Video, 'personalScore' | 'personalNote' | 'corrections' | 'tldr' | 'takeaways'>>) => void;
  sortColumn?: SortColumn | null;
  sortOrder?: SortOrder;
  onSort?: (col: SortColumn, order: SortOrder) => void;
}

const COLUMNS: { key: SortColumn | null; label: string; fullName: string; align: 'left' | 'right' }[] = [
  { key: 'playlistIndex', label: '#', fullName: 'Playlist position', align: 'left' },
  { key: 'name', label: 'Title', fullName: 'Title', align: 'left' },
  { key: 'language', label: 'Lang', fullName: 'Language', align: 'left' },
  { key: 'videoType', label: 'Type', fullName: 'Type', align: 'left' },
  { key: 'audience', label: 'Audience', fullName: 'Audience', align: 'left' },
  { key: 'videoPublishedAt', label: 'Published', fullName: 'Published on YouTube', align: 'left' },
  { key: 'addedToPlaylistAt', label: 'Added', fullName: 'Added to playlist', align: 'left' },
  { key: 'usefulness', label: 'USE', fullName: 'Usefulness', align: 'right' },
  { key: 'depth', label: 'DPT', fullName: 'Depth', align: 'right' },
  { key: 'originality', label: 'ORI', fullName: 'Originality', align: 'right' },
  { key: 'recency', label: 'RCN', fullName: 'Recency', align: 'right' },
  { key: 'completeness', label: 'CMP', fullName: 'Completeness', align: 'right' },
  { key: 'overall', label: 'OVR', fullName: 'Overall', align: 'right' },
  { key: 'personalScore', label: 'My Score', fullName: 'My Score', align: 'right' },
  { key: null,            label: 'Note',     fullName: 'Note',     align: 'left'  },
];

const DESC_FIRST_COLS: SortColumn[] = ['videoPublishedAt', 'addedToPlaylistAt', 'personalScore'];

const TH = 'px-3 py-2 text-xs font-medium uppercase';
const noop = () => {};

export default function VideoList({
  videos,
  outputFolder,
  baseOutputFolder,
  showArchive,
  minPersonalScore = 0,
  onDeepDive,
  onArchive,
  onAnnotationChange = noop,
  sortColumn,
  sortOrder = 'asc',
  onSort,
}: VideoListProps) {
  const visible = showArchive ? videos : videos.filter((v) => !v.archived);

  if (visible.length === 0) {
    return (
      <p className="py-12 text-center text-zinc-500 text-sm">
        No videos to show. Try adjusting the filters or enable &quot;Show Archive&quot; to see archived videos.
      </p>
    );
  }

  function handleHeaderClick(col: SortColumn | null) {
    if (!onSort || col === null) return;
    let nextOrder: SortOrder;
    if (col === sortColumn) {
      nextOrder = sortOrder === 'asc' ? 'desc' : 'asc';
    } else if (DESC_FIRST_COLS.includes(col)) {
      nextOrder = 'desc';
    } else {
      nextOrder = 'asc';
    }
    onSort(col, nextOrder);
  }

  return (
    <table className="w-full border-collapse" aria-label="Video list">
      <thead>
        <tr className="border-b border-zinc-800">
          {/* Chevron column — no label, not sortable */}
          <th className="w-6 px-1 py-2" aria-label="Expand" />
          {COLUMNS.map(({ key, label, fullName, align }) => {
            const isActive   = key !== null && key === sortColumn;
            const arrow      = isActive ? (sortOrder === 'asc' ? ' ↑' : ' ↓') : '';
            const alignClass = align === 'right' ? 'text-right' : 'text-left';

            if (onSort && key !== null) {
              const dirLabel = isActive
                ? `, sorted ${sortOrder === 'asc' ? 'ascending' : 'descending'}`
                : '';
              return (
                <th
                  key={key}
                  scope="col"
                  className={`${TH} ${alignClass}`}
                  aria-sort={isActive ? (sortOrder === 'asc' ? 'ascending' : 'descending') : undefined}
                >
                  <button
                    type="button"
                    onClick={() => handleHeaderClick(key)}
                    title={fullName}
                    aria-label={`${fullName}${dirLabel}`}
                    aria-pressed={isActive}
                    className={`${isActive ? 'text-white' : 'text-zinc-400 hover:text-zinc-100'} transition-colors`}
                  >
                    {label}{arrow}
                  </button>
                </th>
              );
            }
            // Non-sortable column (key === null, or onSort not provided)
            const keyOrLabel = key ?? label;
            return (
              <th key={keyOrLabel} className={`${TH} text-zinc-400 ${alignClass}`}>
                {label}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {/* Archive filtering is the caller's responsibility via filteredVideos in page.tsx.
            showArchive={true} is always passed from the app; this prop is preserved for
            component-level testing and API backward-compatibility. */}
        {visible.map((video, i) => (
          <VideoRow
            key={video.id}
            video={video}
            rank={video.playlistIndex ?? i + 1}
            outputFolder={outputFolder}
            baseOutputFolder={baseOutputFolder}
            dimUnscored={minPersonalScore > 0 && video.personalScore === undefined}
            onDeepDive={onDeepDive}
            onArchive={onArchive}
            onAnnotationChange={onAnnotationChange}
          />
        ))}
      </tbody>
    </table>
  );
}
