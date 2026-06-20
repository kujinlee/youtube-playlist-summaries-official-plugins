import type { ParsedSummary, ParsedSection, SectionTimeRange } from './types';
import { parseClockToSeconds } from '../transcript-timestamps';

function frontmatterField(md: string, key: string): string | null {
  const m = md.match(new RegExp(`^${key}:\\s*"?([^"\\n]*)"?\\s*$`, 'm'));
  return m?.[1]?.trim() ?? null;
}

/** True when a line opens or closes a fenced code block (``` or ~~~, with optional info string). */
function isFenceLine(line: string): boolean {
  return /^\s*(```|~~~)/.test(line);
}

// Matches a `▶ [label](url)` line. A line starting with `▶ ` that does NOT fully match is treated
// as malformed: still consumed (removed from prose) but yields a null time range.
const TS_LINE_RE = /^▶\s+\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)\s*$/;

function extractTimeRange(proseLines: string[]): SectionTimeRange | null {
  // Find the first non-blank prose line; only that line may carry the timestamp.
  const firstIdx = proseLines.findIndex((l) => l.trim() !== '');
  if (firstIdx === -1) return null;
  const line = proseLines[firstIdx];
  if (!line.trimStart().startsWith('▶')) return null;

  // Consume the ▶ line regardless of whether it is well-formed (don't leak it into prose).
  proseLines.splice(firstIdx, 1);

  const m = line.match(TS_LINE_RE);
  if (!m) return null; // malformed: consumed but no range
  const label = m[1];
  const url = m[2];
  const startMatch = url.match(/[?&]t=(\d+)s/);
  const startSec = startMatch ? parseInt(startMatch[1], 10) : NaN;
  if (Number.isNaN(startSec)) return null;
  const endRaw = label.split('–')[1] ?? ''; // en dash U+2013
  const endSec = parseClockToSeconds(endRaw);
  // If the label has no/invalid end clock, collapse the range to the start: the start-anchored
  // link is still useful (render shows the raw label + links to &t=startSec). Never discard it.
  return { startSec, endSec: Number.isNaN(endSec) ? startSec : endSec, label, url };
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
    const timeRange = extractTimeRange(current.proseLines); // mutates proseLines (removes ▶ line)
    const prose = current.proseLines.join('\n').trim();
    sections.push({ numeral, title, prose, timeRange });
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
