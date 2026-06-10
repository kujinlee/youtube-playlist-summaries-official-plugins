import MarkdownIt from 'markdown-it';

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

const CSS = `
*{box-sizing:border-box}
body{margin:0;background:#f3f4f6;color:#1e1e22;line-height:1.65;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",'Apple SD Gothic Neo','Malgun Gothic',Helvetica,Arial,sans-serif}
.dd{max-width:52rem;margin:0 auto;background:#fff;padding:2.6rem 3rem 4rem;box-shadow:0 1px 3px rgba(0,0,0,.07)}
.dd h1{font-size:1.9rem;line-height:1.25;margin:.2em 0 .5em;color:#111}
.dd h2{font-size:1.4rem;margin:1.8em 0 .4em;color:#5b46d6}
.dd h3{font-size:1.18rem;margin:1.5em 0 .3em;color:#2a2540}
.dd h4{font-size:1.02rem;margin:1.2em 0 .3em;color:#3a3550}
.dd p{margin:.7em 0}
.dd a{color:#5b46d6}
.dd ul,.dd ol{padding-left:1.4em}
.dd li{margin:.3em 0}
.dd hr{border:0;border-top:1px solid #e6e6ea;margin:1.6em 0}
.dd strong{color:#111}
.dd code{font-family:'SF Mono',Menlo,Monaco,Consolas,monospace;font-size:.88em;background:#f5f4fb;padding:.1em .35em;border-radius:4px}
.dd pre{background:#f5f4fb;border:1px solid #e6e6ea;border-radius:8px;padding:1em;overflow:auto;line-height:1.4}
.dd pre code{background:none;padding:0;font-size:.85em;white-space:pre}
.dd blockquote{border-left:3px solid #5b46d6;margin:1em 0;padding:.2em 1em;color:#6b7280}
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
<style>${CSS}</style>
</head>
<body>
<article class="dd">
${bodyHtml}</article>
</body>
</html>`;
}
