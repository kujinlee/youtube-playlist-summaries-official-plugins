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
  page: '#eef0f3', card: '#fbf9f6', ink: '#2a2622', rule: '#ece7df',
  ghost: '#f0e7d6', gold: '#b07700', goldline: '#e0a800', li: '#4a463f', foot: '#9a917f',
  shadow: '0 1px 3px rgba(0,0,0,.08)', link: '#b07700', h3: '#5b463a', h4: '#6b5a4a',
  codebg: '#f1ebe0', preborder: '#e6ddcf', quote: '#8a8276',
};
const DARK: Palette = {
  page: '#1a1714', card: '#221d18', ink: '#e8e2d6', rule: '#332c24',
  ghost: '#2e2820', gold: '#e6b54d', goldline: '#e0a800', li: '#cfc8ba', foot: '#8a8174',
  shadow: '0 1px 3px rgba(0,0,0,.5)', link: '#e6b54d', h3: '#d8cdb8', h4: '#c4b7a0',
  codebg: '#2a241c', preborder: '#332c24', quote: '#9a9082',
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
.dd h2 + p{font-size:1.12rem;line-height:1.55;color:var(--gold);font-weight:600;margin:.3em 0 .9em;max-width:92%}
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
