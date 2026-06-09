import type { ParsedSummary, MagazineModel } from './types';

const SERIF = `Georgia, 'Nanum Myeongjo', 'Apple SD Gothic Neo', 'Times New Roman', serif`;

const CSS = `
*{box-sizing:border-box}
body{margin:0;background:#eef0f3;color:#2a2622;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",'Apple SD Gothic Neo',Helvetica,Arial,sans-serif}
.v4{max-width:50rem;margin:0 auto;background:#fbf9f6;padding:2.8rem 3rem 4rem;box-shadow:0 1px 3px rgba(0,0,0,.08)}
.doc-title{font-family:${SERIF};font-size:2rem;line-height:1.2;margin:0 0 .15em}
.doc-meta{color:#8a8276;font-size:.9rem;margin:0 0 1.8em}
.callout{margin:0 0 2.4em;border-top:2px solid #e0a800;border-bottom:2px solid #e0a800;padding:1em 0}
.callout .lbl{color:#b07700;letter-spacing:.12em;text-transform:uppercase;font-size:.7rem;font-weight:700;margin-bottom:.5em}
.callout p{margin:.2em 0 .8em}
.callout ul{padding-left:1.1em;margin:.4em 0 0}
.callout li{margin:.25em 0}
section{position:relative;padding:1.6em 0 1.2em;border-bottom:1px solid #ece7df}
.ghost{font:700 4.5rem/1 Georgia,serif;color:#f0e7d6;position:absolute;right:0;top:.1em;pointer-events:none;user-select:none}
h2{font-family:${SERIF};font-size:1.3rem;margin:.1em 0 .35em}
.lead{font-size:1.12rem;line-height:1.5;color:#b07700;font-weight:600;margin:.2em 0 .8em;max-width:90%}
ul{padding-left:1.15em;margin:0}
li{margin:.4em 0;line-height:1.6;color:#4a463f}
footer{margin-top:2.5em;color:#9a917f;font-size:.8rem}
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
<style>${CSS}</style>
</head>
<body>
<article class="v4">
  <h1 class="doc-title">${esc(parsed.title)}</h1>
  <p class="doc-meta">${metaLine}</p>
  ${callout}
  ${sections}
  <footer>Skim view — generated from the source note${footerSource}. Full text lives in the source <code>.md</code>.</footer>
</article>
</body>
</html>`;
}
