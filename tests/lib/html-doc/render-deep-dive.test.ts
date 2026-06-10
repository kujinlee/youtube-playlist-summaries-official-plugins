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
});
