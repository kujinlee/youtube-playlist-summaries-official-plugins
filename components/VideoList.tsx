'use client';

import type { SortColumn, SortOrder, Video } from '@/types';
import VideoRow from './VideoRow';

interface VideoListProps {
  videos: Video[];
  outputFolder: string;
  showArchive: boolean;
  onDeepDive: (videoId: string) => void;
  onArchive: (videoId: string, action: 'archive' | 'unarchive') => void;
  sortColumn?: SortColumn | null;
  sortOrder?: SortOrder;
  onSort?: (col: SortColumn, order: SortOrder) => void;
}

const COLUMNS: { key: SortColumn; label: string; fullName: string; align: 'left' | 'right' }[] = [
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
];

const DATE_COLS: SortColumn[] = ['videoPublishedAt', 'addedToPlaylistAt'];

const TH = 'px-3 py-2 text-xs font-medium uppercase';

export default function VideoList({
  videos,
  outputFolder,
  showArchive,
  onDeepDive,
  onArchive,
  sortColumn,
  sortOrder = 'asc',
  onSort,
}: VideoListProps) {
  const visible = showArchive ? videos : videos.filter((v) => !v.archived);

  if (visible.length === 0) return null;

  function handleHeaderClick(col: SortColumn) {
    if (!onSort) return;
    let nextOrder: SortOrder;
    if (col === sortColumn) {
      nextOrder = sortOrder === 'asc' ? 'desc' : 'asc';
    } else if (DATE_COLS.includes(col)) {
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
          {COLUMNS.map(({ key, label, fullName, align }) => {
            const isActive = key === sortColumn;
            const arrow = isActive ? (sortOrder === 'asc' ? ' ↑' : ' ↓') : '';
            const alignClass = align === 'right' ? 'text-right' : 'text-left';
            if (onSort) {
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
            return (
              <th key={key} className={`${TH} text-zinc-400 ${alignClass}`}>
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
            onDeepDive={onDeepDive}
            onArchive={onArchive}
          />
        ))}
      </tbody>
    </table>
  );
}
