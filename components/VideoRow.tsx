'use client';

import { useState, useEffect } from 'react';
import type { Video, VideoType, Audience } from '@/types';
import Badge from './Badge';
import VideoMenu from './VideoMenu';

interface VideoRowProps {
  video: Video;
  rank: number;
  outputFolder: string;
  onDeepDive: (videoId: string) => void;
  onArchive: (videoId: string, action: 'archive' | 'unarchive') => void;
}

const LANG_COLOR: Record<string, string> = {
  en: 'bg-blue-700 text-white',
  ko: 'bg-violet-700 text-white',
};

const TYPE_COLOR: Record<VideoType, string> = {
  Tutorial: 'bg-green-700 text-white',
  Analysis: 'bg-sky-700 text-white',
  'Case Study': 'bg-amber-700 text-white',
  Framework: 'bg-purple-700 text-white',
  Demo: 'bg-teal-700 text-white',
  Interview: 'bg-orange-700 text-white',
};

const AUDIENCE_COLOR: Record<Audience, string> = {
  Beginner: 'bg-green-700 text-white',
  Intermediate: 'bg-yellow-700 text-white',
  Advanced: 'bg-red-700 text-white',
};

export default function VideoRow({ video, rank, outputFolder, onDeepDive, onArchive }: VideoRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { ratings, overallScore } = video;

  useEffect(() => {
    if (!menuOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [menuOpen]);

  return (
    <tr className={`border-b border-zinc-800 hover:bg-zinc-900/50 ${video.archived ? 'opacity-40' : ''}`}>
      <td className="px-3 py-2 text-sm text-zinc-500 tabular-nums">{rank}</td>
      <td className="px-3 py-2">
        <div className="relative flex items-center gap-2">
          <span className="text-sm text-zinc-100">{video.title}</span>
          <button
            type="button"
            aria-label="Menu"
            aria-haspopup="true"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((prev) => !prev)}
            className="shrink-0 text-zinc-400 hover:text-zinc-100 px-1 leading-none"
          >
            ☰
          </button>
          {menuOpen && (
            <>
              <div aria-hidden="true" className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <VideoMenu
                video={video}
                outputFolder={outputFolder}
                onDeepDive={onDeepDive}
                onArchive={onArchive}
                onClose={() => setMenuOpen(false)}
              />
            </>
          )}
        </div>
      </td>
      <td className="px-3 py-2">
        <Badge
          label={video.language === 'en' ? 'EN' : 'KO'}
          colorClass={LANG_COLOR[video.language] ?? ''}
        />
      </td>
      <td className="px-3 py-2">
        {video.videoType && (
          <Badge label={video.videoType} colorClass={TYPE_COLOR[video.videoType] ?? ''} />
        )}
      </td>
      <td className="px-3 py-2">
        {video.audience && (
          <Badge label={video.audience} colorClass={AUDIENCE_COLOR[video.audience] ?? ''} />
        )}
      </td>
      <td className="px-3 py-2 text-sm tabular-nums font-mono text-right text-zinc-200" aria-label="Usefulness">{ratings.usefulness}</td>
      <td className="px-3 py-2 text-sm tabular-nums font-mono text-right text-zinc-200" aria-label="Depth">{ratings.depth}</td>
      <td className="px-3 py-2 text-sm tabular-nums font-mono text-right text-zinc-200" aria-label="Originality">{ratings.originality}</td>
      <td className="px-3 py-2 text-sm tabular-nums font-mono text-right text-zinc-200" aria-label="Recency">{ratings.recency}</td>
      <td className="px-3 py-2 text-sm tabular-nums font-mono text-right text-zinc-200" aria-label="Completeness">{ratings.completeness}</td>
      <td className="px-3 py-2 text-sm tabular-nums font-mono text-right text-zinc-200" aria-label="Overall">{overallScore}</td>
    </tr>
  );
}
