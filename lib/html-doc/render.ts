import type { ParsedSummary, MagazineModel } from './types';
import { themeStyleBlock, THEME_HEAD_SCRIPT, THEME_TOGGLE_BUTTON, THEME_TOGGLE_SCRIPT, type Palette } from './theme';

const SERIF = `Georgia, 'Nanum Myeongjo', 'Apple SD Gothic Neo', 'Times New Roman', serif`;

const LIGHT: Palette = {
  page: '#eef0f3', card: '#fbf9f6', ink: '#2a2622', meta: '#8a8276', rule: '#ece7df',
  ghost: '#f0e7d6', gold: '#b07700', goldline: '#e0a800', li: '#4a463f', foot: '#9a917f',
  shadow: '0 1px 3px rgba(0,0,0,.08)',
};
const DARK: Palette = {
  page: '#1a1714', card: '#221d18', ink: '#e8e2d6', meta: '#9a9082', rule: '#332c24',
  ghost: '#2e2820', gold: '#e6b54d', goldline: '#e0a800', li: '#cfc8ba', foot: '#8a8174',
  shadow: '0 1px 3px rgba(0,0,0,.5)',
};

const STRUCTURAL_CSS = `
*{box-sizing:border-box}
body{margin:0;background:var(--page);color:var(--ink);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",'Apple SD Gothic Neo',Helvetica,Arial,sans-serif}
.v4{max-width:50rem;margin:0 auto;background:var(--card);padding:2.8rem 3rem 4rem;box-shadow:var(--shadow)}
html.theme-ready .v4{transition:background-color .2s,color .2s}
.doc-title{font-family:${SERIF};font-size:2rem;line-height:1.2;margin:0 0 .15em}
.doc-meta{color:var(--meta);font-size:.9rem;margin:0 0 1.8em}
.callout{margin:0 0 2.4em;border-top:2px solid var(--goldline);border-bottom:2px solid var(--goldline);padding:1em 0}
.callout .lbl{color:var(--gold);letter-spacing:.12em;text-transform:uppercase;font-size:.7rem;font-weight:700;margin-bottom:.5em}
.callout p{margin:.2em 0 .8em}
.callout ul{padding-left:1.1em;margin:.4em 0 0}
.callout li{margin:.25em 0}
section{position:relative;padding:1.6em 0 1.2em;border-bottom:1px solid var(--rule)}
.ghost{font:700 4.5rem/1 Georgia,serif;color:var(--ghost);position:absolute;right:0;top:.1em;pointer-events:none;user-select:none}
h2{font-family:${SERIF};font-size:1.3rem;margin:.1em 0 .35em}
.lead{font-size:1.12rem;line-height:1.5;color:var(--gold);font-weight:600;margin:.2em 0 .8em;max-width:90%}
ul{padding-left:1.15em;margin:0}
li{margin:.4em 0;line-height:1.6;color:var(--li)}
footer{margin-top:2.5em;color:var(--foot);font-size:.8rem}
@media print{body{background:#fff}.v4{box-shadow:none}}
`;

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderMagazineHtml(parsed: ParsedSummary, model: MagazineModel): string {
  const metaLine = [parsed.channel, parsed.duration].filter(Boolean).map((s) => esc(s as string)).join(' · ');

  const callout =
    parsed.tldr
      ? `<div class="callout">
    <div class="lbl">Quick Reference</div>
    <p>${esc(parsed.tldr)}</p>
    ${parsed.takeaways.length ? `<ul>${parsed.takeaways.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
  </div>`
      : '';

  const sections = parsed.sections
    .map((s, i) => {
      const m = model.sections[i];
      if (!m) return '';
      const ghost = s.numeral ? `<span class="ghost">${esc(s.numeral)}</span>` : '';
      const bullets = m.bullets
        .map((b) => `<li><strong>${esc(b.label)}:</strong> ${esc(b.text)}</li>`)
        .join('');
      return `<section>
      ${ghost}
      <h2>${esc(s.title)}</h2>
      <p class="lead">${esc(m.lead)}</p>
      <ul>${bullets}</ul>
    </section>`;
    })
    .join('\n');

  const sourceMd = parsed.sourceMd ?? '';
  const footerSource = sourceMd ? ` <code>${esc(sourceMd)}</code>` : '';

  return `<!DOCTYPE html>
<html lang="${esc((parsed.lang || 'en').toLowerCase())}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="magazine-skim v1">
<meta name="source-md" content="${esc(sourceMd)}">
<meta name="video-id" content="${esc(parsed.videoId ?? '')}">
<title>${esc(parsed.title)}</title>
${THEME_HEAD_SCRIPT}
<style>${themeStyleBlock(LIGHT, DARK)}${STRUCTURAL_CSS}</style>
</head>
<body>
${THEME_TOGGLE_BUTTON}
<article class="v4">
  <h1 class="doc-title">${esc(parsed.title)}</h1>
  <p class="doc-meta">${metaLine}</p>
  ${callout}
  ${sections}
  <footer>Skim view — generated from the source note${footerSource}. Full text lives in the source <code>.md</code>.</footer>
</article>
${THEME_TOGGLE_SCRIPT}
</body>
</html>`;
}
