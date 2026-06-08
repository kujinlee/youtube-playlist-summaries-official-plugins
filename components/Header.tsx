'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface HeaderProps {
  defaultOutputFolder: string;
  currentPlaylistUrl?: string;
  onIngest: (playlistUrl: string, outputFolder: string) => void;
  onSync?: (folder: string, playlistUrl: string) => void;
  onFolderChange?: (folder: string) => void;
  disabled?: boolean;
}

export default function Header({
  defaultOutputFolder,
  currentPlaylistUrl,
  onIngest,
  onSync,
  onFolderChange,
  disabled = false,
}: HeaderProps) {
  const [playlistUrl, setPlaylistUrl] = useState('');
  const [outputFolder, setOutputFolder] = useState(defaultOutputFolder);
  // Start false (matches server render); set to true after hydration on macOS.
  // Using useEffect ensures the SSR and client initial renders are identical,
  // avoiding hydration mismatches when navigator is unavailable on the server.
  const [isMac, setIsMac] = useState(false);
  // true once the user types into the URL field; resets only on Browse success
  // (intentionally NOT on manual folder edit — see handleFolderChange)
  const urlEditedByUser = useRef(false);
  // true once the user edits the folder field (typing or Browse); blocks a late
  // settings-driven defaultOutputFolder sync from overwriting the user's choice
  const folderEditedByUser = useRef(false);

  // Detect macOS after hydration — runs only on the client, so SSR and initial
  // client render both see isMac=false (no Browse button), then it flips to true
  // on macOS. Tests can override navigator.platform before render; the effect
  // fires synchronously inside act(), so test assertions see the correct value.
  useEffect(() => {
    setIsMac(typeof navigator !== 'undefined' && navigator.platform.includes('Mac'));
  }, []);

  // Keep folder in sync when settings load after mount — but never clobber a
  // folder the user has already chosen (typed or via Browse). Without this guard,
  // a folder typed before /api/settings resolves would be silently overwritten.
  useEffect(() => {
    if (!folderEditedByUser.current) {
      setOutputFolder(defaultOutputFolder);
    }
  }, [defaultOutputFolder]);

  // Auto-fill URL from folder metadata — only if user hasn't typed their own value
  useEffect(() => {
    if (currentPlaylistUrl && !urlEditedByUser.current) {
      setPlaylistUrl(currentPlaylistUrl);
    }
  }, [currentPlaylistUrl]);

  const handleBrowse = useCallback(async () => {
    try {
      const res = await fetch('/api/pick-folder');
      if (!res.ok) return; // treat non-2xx as no-op — folder input unchanged
      const data = (await res.json()) as { folderPath?: string; cancelled?: boolean };
      if (data.folderPath) {
        setOutputFolder(data.folderPath);
        folderEditedByUser.current = true; // explicit folder choice — protect from late settings sync
        urlEditedByUser.current = false; // browsing a new folder resets the URL guard
        onFolderChange?.(data.folderPath); // notify page.tsx to re-fetch metadata
      }
    } catch {
      // silently ignore — folder input unchanged
    }
  }, [onFolderChange]);

  const handleFolderChange = useCallback((value: string) => {
    setOutputFolder(value);
    folderEditedByUser.current = true; // user owns the folder now — block late settings sync
    // Do NOT reset urlEditedByUser here: if the user has typed their own URL
    // and then adjusts the folder path, their URL should remain intact.
    // The guard resets only on Browse success (explicit fresh-folder navigation).
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
