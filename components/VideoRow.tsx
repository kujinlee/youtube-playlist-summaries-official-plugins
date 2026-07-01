'use client';

import { useState, useEffect } from 'react';
import type { Video } from '@/types';
import { formatDuration } from '@/lib/format-duration';
import Badge from './Badge';
import CorrectionsPanel from './CorrectionsPanel';
import VideoMenu from './VideoMenu';
import StarRating from './StarRating';
import NoteCell from './NoteCell';
import VideoQuickView from './VideoQuickView';

interface VideoRowProps {
  video: Video;
  /** Serial number shown in the # column; undefined for videos with no summary yet (renders as an em dash). */
  rank?: number;
  outputFolder: string;
  baseOutputFolder: string;
  dimUnscored: boolean;
  busy?: boolean;
  onArchive: (videoId: string, action: 'archive' | 'unarchive') => void;
  onGenerateHtml: (videoId: string) => void;
  onAnnotationChange: (videoId: string, patch: Partial<Pick<Video, 'personalScore' | 'personalNote' | 'corrections' | 'tldr' | 'takeaways' | 'summaryHtml'>>) => void;
  selected?: boolean;
  selectable?: boolean;
  onToggleSelect?: (videoId: string) => void;
}

const LANG_COLOR: Record<string, string> = {
  en: 'bg-blue-700 text-white',
  ko: 'bg-violet-700 text-white',
};

// Total column count in VideoList: 1 checkbox + 1 chevron + 10 data columns = 12
const TOTAL_COLUMNS = 12;

export default function VideoRow({ video, rank, outputFolder, baseOutputFolder, dimUnscored, busy = false, onArchive, onGenerateHtml, onAnnotationChange, selected = false, selectable = true, onToggleSelect = () => {} }: VideoRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [showCorrections, setShowCorrections] = useState(false);
  const { overallScore } = video;

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
    <>
      <tr className="border-b border-zinc-800 hover:bg-zinc-900/50">
        {/* Checkbox */}
        <td className="px-2 py-2 w-8">
          <input
            type="checkbox"
            aria-label={`Select ${video.title}`}
            checked={selected}
            disabled={!selectable || busy}
            onChange={() => onToggleSelect(video.id)}
            title={selectable ? undefined : 'No summary to generate from'}
          />
        </td>
        {/* Expand chevron */}
        <td className="px-1 py-2 w-6">
          <button
            type="button"
            aria-label={isExpanded ? 'Collapse' : 'Expand'}
            aria-expanded={isExpanded}
            onClick={() => setIsExpanded((prev) => !prev)}
            className="text-zinc-500 hover:text-zinc-200 text-xs leading-none"
          >
            {isExpanded ? '▼' : '▶'}
          </button>
        </td>
        <td className={`px-3 py-2 text-sm text-zinc-500 tabular-nums ${cellDim}`}>{rank ?? '—'}</td>
        <td
          className="px-3 py-2 cursor-pointer"
          onClick={() => setIsExpanded((prev) => !prev)}
          title={isExpanded ? 'Collapse' : 'Expand'}
        >
          <div className="relative flex items-center gap-2">
            <span className={`text-sm text-zinc-100 ${cellDim}`}>{video.title}</span>
            <button
              type="button"
              aria-label="Menu"
              aria-haspopup="true"
              aria-expanded={menuOpen}
              onClick={(e) => { e.stopPropagation(); setMenuOpen((prev) => !prev); }}
              className={`shrink-0 text-zinc-400 hover:text-zinc-100 px-1 leading-none ${cellDim}`}
            >
              ☰
            </button>
            {busy && <span role="status" aria-label="Regenerating" title="Regenerating…" className="shrink-0 text-amber-400 animate-pulse">⏳</span>}
            {menuOpen && (
              // Stop menu clicks (backdrop + items) from bubbling to the title-cell expand handler
              <div role="presentation" onClick={(e) => e.stopPropagation()}>
                <div aria-hidden="true" className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <VideoMenu
                  video={video}
                  outputFolder={outputFolder}
                  baseOutputFolder={baseOutputFolder}
                  busy={busy}
                  onArchive={onArchive}
                  onGenerateHtml={onGenerateHtml}
                  onEditCorrections={() => setShowCorrections(true)}
                  onClose={() => setMenuOpen(false)}
                />
              </div>
            )}
          </div>
        </td>
        <td className={`px-3 py-2 text-sm text-zinc-300 ${cellDim}`} aria-label="Channel">
          <span className="block max-w-[12rem] truncate" title={video.channel || undefined}>
            {video.channel || '—'}
          </span>
        </td>
        <td className={`px-3 py-2 text-sm tabular-nums text-right text-zinc-400 ${cellDim}`} aria-label="Duration">
          {formatDuration(video.durationSeconds)}
        </td>
        <td className={`px-3 py-2 text-sm tabular-nums text-zinc-400 ${cellDim}`} aria-label="Published on YouTube">
          {video.videoPublishedAt ? video.videoPublishedAt.slice(0, 10) : '—'}
        </td>
        <td className={`px-3 py-2 text-sm tabular-nums text-zinc-400 ${cellDim}`} aria-label="Added to playlist">
          {video.addedToPlaylistAt ? video.addedToPlaylistAt.slice(0, 10) : '—'}
        </td>
        <td className={`px-3 py-2 ${cellDim}`}>
          <Badge
            label={video.language === 'en' ? 'EN' : 'KO'}
            colorClass={LANG_COLOR[video.language] ?? ''}
          />
        </td>
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
      {isExpanded && (
        <tr className="border-b border-zinc-800 bg-zinc-950">
          <td colSpan={TOTAL_COLUMNS} className="p-0">
            <VideoQuickView
              videoId={video.id}
              tldr={video.tldr}
              takeaways={video.takeaways}
              tags={video.tags}
              outputFolder={outputFolder}
            />
          </td>
        </tr>
      )}
      {showCorrections && (
        <CorrectionsPanel
          videoId={video.id}
          outputFolder={outputFolder}
          initialCorrections={video.corrections}
          onClose={() => setShowCorrections(false)}
          onSuccess={(patch) => onAnnotationChange(video.id, patch)}
        />
      )}
    </>
  );
}
