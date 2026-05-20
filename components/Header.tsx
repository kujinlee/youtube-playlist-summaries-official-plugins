'use client';

import { useEffect, useState } from 'react';

interface HeaderProps {
  defaultOutputFolder: string;
  onIngest: (playlistUrl: string, outputFolder: string) => void;
  disabled?: boolean;
}

export default function Header({ defaultOutputFolder, onIngest, disabled = false }: HeaderProps) {
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
    <header>
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder="Playlist URL"
          value={playlistUrl}
          onChange={(e) => setPlaylistUrl(e.target.value)}
        />
        <input
          type="text"
          placeholder="Output folder"
          value={outputFolder}
          onChange={(e) => setOutputFolder(e.target.value)}
        />
        <button type="submit" disabled={disabled || playlistUrl.trim() === ''}>
          Fetch &amp; Summarize
        </button>
      </form>
    </header>
  );
}
