/**
 * Blank-line-pad every section-divider line (3+ dashes, optionally trailing whitespace) that sits
 * OUTSIDE a fenced code block, so CommonMark renders it as a thematic break (<hr>) rather than
 * promoting the preceding paragraph into a setext heading (the Obsidian "whole body bold" bug).
 *
 * Fence-aware: a `---` inside a ``` or ~~~ fence is literal content and is left untouched — a naive
 * `replace(/\n---/)` would corrupt embedded YAML/code samples. Idempotent. EOL-preserving (CRLF/LF).
 */
export function padDividers(body: string): string {
  // EOL heuristic: detected from the first CRLF occurrence and applied uniformly on rejoin;
  // mixed-EOL input is normalized to that EOL (not a concern for this project's LF/CRLF-uniform content).
  const eol = body.includes('\r\n') ? '\r\n' : '\n';
  const lines = body.split(/\r?\n/);

  // Pass 1 — mark divider line indices that are outside any fence.
  // Fence open/close must match BOTH the marker char AND length >= the opening run
  // (CommonMark rule, mirrors lib/html-doc/parse.ts) — otherwise ``` is wrongly closed by `.
  const dividers = new Set<number>();
  let fence: { char: string; len: number } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*(`{3,}|~{3,})/);
    if (m) {
      const run = m[1];
      const ch = run[0];
      if (!fence) fence = { char: ch, len: run.length };
      else if (ch === fence.char && run.length >= fence.len) fence = null;
      continue;
    }
    if (!fence && /^-{3,}\s*$/.test(lines[i])) dividers.add(i);
  }
  if (dividers.size === 0) return body;

  // Pass 2 — rebuild, ensuring exactly one blank line on each side of each marked divider.
  // Push the ORIGINAL divider line (preserves dash count, e.g. `-----`), never a literal `---`.
  const isBlank = (s: string | undefined) => s === undefined || s.trim() === '';
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (dividers.has(i)) {
      while (out.length && isBlank(out[out.length - 1])) out.pop();
      if (out.length) out.push('');
      out.push(lines[i]);
      let j = i + 1;
      while (j < lines.length && isBlank(lines[j])) j++;
      if (j < lines.length) out.push('');
      i = j - 1;
      continue;
    }
    out.push(lines[i]);
  }
  return out.join(eol);
}
