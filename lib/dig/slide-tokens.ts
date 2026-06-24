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
 * `sec` is the absolute second value (integer) from the token.
 * `caption` has already been sanitized and may be the empty string.
 */
export interface SlideToken {
  /** The full original token string, e.g. `[[SLIDE:312|Diagram]]`. */
  raw: string;
  /** Second offset (absolute integer). */
  sec: number;
  /** Sanitized caption, or `''` if no caption was present. */
  caption: string;
}

/** Grammar: captures (sec-digits, optional caption-text). */
const TOKEN_RE = /\[\[SLIDE:(\d+)(?:\|([^\]]*))?\]\]/g;

/**
 * Parse, validate, deduplicate, and cap SLIDE tokens found in `markdown`.
 *
 * Rules applied in order:
 * 1. Extract all tokens matching the grammar.
 * 2. Drop tokens whose `sec` is outside [startSec, endSec] (inclusive).
 * 3. Sanitize each caption via `sanitizeCaption`.
 * 4. Deduplicate by `sec` — first occurrence wins.
 * 5. Return at most 3 tokens (first 3 unique seconds, in document order).
 */
export function parseSlideTokens(
  markdown: string,
  startSec: number,
  endSec: number,
): SlideToken[] {
  const results: SlideToken[] = [];
  const seenSecs = new Set<number>();

  TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = TOKEN_RE.exec(markdown)) !== null) {
    if (results.length >= 3) break;

    const raw = match[0];
    const sec = parseInt(match[1], 10);
    // parseInt on a \d+ group is always a non-negative integer, but guard anyway.
    if (!Number.isFinite(sec) || sec < 0) continue;
    if (sec < startSec || sec > endSec) continue;
    if (seenSecs.has(sec)) continue;

    // caption is the text after the first '|'.  The grammar captures everything
    // up to the closing ']', so inner pipes are possible — sanitizeCaption
    // removes them.
    const rawCaption = match[2] ?? '';
    const caption = sanitizeCaption(rawCaption);

    seenSecs.add(sec);
    results.push({ raw, sec, caption });
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
