'use client';

import { useEffect, useRef, useState } from 'react';
import type { ProgressEvent } from '@/types';

interface BackfillOverlayProps {
  outputFolder: string;
  onClose: () => void;
}

interface LogEntry {
  title: string;
  status: 'done' | 'error';
  error?: string;
}

type OverlayState =
  | { status: 'running'; current: number; total: number; logs: LogEntry[] }
  | { status: 'done'; succeeded: number; failed: number; logs: LogEntry[] }
  | { status: 'error'; logs: LogEntry[] };

const FOCUSABLE = 'button:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function BackfillOverlay({ outputFolder, onClose }: BackfillOverlayProps) {
  const [state, setState] = useState<OverlayState>({ status: 'running', current: 0, total: 0, logs: [] });
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const priorFocusRef = useRef<Element | null>(null);

  // Move focus into dialog on mount; restore on unmount
  useEffect(() => {
    priorFocusRef.current = document.activeElement;
    const firstFocusable = dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    firstFocusable?.focus();
    return () => { (priorFocusRef.current as HTMLElement | null)?.focus(); };
  }, []);

  const isDismissable = state.status === 'done' || state.status === 'error';

  // Escape key dismissal (when dismissable)
  useEffect(() => {
    if (!isDismissable) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isDismissable, onClose]);

  // Tab-key focus trap: keep Tab/Shift-Tab within the dialog
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) { e.preventDefault(); return; }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    dialog.addEventListener('keydown', handler);
    return () => dialog.removeEventListener('keydown', handler);
  }, []);

  // SSE connection: subscribe to backfill progress events
  useEffect(() => {
    const url = `/api/quick-view/backfill?outputFolder=${encodeURIComponent(outputFolder)}`;
    const es = new EventSource(url);
    let terminal = false;

    es.onmessage = (event: MessageEvent) => {
      if (terminal) return;
      let data: ProgressEvent;
      try { data = JSON.parse(event.data) as ProgressEvent; } catch { return; }

      if (data.type === 'start') {
        setState({ status: 'running', current: 0, total: data.total ?? 0, logs: [] });
      } else if (data.type === 'step') {
        setState((prev) => {
          if (prev.status !== 'running') return prev;
          return {
            status: 'running',
            current: data.current ?? 0,
            total: prev.total,
            logs: [...prev.logs, { title: data.title ?? '', status: 'done' }],
          };
        });
      } else if (data.type === 'error' && data.videoId) {
        setState((prev) => {
          if (prev.status !== 'running') return prev;
          return {
            ...prev,
            logs: [...prev.logs, { title: data.title ?? data.videoId ?? '', status: 'error', error: data.log }],
          };
        });
      } else if (data.type === 'done') {
        terminal = true;
        es.close();
        setState((prev) => ({
          status: 'done',
          succeeded: data.succeeded ?? 0,
          failed: data.failed ?? 0,
          logs: prev.logs,
        }));
      }
    };

    es.onerror = () => {
      if (terminal) return;
      terminal = true;
      es.close();
      setState((prev) => ({ status: 'error', logs: prev.logs }));
    };

    return () => { terminal = true; es.close(); };
  }, [outputFolder]);

  const progress = state.status === 'running' && state.total > 0
    ? Math.round((state.current / state.total) * 100)
    : state.status === 'done' ? 100 : 0;

  const logs = state.logs;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={isDismissable ? onClose : undefined}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Generating Quick References"
        className="w-full max-w-lg rounded-xl bg-zinc-900 border border-zinc-800 p-6 shadow-2xl mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-zinc-100">Generating Quick References…</h2>
        </div>

        <div
          className="h-2 bg-zinc-700 rounded-full overflow-hidden mb-3"
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full bg-blue-600 rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>

        {state.status === 'running' && (
          <p className="text-xs text-zinc-400 mb-3">
            {state.current} / {state.total} processed
          </p>
        )}

        {state.status === 'done' && (
          <p role="status" className="text-xs text-green-400 mb-3">
            ✓ Done — {state.succeeded} succeeded{state.failed > 0 ? `, ${state.failed} failed` : ''}
          </p>
        )}

        {state.status === 'error' && (
          <p role="alert" className="text-xs text-red-400 mb-3">
            ⚠ Connection lost. Please try again.
          </p>
        )}

        {logs.length > 0 && (
          <ul className="max-h-40 overflow-auto space-y-0.5 mb-4 text-xs">
            {logs.map((entry, i) => (
              <li key={i} className={entry.status === 'error' ? 'text-red-400' : 'text-zinc-400'}>
                <span className="mr-1">{entry.status === 'done' ? '✓' : '⚠'}</span>
                <span>{entry.title}</span>
                {entry.error && <span className="ml-1 text-zinc-500">({entry.error})</span>}
              </li>
            ))}
          </ul>
        )}

        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={!isDismissable}
            aria-label="Dismiss"
            className="text-xs px-3 py-1.5 rounded bg-zinc-700 text-zinc-200 hover:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
