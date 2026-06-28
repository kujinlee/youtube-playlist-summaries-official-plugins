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
/**
 * A malformed citation token of the shape `[[<index> @<clock>]]` — e.g. `[[0 @1:09]]`.
 * This is NOT a `[[TS:i]]` token; it is Gemini fusing the `[[ ]]` citation wrapper with the
 * `[i @m:ss]` DISPLAY format it sees in buildIndexedTranscript, so it matches neither
 * OWN_LINE_TOKEN nor ANY_TOKEN and would otherwise leak verbatim. The pattern is deliberately
 * narrow — digits, then `@`, then a clock (digits/colons) — so it never touches a genuine
 * Obsidian wikilink (`[[Some Note]]`, `[[2024 Roadmap]]`: no digits-then-`@` shape).
 * Whitespace is tolerated everywhere inside the wrapper (`[[ 0 @ 1:09 ]]`) so a padded
 * LLM echo cannot slip past — the `\d+ … @ … clock` skeleton is still required, so genuine
 * wikilinks (which never present digits-then-`@`) remain untouched.
 */
const STRAY_CITATION = /\[\[\s*\d+\s*@\s*[\d:]+\s*\]\]/g;
const FENCE = /^\s*(```|~~~)/; // opens/closes a fenced code block (matches parse.ts:isFenceLine)

/**
 * Replace each own-line `[[TS:<index>]]` token with a `▶ [start–end](url)` line, resolving the real
 * timestamp from `segments[index].offset`. End of a token = next kept token's start; the last kept
 * token's end = video duration (last segment offset + duration).
 *
 * Lenient selection: invalid candidates (out-of-range index, non-finite offset, offset >= videoDuration)
 * are removed individually. From the remaining candidates the longest strictly-increasing-offset
 * subsequence (LIS) is kept — only that subset emits `▶` lines. The rest are dropped (line removed).
 *
 * Global no-op (no `▶` emitted, tokens stripped): N===0, no `videoId`, `segments.length===0`, or
 * non-finite `videoDuration`.
 *
 * Fence-aware: tokens inside ``` / ~~~ fenced code blocks are left verbatim (never counted toward
 * selection, never rewritten) — mirroring parse.ts's fence handling. Unterminated fences: the
 * remainder of the document is treated as fenced content.
 *
 * Any stray inline token OUTSIDE a fence is stripped regardless, so no raw `[[TS:…]]` ever reaches
 * the reader (spec §8). The same strip also scrubs the malformed `[[<index> @<clock>]]` shape that
 * Gemini produced when it echoed the indexed-transcript display format (see STRAY_CITATION).
 */
export function resolveTranscriptTokens(
  markdown: string,
  segments: TranscriptSegment[],
  videoId: string | null,
  videoDuration_param?: number,
): string {
  const lines = markdown.split('\n');

  // Pass 1: record own-line non-fenced tokens in document order.
  const tokens: { lineIndex: number; index: number }[] = [];
  let inFence = false;
  lines.forEach((line, i) => {
    if (FENCE.test(line)) { inFence = !inFence; return; }
    if (inFence) return;
    const m = line.match(OWN_LINE_TOKEN);
    if (m) {
      const raw = m[1].trim();
      tokens.push({ lineIndex: i, index: /^\d+$/.test(raw) ? Number(raw) : NaN });
    }
  });
  const N = tokens.length;
  const tokenSet = new Set(tokens.map((t) => t.lineIndex));

  const lastSeg = segments[segments.length - 1];
  const videoDuration = videoDuration_param ?? (segments.length > 0 ? Math.floor(lastSeg.offset + lastSeg.duration) : NaN);
  const globalOk = N > 0 && !!videoId && segments.length > 0 && Number.isFinite(videoDuration);

  // Select the kept tokens (candidate filter + longest strictly-increasing-offset subsequence).
  const keptMap = new Map<number, { start: number; end: number }>();
  let kept = 0;
  if (globalOk) {
    const candidates = tokens.filter((t) =>
      Number.isInteger(t.index) &&
      t.index >= 0 &&
      t.index < segments.length &&
      Number.isFinite(segments[t.index].offset) &&
      Math.floor(segments[t.index].offset) < videoDuration,
    );
    const offs = candidates.map((c) => segments[c.index].offset);
    const len = offs.map(() => 1);
    const prev = offs.map(() => -1);
    for (let i = 0; i < offs.length; i++) {
      for (let j = 0; j < i; j++) {
        // strict `>` keeps the SMALLEST predecessor j on ties → deterministic
        if (offs[j] < offs[i] && len[j] + 1 > len[i]) { len[i] = len[j] + 1; prev[i] = j; }
      }
    }
    let best = -1;
    for (let i = 0; i < offs.length; i++) if (best === -1 || len[i] > len[best]) best = i; // earliest max
    const pos: number[] = [];
    for (let i = best; i >= 0; i = prev[i]) pos.push(i);
    pos.reverse();
    const keptTokens = pos.map((p) => candidates[p]); // document order, strictly increasing offsets
    kept = keptTokens.length;
    keptTokens.forEach((t, k) => {
      const start = Math.floor(segments[t.index].offset);
      const end = k + 1 < keptTokens.length
        ? Math.floor(segments[keptTokens[k + 1].index].offset)
        : videoDuration;
      keptMap.set(t.lineIndex, { start, end });
    });
  }

  if (N > 0) {
    if (!globalOk || kept === 0) {
      console.warn(`resolveTranscriptTokens: dropped all ${N} timestamp tokens (invalid indices or missing videoId/segments)`);
    } else if (kept < N) {
      console.warn(`resolveTranscriptTokens: kept ${kept} of ${N} timestamp tokens (dropped ${N - kept} out-of-range/out-of-order)`);
    }
  }

  // Pass 2: rebuild line-by-line, fence-aware.
  inFence = false;
  const out: (string | null)[] = lines.map((line, i) => {
    if (FENCE.test(line)) { inFence = !inFence; return line; }
    if (inFence) return line;                       // fenced content: verbatim
    if (tokenSet.has(i)) {
      const k = keptMap.get(i);
      return k ? timestampLine(k.start, k.end, videoId as string) : null; // dropped token line removed
    }
    return line.replace(ANY_TOKEN, '').replace(STRAY_CITATION, ''); // strip stray [[TS:…]] AND malformed [[i @clock]] citation echoes
  });

  return out.filter((l): l is string => l !== null).join('\n');
}
