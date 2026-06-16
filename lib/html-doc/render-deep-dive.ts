import MarkdownIt from 'markdown-it';
import { themeStyleBlock, THEME_HEAD_SCRIPT, THEME_TOGGLE_BUTTON, THEME_TOGGLE_SCRIPT, type Palette } from './theme';

// html:false → raw HTML in the (Gemini-generated) markdown is escaped, not passed through.
// markdown-it's default validateLink already blocks javascript:/vbscript:/data: (non-image) hrefs.
const md = new MarkdownIt({ html: false });

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
  page: '#f3f4f6', card: '#fff', ink: '#1e1e22', h1: '#111', h2: '#5b46d6', h3: '#2a2540', h4: '#3a3550',
  link: '#5b46d6', hr: '#e6e6ea', strong: '#111', codebg: '#f5f4fb', preborder: '#e6e6ea', quote: '#6b7280',
  shadow: '0 1px 3px rgba(0,0,0,.07)',
};
const DARK: Palette = {
  page: '#0f1115', card: '#16181d', ink: '#d8dbe0', h1: '#f2f3f5', h2: '#a99bf0', h3: '#cfc9ec', h4: '#b9b4dc',
  link: '#a99bf0', hr: '#2a2d34', strong: '#f2f3f5', codebg: '#20222a', preborder: '#2a2d34', quote: '#9aa0ab',
  shadow: '0 1px 3px rgba(0,0,0,.5)',
};

const STRUCTURAL_CSS = `
*{box-sizing:border-box}
body{margin:0;background:var(--page);color:var(--ink);line-height:1.65;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",'Apple SD Gothic Neo','Malgun Gothic',Helvetica,Arial,sans-serif}
.dd{max-width:52rem;margin:0 auto;background:var(--card);padding:2.6rem 3rem 4rem;box-shadow:var(--shadow)}
html.theme-ready .dd{transition:background-color .2s,color .2s}
.dd h1{font-size:1.9rem;line-height:1.25;margin:.2em 0 .5em;color:var(--h1)}
.dd h2{font-size:1.4rem;margin:1.8em 0 .4em;color:var(--h2)}
.dd h3{font-size:1.18rem;margin:1.5em 0 .3em;color:var(--h3)}
.dd h4{font-size:1.02rem;margin:1.2em 0 .3em;color:var(--h4)}
.dd p{margin:.7em 0}
.dd a{color:var(--link)}
.dd ul,.dd ol{padding-left:1.4em}
.dd li{margin:.3em 0}
.dd hr{border:0;border-top:1px solid var(--hr);margin:1.6em 0}
.dd strong{color:var(--strong)}
.dd code{font-family:'SF Mono',Menlo,Monaco,Consolas,monospace;font-size:.88em;background:var(--codebg);padding:.1em .35em;border-radius:4px}
.dd pre{background:var(--codebg);border:1px solid var(--preborder);border-radius:8px;padding:1em;overflow:auto;line-height:1.4}
.dd pre code{background:none;padding:0;font-size:.85em;white-space:pre}
.dd blockquote{border-left:3px solid var(--h2);margin:1em 0;padding:.2em 1em;color:var(--quote)}
@media print{body{background:#fff}.dd{box-shadow:none}}
`;

/** Faithfully render a deep-dive markdown document into a self-contained HTML page. */
export function renderDeepDiveHtml(mdContent: string, sourceMd: string): string {
  const lang = (frontmatterField(mdContent, 'lang') ?? 'EN').toLowerCase();
  const videoId = frontmatterField(mdContent, 'video_id') ?? '';
  // Strip the leading YAML frontmatter block, then render the body faithfully.
  const body = mdContent.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  const title = body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? 'Deep Dive';
  const bodyHtml = md.render(body);

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
<style>${themeStyleBlock(LIGHT, DARK)}${STRUCTURAL_CSS}</style>
</head>
<body>
${THEME_TOGGLE_BUTTON}
<article class="dd">
${bodyHtml}</article>
${THEME_TOGGLE_SCRIPT}
</body>
</html>`;
}
