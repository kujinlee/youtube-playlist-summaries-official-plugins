/** One transcript segment with timing in SECONDS (the youtube-transcript lib returns ms). */
export interface TranscriptSegment {
  text: string;
  offset: number;   // seconds from video start
  duration: number; // seconds
}

/** Format a second count as `m:ss` (or `h:mm:ss` for >= 1h). Floors fractions; clamps negatives. */
export function formatTimestamp(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Inverse of formatTimestamp: `m:ss` / `h:mm:ss` -> seconds. NaN if any part is non-numeric. */
export function parseClockToSeconds(clock: string): number {
  const parts = clock.trim().split(':').map((p) => parseInt(p, 10));
  if (parts.length < 2 || parts.length > 3 || parts.some((n) => Number.isNaN(n))) return NaN;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

/** A YouTube watch URL that opens at startSec (integer, clamped >= 0). */
export function buildWatchUrl(videoId: string, startSec: number): string {
  return `https://www.youtube.com/watch?v=${videoId}&t=${Math.max(0, Math.floor(startSec))}s`;
}

/** The `▶ [start–end](url)` markdown line (en dash U+2013 between start and end). */
export function timestampLine(startSec: number, endSec: number, videoId: string): string {
  return `▶ [${formatTimestamp(startSec)}–${formatTimestamp(endSec)}](${buildWatchUrl(videoId, startSec)})`;
}
