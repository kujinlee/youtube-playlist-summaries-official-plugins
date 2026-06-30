/**
 * Format a duration in seconds as a clock string.
 *
 * Pure and dependency-free so it is safe to import from client components
 * (unlike lib/pipeline.ts, which pulls in fs / youtube / gemini).
 *
 *   45   → "0:45"
 *   300  → "5:00"
 *   3661 → "1:01:01"
 */
export function formatDuration(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}
