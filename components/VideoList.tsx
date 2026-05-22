'use client';

import type { Video } from '@/types';
import VideoRow from './VideoRow';

interface VideoListProps {
  videos: Video[];
  outputFolder: string;
  showArchive: boolean;
  onDeepDive: (videoId: string) => void;
  onArchive: (videoId: string, action: 'archive' | 'unarchive') => void;
}

const TH = 'px-3 py-2 text-xs font-medium text-zinc-400 uppercase';

export default function VideoList({
  videos,
  outputFolder,
  showArchive,
  onDeepDive,
  onArchive,
}: VideoListProps) {
  const visible = showArchive ? videos : videos.filter((v) => !v.archived);

  if (visible.length === 0) return null;

  return (
    <table className="w-full border-collapse" aria-label="Video list">
      <thead>
        <tr className="border-b border-zinc-800">
          <th className={`${TH} text-left`}>#</th>
          <th className={`${TH} text-left`}>Title</th>
          <th className={`${TH} text-left`}>Lang</th>
          <th className={`${TH} text-left`}>Type</th>
          <th className={`${TH} text-left`}>Audience</th>
          <th className={`${TH} text-right`}>USE</th>
          <th className={`${TH} text-right`}>DPT</th>
          <th className={`${TH} text-right`}>ORI</th>
          <th className={`${TH} text-right`}>RCN</th>
          <th className={`${TH} text-right`}>CMP</th>
          <th className={`${TH} text-right`}>OVR</th>
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
