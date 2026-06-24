import MarkdownIt from 'markdown-it';
import {
  themeStyleBlock, THEME_HEAD_SCRIPT, THEME_TOGGLE_BUTTON, THEME_TOGGLE_SCRIPT, PRINT_BUTTON,
  BASE_PALETTE_LIGHT_PRE, BASE_PALETTE_LIGHT_POST, BASE_PALETTE_DARK_PRE, BASE_PALETTE_DARK_POST,
  type Palette,
} from './theme';
import { digControl, startSecFromTsUrl, NAV_SCRIPT, NAV_CSS } from './nav';

// html:false → raw HTML in the (Gemini-generated) markdown is escaped, not passed through.
// markdown-it's default validateLink already blocks javascript:/vbscript:/data: (non-image) hrefs.
const md = new MarkdownIt({ html: false });

export interface RawSection {
  heading: string;
  lines: string[];
}

/** Fence-aware split of a deep-dive body into preamble + `## ` sections. */
export function splitSections(body: string): { preamble: string; sections: RawSection[] } {
  const lines = body.split('\n');
  const preambleLines: string[] = [];
  const sections: RawSection[] = [];
  let inFence = false;
  let current: RawSection | null = null;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      (current ? current.lines : preambleLines).push(line);
      continue;
    }
    const h = !inFence ? line.match(/^##\s+(.*)$/) : null;
    if (h) {
      if (current) sections.push(current);
      current = { heading: h[1].trim(), lines: [] };
      continue;
    }
    (current ? current.lines : preambleLines).push(line);
  }
  if (current) sections.push(current);
  return { preamble: preambleLines.join('\n'), sections };
}

// A `▶ [label](https url)` line (en dash U+2013 inside the label). Mirrors parse.ts TS_LINE_RE.
const TS_LINE_RE = /^▶\s+\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)\s*$/;

/**
 * Remove the leading `▶` line (first non-blank line of the section) and return its label+url.
 * Returns null when the first non-blank line is not a ▶ line, or when a ▶ line is malformed
 * (still consumed so it never leaks into prose). Mutates `lines`.
 */
export function extractTimestamp(lines: string[]): { label: string; url: string } | null {
  const firstIdx = lines.findIndex((l) => l.trim() !== '');
  if (firstIdx === -1) return null;
  const line = lines[firstIdx];
  if (!line.trimStart().startsWith('▶')) return null;
  lines.splice(firstIdx, 1); // consume regardless of well-formedness
  const m = line.match(TS_LINE_RE);
  if (!m) return null;
  return { label: m[1], url: m[2] };
}

/** Rewrite the first `**URL:** <https url>` header occurrence into a markdown link. */
export function linkifyHeaderUrl(body: string): string {
  return body.replace(
    /(\*\*URL:\*\*\s+)(https?:\/\/\S+)/,
    (_m, pre: string, url: string) => `${pre}[${url}](${url})`,
  );
}

// A line that opens a block-level construct (so it is not a prose lead paragraph).
const BLOCK_START_RE = /^\s*([-*+]\s|\d+\.\s|#{1,6}\s|>|\||`{3}|~{3})/;

/**
 * First prose paragraph (lines up to the next blank line) vs the remainder.
 * Returns para='' (and rest = all remaining content) when the first non-blank line opens a
 * block construct (list, heading, blockquote, fence, table) — no gold lead in that case.
 */
export function takeFirstParagraph(lines: string[]): { para: string; rest: string } {
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i++;
  if (i >= lines.length) return { para: '', rest: '' };
  if (BLOCK_START_RE.test(lines[i])) return { para: '', rest: lines.slice(i).join('\n') };
  let j = i;
  while (j < lines.length && lines[j].trim() !== '') j++;
  return { para: lines.slice(i, j).join('\n'), rest: lines.slice(j).join('\n') };
}

/** Split off the first sentence (terminator: . ! ? 。 ！ ？ + whitespace/end). */
export function splitFirstSentence(text: string): { first: string; rest: string } {
  const m = text.match(/^([\s\S]*?[.!?。！？])\s+([\s\S]*)$/);
  if (!m) return { first: text, rest: '' };
  return { first: m[1], rest: m[2] };
}

function frontmatterField(src: string, key: string): string | null {
  const m = src.match(new RegExp(`^${key}:\\s*"?([^"\\r\\n]*)"?\\s*$`, 'm'));
  return m?.[1]?.trim() ?? null;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const LIGHT: Palette = {
  ...BASE_PALETTE_LIGHT_PRE, ...BASE_PALETTE_LIGHT_POST, link: '#b07700', h3: '#5b463a', h4: '#6b5a4a',
  codebg: '#f1ebe0', preborder: '#e6ddcf', quote: '#8a8276', meta: '#8a8276',
};
const DARK: Palette = {
  ...BASE_PALETTE_DARK_PRE, ...BASE_PALETTE_DARK_POST, link: '#e6b54d', h3: '#d8cdb8', h4: '#c4b7a0',
  codebg: '#2a241c', preborder: '#332c24', quote: '#9a9082', meta: '#9a9082',
};

const STRUCTURAL_CSS = `
*{box-sizing:border-box}
body{margin:0;background:var(--page);color:var(--ink);line-height:1.7;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",'Apple SD Gothic Neo','Malgun Gothic',Helvetica,Arial,sans-serif}
.dd{max-width:52rem;margin:0 auto;background:var(--card);padding:2.8rem 3rem 4rem;box-shadow:var(--shadow);counter-reset:sec}
html.theme-ready .dd{transition:background-color .2s,color .2s}
.dd h1{font-family:Georgia,'Nanum Myeongjo','Apple SD Gothic Neo','Times New Roman',serif;font-size:2rem;line-height:1.2;margin:0 0 .15em;color:var(--ink)}
.dd h2{counter-increment:sec;position:relative;font-family:Georgia,'Nanum Myeongjo',serif;font-size:1.5rem;
  margin:2.2em 0 .35em;padding-top:1.5em;border-top:1px solid var(--rule);color:var(--ink)}
.dd h2:first-of-type{border-top:0;padding-top:0;margin-top:.4em}
.dd h2::before{content:counter(sec);position:absolute;right:0;top:.55em;font:700 4.2rem/1 Georgia,serif;
  color:var(--ghost);pointer-events:none;user-select:none}
.dd .lead{font-size:1.02rem;line-height:1.55;color:var(--ink);font-weight:400;margin:.3em 0 .9em;max-width:92%}
.dd .lead-accent{color:var(--gold);font-weight:400}
.dd .ts{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--meta);font-size:.85rem;font-weight:400;text-decoration:none;white-space:nowrap}
.dd .ts:hover{text-decoration:underline}
.dd h3{font-size:1.15rem;margin:1.6em 0 .3em;color:var(--h3)}
.dd h4{font-size:1.02rem;margin:1.2em 0 .3em;color:var(--h4)}
.dd p{margin:.75em 0;color:var(--ink)}
.dd a{color:var(--link)}
.dd ul,.dd ol{padding-left:1.4em;margin:.5em 0}
.dd li{margin:.4em 0;color:var(--li);line-height:1.65}
.dd strong{color:var(--ink);font-weight:700}
.dd blockquote{border-left:3px solid var(--goldline);margin:1.1em 0;padding:.2em 1.1em;color:var(--quote);font-style:italic}
.dd code{font-family:'SF Mono',Menlo,Monaco,Consolas,monospace;font-size:.88em;background:var(--codebg);padding:.1em .35em;border-radius:4px}
.dd pre{background:var(--codebg);border:1px solid var(--preborder);border-radius:8px;padding:1em 1.2em;overflow:auto;line-height:1.4}
.dd pre code{background:none;padding:0;font-size:.85em;white-space:pre}
.dd footer{margin-top:2.6em;padding-top:1.2em;border-top:1px solid var(--rule);color:var(--foot);font-size:.8rem}
@media print{body{background:#fff}.dd{box-shadow:none}#theme-toggle{display:none}}
`;

function tsAnchor(ts: { label: string; url: string } | null): string {
  return ts
    ? ` <a class="ts" href="${esc(ts.url)}" target="_blank" rel="noopener noreferrer">(${esc(ts.label)})</a>`
    : '';
}

/**
 * Render an H2 section's body: fence-aware split into `### ` subsections, folding each
 * subsection's leading ▶ into a muted .ts link trailing the <h3> (mirrors renderSection's H2).
 * Content before the first `### ` and all non-subsection prose render via md.render unchanged.
 */
function renderSubsections(rest: string): string {
  const lines = rest.split('\n');
  const preLines: string[] = [];
  const subs: { heading: string; lines: string[] }[] = [];
  let inFence = false;
  let current: { heading: string; lines: string[] } | null = null;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; (current ? current.lines : preLines).push(line); continue; }
    const h = !inFence ? line.match(/^###\s+(.*)$/) : null;
    if (h) { if (current) subs.push(current); current = { heading: h[1].trim(), lines: [] }; continue; }
    (current ? current.lines : preLines).push(line);
  }
  if (current) subs.push(current);

  const preHtml = preLines.join('\n').trim() ? md.render(preLines.join('\n')) : '';
  const subsHtml = subs.map((s) => {
    const subLines = [...s.lines];
    const ts = extractTimestamp(subLines);       // mutates subLines (removes leading ▶)
    const heading = `<h3>${md.renderInline(s.heading)}${tsAnchor(ts)}</h3>`;
    const bodyHtml = subLines.join('\n').trim() ? md.render(subLines.join('\n')) : '';
    return `${heading}\n${bodyHtml}`;
  }).join('\n');

  return [preHtml, subsHtml].filter(Boolean).join('\n');
}

function renderSection(raw: RawSection, hasSummary = false): string {
  const lines = [...raw.lines];
  const ts = extractTimestamp(lines); // mutates lines (removes the ▶ line)
  const tsHtml = tsAnchor(ts);
  const startSec = ts ? startSecFromTsUrl(ts.url) : null;
  const dataStart = startSec != null ? ` data-start="${startSec}"` : '';
  const dig = (hasSummary && startSec != null) ? digControl('summary', startSec) : '';
  const heading = `<h2${dataStart}>${md.renderInline(raw.heading)}${tsHtml}${dig}</h2>`;

  const { para, rest } = takeFirstParagraph(lines);
  let leadHtml = '';
  if (para) {
    const { first, rest: tail } = splitFirstSentence(para);
    const firstHtml = md.renderInline(first);
    const tailHtml = tail ? ` ${md.renderInline(tail)}` : '';
    leadHtml = `<p class="lead"><span class="lead-accent">${firstHtml}</span>${tailHtml}</p>`;
  }
  const restHtml = rest.trim() ? renderSubsections(rest) : '';
  return `${heading}\n${leadHtml}${restHtml}`;
}

/** Faithfully render a deep-dive markdown document into a self-contained HTML page. */
export function renderDeepDiveHtml(mdContent: string, sourceMd: string, hasSummary = false): string {
  const lang = (frontmatterField(mdContent, 'lang') ?? 'EN').toLowerCase();
  const videoId = frontmatterField(mdContent, 'video_id') ?? '';
  // Strip the leading YAML frontmatter block, normalize newlines, linkify the header URL.
  // linkifyHeaderUrl is a non-global replace, so only the FIRST `**URL:** <url>` is linked — that is
  // our standardized header line, which always precedes any body content/code fences in the .md.
  let body = mdContent.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').replace(/\r\n/g, '\n');
  body = linkifyHeaderUrl(body);
  const title = body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? 'Deep Dive';

  // Preamble (our H1 + meta + ---) renders faithfully; each `## ` section is restructured so the
  // ▶ timestamp trails the heading (muted) and gold lands only on the lead's first sentence.
  const { preamble, sections } = splitSections(body);
  const preambleHtml = md.render(preamble);
  const sectionsHtml = sections.map((s) => renderSection(s, hasSummary)).join('\n');
  const bodyHtml = `${preambleHtml}\n${sectionsHtml}`;

  return `<!DOCTYPE html>
<html lang="${esc(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="deep-dive-html v1">
<meta name="source-md" content="${esc(sourceMd)}">
<meta name="video-id" content="${esc(videoId)}">
<title>${esc(title)}</title>
${THEME_HEAD_SCRIPT}
<style>${themeStyleBlock(LIGHT, DARK)}${STRUCTURAL_CSS}${NAV_CSS}</style>
</head>
<body>
${THEME_TOGGLE_BUTTON}${PRINT_BUTTON}
<article class="dd">
${bodyHtml}</article>
${NAV_SCRIPT}${THEME_TOGGLE_SCRIPT}
</body>
</html>`;
}
