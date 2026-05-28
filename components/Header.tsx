'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { slugify } from '../lib/slugify';

interface HeaderProps {
  defaultOutputFolder: string;
  baseOutputFolder?: string;
  currentPlaylistUrl?: string;
  onIngest: (playlistUrl: string, outputFolder: string) => void;
  onSync?: (folder: string, playlistUrl: string) => void;
  disabled?: boolean;
}

// Checked at render time so tests can override navigator.platform per-test
function getIsMac() {
  return typeof navigator !== 'undefined' && navigator.platform.includes('Mac');
}

export default function Header({
  defaultOutputFolder,
  baseOutputFolder,
  currentPlaylistUrl,
  onIngest,
  onSync,
  disabled = false,
}: HeaderProps) {
  const [playlistUrl, setPlaylistUrl] = useState('');
  const [outputFolder, setOutputFolder] = useState(defaultOutputFolder);
  const [isMac] = useState(getIsMac); // stable after mount; useState(fn) calls fn once
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // true once the user types into the URL field; resets to false on Browse success or folder change
  const urlEditedByUser = useRef(false);

  // Keep folder in sync when settings load after mount
  useEffect(() => {
    setOutputFolder(defaultOutputFolder);
  }, [defaultOutputFolder]);

  // Auto-fill URL from folder metadata — only if user hasn't typed their own value
  useEffect(() => {
    if (currentPlaylistUrl && !urlEditedByUser.current) {
      setPlaylistUrl(currentPlaylistUrl);
    }
  }, [currentPlaylistUrl]);

  // Auto-suggest output folder slug when playlist URL changes
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    let playlistId: string | null = null;
    try {
      playlistId = new URL(playlistUrl).searchParams.get('list');
    } catch {
      return;
    }
    if (!playlistId) return;

    const base = baseOutputFolder || defaultOutputFolder;
    const url = playlistUrl;

    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/playlist-info?url=${encodeURIComponent(url)}`);
        if (!res.ok) return;
        const data = (await res.json()) as { title: string };
        setOutputFolder(`${base}/${slugify(data.title)}`);
      } catch {
        // leave folder unchanged on network error
      }
    }, 350);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [playlistUrl, baseOutputFolder, defaultOutputFolder]);

  const handleBrowse = useCallback(async () => {
    try {
      const res = await fetch('/api/pick-folder');
      if (!res.ok) return; // treat non-2xx as no-op — folder input unchanged
      const data = (await res.json()) as { folderPath?: string; cancelled?: boolean };
      if (data.folderPath) {
        setOutputFolder(data.folderPath);
        urlEditedByUser.current = false; // browsing a new folder resets the guard
      }
    } catch {
      // silently ignore — folder input unchanged
    }
  }, []);

  const handleFolderChange = useCallback((value: string) => {
    setOutputFolder(value);
    urlEditedByUser.current = false;
  }, []);

  const handleUrlChange = useCallback((value: string) => {
    setPlaylistUrl(value);
    urlEditedByUser.current = true;
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onIngest(playlistUrl.trim(), outputFolder);
  }

  const canSync = playlistUrl.trim() !== '' && !disabled;
  const canSubmit = playlistUrl.trim() !== '' && !disabled;

  return (
    <header className="bg-zinc-900 border-b border-zinc-800 px-6 py-4">
      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        {/* Row 1: Output folder + Browse + Sync */}
        <div className="flex gap-2 items-center">
          <input
            type="text"
            placeholder="Output folder"
            value={outputFolder}
            onChange={(e) => handleFolderChange(e.target.value)}
            className="flex-1 rounded bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {isMac && (
            <button
              type="button"
              onClick={handleBrowse}
              disabled={disabled}
              className="rounded bg-zinc-800 border border-zinc-700 hover:border-zinc-500 disabled:opacity-40 disabled:cursor-not-allowed px-3 py-2 text-sm text-zinc-300 transition-colors whitespace-nowrap"
            >
              Browse…
            </button>
          )}
          {onSync && (
            <button
              type="button"
              onClick={() => onSync(outputFolder, playlistUrl)}
              disabled={!canSync}
              className="rounded border px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors bg-green-900 text-green-300 border-green-700 hover:bg-green-800 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ↻ Sync
            </button>
          )}
        </div>

        {/* Row 2: Playlist URL + Fetch & Summarize */}
        <div className="flex gap-2 items-center">
          <input
            type="text"
            placeholder="Playlist URL"
            value={playlistUrl}
            onChange={(e) => handleUrlChange(e.target.value)}
            className="flex-1 rounded bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2 text-sm font-medium text-white transition-colors whitespace-nowrap"
          >
            Fetch &amp; Summarize
          </button>
        </div>
      </form>
    </header>
  );
}
