import type { ParsedSummary, ParsedSection } from './types';

function frontmatterField(md: string, key: string): string | null {
  const m = md.match(new RegExp(`^${key}:\\s*"?([^"\\n]*)"?\\s*$`, 'm'));
  return m?.[1]?.trim() ?? null;
}

function parseSections(body: string): ParsedSection[] {
  // Split on H2 headings. The first chunk (before any ##) is preamble — discarded.
  const parts = body.split(/^##\s+/m);
  const sections: ParsedSection[] = [];
  for (let i = 1; i < parts.length; i++) {
    const chunk = parts[i];
    const nl = chunk.indexOf('\n');
    const headingLine = (nl === -1 ? chunk : chunk.slice(0, nl)).trim();
    const rest = nl === -1 ? '' : chunk.slice(nl + 1);
    const ord = headingLine.match(/^(\d+)\.\s+(.*)$/);
    const numeral = ord ? ord[1] : null;
    const title = ord ? ord[2].trim() : headingLine;
    const prose = rest
      .split('\n')
      .filter((line) => !/^-{3,}\s*$/.test(line))   // drop divider lines (3+ dashes, optional trailing ws)
      .join('\n')
      .trim();
    sections.push({ numeral, title, prose });
  }
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

export function parseSummaryMarkdown(md: string): ParsedSummary {
  const title = (md.match(/^#\s+(.+)$/m)?.[1] ?? '').trim();
  const channel = md.match(/\*\*Channel:\*\*\s*([^|]+?)\s*(?:\||$)/m)?.[1]?.trim() ?? null;
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
