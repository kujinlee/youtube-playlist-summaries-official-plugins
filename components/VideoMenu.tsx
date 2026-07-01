'use client';

import type { Video } from '@/types';
import AskGeminiMenuItem from './AskGeminiMenuItem';
import { CURRENT_DOC_VERSION, isOlder } from '@/lib/doc-version';

interface VideoMenuProps {
  video: Video;
  outputFolder: string;
  baseOutputFolder: string;
  onArchive: (videoId: string, action: 'archive' | 'unarchive') => void;
  onEditCorrections: () => void;
  onGenerateHtml: (videoId: string) => void;
  onResummarize?: (videoId: string) => void;
  onClose: () => void;
  busy?: boolean;
}

function obsidianHref(baseOutputFolder: string, outputFolder: string, file: string): string {
  // Vault = the playlist-level folder: the FIRST path segment of outputFolder below
  // baseOutputFolder (the data root). The note path is the remaining segments below it.
  // Each playlist folder under the data root is registered as its own Obsidian vault
  // (e.g. agentic-ai-claude-code, cs146s-the-modern-software-development); subfolders
  // like raw/ or wiki/ belong to the note path, not the vault name. When outputFolder
  // has no segment below the base (it IS the base, or sits outside it), fall back to the
  // output folder's own basename. Assumes POSIX paths and a non-empty outputFolder — the
  // row menu only renders once a folder is loaded, so both props are non-empty in practice.
  const base = (baseOutputFolder || outputFolder).replace(/\/+$/, '');
  const out = outputFolder.replace(/\/+$/, '');
  const rel = out !== base && out.startsWith(`${base}/`) ? out.slice(base.length + 1) : '';
  const segments = rel ? rel.split('/').filter(Boolean) : [];
  const vault = segments[0] ?? (out.split('/').filter(Boolean).at(-1) ?? out);
  const innerPath = segments.slice(1).join('/');
  const fullFile = innerPath ? `${innerPath}/${file}` : file;
  return `obsidian://open?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(fullFile)}`;
}

const itemClass = 'block w-full px-4 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-700';
const disabledClass = 'block w-full px-4 py-2 text-left text-sm text-zinc-500 cursor-not-allowed';

export default function VideoMenu({ video, outputFolder, baseOutputFolder, onArchive, onEditCorrections, onGenerateHtml, onResummarize = () => {}, onClose, busy = false }: VideoMenuProps) {
  const summaryFile = video.summaryMd?.replace(/\.md$/, '') ?? video.id;
  const hasSummary = !!video.summaryMd;
  const htmlViewHref = `/api/html/${encodeURIComponent(video.id)}?outputFolder=${encodeURIComponent(outputFolder)}&type=summary`;

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
        <AskGeminiMenuItem video={video} onClose={onClose} />
      </li>
      <li role="none">
        <a href={obsidianHref(baseOutputFolder, outputFolder, summaryFile)} onClick={onClose} target="_blank" rel="noopener noreferrer" className={itemClass}>
          Open in Obsidian
        </a>
      </li>
      <li role="none">
        {(() => {
          const current = !!video.summaryHtml && !isOlder(video.docVersion ?? { major: 1, minor: 0 }, CURRENT_DOC_VERSION);
          if (!hasSummary) return <span aria-disabled="true" className={disabledClass}>HTML doc</span>;
          if (busy) return <span aria-disabled="true" className={disabledClass}>HTML doc <span aria-hidden="true">⏳</span></span>;
          return current
            ? <a href={htmlViewHref} onClick={onClose} target="_blank" rel="noopener noreferrer" className={itemClass}>HTML doc</a>
            : <button type="button" onClick={() => { onGenerateHtml(video.id); onClose(); }} className={itemClass}>HTML doc</button>;
        })()}
      </li>
      {hasSummary && (
        <li role="none">
          {/* Always force-regenerates (never opens cached) — for a doc the audit flags or that looks off. */}
          {busy
            ? <span aria-disabled="true" className={disabledClass}>Re-summarize <span aria-hidden="true">⏳</span></span>
            : <button type="button" onClick={() => { onResummarize(video.id); onClose(); }} className={itemClass}>Re-summarize</button>}
        </li>
      )}
      {video.summaryMd && (
        <li role="none">
          <button
            type="button"
            onClick={() => { onEditCorrections(); onClose(); }}
            className={itemClass}
          >
            Edit corrections
          </button>
        </li>
      )}
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
