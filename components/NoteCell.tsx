'use client';

import { useEffect, useRef, useState } from 'react';

interface NoteCellProps {
  videoId: string;
  outputFolder: string;
  value: string | undefined;
  onChange: (note: string | undefined) => void;
}

function truncate(text: string, len: number): string {
  return text.length <= len ? text : text.slice(0, len) + '…';
}

export default function NoteCell({ videoId, outputFolder, value, onChange }: NoteCellProps) {
  const [open,   setOpen]   = useState(false);
  const [draft,  setDraft]  = useState('');
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function openPopover() {
    setDraft(value ?? '');
    setError('');
    setOpen(true);
  }

  function closePopover() {
    if (saving) return;
    setOpen(false);
  }

  // Move focus to textarea when popover opens
  useEffect(() => {
    if (open) textareaRef.current?.focus();
  }, [open]);

  // Escape key dismissal
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !saving) setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, saving]);

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/videos/${encodeURIComponent(videoId)}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outputFolder, personalNote: draft }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        setError(data.error ?? 'Save failed');
        return;
      }
      onChange(draft || undefined);
      setOpen(false);
    } catch {
      setError('Save failed');
    } finally {
      setSaving(false);
    }
  }

  const preview = value ? truncate(value, 25) : '—';

  return (
    <div className="relative">
      <button
        type="button"
        onClick={openPopover}
        className="text-sm text-zinc-300 hover:text-zinc-100 text-left w-full"
      >
        {preview}
      </button>

      {open && (
        <>
          {/* Backdrop: clicking outside dismisses (no-op while saving) */}
          <div
            data-testid="note-backdrop"
            aria-hidden="true"
            className="fixed inset-0 z-20"
            onClick={closePopover}
          />

          {/* Popover */}
          <div
            role="dialog"
            aria-label="Edit note"
            className="absolute z-30 right-0 top-full mt-1 w-72 rounded border border-zinc-700 bg-zinc-900 p-3 shadow-lg"
          >
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={500}
              rows={4}
              className="w-full rounded bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-xs text-zinc-300 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              placeholder="Add a note…"
            />
            {error && <p role="alert" className="text-xs text-red-400 mt-1">{error}</p>}
            <div className="flex justify-end gap-2 mt-2">
              <button
                type="button"
                onClick={closePopover}
                disabled={saving}
                className="px-2 py-1 text-xs rounded border border-zinc-700 text-zinc-300 hover:text-zinc-100 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="px-2 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
