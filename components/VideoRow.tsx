'use client';

import { useState, useEffect } from 'react';
import type { Video } from '@/types';
import VideoMenu from './VideoMenu';

interface VideoRowProps {
  video: Video;
  outputFolder: string;
  onDeepDive: (videoId: string) => void;
  onArchive: (videoId: string, action: 'archive' | 'unarchive') => void;
}

export default function VideoRow({ video, outputFolder, onDeepDive, onArchive }: VideoRowProps) {
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
    <div>
      <div>
        <span>{video.title}</span>
        <span>{video.language === 'en' ? 'EN' : 'KO'}</span>
        <span>
          USE:{ratings.usefulness} DPT:{ratings.depth} ORI:{ratings.originality} RCN:
          {ratings.recency} CMP:{ratings.completeness} OVR:{overallScore}
        </span>
        <button
          type="button"
          aria-label="Menu"
          aria-haspopup="true"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((prev) => !prev)}
        >
          ☰
        </button>
      </div>
      {menuOpen && (
        <VideoMenu
          video={video}
          outputFolder={outputFolder}
          onDeepDive={onDeepDive}
          onArchive={onArchive}
        />
      )}
    </div>
  );
}
