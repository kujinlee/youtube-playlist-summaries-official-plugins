import { renderDeepDiveHtml } from '../../../lib/html-doc/render-deep-dive';

const MD = `---
tags:
  - deep-dive
video_id: "rjoMZyxncUI"
lang: EN
score: 4.4
---

# The ABCs of agent building (Deep Dive)

**Channel:** Google Cloud Tech | **Duration:** 13:54 | **URL:** https://youtu.be/rjoMZyxncUI

---

Of course. Here is a comprehensive deep-dive analysis.

### **1. High-Level Summary**
The video explains agent protocols.

\`\`\`ascii
+--------+      +--------+
| Agent  | ---> | Tool   |
+--------+      +--------+
\`\`\`

#### Sub-point
- bullet one
- bullet two

A link: [click](javascript:alert(1)) and <script>alert(2)</script> inline.
`;

describe('renderDeepDiveHtml', () => {
  const html = renderDeepDiveHtml(MD, 'the-abcs-deep-dive.md');

  it('is a self-contained document with inlined CSS and provenance', () => {
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('<style>');
    expect(html).not.toContain('<link');
    expect(html).toContain('<meta name="generator" content="deep-dive-html v1">');
    expect(html).toContain('<meta name="source-md" content="the-abcs-deep-dive.md">');
    expect(html).toContain('<meta name="video-id" content="rjoMZyxncUI">');
    expect(html).toContain('<html lang="en">');
  });

  it('strips YAML frontmatter from the body', () => {
    expect(html).not.toContain('video_id:');
    expect(html).not.toContain('tags:');
  });

  it('renders headings (h1–h4) including bold-in-heading', () => {
    expect(html).toContain('<h1>The ABCs of agent building (Deep Dive)</h1>');
    expect(html).toMatch(/<h3><strong>1\. High-Level Summary<\/strong><\/h3>/);
    expect(html).toContain('<h4>Sub-point</h4>');
  });

  it('preserves an ASCII diagram in a <pre><code> block', () => {
    expect(html).toMatch(/<pre><code[^>]*>[\s\S]*Agent[\s\S]*Tool[\s\S]*<\/code><\/pre>/);
  });

  it('keeps the conversational preamble (faithful render)', () => {
    expect(html).toContain('Of course. Here is a comprehensive deep-dive analysis.');
  });

  it('escapes raw HTML (html:false) — no injection', () => {
    expect(html).not.toContain('<script>alert(2)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('drops a javascript: link href (markdown-it validateLink)', () => {
    expect(html).not.toContain('href="javascript:');
  });

  it('strips CRLF (Windows) frontmatter and still renders the body', () => {
    const sample = `---\nvideo_id: "crlf1"\nlang: EN\n---\n\n# CRLF Title (Deep Dive)\n\nBody survives.\n`;
    const crlf = renderDeepDiveHtml(sample.replace(/\n/g, '\r\n'), 'crlf-deep-dive.md');
    expect(crlf).not.toContain('video_id:');
    expect(crlf).toContain('Body survives.');
  });

  it('renders Korean content', () => {
    const ko = renderDeepDiveHtml(
      `---\nvideo_id: "k1"\nlang: KO\n---\n\n# 한국어 (Deep Dive)\n\n### **1. 개요**\n본문입니다.\n`,
      'ko-deep-dive.md',
    );
    expect(ko).toContain('<html lang="ko">');
    expect(ko).toContain('본문입니다.');
  });

  it('adopts magazine light palette (cream card, gold accent, ghost numeral vars)', () => {
    // Positive: key magazine-skin vars must be present in the light palette.
    expect(html).toContain('--card:#fbf9f6');   // cream card
    expect(html).toContain('--gold:#b07700');    // gold accent
    expect(html).toContain('--ghost:#f0e7d6');   // ghost numeral background color
    expect(html).toContain('--rule:#ece7df');    // section divider rule

    // Negative: ALL four removed vars must be absent from the emitted CSS.
    expect(html).not.toContain('--h1:');
    expect(html).not.toContain('--h2:');
    expect(html).not.toContain('--hr:');
    expect(html).not.toContain('--strong:');

    expect(html).toContain('background:var(--page)');
    expect(html).toContain('color:var(--ink)');
  });

  it('emits ghost-numeral CSS (counter-reset:sec, counter(sec)) and gold-lead rule', () => {
    expect(html).toContain('counter-reset:sec');
    expect(html).toContain('counter(sec)');
    // h2 + p adjacent-sibling is the gold "lead" rule.
    expect(html).toContain('.dd h2 + p');
    // .dd h1 must be styled as the serif title (no .doc-title class — renderer emits plain <h1>).
    expect(html).toContain('.dd h1');
  });

  it('ships the magazine dark palette + system-dark media query', () => {
    // Exhaustive + anchored to the explicit [data-theme="dark"] block. Key order MUST match the
    // DARK palette object's insertion order in render-deep-dive.ts.
    const DARK_EXPECTED: Record<string, string> = {
      page: '#1a1714', card: '#221d18', ink: '#e8e2d6', rule: '#332c24',
      ghost: '#2e2820', gold: '#e6b54d', goldline: '#e0a800', li: '#cfc8ba', foot: '#8a8174',
      shadow: '0 1px 3px rgba(0,0,0,.5)', link: '#e6b54d', h3: '#d8cdb8', h4: '#c4b7a0',
      codebg: '#2a241c', preborder: '#332c24', quote: '#9a9082',
    };
    const darkDecls = Object.entries(DARK_EXPECTED).map(([k, v]) => `--${k}:${v}`).join(';');
    expect(html).toContain(`[data-theme="dark"]{${darkDecls}}`);
    expect(html).toContain('@media(prefers-color-scheme:dark){:root:not([data-theme])');
  });

  it('injects the toggle + scripts and never hardcodes data-theme on <html>', () => {
    expect(html).toContain('id="theme-toggle"');
    expect(html).toContain("localStorage.getItem('html-doc-theme')");
    expect(html).not.toMatch(/<html[^>]*data-theme=/);
  });
});
