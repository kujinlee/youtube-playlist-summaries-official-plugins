'use client';

interface BulkActionBarProps {
  selectedCount: number;
  willGenerateCount: number;
  skipCount: number;
  onGenerate: () => void;
  onClear: () => void;
}

export default function BulkActionBar({ selectedCount, willGenerateCount, skipCount, onGenerate, onClear }: BulkActionBarProps) {
  if (selectedCount === 0) return null;
  return (
    <div className="flex items-center gap-3 px-3 py-2 mb-2 rounded bg-zinc-900 border border-zinc-800 text-sm">
      <button
        type="button"
        onClick={onGenerate}
        disabled={willGenerateCount === 0}
        className="px-3 py-1 rounded bg-amber-700 text-white disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Generate HTML doc — {willGenerateCount} videos
      </button>
      <button type="button" onClick={onClear} className="px-2 py-1 rounded text-zinc-300 hover:text-white">
        Clear
      </button>
      {skipCount > 0 && (
        <span className="text-zinc-500">({skipCount} already current)</span>
      )}
    </div>
  );
}
