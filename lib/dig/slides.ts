/**
 * Resolves `[[SLIDE:sec|end|caption]]` tokens in "dig deeper" section markdown
 * into markdown image references. Each token triggers one bounded yt-dlp download
 * of the slide's lifespan [startSec, min(endSec, startSec+MAX_CAPTURE_SEC)], then
 * frames are sampled at SAMPLE_FPS over the whole window but selected only from the
 * trailing TRAIL_SEC seconds (anchored on the reliable `end`) via `pickLargestFrom`.
 * Each token owns its own temp clip, which is always deleted in `finally` regardless
 * of success or error.
 *
 * Security invariants:
 * - `videoId` is validated via `assertVideoId` (throws on traversal chars)
 *   BEFORE any exec call.
 * - `youtubeUrl` is always server-built from the validated videoId.
 * - `execFile` (argv array) is used exclusively — never `exec`/shell strings.
 * - Asset paths are containment-checked against `assetsRoot` BEFORE `captureSlideFrame`
 *   writes to `outPath`.
 * - The temp clip is always deleted in `finally`.
 */

import { execFile as _execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import util from 'node:util';
import { assertVideoId } from '@/lib/index-store';
import { parseSlideTokens, type SlideToken } from '@/lib/dig/slide-tokens';

const execFileAsync = util.promisify(_execFile);

/** Read a finite numeric env override, else the default. */
export function numEnv(name: string, def: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : def;
}

/** Frame sampling density within the window (frames per second). */
const SAMPLE_FPS = numEnv('DIG_SAMPLE_FPS', 2);
/** Maximum capture window length per slide (seconds). */
const MAX_CAPTURE_SEC = numEnv('DIG_MAX_CAPTURE_SEC', 10);
/** Forward window used when Gemini omits the slide end time (seconds). */
const DEFAULT_FWD = numEnv('DIG_DEFAULT_FWD', 4);
/** Trailing window for frame selection — select from the last TRAIL_SEC seconds of the window. */
const TRAIL_SEC = numEnv('DIG_TRAIL_SEC', 4);

/** Largest .jpg in `dir` whose 1-based ordinal (f_NNN) is >= minOrdinal. Null if none qualify. */
export function pickLargestFrom(dir: string, minOrdinal: number): string | null {
  let best: string | null = null;
  let bestSize = -1;
  for (const name of fs.readdirSync(dir)) {
    const m = name.match(/(\d+)\.jpg$/);
    if (!m) continue;
    if (parseInt(m[1], 10) < minOrdinal) continue;            // skip leading frames
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isFile() && st.size > bestSize) { bestSize = st.size; best = p; }
  }
  return best;
}

export interface ResolveSlideTokensOpts {
  /** YouTube video ID (section-level, validated before any exec). */
  videoId: string;
  /** Section start second — used to bound token sec values in `parseSlideTokens`. */
  startSec: number;
  /** Section end second — used to bound token sec values in `parseSlideTokens`. */
  endSec: number;
  assetsRoot: string;
  sectionId: number;
}

/** Download [startSec, winEnd], sample the whole window, but select the largest (most-built)
 *  frame only from the trailing TRAIL_SEC seconds. Trailing-only because Gemini's `end` reliably
 *  brackets the slide while `start` can be early (previous slide lingers at the leading edge).
 *  Returns the chosen frame's absolute timestamp (pickedSec). SECURITY: trusts outPath. */
async function captureSlideFrame(opts: {
  youtubeUrl: string; startSec: number; endSec: number | null; outPath: string;
}): Promise<number> {
  const { youtubeUrl, startSec, endSec, outPath } = opts;
  const cacheDir = path.resolve('.cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const rawEnd = endSec != null && endSec > startSec
    ? Math.min(endSec, startSec + MAX_CAPTURE_SEC)
    : startSec + DEFAULT_FWD;
  const winEnd = Math.max(rawEnd, startSec + 1);  // guard a degenerate window (e.g. DIG_DEFAULT_FWD="" → 0)
  const tailStart = Math.max(startSec, winEnd - TRAIL_SEC);          // absolute, anchored on end
  const minOrdinal = Math.floor((tailStart - startSec) * SAMPLE_FPS) + 1; // 1-based; frames before are leading

  const clip = path.join(cacheDir, `clip-${crypto.randomUUID()}.mp4`);
  const framesDir = fs.mkdtempSync(path.join(cacheDir, 'frames-'));
  try {
    await execFileAsync('yt-dlp', [
      '--download-sections', `*${startSec}-${winEnd}`,
      '-f', 'bv[height<=720]', '-o', clip, youtubeUrl,
    ]);
    await execFileAsync('ffmpeg', [
      '-y', '-i', clip, '-vf', `fps=${SAMPLE_FPS}`, '-q:v', '2',
      path.join(framesDir, 'f_%03d.jpg'),
    ]);
    let best = pickLargestFrom(framesDir, minOrdinal);
    if (!best) best = pickLargestFrom(framesDir, 1);   // tiny window → fall back to whole sample
    if (!best) throw new Error('no frames sampled');
    fs.copyFileSync(best, outPath);
    const ord = parseInt(path.basename(best).match(/(\d+)\.jpg$/)![1], 10);
    let pickedSec = startSec + (ord - 1) / SAMPLE_FPS;
    pickedSec = Math.min(Math.max(pickedSec, startSec), winEnd);     // clamp
    return Math.round(pickedSec * 10) / 10;
  } finally {
    fs.rmSync(framesDir, { recursive: true, force: true });
    try { fs.unlinkSync(clip); } catch { /* ignore */ }
  }
}

/**
 * Resolve all `[[SLIDE:sec|end|caption]]` tokens in `markdown` to markdown image
 * references pointing at extracted JPEG frames.
 *
 * - No tokens → returns `{ markdown: stripped, slides: [] }`; no exec calls made.
 * - `videoId` validated (throws) before any exec.
 * - Per token: one bounded yt-dlp download; on failure the token is stripped.
 * - On per-frame ffmpeg failure → that token dropped, others kept.
 * - Duplicate asset names (B2): first-wins; second token with same name is skipped.
 *
 * Returns `{ markdown, slides }` where `slides` carries `{ startSec, endSec, pickedSec }`
 * metadata for each successfully captured slide.
 */
export async function resolveSlideTokens(
  markdown: string,
  opts: ResolveSlideTokensOpts,
): Promise<{ markdown: string; slides: Array<{ startSec: number; endSec: number; pickedSec: number }> }> {
  const { videoId, startSec, endSec, assetsRoot, sectionId } = opts;

  // Always validate videoId first — throws on traversal chars or invalid format.
  assertVideoId(videoId);

  const tokens = parseSlideTokens(markdown, startSec, endSec);

  // Short-circuit: no resolvable tokens → no exec calls. Still strip any raw
  // [[SLIDE:...]] that the parser rejected (out-of-range / malformed) so it
  // never leaks into the rendered doc as literal text.
  // M3: also prune stale sectionId-* assets — a legitimate empty re-dig (Gemini
  // emitted ZERO slide tokens) should clear the prior set for this section.
  if (tokens.length === 0) {
    const emptyDir = path.resolve(assetsRoot, videoId);
    const emptyPrefix = `${sectionId}-`;
    let emptyEntries: string[] = [];
    try { emptyEntries = fs.readdirSync(emptyDir); } catch { emptyEntries = []; }
    for (const name of emptyEntries) {
      if (name.startsWith(emptyPrefix) && name.endsWith('.jpg')) {
        try { fs.unlinkSync(path.join(emptyDir, name)); } catch { /* ignore */ }
      }
    }
    return { markdown: stripUnresolvedSlideTokens(markdown), slides: [] };
  }

  // Build YouTube URL server-side from the validated videoId.
  const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;

  const slides: Array<{ startSec: number; endSec: number; pickedSec: number }> = [];
  const usedNames = new Set<string>();  // B2: guarantee filename uniqueness (first-wins) across this run
  const written = new Set<string>();    // M3: basenames that SUCCESSFULLY captured; drives post-loop prune

  let result = markdown;
  for (const token of tokens) {
    const endComponent = token.endSec ?? (token.sec + DEFAULT_FWD);
    const assetName = `${sectionId}-${token.sec}-${endComponent}.jpg`;

    if (usedNames.has(assetName)) continue;   // B2: two tokens resolving to the same file → keep the first only
    usedNames.add(assetName);

    const assetPath = path.resolve(assetsRoot, videoId, assetName);
    const resolvedRoot = path.resolve(assetsRoot);
    if (!assetPath.startsWith(resolvedRoot + path.sep)) {            // containment BEFORE any write
      console.warn('[dig-slide-miss] asset path escaped assetsRoot — skipping token:', token.raw);
      result = result.replace(token.raw, '');
      usedNames.delete(assetName);
      continue;
    }
    fs.mkdirSync(path.resolve(assetsRoot, videoId), { recursive: true });
    try {
      const pickedSec = await captureSlideFrame({ youtubeUrl, startSec: token.sec, endSec: token.endSec, outPath: assetPath });
      written.add(assetName);  // M3: record successful capture for post-loop prune
      const imgRef = `![${token.caption}](assets/${videoId}/${assetName})`;
      const escapedRaw = token.raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      result = result.replace(new RegExp(escapedRaw, 'g'), () => imgRef);
      slides.push({ startSec: token.sec, endSec: endComponent, pickedSec });
    } catch (err: unknown) {
      console.warn('[dig-slide-miss] capture failed for token', token.raw, ':', (err as Error).message);
      const escapedRaw2 = token.raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      result = result.replace(new RegExp(escapedRaw2, 'g'), () => '');
      usedNames.delete(assetName); // failed capture: free the name
    }
  }

  // M3: prune stale sectionId-* assets. Runs when at least one new asset was written
  // (normal re-dig) or when Gemini legitimately emitted ZERO tokens (empty re-dig,
  // handled in the short-circuit above). Does NOT prune when tokens were emitted but
  // ALL captures failed (written.size===0 && tokens.length>0) — that would wipe the
  // prior good set. The prefix `${sectionId}-` includes a trailing hyphen so section
  // 16 never matches section 160's files ('160-…'.startsWith('16-') is false).
  if (written.size > 0) {
    const pruneDir = path.resolve(assetsRoot, videoId);
    const prunePrefix = `${sectionId}-`;
    let pruneEntries: string[] = [];
    try { pruneEntries = fs.readdirSync(pruneDir); } catch { pruneEntries = []; }
    for (const name of pruneEntries) {
      if (name.startsWith(prunePrefix) && name.endsWith('.jpg') && !written.has(name)) {
        try { fs.unlinkSync(path.join(pruneDir, name)); } catch { /* ignore */ }
      }
    }
  }

  // Final safety net: strip any [[SLIDE:...]] that was never resolved to an
  // image (e.g. dropped as out-of-range, or malformed) so no raw token ships.
  return { markdown: stripUnresolvedSlideTokens(result), slides };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Remove any `[[SLIDE:...]]` token not already rewritten to `![](...)` — a token
 * the parser rejected (malformed, or a caption containing `]`) or one dropped as
 * out-of-range — so a raw token never renders as literal text. Resolved tokens
 * contain no `[[SLIDE:` prefix, so they are untouched.
 *
 * Uses a lazy `.*?` (not `[^\]]*`) so a caption with an embedded `]` cannot
 * defeat the strip; lazy stops at the first real `]]` delimiter. The negated-class
 * form would stop at the first inner `]` and leave the token behind (review I-1).
 * No `s` flag (es2018+) — captions are single-line phrases, never multi-line.
 */
function stripUnresolvedSlideTokens(markdown: string): string {
  return markdown.replace(/\[\[SLIDE:.*?\]\]/g, '');
}
