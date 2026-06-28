/**
 * Resolves `[[SLIDE:sec|end|caption]]` tokens in "dig deeper" section markdown
 * into markdown image references. Each token triggers one bounded yt-dlp download
 * of the slide's lifespan [startSec, min(endSec, startSec+MAX_CAPTURE_SEC)], then
 * frames are sampled at SAMPLE_FPS and the most-built (largest) frame is written
 * via `pickLargestFile`. Each token owns its own temp clip, which is always deleted
 * in `finally` regardless of success or error.
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

/** Return the path of the largest file in `dir`, or null if the dir has no files. */
export function pickLargestFile(dir: string): string | null {
  let best: string | null = null;
  let bestSize = -1;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isFile() && st.size > bestSize) {
      bestSize = st.size;
      best = p;
    }
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

/** Download exactly the slide's lifespan and write the most-built frame.
 *  Window = [startSec, min(endSec, startSec+MAX_CAPTURE_SEC)] when endSec is usable,
 *  else [startSec, startSec+DEFAULT_FWD]. SECURITY: trusts outPath — caller checks containment. */
async function captureSlideFrame(opts: {
  youtubeUrl: string; startSec: number; endSec: number | null; outPath: string;
}): Promise<void> {
  const { youtubeUrl, startSec, endSec, outPath } = opts;
  const cacheDir = path.resolve('.cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const rawEnd = endSec != null && endSec > startSec
    ? Math.min(endSec, startSec + MAX_CAPTURE_SEC)
    : startSec + DEFAULT_FWD;
  const winEnd = Math.max(rawEnd, startSec + 1);  // guard a degenerate window (e.g. DIG_DEFAULT_FWD="" → 0)

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
    const best = pickLargestFile(framesDir);
    if (!best) throw new Error('no frames sampled');
    fs.copyFileSync(best, outPath);
  } finally {
    fs.rmSync(framesDir, { recursive: true, force: true });
    try { fs.unlinkSync(clip); } catch { /* ignore */ }
  }
}

/**
 * Resolve all `[[SLIDE:sec|end|caption]]` tokens in `markdown` to markdown image
 * references pointing at extracted JPEG frames.
 *
 * - No tokens → returns `markdown` unchanged; no exec calls made.
 * - `videoId` validated (throws) before any exec.
 * - Per token: one bounded yt-dlp download; on failure the token is stripped.
 * - On per-frame ffmpeg failure → that token dropped, others kept.
 */
export async function resolveSlideTokens(
  markdown: string,
  opts: ResolveSlideTokensOpts,
): Promise<string> {
  const { videoId, startSec, endSec, assetsRoot, sectionId } = opts;

  // Always validate videoId first — throws on traversal chars or invalid format.
  assertVideoId(videoId);

  const tokens = parseSlideTokens(markdown, startSec, endSec);

  // Short-circuit: no resolvable tokens → no exec calls. Still strip any raw
  // [[SLIDE:...]] that the parser rejected (out-of-range / malformed) so it
  // never leaks into the rendered doc as literal text.
  if (tokens.length === 0) {
    return stripUnresolvedSlideTokens(markdown);
  }

  // Build YouTube URL server-side from the validated videoId.
  const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;

  let result = markdown;
  for (const token of tokens) {
    const assetPath = resolveAssetPath(assetsRoot, videoId, sectionId, token.sec);
    const resolvedRoot = path.resolve(assetsRoot);
    if (!assetPath.startsWith(resolvedRoot + path.sep)) {            // containment BEFORE any write
      console.warn('[dig-slide-miss] asset path escaped assetsRoot — skipping token:', token.raw);
      result = result.replace(token.raw, '');
      continue;
    }
    fs.mkdirSync(path.resolve(assetsRoot, videoId), { recursive: true });
    try {
      await captureSlideFrame({ youtubeUrl, startSec: token.sec, endSec: token.endSec, outPath: assetPath });
      const imgRef = `![${token.caption}](assets/${videoId}/${sectionId}-${token.sec}.jpg)`;
      const escapedRaw = token.raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      result = result.replace(new RegExp(escapedRaw, 'g'), () => imgRef);
    } catch (err: unknown) {
      console.warn('[dig-slide-miss] capture failed for token', token.raw, ':', (err as Error).message);
      const escapedRaw2 = token.raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      result = result.replace(new RegExp(escapedRaw2, 'g'), () => '');
    }
  }

  // Final safety net: strip any [[SLIDE:...]] that was never resolved to an
  // image (e.g. dropped as out-of-range, or malformed) so no raw token ships.
  return stripUnresolvedSlideTokens(result);
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

function resolveAssetPath(
  assetsRoot: string,
  videoId: string,
  sectionId: number,
  sec: number,
): string {
  return path.resolve(assetsRoot, videoId, `${sectionId}-${sec}.jpg`);
}
