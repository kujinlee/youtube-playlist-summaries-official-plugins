'use client';
import { useEffect, useRef } from 'react';

type Props = {
  value: string;
  onChange: (v: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabled?: boolean;
  /** The active playlist URL; blur with an empty or unchanged field collapses. */
  currentUrl?: string;
};

export default function AddByLink({ value, onChange, open, onOpenChange, disabled, currentUrl }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') { e.preventDefault(); onOpenChange(false); }
  }
  function onBlur() {
    const v = value.trim();
    if (v === '' || v === (currentUrl ?? '').trim()) onOpenChange(false);
  }

  return (
    <div className="flex-1">
      <button
        type="button" disabled={disabled} aria-expanded={open}
        onClick={() => onOpenChange(!open)}
        className="text-xs text-zinc-400 hover:text-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        + Add by link
      </button>
      {open && (
        <input
          ref={inputRef} type="text" value={value} disabled={disabled}
          placeholder="Paste a playlist URL…"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={onBlur}
          className="mt-1 w-full rounded bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      )}
    </div>
  );
}
