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

  // Short-circuit: no tokens → no exec calls.
  if (tokens.length === 0) {
    return markdown;
  }

  // Build YouTube URL server-side from the validated videoId.
  const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;

  // Ensure assets directory exists.
  const assetsDir = path.resolve(assetsRoot, videoId);
  fs.mkdirSync(assetsDir, { recursive: true });

  // Write temp clip under .cache/.
  const cacheDir = path.resolve('.cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const tmpClip = path.join(cacheDir, `clip-${crypto.randomUUID()}.mp4`);

  let result = markdown;

  try {
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
      return stripAllTokens(markdown, tokens);
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
        result = result.replace(token.raw, imgRef);
      } catch (err: unknown) {
        // Per-frame failure → drop that token, continue with remaining tokens.
        console.warn('[dig-slide-miss] ffmpeg failed for token', token.raw, ':', (err as Error).message);
        result = result.replace(token.raw, '');
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

  return result;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function stripAllTokens(markdown: string, tokens: SlideToken[]): string {
  let result = markdown;
  for (const token of tokens) {
    result = result.replace(token.raw, '');
  }
  return result;
}

function resolveAssetPath(
  assetsRoot: string,
  videoId: string,
  sectionId: number,
  sec: number,
): string {
  return path.resolve(assetsRoot, videoId, `${sectionId}-${sec}.jpg`);
}
