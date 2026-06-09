import type { ParsedSummary, ParsedSection } from './types';

function frontmatterField(md: string, key: string): string | null {
  const m = md.match(new RegExp(`^${key}:\\s*"?([^"\\n]*)"?\\s*$`, 'm'));
  return m?.[1]?.trim() ?? null;
}

/** True when a line opens or closes a fenced code block (``` or ~~~, with optional info string). */
function isFenceLine(line: string): boolean {
  return /^\s*(```|~~~)/.test(line);
}

function parseSections(body: string): ParsedSection[] {
  // Fence-aware, line-based split on H2 headings. A `## ` line inside a fenced
  // code block must NOT start a new section; dash dividers inside a fence must be
  // preserved verbatim in prose. The first chunk (before any ##) is preamble — discarded.
  const lines = body.split('\n');
  const sections: ParsedSection[] = [];
  let inFence = false;
  let current: { heading: string; proseLines: string[] } | null = null;

  const flush = () => {
    if (!current) return;
    const headingLine = current.heading.trim();
    const ord = headingLine.match(/^(\d+)\.\s+(.*)$/);
    const numeral = ord ? ord[1] : null;
    const title = ord ? ord[2].trim() : headingLine;
    const prose = current.proseLines.join('\n').trim();
    sections.push({ numeral, title, prose });
    current = null;
  };

  for (const line of lines) {
    if (isFenceLine(line)) {
      inFence = !inFence;
      if (current) current.proseLines.push(line);
      continue;
    }

    const heading = !inFence ? line.match(/^##\s+(.*)$/) : null;
    if (heading) {
      flush();
      current = { heading: heading[1], proseLines: [] };
      continue;
    }

    if (current) {
      // Drop pure-dash divider lines (3+ dashes, optional trailing ws) only when
      // OUTSIDE a fence — fenced content is preserved verbatim.
      if (!inFence && /^-{3,}\s*$/.test(line)) continue;
      current.proseLines.push(line);
    }
  }
  flush();
  return sections;
}

function parseCallout(md: string): { tldr: string | null; takeaways: string[] } {
  // Collect contiguous blockquote lines beginning the callout.
  const calloutMatch = md.match(/^> \[!summary\][^\n]*\n((?:>.*\n?)*)/m);
  if (!calloutMatch) return { tldr: null, takeaways: [] };
  const lines = calloutMatch[1].split('\n').map((l) => l.replace(/^>\s?/, ''));
  let tldr: string | null = null;
  const takeaways: string[] = [];
  let inTakeaways = false;
  for (const line of lines) {
    const tl = line.match(/^\*\*TL;DR:\*\*\s*(.*)$/);
    if (tl) { tldr = tl[1].trim(); continue; }
    if (/^\*\*Key Takeaways:\*\*/.test(line)) { inTakeaways = true; continue; }
    if (/^\*\*Concepts:\*\*/.test(line)) { inTakeaways = false; continue; }
    if (inTakeaways) {
      const b = line.match(/^-\s+(.*)$/);
      if (b) takeaways.push(b[1].trim());
    }
  }
  return { tldr, takeaways };
}

function parseChannel(md: string): string | null {
  // Capture everything between **Channel:** and the | **Duration:** delimiter, so
  // channel values that themselves contain " | " are not truncated.
  const delimited = md.match(/\*\*Channel:\*\*\s*(.+?)\s*\|\s*\*\*Duration:\*\*/m)?.[1]?.trim();
  if (delimited) return delimited;
  // Fallbacks: frontmatter channel: field, then the old single-pipe form.
  return frontmatterField(md, 'channel') ?? md.match(/\*\*Channel:\*\*\s*([^|]+?)\s*(?:\||$)/m)?.[1]?.trim() ?? null;
}

export function parseSummaryMarkdown(md: string): ParsedSummary {
  // Normalize CRLF → LF before any matching (Windows-authored notes otherwise drop takeaways).
  md = md.replace(/\r\n/g, '\n');

  const title = (md.match(/^#\s+(.+)$/m)?.[1] ?? '').trim();
  const channel = parseChannel(md);
  const duration = md.match(/\*\*Duration:\*\*\s*([^|]+?)\s*(?:\||$)/m)?.[1]?.trim() ?? null;
  const url = md.match(/\*\*URL:\*\*\s*(\S+)/m)?.[1]?.trim() ?? null;
  const lang = frontmatterField(md, 'lang') ?? 'EN';
  const videoId = frontmatterField(md, 'video_id');
  const { tldr, takeaways } = parseCallout(md);
  const sections = parseSections(md);
  if (sections.length === 0) {
    throw new Error('Cannot render HTML doc: summary has no sections (## headings required).');
  }
  // sourceMd is null here — the bare parser does not know the filename; the orchestrator sets it.
  return { title, channel, duration, url, lang, videoId, tldr, takeaways, sections, sourceMd: null };
}
