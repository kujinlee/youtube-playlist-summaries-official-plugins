'use client';

import { useState } from 'react';

interface HeaderProps {
  defaultOutputFolder: string;
  onIngest: (playlistUrl: string, outputFolder: string) => void;
}

export default function Header({ defaultOutputFolder, onIngest }: HeaderProps) {
  const [playlistUrl, setPlaylistUrl] = useState('');
  const [outputFolder, setOutputFolder] = useState(defaultOutputFolder);

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
        <button type="submit" disabled={playlistUrl.trim() === ''}>
          Fetch &amp; Summarize
        </button>
      </form>
    </header>
  );
}
