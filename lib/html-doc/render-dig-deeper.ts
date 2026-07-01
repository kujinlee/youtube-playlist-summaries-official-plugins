import fs from 'fs';
import path from 'path';
import MarkdownIt from 'markdown-it';
import type { RenderRuleRecord } from 'markdown-it/lib/renderer.mjs';
import {
  themeStyleBlock, THEME_HEAD_SCRIPT, THEME_TOGGLE_BUTTON, THEME_TOGGLE_SCRIPT, PRINT_BUTTON,
  BASE_PALETTE_LIGHT_PRE, BASE_PALETTE_LIGHT_POST, BASE_PALETTE_DARK_PRE, BASE_PALETTE_DARK_POST,
  type Palette,
} from './theme';
import { digControl, NAV_SCRIPT, NAV_CSS } from './nav';
import type { ParsedSummary } from './types';
import type { ModelEnvelope } from './model-store';
import type { DugSection } from '../dig/companion-doc';
import type { CropBox } from '../dig/slide-crop';
import { mergeDigDoc } from './dig-merge';
import { buildWholeVideoPrompt, buildSectionPrompt, AI_PROVIDER } from '../ask-gemini';

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
.dg .lead{font-size:1.02rem;line-height:1.55;color:var(--gold);font-weight:400;margin:.3em 0 .9em;max-width:92%}
.dg .ts{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--meta);font-size:.85rem;font-weight:400;text-decoration:none;white-space:nowrap}
.dg .ts:hover{text-decoration:underline}
.dg h3{font-size:1.15rem;margin:1.6em 0 .3em;color:var(--h3)}
.dg .dug h3{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:1.12rem;font-weight:700;letter-spacing:.01em;margin:1.8em 0 .4em;color:var(--gold)}
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
@media print{body{background:#fff}.dg{box-shadow:none}#theme-toggle{display:none}.dg-zoom{display:none!important}}
.missing-slide{display:inline-block;color:var(--meta);font-style:italic;font-size:.85rem;padding:.15em .4em;border:1px dashed var(--rule);border-radius:4px}
`;

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Format a second offset as a clock label: "m:ss" (or "h:mm:ss" past an hour). */
function fmtClock(totalSec: number): string {
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60) % 60;
  const h = Math.floor(totalSec / 3600);
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/**
 * Build a markdown-it instance with the image rule overridden to inline `assets/…` files as
 * base64 data URIs. The instance is created fresh per render call so the `mdPath` closure is
 * correct for each document.
 *
 * Decision (M-5): override the `image` renderer rule (not post-hoc HTML regex) so the inlining
 * happens at the token level. If the asset file is missing, drop the `<img>` entirely (return '')
 * so no broken relative src ever ships in the output.
 *
 * Note: dig-deeper bodies use markdown timestamp LINKS like
 *   ▶ [11:00–21:19](https://www.youtube.com/watch?v=abc&t=660s)
 * (output of resolveTranscriptTokens), NOT raw inline <a data-t> HTML anchors.
 * markdown-it renders these markdown links to <a href="...t=660s..."> anchors normally,
 * so html:false (which escapes raw HTML) does not affect timestamp link rendering.
 */
function buildRenderer(mdPath: string, cropMap: Map<string, CropBox | null>): MarkdownIt {
  const renderer = new MarkdownIt({ html: false });
  const docDir = path.dirname(mdPath);
  // assetsRoot is the only directory from which images may be inlined.
  const assetsRoot = path.resolve(docDir, 'assets');

  const rules = renderer.renderer.rules as RenderRuleRecord;
  rules.image = (tokens, idx) => {
    const token = tokens[idx];
    const srcAttr = token.attrGet('src') ?? '';
    const altAttr = token.children
      ? token.children.map((t) => t.content).join('')
      : (token.attrGet('alt') ?? '');

    if (srcAttr.startsWith('assets/')) {
      const absPath = path.resolve(docDir, srcAttr);
      // Containment check: resolved path must stay inside assetsRoot.
      // Blocks traversal like assets/../../etc/passwd (passes the startsWith('assets/')
      // prefix test but resolves outside the doc's assets dir → arbitrary file disclosure).
      // SECURITY-CRITICAL: containment violation → silent drop (no placeholder, no
      // attacker-controlled alt text in the output).
      if (!absPath.startsWith(assetsRoot + path.sep)) return '';
      let data: Buffer | null = null;
      try {
        data = fs.readFileSync(absPath);
      } catch {
        // Benign missing file — visible placeholder, UNCHANGED (no figure/figcaption).
        return `<span class="missing-slide">${esc(altAttr)}</span>`;
      }
      const b64 = data.toString('base64');
      const box = cropMap.get(absPath) ?? null;
      // figcaption only when a caption is present (empty caption is a supported state).
      const cap = altAttr ? `<figcaption class="dig-cap">${esc(altAttr)}</figcaption>` : '';
      let inner: string;
      if (box) {
        const keepFrac = 1 - box.trimTop - box.trimBot;
        const keepH = Math.round(box.height * keepFrac);
        const posPct = (box.trimTop / (box.trimTop + box.trimBot)) * 100;
        const cropStyle = `aspect-ratio:${box.width} / ${keepH}`;
        inner = `<div class="dig-slide-crop" style="${cropStyle}">` +
                `<img class="dig-slide" style="object-position:0 ${posPct.toFixed(1)}%" ` +
                `src="data:image/jpeg;base64,${b64}" alt="${esc(altAttr)}"></div>`;
      } else {
        inner = `<img class="dig-slide" src="data:image/jpeg;base64,${b64}" alt="${esc(altAttr)}">`;
      }
      return `<figure class="dig-slide-fig">${inner}${cap}</figure>`;
    }

    // Non-assets src (external URL): rendered escaped, but intentionally NOT a
    // .dig-slide — external images keep default sizing and are not zoomable
    // (only inlined slide assets get the size cap + click-to-zoom).
    return `<img src="${esc(srcAttr)}" alt="${esc(altAttr)}">`;
  };

  return renderer;
}

// ── Dig-deeper merge renderer CSS additions (Task 6) ─────────────────────────
const DIG_DOC_CSS = `
section{padding:2.4em 0;border-top:2px solid var(--rule)}
section:first-of-type{border-top:0}
.dig-slide-fig{margin:2em auto;max-width:100%}
.dg img.dig-slide{display:block;margin:0 auto;max-width:100%;max-height:calc(300px * var(--dig-slide-scale, 1));border:1px solid var(--rule);cursor:zoom-in}
.dg .dig-slide-crop{display:block;margin:0 auto;overflow:hidden;width:min(100%, calc(540px * var(--dig-slide-scale, 1)));border:1px solid var(--rule);border-radius:6px}
.dg .dig-slide-crop>img.dig-slide{display:block;width:100%;height:100%;max-height:none;margin:0;border:0;border-radius:0;object-fit:cover;cursor:zoom-in}
.dig-cap{margin:.5em auto 0;text-align:center;font-size:.8rem;color:var(--meta);line-height:1.4}
.dg .dig-trigger,.dg .dig-toggle,.dg .dig-refresh{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--meta);font-size:.8rem;font-weight:400;text-decoration:none;white-space:nowrap;cursor:pointer}
.dg .dig-trigger:hover,.dg .dig-toggle:hover,.dg .dig-refresh:hover{text-decoration:underline}
section[data-dug="true"] .gist{display:none}
section[data-dug="true"] .dug{display:block}
section[data-dug="true"].show-gist .gist{display:block}
section[data-dug="true"].show-gist .dug{display:none}
.dg-topbar{display:flex;flex-wrap:wrap;align-items:center;gap:1em;margin-bottom:1.6em;font-size:.85rem}
.dg-expand-all{background:none;border:1px solid var(--rule);border-radius:4px;padding:.2em .6em;cursor:pointer;font-size:.85rem;color:var(--meta)}
.dg-orphans{margin-top:3em;padding-top:1.5em;border-top:2px dashed var(--rule)}
.dg-orphan-note{font-size:.82rem;color:var(--meta);font-style:italic}
#_dg-ea-dlg{display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9000;align-items:center;justify-content:center}
#_dg-ea-dlg[data-open]{display:flex}
#_dg-ea-prog{display:none;position:fixed;left:0;right:0;bottom:0;z-index:9000}
#_dg-ea-prog[data-open]{display:block}
._dg-bar{display:flex;flex-wrap:wrap;align-items:center;gap:.6em 1em;background:var(--card,#fff);border-top:1px solid var(--rule);padding:.7em 1.2em;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:.9rem;color:var(--ink);box-shadow:0 -2px 12px rgba(0,0,0,.12);max-height:40vh;overflow-y:auto}
._dg-bar #_dg-ea-prog-msg{flex:1 1 12rem;min-width:0;margin:0}
._dg-bar #_dg-ea-fail-msg{flex:1 1 100%;min-width:0;margin:0}
._dg-bar button{flex:0 0 auto;padding:.3em .9em;border-radius:4px;font-size:.85rem;cursor:pointer;border:1px solid var(--rule)}
._dg-box{background:var(--card,#fff);border-radius:8px;padding:1.6em 2em;max-width:28rem;width:90%;box-shadow:0 4px 24px rgba(0,0,0,.18);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
._dg-box p{margin:.4em 0 1.2em;font-size:.95rem;color:var(--ink)}
._dg-box button{padding:.3em .9em;border-radius:4px;font-size:.88rem;cursor:pointer;border:1px solid var(--rule)}
#_dg-ea-confirm{background:var(--link,#b07700);color:#fff;border-color:transparent;margin-right:.6em}
#_dg-ea-cancel-dlg,#_dg-ea-cancel-prog{background:none;color:var(--meta)}
.dg-zoom{display:none;position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:9500;flex-direction:column;align-items:center;justify-content:center;cursor:zoom-out}
.dg-zoom[data-open]{display:flex}
.dg-zoom img{max-width:95vw;max-height:95vh;object-fit:contain;border-radius:4px}
.dg-zoom-close{position:fixed;top:1rem;right:1.2rem;font-size:1.6rem;line-height:1;color:#fff;background:none;border:none;cursor:pointer;z-index:9501}
.dg-zoom-cap{display:none;color:#fff;font-size:.85rem;line-height:1.4;margin-top:1rem;max-width:95vw;text-align:center}
.dg .ask-ai{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--meta);font-size:.8rem;font-weight:400;text-decoration:none;white-space:nowrap;cursor:pointer}
.dg .ask-ai:hover{text-decoration:underline}
#_dg-ai-toast{display:none;position:fixed;left:50%;bottom:1.4rem;transform:translateX(-50%);z-index:9600;background:var(--card,#222);color:var(--ink,#fff);border:1px solid var(--rule);border-radius:6px;padding:.5em .9em;font-size:.85rem;box-shadow:0 4px 18px rgba(0,0,0,.2)}
#_dg-ai-toast[data-show]{display:block}
.dg-size{display:inline-flex;align-items:center;gap:.3em;color:var(--meta);font-size:.85rem}
.dg-size button{background:none;border:1px solid var(--rule);border-radius:4px;cursor:pointer;color:var(--meta);font-size:.85rem;line-height:1;padding:.15em .45em}
.dg-size-range{width:7rem;flex:0 0 auto}
.dg-size-val{min-width:3.2em;text-align:center;flex:0 0 auto}
.dg-caps-toggle{background:none;border:1px solid var(--rule);border-radius:4px;cursor:pointer;color:var(--meta);font-size:.85rem;line-height:1;padding:.2em .6em}
.dg-hide-caps .dig-cap{display:none}
/* print base-size is enforced by the element-level overrides above; the scale var is intentionally NOT reset via @media because the size script's inline style on documentElement outranks an @media :root rule */
@media print{.dg-size{display:none!important}.dg-caps-toggle{display:none!important}.dg img.dig-slide{max-height:300px}.dg .dig-slide-crop{width:min(100%,540px)}}
`;

// Shared sanitizer — used verbatim in both SIZE_HEAD_SCRIPT (head) and sizeScript (body) to avoid duplication.
export const DIG_SLIDE_SANITIZE_JS = "function s(raw){if(raw==null){return 100;}if(typeof raw==='string'&&raw.trim()===''){return 100;}var n=Number(raw);if(!Number.isFinite(n)){return 100;}n=Math.round(n/10)*10;return Math.min(150,Math.max(50,n));}";

// Pre-paint: set --dig-slide-scale from sanitized localStorage BEFORE first paint (no FOUC).
const SIZE_HEAD_SCRIPT = `<script>(function(){try{${DIG_SLIDE_SANITIZE_JS}` +
  `var v=s(localStorage.getItem('digSlideScale'));` +
  `document.documentElement.style.setProperty('--dig-slide-scale',v/100);` +
  `}catch(e){}})();</script>`;

// Shared captions sanitizer — used in both CAPTIONS_HEAD_SCRIPT (head) and captionsScript (body).
export const DIG_CAPTIONS_SANITIZE_JS = "function c(raw){return raw==='off'?'off':'on';}";

// Pre-paint: hide captions BEFORE first paint when stored 'off' (no FOUC). Default shown.
const CAPTIONS_HEAD_SCRIPT = `<script>(function(){try{${DIG_CAPTIONS_SANITIZE_JS}` +
  `if(c(localStorage.getItem('digCaptions'))==='off'){document.documentElement.classList.add('dg-hide-caps');}` +
  `}catch(e){}})();</script>`;

/**
 * Render a dig-deeper doc using the structured merge result (Task 6).
 *
 * Takes structured summary + model data (rather than a raw .md string) and
 * emits a full HTML page where each MergedSection is rendered with its gist
 * and/or dug-content in the correct state.
 *
 * This is the sole public render function — renderDigDeeperHtml was removed in Task 9.
 */
export function renderDigDeeperDoc(args: {
  summary: ParsedSummary;
  envelope: ModelEnvelope | null;
  dug: DugSection[];
  mdPath: string;
  videoId: string;
  language?: 'en' | 'ko';
  cropMap?: Map<string, CropBox | null>;
}): string {
  const { summary, envelope, dug, mdPath, videoId, language = 'en', cropMap = new Map<string, CropBox | null>() } = args;
  const renderer = buildRenderer(mdPath, cropMap);

  const { sections, orphans } = mergeDigDoc(summary, envelope, dug);

  const title = summary.title;

  // ── Ask-AI (Feature 2) ─────────────────────────────────────────────────────
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  // An .ask-ai anchor: data-ai-prompt is HTML-attribute-escaped (NOT percent-encoded)
  // so the clipboard receives the literal prompt; data-ai-url percent-encodes the
  // prompt INSIDE the gemini URL (then attribute-escapes the whole URL).
  const askAi = (prompt: string, label: string): string =>
    `<a class="ask-ai" data-ai-prompt="${esc(prompt)}" data-ai-url="${esc(AI_PROVIDER.buildUrl(prompt))}">${label}</a>`;

  // Determine the first section that has a startSec for the top-bar back-link.
  const firstStartSec = sections.find((s) => s.startSec !== null)?.startSec ?? null;

  // ── Top bar ──────────────────────────────────────────────────────────────
  const summaryLink = firstStartSec !== null
    ? digControl('summary', firstStartSec)
    : `<a class="dig" data-type="summary">↑ summary</a>`;
  const wholeAsk = askAi(buildWholeVideoPrompt(videoUrl, language), '💬 Ask AI about this video');
  const sizeControl = `<span class="dg-size" role="group" aria-label="Slide image size">` +
    `<button class="dg-size-dec" type="button" aria-label="Smaller slides">−</button>` +
    `<input class="dg-size-range" type="range" min="50" max="150" step="10" value="100" aria-label="Slide image size percent">` +
    `<button class="dg-size-inc" type="button" aria-label="Larger slides">+</button>` +
    `<button class="dg-size-val" type="button" aria-label="Reset slide image size to 100%">100%</button></span>`;
  const capsControl = `<button class="dg-caps-toggle" type="button" aria-pressed="true" aria-label="Toggle slide captions">▣ captions</button>`;
  const topBar = `<div class="dg-topbar">${summaryLink} <button class="dg-expand-all">⤢ expand all</button> ${wholeAsk} ${sizeControl} ${capsControl}</div>`;

  // ── Sections ──────────────────────────────────────────────────────────────
  const sectionsHtml = sections.map((ms, i) => {
    const { startSec, title: sectionTitle, gist, dug: dugData } = ms;
    const isDug = dugData !== null;

    // section open tag — omit data-start when startSec is null
    const startAttr = startSec !== null ? ` data-start="${startSec}"` : '';
    const dugAttr = ` data-dug="${isDug}"`;
    const sectionOpen = `<section${startAttr}${dugAttr}>`;

    // heading text: numeral prefix in front of the title (shown once, in the heading itself).
    const headingText = ms.numeral ? `${ms.numeral}. ${sectionTitle}` : sectionTitle;
    // muted ts link (when startSec known): just the clickable play timestamp — no title repeat.
    const tsLink = startSec !== null
      ? ` <a class="ts" href="https://www.youtube.com/watch?v=${esc(videoId)}&amp;t=${startSec}s" target="_blank" rel="noopener noreferrer">▶ (${fmtClock(startSec)})</a>`
      : '';
    // control: un-dug (with startSec) → dig-trigger; dug → dig-toggle (+ dig-refresh if stale); no startSec → neither
    let control = '';
    if (isDug) {
      control = ` <a class="dig-toggle">show summary ⌃</a>`;
      if (ms.isStale && startSec !== null) {
        control += ` <a class="dig-refresh" data-section="${startSec}">↻ outdated</a>`;
      }
    } else if (startSec !== null) {
      control = ` <a class="dig-trigger" data-section="${startSec}">dig deeper ▶</a>`;
    }

    // Section Ask-AI (independent of dug state): end = the next section's start,
    // or null → "onward" for the last/untimed-tail section.
    if (startSec !== null) {
      const endSec = sections.slice(i + 1).find((s) => s.startSec !== null)?.startSec ?? null;
      control += ` ${askAi(buildSectionPrompt(videoUrl, startSec, endSec, language), '💬 ask AI')}`;
    }

    const heading = `<h2>${esc(headingText)}${tsLink}${control}</h2>`;

    // .gist block — only when gist != null (skeleton → omit)
    let gistHtml = '';
    if (gist !== null) {
      const leadHtml = `<p class="lead">${esc(gist.lead)}</p>`;
      const bulletsHtml = gist.bullets.map((b) => `<li>${esc(b.text)}</li>`).join('');
      gistHtml = `<div class="gist">${leadHtml}<ul>${bulletsHtml}</ul></div>`;
    }

    // .dug block — only when dug matched
    let dugHtml = '';
    if (dugData !== null) {
      const rendered = renderer.render(dugData.bodyMarkdown);
      dugHtml = `<div class="dug">${rendered}</div>`;
    }

    return `${sectionOpen}\n${heading}${gistHtml}${dugHtml}\n</section>`;
  }).join('\n');

  // ── Orphan region ─────────────────────────────────────────────────────────
  let orphansHtml = '';
  if (orphans.length > 0) {
    const orphanItems = orphans.map((o) => {
      const rendered = renderer.render(o.bodyMarkdown);
      return [
        `<h3>${esc(o.title)}</h3>`,
        `<div class="dug">${rendered}</div>`,
        `<p class="dg-orphan-note">This section was dug but could not be matched to a current summary section. Re-dig to regenerate.</p>`,
        `<!-- orphan: ${o.sectionId} -->`,
      ].join('\n');
    }).join('\n');
    orphansHtml = `\n<section class="dg-orphans"><h2>Unmapped dug sections</h2>\n${orphanItems}\n</section>`;
  }

  const bodyHtml = `${topBar}\n${sectionsHtml}${orphansHtml}`;

  // ── Expand-all dialog + progress overlay (Task 12) ───────────────────────
  const expandAllDialogs = `
<div id="_dg-ea-dlg" role="dialog" aria-modal="true" aria-labelledby="_dg-ea-msg">
  <div class="_dg-box">
    <p id="_dg-ea-msg"></p>
    <button id="_dg-ea-confirm">Confirm</button>
    <button id="_dg-ea-cancel-dlg">Cancel</button>
  </div>
</div>
<div id="_dg-ea-prog" role="region" aria-label="Expand-all progress">
  <div class="_dg-bar">
    <span id="_dg-ea-prog-msg" role="status" aria-live="polite">Starting…</span>
    <span id="_dg-ea-fail-msg" aria-live="polite" style="color:#c00;display:none"></span>
    <button id="_dg-ea-cancel-prog">Cancel</button>
  </div>
</div>`;

  // ── Slide zoom lightbox (Feature 1) ──────────────────────────────────────
  // The <img> is created in JS (not static markup) so the page shell carries no
  // <img> of its own — existing image-rule tests assert on whole-doc <img>
  // presence/count and must see only rendered slide images.
  const zoomOverlay = `
<div class="dg-zoom" id="_dg-zoom" role="dialog" aria-modal="true" aria-label="Enlarged slide">
  <button class="dg-zoom-close" id="_dg-zoom-close" aria-label="Close">✕</button>
  <div class="dg-zoom-cap" id="_dg-zoom-cap"></div>
</div>`;

  // ES5-plain to match NAV_SCRIPT. Click delegation on document so dynamically
  // dug sections are covered. Esc no-ops unless the lightbox is open, so it
  // never interferes with the expand-all dialog's own Esc handler (nav.ts).
  const zoomScript = `<script>(function(){
  var ov=document.getElementById('_dg-zoom');
  if(!ov)return;
  var cap=document.getElementById('_dg-zoom-cap');
  // img is inserted BEFORE the caption node so the overlay stacks img-over-caption (flex column).
  var im=document.createElement('img');im.id='_dg-zoom-img';im.alt='';ov.insertBefore(im,cap);
  // close() fully resets the caption; because any click while open closes first, opening a
  // different slide is always a fresh open (consecutive-slide zoom = two clicks: close, then open).
  function close(){ov.removeAttribute('data-open');im.removeAttribute('src');if(cap){cap.textContent='';cap.style.display='none';}}
  document.addEventListener('click',function(e){
    var t=e.target;
    if(t&&t.classList&&t.classList.contains('dig-slide')){
      im.src=t.getAttribute('src');im.alt=t.getAttribute('alt')||'';
      if(cap){
        var fig=t.closest?t.closest('.dig-slide-fig'):null;
        var capEl=fig?fig.querySelector('.dig-cap'):null;
        var txt=capEl?capEl.textContent:'';
        cap.textContent=txt||'';
        cap.style.display=(txt&&!document.documentElement.classList.contains('dg-hide-caps'))?'block':'none';
      }
      ov.setAttribute('data-open','');return;
    }
    if(ov.hasAttribute('data-open')){close();} // when open the overlay covers the viewport → any click (backdrop, image, or ✕) closes, matching the zoom-out cursor
  });
  document.addEventListener('keydown',function(e){
    if(e.key==='Escape'&&ov.hasAttribute('data-open')){close();}
  });
})();</script>`;

  // ── Ask-AI toast + launcher (Feature 2) ──────────────────────────────────
  // Third independent document-level click handler (with nav's .dg-scoped one and
  // zoomScript's): isolated by closest('.ask-ai'), so they coexist by design.
  const aiToast = `<div id="_dg-ai-toast" role="status"></div>`;

  const askAiScript = `<script>(function(){
  var toast=document.getElementById('_dg-ai-toast');
  function show(m){if(!toast)return;toast.textContent=m;toast.setAttribute('data-show','');setTimeout(function(){toast.removeAttribute('data-show');},2500);}
  document.addEventListener('click',function(e){
    var a=e.target&&e.target.closest?e.target.closest('.ask-ai'):null;
    if(!a)return;
    e.preventDefault();
    var p=a.getAttribute('data-ai-prompt')||'',u=a.getAttribute('data-ai-url')||'';
    if(u){
      // Open Gemini as a resizable popup window on the right (uses the real
      // gemini.google.com + the user's subscription — a top-level window, not an
      // embeddable frame). No noopener: some browsers ignore the size/position
      // features when it is set, and we want a usable handle. The opener back-ref
      // is then severed best-effort (Gemini is trusted; this doc has no sensitive
      // state). If the popup is blocked, the prompt is already on the clipboard.
      var sw=screen.availWidth||1280,w=Math.max(420,Math.round(sw*0.42)),h=screen.availHeight||800;
      var win=window.open(u,'_blank','popup=1,width='+w+',height='+h+',left='+(sw-w)+',top=0');
      try{if(win)win.opener=null;}catch(_e){}
    }
    if(navigator.clipboard&&navigator.clipboard.writeText){
      navigator.clipboard.writeText(p).then(function(){show('✓ copied — paste (⌘V) into Gemini');},function(){show('Could not copy — select the link text and copy it');});
    }else{show('Could not copy — select the link text and copy it');}
  });
})();</script>`;

  const sizeScript = `<script>(function(){
  var root=document.documentElement;
  var range=document.querySelector('.dg-size-range');
  var dec=document.querySelector('.dg-size-dec');
  var inc=document.querySelector('.dg-size-inc');
  var val=document.querySelector('.dg-size-val');
  if(!range||!val)return;
  ${DIG_SLIDE_SANITIZE_JS}
  function read(){try{return s(localStorage.getItem('digSlideScale'));}catch(e){return 100;}}
  function apply(p,persist){p=s(p);root.style.setProperty('--dig-slide-scale',p/100);range.value=String(p);val.textContent=p+'%';if(persist){try{localStorage.setItem('digSlideScale',String(p));}catch(e){}}}
  apply(read(),false);
  range.addEventListener('input',function(){apply(range.value,true);});
  if(dec)dec.addEventListener('click',function(){apply(Number(range.value)-10,true);});
  if(inc)inc.addEventListener('click',function(){apply(Number(range.value)+10,true);});
  val.addEventListener('click',function(){apply(100,true);});
})();</script>`;

  const captionsScript = `<script>(function(){
  var root=document.documentElement;
  var btn=document.querySelector('.dg-caps-toggle');
  if(!btn)return;
  ${DIG_CAPTIONS_SANITIZE_JS}
  function read(){try{return c(localStorage.getItem('digCaptions'));}catch(e){return 'on';}}
  function apply(state,persist){
    var on=state!=='off';
    if(on){root.classList.remove('dg-hide-caps');}else{root.classList.add('dg-hide-caps');}
    btn.setAttribute('aria-pressed',on?'true':'false');
    btn.textContent=(on?'▣':'▢')+' captions';
    if(persist){try{localStorage.setItem('digCaptions',on?'on':'off');}catch(e){}}
  }
  // REQUIRED, not redundant: the pre-paint head script set ONLY the dg-hide-caps class.
  // This initial apply() syncs aria-pressed + button text to the persisted state. Do not remove.
  apply(read(),false);
  // Toggle off the CURRENT visible state (the class), not a re-read, to avoid any read race.
  btn.addEventListener('click',function(){apply(root.classList.contains('dg-hide-caps')?'on':'off',true);});
})();</script>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="dig-deeper-doc v1">
<meta name="source-md" content="${esc(path.basename(mdPath))}">
<title>${esc(title)}</title>
${THEME_HEAD_SCRIPT}
${SIZE_HEAD_SCRIPT}
${CAPTIONS_HEAD_SCRIPT}
<style>${themeStyleBlock(LIGHT, DARK)}${STRUCTURAL_CSS}${NAV_CSS}${DIG_DOC_CSS}</style>
</head>
<body>
${THEME_TOGGLE_BUTTON}${PRINT_BUTTON}
<article class="dg">
${bodyHtml}
</article>
${expandAllDialogs}${zoomOverlay}${aiToast}
${NAV_SCRIPT}${THEME_TOGGLE_SCRIPT}${zoomScript}${askAiScript}${sizeScript}${captionsScript}
</body>
</html>`;
}
