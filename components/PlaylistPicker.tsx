'use client';
import { useEffect, useRef, useState } from 'react';
import type { PlaylistOption } from '../lib/playlists/types';

type Props = {
  root: string; value: string; onChange: (v: string) => void;
  onPick: (url: string) => void; onBrowseChannel: () => void; disabled?: boolean;
};

export default function PlaylistPicker({ root, value, onChange, onPick, onBrowseChannel, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<PlaylistOption[]>([]);
  const boxRef = useRef<HTMLDivElement>(null);

  async function loadRecent() {
    if (!root) return;
    try {
      const res = await fetch(`/api/playlists/recent?root=${encodeURIComponent(root)}`);
      if (!res.ok) return;
      setOptions(((await res.json()).playlists ?? []) as PlaylistOption[]);
    } catch { /* leave options empty */ }
  }

  useEffect(() => {
    function onDocClick(e: MouseEvent) { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  return (
    <div ref={boxRef} className="relative flex-1">
      <input
        type="text" placeholder="Paste a playlist URL — or pick ▾" value={value} disabled={disabled}
        onFocus={() => { setOpen(true); loadRecent(); }}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      {open && (
        <div className="absolute z-20 mt-1 w-full rounded border border-zinc-700 bg-zinc-900 shadow-lg">
          {options.length > 0 && <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-zinc-500">Recent</div>}
          {options.map((o) => (
            <button key={o.id} type="button" onClick={() => { onPick(o.url); setOpen(false); }}
              className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-800">
              <span className="truncate">{o.title}</span>
              {o.meta?.videoCount != null && <span className="ml-2 shrink-0 text-xs text-zinc-500">{o.meta.videoCount} videos</span>}
            </button>
          ))}
          <div className="border-t border-zinc-800" />
          <button type="button" onClick={() => { onBrowseChannel(); setOpen(false); }}
            className="flex w-full items-center px-3 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-800">
            🔍 Browse a channel&apos;s playlists…
          </button>
        </div>
      )}
    </div>
  );
}
