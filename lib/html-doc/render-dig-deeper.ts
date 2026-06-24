import fs from 'fs';
import path from 'path';
import MarkdownIt from 'markdown-it';
import type { RenderRuleRecord } from 'markdown-it/lib/renderer.mjs';
import {
  themeStyleBlock, THEME_HEAD_SCRIPT, THEME_TOGGLE_BUTTON, THEME_TOGGLE_SCRIPT, PRINT_BUTTON,
  BASE_PALETTE_LIGHT_PRE, BASE_PALETTE_LIGHT_POST, BASE_PALETTE_DARK_PRE, BASE_PALETTE_DARK_POST,
  type Palette,
} from './theme';
import { NAV_SCRIPT, NAV_CSS } from './nav';

// html:false → raw HTML in the markdown is escaped, not passed through.
// markdown-it's default validateLink already blocks javascript:/vbscript:/data: (non-image) hrefs.
const md = new MarkdownIt({ html: false });

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
.dg{max-width:52rem;margin:0 auto;background:var(--card);padding:2.8rem 3rem 4rem;box-shadow:var(--shadow)}
html.theme-ready .dg{transition:background-color .2s,color .2s}
.dg h1{font-family:Georgia,'Nanum Myeongjo','Apple SD Gothic Neo','Times New Roman',serif;font-size:2rem;line-height:1.2;margin:0 0 .15em;color:var(--ink)}
.dg h2{font-family:Georgia,'Nanum Myeongjo',serif;font-size:1.5rem;margin:2.2em 0 .35em;padding-top:1.5em;border-top:1px solid var(--rule);color:var(--ink)}
.dg h2:first-of-type{border-top:0;padding-top:0;margin-top:.4em}
.dg h3{font-size:1.15rem;margin:1.6em 0 .3em;color:var(--h3)}
.dg h4{font-size:1.02rem;margin:1.2em 0 .3em;color:var(--h4)}
.dg p{margin:.75em 0;color:var(--ink)}
.dg a{color:var(--link)}
.dg ul,.dg ol{padding-left:1.4em;margin:.5em 0}
.dg li{margin:.4em 0;color:var(--li);line-height:1.65}
.dg strong{color:var(--ink);font-weight:700}
.dg blockquote{border-left:3px solid var(--goldline);margin:1.1em 0;padding:.2em 1.1em;color:var(--quote);font-style:italic}
.dg code{font-family:'SF Mono',Menlo,Monaco,Consolas,monospace;font-size:.88em;background:var(--codebg);padding:.1em .35em;border-radius:4px}
.dg pre{background:var(--codebg);border:1px solid var(--preborder);border-radius:8px;padding:1em 1.2em;overflow:auto;line-height:1.4}
.dg pre code{background:none;padding:0;font-size:.85em;white-space:pre}
.dg img{max-width:100%;height:auto;border-radius:6px;margin:.75em 0;display:block}
.dg footer{margin-top:2.6em;padding-top:1.2em;border-top:1px solid var(--rule);color:var(--foot);font-size:.8rem}
@media print{body{background:#fff}.dg{box-shadow:none}#theme-toggle{display:none}}
`;

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Build a markdown-it instance with the image rule overridden to inline `assets/…` files as
 * base64 data URIs. The instance is created fresh per render call so the `mdPath` closure is
 * correct for each document.
 *
 * Decision (M-5): override the `image` renderer rule (not post-hoc HTML regex) so the inlining
 * happens at the token level. If the asset file is missing, drop the `<img>` entirely (return '')
 * so no broken relative src ever ships in the output.
 */
function buildRenderer(mdPath: string): MarkdownIt {
  const renderer = new MarkdownIt({ html: false });
  const docDir = path.dirname(mdPath);

  const rules = renderer.renderer.rules as RenderRuleRecord;
  rules.image = (tokens, idx) => {
    const token = tokens[idx];
    const srcAttr = token.attrGet('src') ?? '';
    const altAttr = token.children
      ? token.children.map((t) => t.content).join('')
      : (token.attrGet('alt') ?? '');

    // Only inline relative `assets/` paths; leave absolute URLs untouched.
    if (srcAttr.startsWith('assets/')) {
      const absPath = path.resolve(docDir, srcAttr);
      let data: Buffer | null = null;
      try {
        data = fs.readFileSync(absPath);
      } catch {
        // File missing — drop the <img> entirely (no broken relative src)
        return '';
      }
      const b64 = data.toString('base64');
      return `<img src="data:image/jpeg;base64,${b64}" alt="${esc(altAttr)}">`;
    }

    // Non-assets src: let markdown-it render normally but escape the src.
    return `<img src="${esc(srcAttr)}" alt="${esc(altAttr)}">`;
  };

  return renderer;
}

/**
 * Render a dig-deeper `.md` into a self-contained HTML page with slide screenshots inlined as
 * base64. Mirrors `renderDeepDiveHtml`'s CSS/theme/NAV pattern.
 *
 * @param mdContent  Raw markdown string (may include YAML frontmatter — stripped).
 * @param mdPath     Absolute path to the source `.md` file (used to resolve `assets/` images).
 */
export function renderDigDeeperHtml(mdContent: string, mdPath: string): string {
  const renderer = buildRenderer(mdPath);

  // Strip the leading YAML frontmatter block and normalize line endings.
  const body = mdContent
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
    .replace(/\r\n/g, '\n');

  const title = body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? 'Dig Deeper';
  const bodyHtml = renderer.render(body);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="dig-deeper-html v1">
<meta name="source-md" content="${esc(path.basename(mdPath))}">
<title>${esc(title)}</title>
${THEME_HEAD_SCRIPT}
<style>${themeStyleBlock(LIGHT, DARK)}${STRUCTURAL_CSS}${NAV_CSS}</style>
</head>
<body>
${THEME_TOGGLE_BUTTON}${PRINT_BUTTON}
<article class="dg">
${bodyHtml}</article>
${NAV_SCRIPT}${THEME_TOGGLE_SCRIPT}
</body>
</html>`;
}
