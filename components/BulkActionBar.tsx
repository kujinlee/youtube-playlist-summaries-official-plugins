'use client';
import type { BatchMode } from '@/lib/html-doc/batch';

interface BulkActionBarProps {
  selectedCount: number;
  willGenerateCount: number;
  skipCount: number;
  mode: BatchMode;
  onModeChange: (m: BatchMode) => void;
  onGenerate: () => void;
  onClear: () => void;
}

const DIG_CONFIRM =
  'Summary + Dig-deeper digs every missing/stale section of the selected videos. ' +
  'Each section runs a Gemini call plus a short video download (~$0.05 and ~30s each), ' +
  'so a large batch can take several minutes and cost a few dollars. Continue?';

export default function BulkActionBar({ selectedCount, willGenerateCount, skipCount, mode, onModeChange, onGenerate, onClear }: BulkActionBarProps) {
  if (selectedCount === 0) return null;
  const handleGenerate = () => {
    if (mode === 'summary-dig' && !window.confirm(DIG_CONFIRM)) return;
    onGenerate();
  };
  return (
    <div className="flex flex-wrap items-center gap-3 px-3 py-2 mb-2 rounded bg-zinc-900 border border-zinc-800 text-sm">
      <fieldset className="flex items-center gap-3" aria-label="Doc mode">
        <label className="flex items-center gap-1">
          <input type="radio" name="batch-mode" checked={mode === 'summary'} onChange={() => onModeChange('summary')} />
          Summary HTML
        </label>
        <label className="flex items-center gap-1">
          <input type="radio" name="batch-mode" checked={mode === 'summary-dig'} onChange={() => onModeChange('summary-dig')} />
          Summary + Dig-deeper
        </label>
      </fieldset>
      <button
        type="button"
        onClick={handleGenerate}
        disabled={willGenerateCount === 0}
        className="px-3 py-1 rounded bg-amber-700 text-white disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Generate {mode === 'summary-dig' ? 'docs' : 'HTML doc'} — {willGenerateCount} videos
      </button>
      <button type="button" onClick={onClear} className="px-2 py-1 rounded text-zinc-300 hover:text-white">Clear</button>
      {skipCount > 0 && <span className="text-zinc-500">({skipCount} already current)</span>}
    </div>
  );
}
