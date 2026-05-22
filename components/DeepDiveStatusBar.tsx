'use client';

import { useEffect, useRef, useState } from 'react';
import type { ProgressEvent } from '@/types';

interface DeepDiveStatusBarProps {
  videoId: string;
  jobId: string;
  title: string;
  onClose: () => void;
}

type BarState =
  | { status: 'running'; progress: number; step: string }
  | { status: 'done' }
  | { status: 'error'; message: string; log: string };

const LOG_PANEL_ID = 'deep-dive-log-panel';

export default function DeepDiveStatusBar({ videoId, jobId, title, onClose }: DeepDiveStatusBarProps) {
  const [state, setState] = useState<BarState>({ status: 'running', progress: 0, step: '' });
  const [logsOpen, setLogsOpen] = useState(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    setState({ status: 'running', progress: 0, step: '' });
    setLogsOpen(false);

    const url = `/api/videos/${encodeURIComponent(videoId)}/deep-dive/stream?jobId=${encodeURIComponent(jobId)}`;
    const es = new EventSource(url);
    let terminal = false;
    let doneTimer: ReturnType<typeof setTimeout> | null = null;

    es.onmessage = (event: MessageEvent) => {
      if (terminal) return;
      let data: ProgressEvent;
      try {
        data = JSON.parse(event.data) as ProgressEvent;
      } catch {
        return;
      }
      if (data.type === 'step') {
        const progress =
          data.current != null && data.total != null
            ? Math.min(100, Math.round((data.current / data.total) * 100))
            : 0;
        setState({ status: 'running', progress, step: data.step });
      } else if (data.type === 'done') {
        terminal = true;
        setState({ status: 'done' });
        es.close();
        doneTimer = setTimeout(() => onCloseRef.current(), 3000);
      } else if (data.type === 'error') {
        terminal = true;
        setState({ status: 'error', message: data.log, log: data.log });
        es.close();
      }
    };

    es.onerror = () => {
      if (terminal) return;
      terminal = true;
      setState({ status: 'error', message: 'Connection lost. Please try again.', log: '' });
      es.close();
    };

    return () => {
      terminal = true;
      es.close();
      if (doneTimer) clearTimeout(doneTimer);
    };
  }, [videoId, jobId]);

  const progress = state.status === 'running' ? state.progress : state.status === 'done' ? 100 : 0;
  const barColor = state.status === 'error' ? 'bg-red-500' : 'bg-blue-500';

  return (
    <div
      role="status"
      aria-label="Deep Dive Progress"
      aria-live="polite"
      className="fixed bottom-0 left-0 right-0 z-40 bg-zinc-900 border-t border-zinc-700 px-6 py-3 shadow-lg"
    >
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-3">
          <span className="text-xs text-zinc-400 flex-shrink-0">
            Deep Dive
            {title && <span className="text-zinc-300 ml-1">— {title}</span>}
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
            <span className="text-xs text-green-400 flex-shrink-0">✓ Done</span>
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

        {state.status === 'error' && (
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              aria-expanded={logsOpen}
              aria-controls={LOG_PANEL_ID}
              onClick={() => setLogsOpen((prev) => !prev)}
              className="text-xs text-zinc-400 hover:text-zinc-100 underline"
            >
              {logsOpen ? 'Hide Logs' : 'Show Logs'}
            </button>
            {logsOpen && (
              <section id={LOG_PANEL_ID} aria-label="Logs" className="w-full">
                <pre className="text-xs text-zinc-400 bg-zinc-800 rounded p-2 overflow-auto max-h-32">
                  {state.log}
                </pre>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
