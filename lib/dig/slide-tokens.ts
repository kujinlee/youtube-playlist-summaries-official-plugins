/**
 * Pure parser for `[[SLIDE:sec|caption]]` tokens emitted by Gemini in
 * "dig deeper" section prompts.
 *
 * Security note: captions are later interpolated into markdown image syntax
 * and HTML.  `sanitizeCaption` neutralises injection by stripping every
 * character that could close a markdown link/image construct or introduce
 * control data.
 */

/**
 * A single parsed and validated SLIDE token.
 * `sec` is the absolute second value (integer) from the token (slide start).
 * `endSec` is the absolute second value of the slide end, or null if absent.
 * `caption` has already been sanitized and may be the empty string.
 */
export interface SlideToken {
  /** The full original token string, e.g. `[[SLIDE:312|Diagram]]`. */
  raw: string;
  /** Second offset (absolute integer) — the slide start. */
  sec: number;
  /** Slide end second (absolute integer), or null if absent or invalid. */
  endSec: number | null;
  /** Sanitized caption, or `''` if no caption was present. */
  caption: string;
}

/**
 * Grammar: `[[SLIDE:<time>(|<end-time>)?(|caption)?]]`
 *
 * Time part pattern: `\d{1,2}:\d{1,2}(?::\d{1,2})?` matches clock forms with one
 * or two digits in ANY position — M:SS, MM:SS, H:MM:SS, HH:MM:SS, and tolerant
 * variants like M:S (`5:2`) or H:M:S (`1:2:3`). Gemini sometimes emits
 * non-zero-padded fields. The `|\d+` alternative matches a plain integer.
 * `clockToSeconds` interprets each colon-separated part positionally, so `5:2`
 * resolves to 5*60+2 = 302 (not 5:20) and `1:2:3` to 1*3600+2*60+3 = 3723.
 *
 * The end-time group uses `(?=\|)` lookahead so it ONLY matches in the
 * three-field form (start|end|caption). This prevents a numeric two-field
 * caption like `[[SLIDE:333|2024]]` from being mis-grabbed as an end: with no
 * trailing `|`, the lookahead fails and `2024` falls through to the caption group.
 */
const TOKEN_RE =
  /\[\[SLIDE:(\d{1,2}:\d{1,2}(?::\d{1,2})?|\d+)(?:\|(\d{1,2}:\d{1,2}(?::\d{1,2})?|\d+)(?=\|))?(?:\|([^\]]*))?\]\]/g;

/**
 * Convert a time string to integer absolute seconds.
 *
 * Accepts:
 * - Plain integer string: `"231"` → 231
 * - Clock M:SS or H:MM:SS: `"3:51"` → 231, `"1:02:05"` → 3725
 *
 * Returns NaN if the value is not parseable or is negative.
 */
function clockToSeconds(timeStr: string): number {
  if (!timeStr.includes(':')) {
    return parseInt(timeStr, 10);
  }
  const parts = timeStr.split(':').map((p) => parseInt(p, 10));
  if (parts.some((p) => !Number.isFinite(p) || p < 0)) return NaN;
  if (parts.length === 2) {
    // M:SS
    const [m, s] = parts;
    return m * 60 + s;
  }
  // H:MM:SS
  const [h, m, s] = parts;
  return h * 3600 + m * 60 + s;
}

/**
 * Parse, validate, deduplicate, and cap SLIDE tokens found in `markdown`.
 *
 * Rules applied in order:
 * 1. Extract all tokens matching the grammar.
 * 2. Convert the start time part to integer seconds via `clockToSeconds`.
 * 3. Drop tokens whose resolved `sec` is NaN, negative, or outside [windowStart, windowEnd].
 * 4. If an end time is present and parses as a number > sec, set `endSec` (clamped to windowEnd);
 *    otherwise `endSec` is null.
 * 5. Sanitize the caption via `sanitizeCaption`.
 * 6. Deduplicate by composite `(sec, endSec)` key — first occurrence wins.
 * 7. Return at most 5 tokens (first 5 unique (start, end) pairs, in document order).
 */
export function parseSlideTokens(
  markdown: string,
  windowStart: number,
  windowEnd: number,
): SlideToken[] {
  const results: SlideToken[] = [];
  const seen = new Set<string>();

  TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = TOKEN_RE.exec(markdown)) !== null) {
    if (results.length >= 5) break;

    const raw = match[0];
    const sec = clockToSeconds(match[1]);
    if (!Number.isFinite(sec) || sec < 0) continue;
    if (sec < windowStart || sec > windowEnd) continue;

    // match[2]: optional end-time field (only present in three-field form due to lookahead)
    let endSec: number | null = null;
    if (match[2] != null) {
      const e = clockToSeconds(match[2]);
      if (Number.isFinite(e) && e > sec) endSec = Math.min(e, windowEnd);
    }

    const key = `${sec}:${endSec ?? 'n'}`;
    if (seen.has(key)) continue;

    // match[3]: caption field (everything after the last '|' up to ']]')
    const caption = sanitizeCaption(match[3] ?? '');

    seen.add(key);
    results.push({ raw, sec, endSec, caption });
  }

  return results;
}

/**
 * Sanitize a raw caption string so it is safe to embed in markdown image
 * syntax (`![caption](url)`) and in HTML attribute values.
 *
 * Transformations applied:
 * - Strip `]`, `[`, `(`, `)`, `|`  — characters that close markdown constructs
 *   or split the SLIDE grammar.
 * - Replace newlines and ASCII control characters (0x00–0x1F, 0x7F) with a space.
 * - Collapse runs of whitespace to a single space and trim.
 * - Cap at 160 characters.
 */
export function sanitizeCaption(s: string): string {
  return s
    // Strip injection-risk punctuation.
    .replace(/[\]\[\(\)\|]/g, '')
    // Replace newlines and control characters with a space.
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    // Collapse whitespace runs.
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}
