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

/** The indexed list Gemini sees: one line per segment, `[<i> @<m:ss>] <text>`. */
export function buildIndexedTranscript(segments: TranscriptSegment[]): string {
  return segments.map((s, i) => `[${i} @${formatTimestamp(s.offset)}] ${s.text}`).join('\n');
}

const OWN_LINE_TOKEN = /^\s*\[\[TS:(.*?)\]\]\s*$/;
const ANY_TOKEN = /\[\[TS:.*?\]\]/g;
const FENCE = /^\s*(```|~~~)/; // opens/closes a fenced code block (matches parse.ts:isFenceLine)

/**
 * Replace each own-line `[[TS:<index>]]` token with a `▶ [start–end](url)` line, resolving the real
 * timestamp from `segments[index].offset`. End of a token = next token's start; the last token's
 * end = video duration (last segment offset + duration).
 *
 * Fence-aware: tokens inside ``` / ~~~ fenced code blocks are left verbatim (never counted toward
 * validation, never rewritten) — mirroring parse.ts's fence handling. Unterminated fences: the
 * remainder of the document is treated as fenced content.
 *
 * All-or-nothing degradation: if any (non-fenced, own-line) index is out of range, indices are not
 * strictly increasing, `videoId` is missing, or there are no segments, ALL such token lines are
 * dropped (no `▶` lines emitted). Any stray inline token OUTSIDE a fence is stripped regardless, so
 * no raw `[[TS:…]]` ever reaches the reader (spec §8).
 */
export function resolveTranscriptTokens(
  markdown: string,
  segments: TranscriptSegment[],
  videoId: string | null,
): string {
  const lines = markdown.split('\n');

  // Pass 1: collect own-line token line indices OUTSIDE fences, in document order.
  const tokenLines: number[] = [];
  const indices: number[] = [];
  let inFence = false;
  lines.forEach((line, i) => {
    if (FENCE.test(line)) { inFence = !inFence; return; }
    if (inFence) return;
    const m = line.match(OWN_LINE_TOKEN);
    if (m) {
      tokenLines.push(i);
      const raw = m[1].trim();
      indices.push(/^\d+$/.test(raw) ? Number(raw) : NaN);
    }
  });

  const valid =
    tokenLines.length > 0 &&
    !!videoId &&
    segments.length > 0 &&
    indices.every((n) => Number.isInteger(n) && n >= 0 && n < segments.length) &&
    indices.every((n, k) => k === 0 || n > indices[k - 1]) &&
    // Codex MEDIUM: don't trust transcript ordering — resolved offsets must be finite & strictly increasing.
    indices.every((n, k) => Number.isFinite(segments[n].offset) && (k === 0 || segments[n].offset > segments[indices[k - 1]].offset)) &&
    // Codex: the final segment feeds videoDuration (last token's end) — it must be finite too.
    Number.isFinite(segments[segments.length - 1].offset) &&
    Number.isFinite(segments[segments.length - 1].duration);

  if (tokenLines.length > 0 && !valid) {
    console.warn('resolveTranscriptTokens: degrading — invalid/missing segment indices or videoId');
  }

  const lastSeg = segments[segments.length - 1];
  const videoDuration = segments.length > 0 ? Math.floor(lastSeg.offset + lastSeg.duration) : 0;
  const tokenSet = new Set(tokenLines);

  // Pass 2: rebuild line-by-line, fence-aware.
  let tokenK = 0;
  inFence = false;
  const out: (string | null)[] = lines.map((line, i) => {
    if (FENCE.test(line)) { inFence = !inFence; return line; }
    if (inFence) return line;                       // fenced content: verbatim
    if (tokenSet.has(i)) {
      if (!valid) return null;                      // degrade: drop the own-line token line
      const startSec = Math.floor(segments[indices[tokenK]].offset);
      const endSec = tokenK + 1 < indices.length
        ? Math.floor(segments[indices[tokenK + 1]].offset)
        : videoDuration;
      tokenK++;
      return timestampLine(startSec, endSec, videoId as string);
    }
    return line.replace(ANY_TOKEN, '');             // strip any stray inline (non-own-line) token
  });

  return out.filter((l): l is string => l !== null).join('\n');
}
