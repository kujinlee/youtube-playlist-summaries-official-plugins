'use client';

import type { Video } from '@/types';

interface VideoMenuProps {
  video: Video;
  outputFolder: string;
  baseOutputFolder: string;
  onDeepDive: (videoId: string) => void;
  onArchive: (videoId: string, action: 'archive' | 'unarchive') => void;
  onClose: () => void;
}

function obsidianHref(baseOutputFolder: string, outputFolder: string, file: string): string {
  // Vault = the registered Obsidian vault root (baseOutputFolder's last segment).
  // File  = subfolder-relative path so Obsidian can locate the note inside the vault.
  const base = baseOutputFolder || outputFolder;
  const vault = base.split('/').filter(Boolean).at(-1) ?? base;
  const normalizedBase = base.replace(/\/$/, '');
  const normalizedOutput = outputFolder.replace(/\/$/, '');
  const subFolder = normalizedOutput.startsWith(`${normalizedBase}/`)
    ? normalizedOutput.slice(normalizedBase.length + 1)
    : '';
  const fullFile = subFolder ? `${subFolder}/${file}` : file;
  return `obsidian://open?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(fullFile)}`;
}

const itemClass = 'block w-full px-4 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-700';
const disabledClass = 'block w-full px-4 py-2 text-left text-sm text-zinc-500 cursor-not-allowed';

export default function VideoMenu({ video, outputFolder, baseOutputFolder, onDeepDive, onArchive, onClose }: VideoMenuProps) {
  const hasDeepDive = !!video.deepDiveMd;
  const hasSummaryPdf = !!video.summaryPdf;
  const hasDeepDivePdf = !!video.deepDivePdf;
  const summaryFile = video.summaryMd?.replace(/\.md$/, '') ?? video.id;
  const deepDiveFile = video.deepDiveMd?.replace(/\.md$/, '') ?? `${video.id}-deep-dive`;
  const pdfBase = `/api/pdf/${encodeURIComponent(video.id)}?outputFolder=${encodeURIComponent(outputFolder)}`;

  return (
    <ul
      role="menu"
      className="absolute left-0 top-full z-20 mt-1 w-52 rounded-md bg-zinc-800 border border-zinc-700 shadow-xl py-1"
    >
      <li role="none">
        <a href={video.youtubeUrl} onClick={onClose} target="_blank" rel="noopener noreferrer" className={itemClass}>
          Watch on YouTube
        </a>
      </li>
      <li role="none">
        <a href={obsidianHref(baseOutputFolder, outputFolder, summaryFile)} onClick={onClose} target="_blank" rel="noopener noreferrer" className={itemClass}>
          Open in Obsidian
        </a>
      </li>
      <li role="none">
        {hasSummaryPdf ? (
          <a href={`${pdfBase}&type=summary`} onClick={onClose} target="_blank" rel="noopener noreferrer" className={itemClass}>
            View Summary PDF
          </a>
        ) : (
          <a
            href="#"
            aria-disabled="true"
            tabIndex={-1}
            onClick={(e) => e.preventDefault()}
            className={disabledClass}
          >
            View Summary PDF
          </a>
        )}
      </li>
      <li role="none">
        <button type="button" onClick={() => { onDeepDive(video.id); onClose(); }} className={itemClass}>
          Deep Dive
        </button>
      </li>
      <li role="none">
        {hasDeepDive ? (
          <a href={obsidianHref(baseOutputFolder, outputFolder, deepDiveFile)} onClick={onClose} target="_blank" rel="noopener noreferrer" className={itemClass}>
            Open Deep Dive in Obsidian
          </a>
        ) : (
          <a
            href="#"
            aria-disabled="true"
            tabIndex={-1}
            onClick={(e) => e.preventDefault()}
            className={disabledClass}
          >
            Open Deep Dive in Obsidian
          </a>
        )}
      </li>
      <li role="none">
        {hasDeepDivePdf ? (
          <a href={`${pdfBase}&type=deep-dive`} onClick={onClose} target="_blank" rel="noopener noreferrer" className={itemClass}>
            View Deep Dive PDF
          </a>
        ) : (
          <a
            href="#"
            aria-disabled="true"
            tabIndex={-1}
            onClick={(e) => e.preventDefault()}
            className={disabledClass}
          >
            View Deep Dive PDF
          </a>
        )}
      </li>
      <li role="none">
        <button
          type="button"
          onClick={() => { onArchive(video.id, video.archived ? 'unarchive' : 'archive'); onClose(); }}
          className={itemClass}
        >
          {video.archived ? 'Unarchive' : 'Archive'}
        </button>
      </li>
    </ul>
  );
}
