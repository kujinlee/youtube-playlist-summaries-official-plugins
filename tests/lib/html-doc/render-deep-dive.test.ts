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

  it('keeps light-mode colors identical via CSS vars (no regression)', () => {
    // EVERY light palette value must equal the previously-hardcoded hex (exhaustive — H4).
    const LIGHT_EXPECTED: Record<string, string> = {
      page: '#f3f4f6', card: '#fff', ink: '#1e1e22', h1: '#111', h2: '#5b46d6', h3: '#2a2540',
      h4: '#3a3550', link: '#5b46d6', hr: '#e6e6ea', strong: '#111', codebg: '#f5f4fb',
      preborder: '#e6e6ea', quote: '#6b7280', shadow: '0 1px 3px rgba(0,0,0,.07)',
    };
    for (const [k, v] of Object.entries(LIGHT_EXPECTED)) {
      expect(html).toContain(`--${k}:${v}`);
    }
    expect(html).toContain('background:var(--page)');
    expect(html).toContain('color:var(--ink)');
  });

  it('ships the cool/purple dark palette (all of it) + system-dark media query', () => {
    // Exhaustive + anchored to the explicit [data-theme="dark"] block. Key order MUST match the
    // DARK palette object's insertion order in render-deep-dive.ts.
    const DARK_EXPECTED: Record<string, string> = {
      page: '#0f1115', card: '#16181d', ink: '#d8dbe0', h1: '#f2f3f5', h2: '#a99bf0', h3: '#cfc9ec',
      h4: '#b9b4dc', link: '#a99bf0', hr: '#2a2d34', strong: '#f2f3f5', codebg: '#20222a',
      preborder: '#2a2d34', quote: '#9aa0ab', shadow: '0 1px 3px rgba(0,0,0,.5)',
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
