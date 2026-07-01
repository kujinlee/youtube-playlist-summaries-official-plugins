'use client';
import { useEffect, useRef, useState } from 'react';
import type { PlaylistOption } from '../lib/playlists/types';

type Props = {
  root: string;
  onPick: (url: string) => void;
  onBrowseChannel: () => void;
  disabled?: boolean;
};

export default function PlaylistPicker({ root, onPick, onBrowseChannel, disabled }: Props) {
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

  function toggle() {
    setOpen((o) => {
      const next = !o;
      if (next) loadRecent();
      return next;
    });
  }

  return (
    <div ref={boxRef} className="relative shrink-0">
      <button
        type="button" disabled={disabled} onClick={toggle} aria-expanded={open}
        className="rounded bg-zinc-800 border border-zinc-700 hover:border-zinc-500 disabled:opacity-40 disabled:cursor-not-allowed px-3 py-2 text-sm text-zinc-300 transition-colors whitespace-nowrap"
      >
        ▾ Recent
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-80 rounded border border-zinc-700 bg-zinc-900 shadow-lg">
          {options.length > 0 && <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-zinc-500">Recent</div>}
          {options.map((o) => (
            <button key={o.id} type="button" onClick={() => { onPick(o.url); setOpen(false); }}
              className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-zinc-800">
              <span className="w-full truncate text-sm text-zinc-200">{o.title}</span>
              {o.url && <span className="w-full truncate text-xs text-zinc-500" title={o.url}>{o.url}</span>}
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
