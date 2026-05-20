'use client';

import { useEffect, useRef, useState } from 'react';
import type { ProgressEvent } from '@/types';

interface DeepDiveOverlayProps {
  videoId: string;
  jobId: string;
  onClose: () => void;
}

type OverlayState =
  | { status: 'running'; progress: number; step: string }
  | { status: 'done' }
  | { status: 'error'; message: string; log: string };

const LOG_PANEL_ID = 'deep-dive-log-panel';

export default function DeepDiveOverlay({ videoId, jobId, onClose }: DeepDiveOverlayProps) {
  const [state, setState] = useState<OverlayState>({ status: 'running', progress: 0, step: '' });
  const [logsOpen, setLogsOpen] = useState(false);
  const priorFocusRef = useRef<Element | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Capture focus target for restoration on close
  useEffect(() => {
    priorFocusRef.current = document.activeElement;
    const firstFocusable = dialogRef.current?.querySelector<HTMLElement>('button, [tabindex]');
    firstFocusable?.focus();
    return () => {
      (priorFocusRef.current as HTMLElement | null)?.focus();
    };
  }, []);

  useEffect(() => {
    // Reset UI state for each new job
    setState({ status: 'running', progress: 0, step: '' });
    setLogsOpen(false);

    const url = `/api/videos/${encodeURIComponent(videoId)}/deep-dive/stream?jobId=${encodeURIComponent(jobId)}`;
    const es = new EventSource(url);
    let terminal = false;

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
    };
  }, [videoId, jobId]);

  const progress = state.status === 'running' ? state.progress : state.status === 'done' ? 100 : 0;

  return (
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Deep Dive Progress">
      <progress
        role="progressbar"
        aria-valuenow={progress}
        aria-valuemin={0}
        aria-valuemax={100}
        value={progress}
        max={100}
      />

      {state.status === 'running' && state.step && <p>{state.step}</p>}

      {state.status === 'done' && (
        <p role="status">✓ Done</p>
      )}

      {state.status === 'error' && (
        <>
          <p role="alert">{state.message}</p>
          <button
            type="button"
            aria-expanded={logsOpen}
            aria-controls={LOG_PANEL_ID}
            onClick={() => setLogsOpen((prev) => !prev)}
          >
            {logsOpen ? 'Hide Logs' : 'Show Logs'}
          </button>
          {logsOpen && (
            <section id={LOG_PANEL_ID} aria-label="Logs">
              <pre>{state.log}</pre>
            </section>
          )}
        </>
      )}

      <button type="button" onClick={onClose}>
        Close
      </button>
    </div>
  );
}
