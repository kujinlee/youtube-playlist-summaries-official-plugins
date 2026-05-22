'use client';

import { useEffect, useState } from 'react';

interface HeaderProps {
  defaultOutputFolder: string;
  onIngest: (playlistUrl: string, outputFolder: string) => void;
  onSync?: (folder: string) => void;
  syncEnabled?: boolean;
  disabled?: boolean;
}

export default function Header({
  defaultOutputFolder,
  onIngest,
  onSync,
  syncEnabled = false,
  disabled = false,
}: HeaderProps) {
  const [playlistUrl, setPlaylistUrl] = useState('');
  const [outputFolder, setOutputFolder] = useState(defaultOutputFolder);

  // Sync when settings load after mount
  useEffect(() => {
    setOutputFolder(defaultOutputFolder);
  }, [defaultOutputFolder]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onIngest(playlistUrl.trim(), outputFolder);
  }

  return (
    <header className="bg-zinc-900 border-b border-zinc-800 px-6 py-4">
      <form onSubmit={handleSubmit} className="flex gap-3 items-center">
        <input
          type="text"
          placeholder="Playlist URL"
          value={playlistUrl}
          onChange={(e) => setPlaylistUrl(e.target.value)}
          className="flex-1 rounded bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <input
          type="text"
          placeholder="Output folder"
          value={outputFolder}
          onChange={(e) => setOutputFolder(e.target.value)}
          className="w-52 rounded bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="submit"
          disabled={disabled || playlistUrl.trim() === ''}
          className="rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2 text-sm font-medium text-white transition-colors"
        >
          Fetch &amp; Summarize
        </button>
        {onSync && (
          <button
            type="button"
            onClick={() => onSync(outputFolder)}
            disabled={disabled || !syncEnabled}
            className="rounded border border-zinc-700 hover:border-zinc-500 disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2 text-sm font-medium text-zinc-400 hover:text-zinc-100 transition-colors"
          >
            Sync
          </button>
        )}
      </form>
    </header>
  );
}
