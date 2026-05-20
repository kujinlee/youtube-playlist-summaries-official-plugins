'use client';

import type { Video } from '@/types';

interface VideoMenuProps {
  video: Video;
  outputFolder: string;
  onDeepDive: (videoId: string) => void;
  onArchive: (videoId: string, action: 'archive' | 'unarchive') => void;
}

function obsidianHref(outputFolder: string, file: string): string {
  return `obsidian://open?vault=${encodeURIComponent(outputFolder)}&file=${encodeURIComponent(file)}`;
}

export default function VideoMenu({ video, outputFolder, onDeepDive, onArchive }: VideoMenuProps) {
  const hasDeepDive = !!video.deepDiveMd;
  const hasSummaryPdf = !!video.summaryPdf;
  const hasDeepDivePdf = !!video.deepDivePdf;
  const deepDiveFile = `${video.id}-deep-dive`;

  return (
    <ul role="menu">
      <li role="none">
        <a href={obsidianHref(outputFolder, video.id)}>Open in Obsidian</a>
      </li>
      <li role="none">
        {hasSummaryPdf ? (
          <a href={`/api/pdf/${video.id}?type=summary`}>View Summary PDF</a>
        ) : (
          <a
            href="#"
            aria-disabled="true"
            tabIndex={-1}
            onClick={(e) => e.preventDefault()}
          >
            View Summary PDF
          </a>
        )}
      </li>
      <li role="none">
        <button type="button" onClick={() => onDeepDive(video.id)}>
          Deep Dive
        </button>
      </li>
      <li role="none">
        {hasDeepDive ? (
          <a href={obsidianHref(outputFolder, deepDiveFile)}>Open Deep Dive in Obsidian</a>
        ) : (
          <a
            href="#"
            aria-disabled="true"
            tabIndex={-1}
            onClick={(e) => e.preventDefault()}
          >
            Open Deep Dive in Obsidian
          </a>
        )}
      </li>
      <li role="none">
        {hasDeepDivePdf ? (
          <a href={`/api/pdf/${video.id}?type=deep-dive`}>View Deep Dive PDF</a>
        ) : (
          <a
            href="#"
            aria-disabled="true"
            tabIndex={-1}
            onClick={(e) => e.preventDefault()}
          >
            View Deep Dive PDF
          </a>
        )}
      </li>
      <li role="none">
        <button
          type="button"
          onClick={() => onArchive(video.id, video.archived ? 'unarchive' : 'archive')}
        >
          {video.archived ? 'Unarchive' : 'Archive'}
        </button>
      </li>
    </ul>
  );
}
