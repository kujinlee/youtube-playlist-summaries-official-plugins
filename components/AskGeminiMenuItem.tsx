'use client';

import { useEffect, useRef, useState } from 'react';
import type { Video } from '@/types';
import { buildGeminiPrompt, buildGeminiUrl } from '@/lib/ask-gemini';

interface AskGeminiMenuItemProps {
  video: Video;
  onClose: () => void;
}

const itemClass = 'block w-full px-4 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-700';
const AUTO_CLOSE_MS = 2500;

type Confirmation =
  | { kind: 'idle' }
  | { kind: 'success' }
  | { kind: 'fallback'; prompt: string };

export default function AskGeminiMenuItem({ video, onClose }: AskGeminiMenuItemProps) {
  const [confirmation, setConfirmation] = useState<Confirmation>({ kind: 'idle' });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  function handleClick() {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    const prompt = buildGeminiPrompt(video);
    // noopener,noreferrer for security; with noopener the return value is null even on
    // success, so it is intentionally ignored. Confirmation is driven by the clipboard promise.
    window.open(buildGeminiUrl(prompt), '_blank', 'noopener,noreferrer');

    const write = navigator.clipboard?.writeText?.(prompt);
    if (write && typeof write.then === 'function') {
      write.then(() => {
        setConfirmation({ kind: 'success' });
        timerRef.current = setTimeout(() => onCloseRef.current(), AUTO_CLOSE_MS);
      }).catch(() => {
        setConfirmation({ kind: 'fallback', prompt });
      });
    } else {
      setConfirmation({ kind: 'fallback', prompt });
    }
  }

  return (
    <>
      <button type="button" onClick={handleClick} className={itemClass}>
        Ask Gemini about this video
      </button>

      {confirmation.kind === 'success' && (
        <div role="status" className="px-4 py-2 text-xs text-green-400">
          ✓ Prompt copied — paste (⌘V / Ctrl+V) into Gemini
        </div>
      )}

      {confirmation.kind === 'fallback' && (
        <div role="alert" className="px-4 py-2 text-xs text-amber-400">
          Could not copy automatically. Copy this prompt and paste into Gemini:
          <textarea
            readOnly
            tabIndex={-1}
            value={confirmation.prompt}
            rows={3}
            className="mt-1 w-full rounded bg-zinc-900 p-1 text-zinc-200"
          />
        </div>
      )}
    </>
  );
}
