'use client';

import { useEffect, useRef, useState } from 'react';
import type { ProgressEvent } from '@/types';

interface PdfStatusBarProps {
  videoId: string;
  jobId: string;
  title: string;
  onClose: () => void;
  // Fired on a terminal error so the page can clear the row's busy state.
  onError?: () => void;
}

type BarState =
  | { status: 'running'; progress: number; step: string }
  | { status: 'done'; file: string }
  | { status: 'error'; message: string };

// Non-blocking bottom bar for the auto-PDF export. Unlike HtmlDocStatusBar it renders NO view link
// on done — the deliverable is a file saved to the pdfs/ folder, so it reports "Saved pdfs/<file>".
export default function PdfStatusBar({ videoId, jobId, title, onClose, onError }: PdfStatusBarProps) {
  const [state, setState] = useState<BarState>({ status: 'running', progress: 0, step: '' });
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    setState({ status: 'running', progress: 0, step: '' });
    const url = `/api/videos/${encodeURIComponent(videoId)}/pdf/stream?jobId=${encodeURIComponent(jobId)}`;
    const es = new EventSource(url);
    let terminal = false;
    let doneTimer: ReturnType<typeof setTimeout> | null = null;

    es.onmessage = (event: MessageEvent) => {
      if (terminal) return;
      let data: ProgressEvent;
      try { data = JSON.parse(event.data) as ProgressEvent; } catch { return; }
      if (data.type === 'step') {
        const progress = data.current != null && data.total != null
          ? Math.min(100, Math.round((data.current / data.total) * 100)) : 0;
        setState({ status: 'running', progress, step: data.step });
      } else if (data.type === 'done') {
        terminal = true;
        setState({ status: 'done', file: data.log ?? '' });
        es.close();
        doneTimer = setTimeout(() => onCloseRef.current(), 2500);
      } else if (data.type === 'error') {
        terminal = true;
        setState({ status: 'error', message: data.log });
        es.close();
        onErrorRef.current?.();
      }
    };

    es.onerror = () => {
      if (terminal) return;
      terminal = true;
      setState({ status: 'error', message: 'Connection lost. Please try again.' });
      es.close();
      onErrorRef.current?.();
    };

    return () => { terminal = true; es.close(); if (doneTimer) clearTimeout(doneTimer); };
  }, [videoId, jobId]);

  const progress = state.status === 'running' ? state.progress : state.status === 'done' ? 100 : 0;
  const barColor = state.status === 'error' ? 'bg-red-500' : 'bg-amber-500';

  return (
    <div
      role="status"
      aria-label="Save PDF Progress"
      aria-live="polite"
      className="fixed bottom-0 left-0 right-0 z-40 bg-zinc-900 border-t border-zinc-700 px-6 py-3 shadow-lg"
    >
      <div className="max-w-5xl mx-auto flex items-center gap-3">
        <span className="text-xs text-zinc-400 flex-shrink-0">
          Save PDF{title && <span className="text-zinc-300 ml-1">— {title}</span>}
        </span>

        <div
          className="flex-1 h-1.5 bg-zinc-700 rounded-full overflow-hidden"
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className={`h-full rounded-full transition-all duration-300 ${barColor} ${state.status === 'running' ? 'animate-pulse' : ''}`}
            style={{ width: `${progress}%` }}
          />
        </div>

        {state.status === 'running' && state.step && (
          <span className="text-xs text-zinc-400 flex-shrink-0 max-w-48 truncate">{state.step}</span>
        )}
        {state.status === 'done' && (
          <span className="text-xs text-amber-400 flex-shrink-0 max-w-64 truncate">
            Saved pdfs/{state.file}
          </span>
        )}
        {state.status === 'error' && (
          <span role="alert" className="text-xs text-red-400 flex-shrink-0 max-w-48 truncate">
            {state.message}
          </span>
        )}

        <button
          type="button"
          onClick={onClose}
          aria-label="Dismiss"
          className="text-zinc-500 hover:text-zinc-200 text-sm leading-none px-1 flex-shrink-0"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
