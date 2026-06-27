/**
 * Resolves `[[SLIDE:sec|caption]]` tokens in "dig deeper" section markdown
 * into markdown image references by downloading a section clip via yt-dlp
 * and extracting frames via ffmpeg.
 *
 * Security invariants:
 * - `videoId` is validated via `assertVideoId` (throws on traversal chars)
 *   BEFORE any exec call.
 * - `youtubeUrl` is always server-built from the validated videoId.
 * - `execFile` (argv array) is used exclusively — never `exec`/shell strings.
 * - Asset paths are containment-checked against `assetsRoot` before use.
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
function numEnv(name: string, def: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : def;
}

/** Scene-change sensitivity: ignore intra-slide animation, catch slide swaps. */
const SCENE_THRESHOLD = numEnv('DIG_SCENE_THRESHOLD', 0.4);
/** Fallback window length when no slide transition is detected (seconds). */
const MAX_WINDOW_SEC = numEnv('DIG_MAX_WINDOW_SEC', 8);
/** Frame sampling density within the window (frames per second). */
const SAMPLE_FPS = numEnv('DIG_SAMPLE_FPS', 2);

/**
 * Parse the first scene-change timestamp (seconds, relative to the window start)
 * from ffmpeg `showinfo` output. Returns `maxFallbackSec` when none is found or
 * the value is non-positive / non-finite.
 */
export function parseFirstSceneChange(ffmpegOutput: string, maxFallbackSec: number): number {
  const m = ffmpegOutput.match(/pts_time:([0-9]+(?:\.[0-9]+)?)/);
  if (!m) return maxFallbackSec;
  const t = Number(m[1]);
  return Number.isFinite(t) && t > 0 ? t : maxFallbackSec;
}

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
  videoId: string;
  startSec: number;
  endSec: number;
  assetsRoot: string;
  sectionId: number;
}

/**
 * Resolve all `[[SLIDE:sec|caption]]` tokens in `markdown` to markdown image
 * references pointing at extracted JPEG frames.
 *
 * - No tokens → returns `markdown` unchanged; no exec calls made.
 * - `videoId` validated (throws) before any exec.
 * - On ENOENT or non-zero exit from yt-dlp → all tokens stripped, text-only
 *   returned (no throw).
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

  // Temp clip path — directory created only once a valid token is confirmed
  // (just before yt-dlp download, below).
  const cacheDir = path.resolve('.cache');
  const tmpClip = path.join(cacheDir, `clip-${crypto.randomUUID()}.mp4`);

  let result = markdown;

  try {
    // Ensure .cache/ exists only now that we know we have tokens to process.
    fs.mkdirSync(cacheDir, { recursive: true });

    // Download the section clip once for all tokens.
    try {
      await execFileAsync('yt-dlp', [
        '--download-sections',
        `*${startSec}-${endSec}`,
        '-f',
        'bv[height<=720]',
        '-o',
        tmpClip,
        youtubeUrl,
      ]);
    } catch (err: unknown) {
      // ENOENT (binary missing) or non-zero exit (download gated / unavailable) →
      // strip all tokens and return text-only markdown.
      console.warn('[dig-slide-miss] yt-dlp failed — stripping all tokens:', (err as Error).message);
      return stripUnresolvedSlideTokens(markdown);
    }

    // Per-token frame extraction.
    for (const token of tokens) {
      const assetPath = resolveAssetPath(assetsRoot, videoId, sectionId, token.sec);

      // Containment guard: asset path must stay within assetsRoot.
      const resolvedRoot = path.resolve(assetsRoot);
      if (!assetPath.startsWith(resolvedRoot + path.sep)) {
        console.warn('[dig-slide-miss] asset path escaped assetsRoot — skipping token:', token.raw);
        result = result.replace(token.raw, '');
        continue;
      }

      // Create asset directory only after the containment check passes.
      const assetsDir = path.resolve(assetsRoot, videoId);
      fs.mkdirSync(assetsDir, { recursive: true });

      try {
        await execFileAsync('ffmpeg', [
          '-ss',
          String(token.sec - startSec),
          '-i',
          tmpClip,
          '-frames:v',
          '1',
          '-q:v',
          '2',
          assetPath,
        ]);

        // Rewrite token to markdown image reference.
        const imgRef = `![${token.caption}](assets/${videoId}/${sectionId}-${token.sec}.jpg)`;
        const escapedRaw = token.raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        result = result.replace(new RegExp(escapedRaw, 'g'), () => imgRef);
      } catch (err: unknown) {
        // Per-frame failure → drop that token, continue with remaining tokens.
        console.warn('[dig-slide-miss] ffmpeg failed for token', token.raw, ':', (err as Error).message);
        const escapedRaw2 = token.raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        result = result.replace(new RegExp(escapedRaw2, 'g'), () => '');
      }
    }
  } finally {
    // Always delete the temp clip, regardless of success or error.
    try {
      fs.unlinkSync(tmpClip);
    } catch {
      // Ignore cleanup errors (e.g. file never created if yt-dlp ENOENT).
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
