'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Video } from '@/types';

type Patch = Partial<Pick<Video, 'corrections' | 'tldr' | 'takeaways' | 'summaryHtml'>>;

interface CorrectionsPanelProps {
  videoId: string;
  outputFolder: string;
  initialCorrections: string | undefined;
  onClose: () => void;
  onSuccess: (patch: Patch) => void;
}

export default function CorrectionsPanel({
  videoId,
  outputFolder,
  initialCorrections,
  onClose,
  onSuccess,
}: CorrectionsPanelProps) {
  const [corrections, setCorrections] = useState(initialCorrections ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Escape key dismissal (no-op while regenerating)
  useEffect(() => {
    if (busy) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  async function handleRegenerate() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/videos/${encodeURIComponent(videoId)}/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outputFolder, corrections }),
      });
      const data = await res.json().catch(() => ({})) as Record<string, unknown>;
      if (!res.ok) {
        setError((data.error as string | undefined) ?? 'Regeneration failed');
        return;
      }
      onSuccess({
        corrections: corrections.trim() || undefined,
        tldr: data.tldr as string | undefined,
        takeaways: data.takeaways as string[] | undefined,
        summaryHtml: (data.summaryHtml ?? null) as string | null,
      });
      onClose();
    } catch {
      setError('Regeneration failed');
    } finally {
      setBusy(false);
    }
  }

  // This is a fixed full-screen overlay. It is rendered from inside a <tbody> (VideoRow),
  // where a bare <div> is invalid DOM (hydration error). Portal it to <body> so it escapes
  // the table and nests validly.
  if (typeof document === 'undefined') return null;

  return createPortal(
    <>
      {/* Semi-transparent backdrop — no-op while regenerating */}
      <div
        data-testid="corrections-backdrop"
        aria-hidden="true"
        className="fixed inset-0 z-40 bg-black/50"
        onClick={() => { if (!busy) onClose(); }}
      />

      {/* Panel */}
      <div
        role="dialog"
        aria-label="Edit corrections"
        aria-modal="true"
        className="fixed inset-x-0 top-1/4 z-50 mx-auto w-full max-w-lg rounded-lg border border-zinc-700 bg-zinc-900 p-4 shadow-2xl"
      >
        <h2 className="text-sm font-semibold text-zinc-200 mb-1">Edit corrections</h2>
        <p className="text-xs text-zinc-400 mb-3">
          Describe transcription errors to fix, e.g. &ldquo;Fix &apos;Clawcode&apos; → &apos;Claude Code&apos;&rdquo;.
          The summary will be regenerated with these corrections applied.
        </p>
        <textarea
          ref={textareaRef}
          value={corrections}
          onChange={(e) => setCorrections(e.target.value)}
          rows={5}
          maxLength={1000}
          disabled={busy}
          className="w-full rounded bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-xs text-zinc-300 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none disabled:opacity-50"
          placeholder="e.g. Fix 'Clawcode' → 'Claude Code'; fix 'Ant Throw Pick' → 'Anthropic'"
        />
        {error && <p role="alert" className="text-xs text-red-400 mt-1">{error}</p>}
        <div className="flex justify-end gap-2 mt-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-3 py-1.5 text-xs rounded border border-zinc-700 text-zinc-300 hover:text-zinc-100 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleRegenerate}
            disabled={busy}
            className="px-3 py-1.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {busy ? 'Regenerating…' : 'Regenerate'}
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
