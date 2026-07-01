'use client';
import { useEffect, useState } from 'react';
import type { PlaylistOption } from '../lib/playlists/types';

const RECENTS_KEY = 'playlist-picker:channel-recents';

export default function ChannelPlaylistPanel({ onSelect, onClose }: { onSelect: (url: string) => void; onClose: () => void }) {
  const [handle, setHandle] = useState('');
  const [recents, setRecents] = useState<string[]>([]);
  const [results, setResults] = useState<PlaylistOption[]>([]);
  const [channelTitle, setChannelTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { try { setRecents(JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]')); } catch { /* ignore */ } }, []);
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  function rememberHandle(h: string) {
    const next = [h, ...recents.filter((r) => r !== h)].slice(0, 8);
    setRecents(next); try { localStorage.setItem(RECENTS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }

  async function go(h: string) {
    const q = h.trim(); if (!q) return;
    setLoading(true); setError(null); setResults([]);
    try {
      const res = await fetch(`/api/playlists/channel?handle=${encodeURIComponent(q)}`);
      const body = await res.json();
      if (res.status === 404) { setError(`No channel found for '${q}'`); return; }
      if (!res.ok) { setError("Couldn’t reach YouTube — try again"); return; }
      setChannelTitle(body.channelTitle ?? ''); setResults(body.playlists ?? []); rememberHandle(q);
    } catch { setError("Couldn’t reach YouTube — try again"); }
    finally { setLoading(false); }
  }

  return (
    <div data-testid="panel-backdrop" onClick={onClose} className="fixed inset-0 z-40 flex items-center justify-center bg-black/50">
      <div onClick={(e) => e.stopPropagation()} className="w-[32rem] max-w-[90vw] rounded-lg border border-zinc-700 bg-zinc-900 p-4 text-zinc-100">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium">Browse channel playlists</h2>
          <button aria-label="Close" onClick={onClose} className="text-zinc-400 hover:text-zinc-200">&#x2715;</button>
        </div>
        <div className="flex gap-2">
          <input type="text" placeholder="@channel or channel URL" value={handle}
            onChange={(e) => setHandle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') go(handle); }}
            className="flex-1 rounded bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm" />
          <button type="button" onClick={() => go(handle)} className="rounded bg-blue-600 hover:bg-blue-500 px-4 py-2 text-sm text-white">Go</button>
        </div>
        {recents.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {recents.map((r) => (
              <button key={r} type="button" onClick={() => { setHandle(r); go(r); }}
                className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300 hover:bg-zinc-700">{r}</button>
            ))}
          </div>
        )}
        <div className="mt-3 max-h-72 overflow-auto">
          {loading && <p className="text-sm text-zinc-500">Loading&#x2026;</p>}
          {error && <p className="text-sm text-red-400">{error}</p>}
          {!loading && !error && results.length === 0 && channelTitle && <p className="text-sm text-zinc-500">No public playlists</p>}
          {results.length > 0 && (
            <>
              <p className="mb-1 text-xs text-zinc-500">{channelTitle} &middot; {results.length} public playlists{results.length === 50 ? ' (showing first 50)' : ''}</p>
              {results.map((o) => (
                <button key={o.id} type="button" onClick={() => { onSelect(o.url); onClose(); }}
                  className="flex w-full flex-col items-start px-2 py-2 text-left hover:bg-zinc-800">
                  <span className="w-full truncate text-sm text-zinc-100">{o.title}</span>
                  {o.url && <span className="w-full truncate text-xs text-zinc-500" title={o.url}>{o.url}</span>}
                </button>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
