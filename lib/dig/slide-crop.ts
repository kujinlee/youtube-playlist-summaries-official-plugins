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
