'use client';

import { useState, useEffect } from 'react';
import Badge from './Badge';

interface VideoQuickViewProps {
  videoId: string;
  tldr?: string;
  takeaways?: string[];
  tags?: string[];
  outputFolder: string;
}

type QuickViewState =
  | { status: 'loading' }
  | { status: 'ready'; tldr: string; takeaways: string[]; tags: string[] }
  | { status: 'error' };

export default function VideoQuickView({
  videoId,
  tldr,
  takeaways,
  tags,
  outputFolder,
}: VideoQuickViewProps) {
  // Initial state reflects props at mount time. This component is always unmounted
  // and remounted by VideoRow ({isExpanded && <VideoQuickView />}), so stale-prop
  // drift is not a concern in this usage.
  const [state, setState] = useState<QuickViewState>(
    tldr
      ? { status: 'ready', tldr, takeaways: takeaways ?? [], tags: tags ?? [] }
      : { status: 'loading' },
  );

  useEffect(() => {
    if (tldr) return;

    let cancelled = false;
    const url = `/api/videos/${encodeURIComponent(videoId)}/quick-view?outputFolder=${encodeURIComponent(outputFolder)}`;

    fetch(url)
      .then(async (res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          setState({ status: 'ready', tldr: data.tldr, takeaways: data.takeaways ?? [], tags: data.tags ?? [] });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' });
      });

    return () => { cancelled = true; };
  }, [videoId, tldr, outputFolder]);

  if (state.status === 'loading') {
    return (
      <div className="px-4 py-3 text-sm text-zinc-400" role="status">
        Loading quick view…
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="px-4 py-3 text-sm text-zinc-500" role="alert">
        Quick Reference not yet generated. Use &ldquo;Generate all&rdquo; in the filter bar above.
      </div>
    );
  }

  return (
    <div className="px-4 py-3 bg-zinc-900/80 border-t border-zinc-800 space-y-2">
      <p className="text-sm text-zinc-300 italic">{state.tldr}</p>
      {state.takeaways.length > 0 && (
        <div>
          <p className="text-xs font-medium text-zinc-400 uppercase mb-1">Key Takeaways</p>
          <ul className="space-y-0.5">
            {state.takeaways.map((t) => (
              <li key={t} className="flex gap-2 text-sm text-zinc-300">
                <span className="text-zinc-500" aria-hidden="true">•</span>
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {state.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {state.tags.map((tag) => (
            <Badge key={tag} label={tag} colorClass="bg-zinc-700 text-zinc-300" />
          ))}
        </div>
      )}
    </div>
  );
}
