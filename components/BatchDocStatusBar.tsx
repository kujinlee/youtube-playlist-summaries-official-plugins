'use client';

import { useEffect, useRef, useState } from 'react';
import type { ProgressEvent } from '@/types';

interface BatchDocStatusBarProps {
  jobId: string;
  onClose: () => void;
  onError?: () => void;
  onProgressEvent?: (e: ProgressEvent) => void; // H2: page refreshes rows on each event
}

type BarState =
  | { status: 'running'; current: number; total: number; failed: number; step: string }
  | { status: 'done'; succeeded: number; failed: number }
  | { status: 'error'; message: string };

export default function BatchDocStatusBar({ jobId, onClose, onError, onProgressEvent }: BatchDocStatusBarProps) {
  const [state, setState] = useState<BarState>({ status: 'running', current: 0, total: 0, failed: 0, step: '' });
  const onCloseRef = useRef(onClose); onCloseRef.current = onClose;
  const onErrorRef = useRef(onError); onErrorRef.current = onError;
  const onProgressEventRef = useRef(onProgressEvent); onProgressEventRef.current = onProgressEvent;
  const failedRef = useRef(0);
  const statusRef = useRef<BarState['status']>('running');
  statusRef.current = state.status;

  // H1: ✕ while running cancels the backend job (fire-and-forget), then closes the bar.
  const handleClose = () => {
    if (statusRef.current === 'running') {
      fetch('/api/videos/batch-docs/cancel', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jobId }),
      }).catch(() => {});
    }
    onClose();
  };

  useEffect(() => {
    failedRef.current = 0;
    setState({ status: 'running', current: 0, total: 0, failed: 0, step: '' });
    const url = `/api/videos/batch-docs/stream?jobId=${encodeURIComponent(jobId)}`;
    const es = new EventSource(url);
    let terminal = false;
    let doneTimer: ReturnType<typeof setTimeout> | null = null;

    es.onmessage = (event: MessageEvent) => {
      if (terminal) return;
      let data: ProgressEvent;
      try { data = JSON.parse(event.data) as ProgressEvent; } catch { return; }
      onProgressEventRef.current?.(data); // H2: let the page refresh rows as items complete
      if (data.type === 'start') {
        setState({ status: 'running', current: 0, total: data.total ?? 0, failed: failedRef.current, step: '' });
      } else if (data.type === 'step') {
        setState({ status: 'running', current: data.current ?? 0, total: data.total ?? 0, failed: failedRef.current, step: data.step });
      } else if (data.type === 'error' && 'videoId' in data && data.videoId) {
        failedRef.current += 1; // non-fatal per-video error
        setState((prev) => prev.status === 'running' ? { ...prev, failed: failedRef.current } : prev);
      } else if (data.type === 'error') {
        terminal = true; setState({ status: 'error', message: data.log }); es.close(); onErrorRef.current?.();
      } else if (data.type === 'done') {
        terminal = true;
        setState({ status: 'done', succeeded: data.succeeded ?? 0, failed: data.failed ?? failedRef.current });
        es.close();
        doneTimer = setTimeout(() => onCloseRef.current(), 4000);
      } else if (data.type === 'cancelled') {
        terminal = true; es.close(); onCloseRef.current();
      }
    };
    es.onerror = () => {
      if (terminal) return;
      terminal = true; setState({ status: 'error', message: 'Connection lost. Please try again.' }); es.close(); onErrorRef.current?.();
    };
    return () => { terminal = true; es.close(); if (doneTimer) clearTimeout(doneTimer); };
  }, [jobId]);

  return (
    <div className="fixed bottom-0 inset-x-0 z-20 bg-zinc-900 border-t border-zinc-800 px-4 py-2 text-sm text-zinc-100">
      <div className="flex items-center gap-3">
        <span className="flex-1">
          {state.status === 'running' && <>Generating — step {state.current} of {state.total}{state.failed > 0 ? ` · ${state.failed} failed` : ''} {state.step && <span className="text-zinc-400">{state.step}</span>}</>}
          {state.status === 'done' && <>✓ {state.succeeded} generated{state.failed > 0 ? `, ${state.failed} failed` : ''}</>}
          {state.status === 'error' && <>✕ {state.message}</>}
        </span>
        <button type="button" aria-label="Close" onClick={handleClose} className="text-zinc-400 hover:text-white">✕</button>
      </div>
      {state.status === 'running' && state.total > 0 && (
        <div className="mt-1 h-1 bg-zinc-800 rounded">
          <div className="h-1 bg-amber-600 rounded" style={{ width: `${Math.min(100, Math.round((state.current / state.total) * 100))}%` }} />
        </div>
      )}
    </div>
  );
}
