export interface CompletenessResult {
  complete: boolean;
  reason?: string;
  confidence?: 'high' | 'low';
}

// Ends on sentence punctuation, optionally + one closing quote/bracket. Bare ) : — , ; are NOT terminal.
const TERMINAL = /[.!?…。！？][)\]"”’」»]?$/;
const HR = /^([-*_])\1{2,}$/;                 // horizontal rule (already trimmed)
const FENCE_LINE = /^(`{3,}|~{3,})\s*$/;      // a line that is ONLY a fence marker
const FENCE_ANY = /^\s*(`{3,}|~{3,})/;        // any line opening/closing a fence
const TABLE_ROW = /^\|.*\|$/;
const URL_ONLY = /^<?https?:\/\/\S+>?$/;
const LINK_ONLY = /^!?\[[^\]]*\]\([^)]*\)$/;
const TRAILING_TS = /\[\[TS:\d+\]\]$/;

/** True if the doc is still inside an open code fence at EOF. Closer must match opener char-class and be ≥ its length. */
function fenceOpenAtEnd(lines: string[]): boolean {
  let opener: string | null = null;
  for (const raw of lines) {
    const m = FENCE_ANY.exec(raw);
    if (!m) continue;
    const marker = m[1];
    if (opener === null) opener = marker;
    else if (marker[0] === opener[0] && marker.length >= opener.length) opener = null; // valid close
    // else: inner fence of other style / shorter length → part of the block, ignore
  }
  return opener !== null;
}

/**
 * Inspect a summary .md body for truncation. Never throws (fails closed → reports suspicious).
 * The fingerprint: a completed prose summary ends its final section on sentence-terminating
 * punctuation. See docs/superpowers/specs/2026-06-30-summary-truncation-resilience-design.md.
 */
export function checkSummaryCompleteness(markdown: string): CompletenessResult {
  try {
    if (typeof markdown !== 'string') return { complete: false, reason: 'not a string', confidence: 'low' };
    const lines = markdown.split('\n');
    if ((markdown.match(/^## /gm) ?? []).length === 0) return { complete: false, reason: 'zero sections', confidence: 'high' };

    if (fenceOpenAtEnd(lines)) return { complete: false, reason: 'unterminated code fence', confidence: 'low' };

    let last = '';
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].trim() !== '') { last = lines[i].trim(); break; }
    }
    if (last === '') return { complete: false, reason: 'empty', confidence: 'high' };

    if (TRAILING_TS.test(last)) return { complete: false, reason: 'unresolved timestamp token', confidence: 'high' };
    // Genuinely-complete structural endings.
    if (HR.test(last) || FENCE_LINE.test(last)) return { complete: true };
    // Suspicious structural endings — flag low-confidence, do NOT blindly pass (spec §Fingerprint).
    if (TABLE_ROW.test(last) || URL_ONLY.test(last) || LINK_ONLY.test(last)) {
      return { complete: false, reason: 'ends on a structural line (table/URL/link)', confidence: 'low' };
    }
    if (TERMINAL.test(last)) return { complete: true };
    return { complete: false, reason: 'ends mid-sentence', confidence: 'high' };
  } catch {
    return { complete: false, reason: 'detector error', confidence: 'low' };
  }
}
