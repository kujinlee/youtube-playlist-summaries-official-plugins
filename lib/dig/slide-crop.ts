export interface Trim { trimTop: number; trimBot: number }
export interface CropBox extends Trim { width: number; height: number }
export interface ComputeOpts { contentFrac?: number; padFrac?: number; minRetain?: number; minTrim?: number }

export const ALGO_VERSION = 1;
export const THR_TOP = 120;            // anchor on the bright heading
export const THR_BOT = 40;             // trim only near-pure-black
const CONTENT_FRAC = 0.004;            // row is "content" if >0.4% of pixels bright
const PAD_FRAC = 0.015;                // padding above/below the content band
const MIN_RETAIN = 0.30;               // kept band < 30% of H → no-op
const MIN_TRIM = 0.04;                 // total trim < 4% → no-op

/**
 * Derive a vertical trim from two per-row bright-fraction profiles.
 * topProfile (high threshold) locates the first bright row; botProfile
 * (low threshold) locates the last non-black row, so dim content/footer survive.
 * Returns trim fractions of height, or null (no-op) when uncertain.
 */
export function computeTrim(
  topProfile: number[],
  botProfile: number[],
  opts: ComputeOpts = {},
): Trim | null {
  const contentFrac = opts.contentFrac ?? CONTENT_FRAC;
  const padFrac = opts.padFrac ?? PAD_FRAC;
  const minRetain = opts.minRetain ?? MIN_RETAIN;
  const minTrim = opts.minTrim ?? MIN_TRIM;

  const H = topProfile.length;
  if (H === 0 || botProfile.length !== H) return null;

  let t = topProfile.findIndex((f) => f > contentFrac);
  if (t < 0) return null;                                   // nothing bright → no-op

  let b = -1;
  for (let i = H - 1; i >= 0; i--) { if (botProfile[i] > contentFrac) { b = i; break; } }
  if (b < 0) return null;

  const pad = Math.round(padFrac * H);
  t = Math.max(0, t - pad);
  b = Math.min(H - 1, b + pad);

  const keepH = b - t + 1;
  if (keepH / H < minRetain) return null;                   // suspect → no-op

  const trimTop = t / H;
  const trimBot = (H - 1 - b) / H;
  if (trimTop + trimBot < minTrim) return null;             // not worth it → no-op

  return { trimTop, trimBot };
}

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Native pixel dimensions via ffprobe. Throws on failure (callers fail closed). */
export async function imageDims(assetPath: string): Promise<{ width: number; height: number }> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'csv=s=x:p=0', assetPath,
  ]);
  const [w, h] = String(stdout).trim().split('x').map((n) => parseInt(n, 10));
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    throw new Error(`imageDims: bad output "${stdout}"`);
  }
  return { width: w, height: h };
}

/** Per-row fraction (0..1) of pixels brighter than `threshold`, length = image height. */
export async function profileRows(assetPath: string, threshold: number): Promise<number[]> {
  const vf =
    `format=gray,geq=lum='if(gte(lum(X\\,Y)\\,${threshold})\\,255\\,0)',scale=1:ih:flags=area`;
  const { stdout } = await execFileAsync('ffmpeg', [
    '-v', 'error', '-i', assetPath, '-vf', vf, '-f', 'rawvideo', '-pix_fmt', 'gray', '-',
  ], { encoding: 'buffer', maxBuffer: 1 << 24 });
  return Array.from(stdout as Buffer).map((v) => v / 255);
}

/** Resolve a crop box for one asset. Fail-closed: any error or length mismatch → null. */
export async function resolveCropBox(assetPath: string): Promise<CropBox | null> {
  let dims: { width: number; height: number };
  try { dims = await imageDims(assetPath); } catch { return null; }
  let top: number[];
  let bot: number[];
  try {
    [top, bot] = await Promise.all([
      profileRows(assetPath, THR_TOP),
      profileRows(assetPath, THR_BOT),
    ]);
  } catch { return null; }
  if (top.length !== dims.height || bot.length !== dims.height) return null;  // M1: fail closed
  const trim = computeTrim(top, bot);
  return trim ? { ...trim, width: dims.width, height: dims.height } : null;
}
