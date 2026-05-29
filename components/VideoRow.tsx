'use client';

import { useState, useEffect } from 'react';
import type { Video, VideoType, Audience } from '@/types';
import Badge from './Badge';
import VideoMenu from './VideoMenu';
import StarRating from './StarRating';
import NoteCell from './NoteCell';

interface VideoRowProps {
  video: Video;
  rank: number;
  outputFolder: string;
  baseOutputFolder: string;
  dimUnscored: boolean;
  onDeepDive: (videoId: string) => void;
  onArchive: (videoId: string, action: 'archive' | 'unarchive') => void;
  onAnnotationChange: (videoId: string, patch: Partial<Pick<Video, 'personalScore' | 'personalNote'>>) => void;
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

export default function VideoRow({ video, rank, outputFolder, baseOutputFolder, dimUnscored, onDeepDive, onArchive, onAnnotationChange }: VideoRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { ratings, overallScore } = video;
  // opacity-40 must NOT be on the <tr> — it creates a CSS stacking context that
  // propagates to the absolutely-positioned VideoMenu, making it unclickable.
  // Apply it per-cell instead, exempting the menu container.
  const cellDim = video.archived
    ? 'opacity-40'
    : (dimUnscored ? 'opacity-50' : '');

  useEffect(() => {
    if (!menuOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [menuOpen]);

  return (
    <tr className="border-b border-zinc-800 hover:bg-zinc-900/50">
      <td className={`px-3 py-2 text-sm text-zinc-500 tabular-nums ${cellDim}`}>{rank}</td>
      <td className="px-3 py-2">
        <div className="relative flex items-center gap-2">
          <span className={`text-sm text-zinc-100 ${cellDim}`}>{video.title}</span>
          <button
            type="button"
            aria-label="Menu"
            aria-haspopup="true"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((prev) => !prev)}
            className={`shrink-0 text-zinc-400 hover:text-zinc-100 px-1 leading-none ${cellDim}`}
          >
            ☰
          </button>
          {menuOpen && (
            <>
              <div aria-hidden="true" className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <VideoMenu
                video={video}
                outputFolder={outputFolder}
                baseOutputFolder={baseOutputFolder}
                onDeepDive={onDeepDive}
                onArchive={onArchive}
                onClose={() => setMenuOpen(false)}
              />
            </>
          )}
        </div>
      </td>
      <td className={`px-3 py-2 ${cellDim}`}>
        <Badge
          label={video.language === 'en' ? 'EN' : 'KO'}
          colorClass={LANG_COLOR[video.language] ?? ''}
        />
      </td>
      <td className={`px-3 py-2 ${cellDim}`}>
        {video.videoType && (
          <Badge label={video.videoType} colorClass={TYPE_COLOR[video.videoType] ?? ''} />
        )}
      </td>
      <td className={`px-3 py-2 ${cellDim}`}>
        {video.audience && (
          <Badge label={video.audience} colorClass={AUDIENCE_COLOR[video.audience] ?? ''} />
        )}
      </td>
      <td className={`px-3 py-2 text-sm tabular-nums text-zinc-400 ${cellDim}`} aria-label="Published on YouTube">
        {video.videoPublishedAt ? video.videoPublishedAt.slice(0, 10) : '—'}
      </td>
      <td className={`px-3 py-2 text-sm tabular-nums text-zinc-400 ${cellDim}`} aria-label="Added to playlist">
        {video.addedToPlaylistAt ? video.addedToPlaylistAt.slice(0, 10) : '—'}
      </td>
      <td className={`px-3 py-2 text-sm tabular-nums font-mono text-right text-zinc-200 ${cellDim}`} aria-label="Usefulness">{ratings.usefulness}</td>
      <td className={`px-3 py-2 text-sm tabular-nums font-mono text-right text-zinc-200 ${cellDim}`} aria-label="Depth">{ratings.depth}</td>
      <td className={`px-3 py-2 text-sm tabular-nums font-mono text-right text-zinc-200 ${cellDim}`} aria-label="Originality">{ratings.originality}</td>
      <td className={`px-3 py-2 text-sm tabular-nums font-mono text-right text-zinc-200 ${cellDim}`} aria-label="Recency">{ratings.recency}</td>
      <td className={`px-3 py-2 text-sm tabular-nums font-mono text-right text-zinc-200 ${cellDim}`} aria-label="Completeness">{ratings.completeness}</td>
      <td className={`px-3 py-2 text-sm tabular-nums font-mono text-right text-zinc-200 ${cellDim}`} aria-label="Overall">{overallScore}</td>

      {/* My Score */}
      <td className={`px-3 py-2 ${cellDim}`} aria-label="My Score">
        <StarRating
          videoId={video.id}
          outputFolder={outputFolder}
          value={video.personalScore}
          onChange={(score) => onAnnotationChange(video.id, { personalScore: score })}
        />
      </td>

      {/* Note */}
      <td className={`px-3 py-2 ${cellDim}`} aria-label="Note">
        <NoteCell
          videoId={video.id}
          outputFolder={outputFolder}
          value={video.personalNote}
          onChange={(note) => onAnnotationChange(video.id, { personalNote: note })}
        />
      </td>
    </tr>
  );
}
