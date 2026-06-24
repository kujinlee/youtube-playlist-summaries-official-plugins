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

  it('emits ghost-numeral CSS and the new lead/lead-accent/ts rules (no old h2+p gold rule)', () => {
    expect(html).toContain('counter-reset:sec');
    expect(html).toContain('counter(sec)');
    expect(html).toContain('.dd h1');
    // New: gold is confined to the lead's first sentence via .lead-accent; lead text is normal ink.
    expect(html).toContain('.dd .lead{font-size:1.02rem;line-height:1.55;color:var(--ink)');
    expect(html).toContain('.dd .lead-accent{color:var(--gold);font-weight:400}');
    expect(html).toContain('.dd .ts{');
    expect(html).toContain('.dd .ts:hover{text-decoration:underline}');
    // Old adjacent-sibling gold rule is gone.
    expect(html).not.toContain('.dd h2 + p');
  });

  it('ships the magazine dark palette + system-dark media query', () => {
    // Exhaustive + anchored to the explicit [data-theme="dark"] block. Key order MUST match the
    // DARK palette object's insertion order in render-deep-dive.ts.
    const DARK_EXPECTED: Record<string, string> = {
      page: '#1a1714', card: '#221d18', ink: '#e8e2d6', rule: '#332c24',
      ghost: '#2e2820', gold: '#e6b54d', goldline: '#e0a800', li: '#cfc8ba', foot: '#8a8174',
      shadow: '0 1px 3px rgba(0,0,0,.5)', link: '#e6b54d', h3: '#d8cdb8', h4: '#c4b7a0',
      codebg: '#2a241c', preborder: '#332c24', quote: '#9a9082', meta: '#9a9082',
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

  it('includes a Print button hidden in print', () => {
    expect(html).toContain('id="print-btn"');
    expect(html).toContain('onclick="window.print()"');
    expect(html).toContain('#theme-toggle,#print-btn{display:none}');
  });

  it('emits the light palette with meta key in insertion order', () => {
    const LIGHT_EXPECTED: Record<string, string> = {
      page: '#eef0f3', card: '#fbf9f6', ink: '#2a2622', rule: '#ece7df',
      ghost: '#f0e7d6', gold: '#b07700', goldline: '#e0a800', li: '#4a463f', foot: '#9a917f',
      shadow: '0 1px 3px rgba(0,0,0,.08)', link: '#b07700', h3: '#5b463a', h4: '#6b5a4a',
      codebg: '#f1ebe0', preborder: '#e6ddcf', quote: '#8a8276', meta: '#8a8276',
    };
    const lightDecls = Object.entries(LIGHT_EXPECTED).map(([k, v]) => `--${k}:${v}`).join(';');
    expect(html).toContain(`:root{${lightDecls}}`);
  });

  describe('section restructure', () => {
    const SEC_MD = `---
video_id: "v1"
lang: EN
---

# T (Deep Dive)

**Channel:** C | **Duration:** 5:00 | **URL:** https://youtu.be/v1

---

## The Genesis
▶ [1:29–3:33](https://www.youtube.com/watch?v=v1&t=89s)
Johnson was unconventional. An author of a dozen books joined later.

### Detail
- point one
- point two

## No Timestamp Here
A lone lead sentence with no marker.
`;
    const out = renderDeepDiveHtml(SEC_MD, 'v1-deep-dive.md');

    it('moves the ▶ into a trailing muted .ts link on the heading', () => {
      expect(out).toContain(
        '<a class="ts" href="https://www.youtube.com/watch?v=v1&amp;t=89s" target="_blank" rel="noopener noreferrer">(1:29–3:33)</a>',
      );
      // the ▶ glyph no longer appears in the rendered body
      expect(out).not.toContain('▶');
    });

    it('golds only the first sentence of the lead', () => {
      expect(out).toContain('<span class="lead-accent">Johnson was unconventional.</span>');
      // second sentence is outside the accent span
      expect(out).toMatch(/<\/span>\s*An author of a dozen books joined later\./);
    });

    it('preserves rich content after the lead (h3 + list)', () => {
      expect(out).toContain('<h3>Detail</h3>');
      expect(out).toContain('<li>point one</li>');
    });

    it('renders a section with no ▶ line: heading without a .ts link, lead still accented', () => {
      expect(out).toContain('<h2>No Timestamp Here</h2>');
      expect(out).toContain('<span class="lead-accent">A lone lead sentence with no marker.</span>');
    });

    it('linkifies the header URL', () => {
      expect(out).toContain('href="https://youtu.be/v1"');
    });

    it('does not emit a bogus lead paragraph when a section opens with a list', () => {
      const md = `---
video_id: "v2"
lang: EN
---

# T2 (Deep Dive)

**URL:** https://youtu.be/v2

---

## Bullets First
- alpha
- beta
`;
      const html = renderDeepDiveHtml(md, 'v2-deep-dive.md');
      expect(html).toContain('<h2>Bullets First</h2>');
      expect(html).not.toContain('class="lead"'); // no prose lead → no .lead paragraph
      expect(html).toContain('<li>alpha</li>');
    });
  });

  it('emits .dd .ts with muted color binding', () => {
    expect(html).toContain('.dd .ts{');
    expect(html).toContain('color:var(--meta)');
  });

  describe('H3 subsection timestamps', () => {
    const FM = `---\nvideo_id: "v1"\nlang: EN\n---\n\n# T (Deep Dive)\n\n**Channel:** C | **Duration:** 5:00 | **URL:** https://youtu.be/v1\n\n---\n\n`;
    const render = (body: string) => renderDeepDiveHtml(FM + body, 'v1-deep-dive.md');

    it('folds a ### subsection leading ▶ into a trailing muted .ts link', () => {
      const out = render('## Sec\n▶ [0:00–0:30](https://www.youtube.com/watch?v=v1&t=0s)\nLead.\n\n### Sub A\n▶ [0:36–1:42](https://www.youtube.com/watch?v=v1&t=36s)\nsub body.\n');
      expect(out).toContain('<h3>Sub A <a class="ts" href="https://www.youtube.com/watch?v=v1&amp;t=36s" target="_blank" rel="noopener noreferrer">(0:36–1:42)</a></h3>');
      expect(out).not.toContain('▶'); // no literal glyph anywhere
      expect((out.match(/0:36–1:42/g) ?? []).length).toBe(1); // folded once, not duplicated
    });

    it('leaves a ### subsection with no ▶ unchanged (plain <h3>, no trailing .ts)', () => {
      const out = render('## Sec\n▶ [0:00–0:30](https://www.youtube.com/watch?v=v1&t=0s)\nLead.\n\n### Plain Sub\nbody text.\n');
      // Plain <h3> with NO trailing anchor (the H2 has its own .ts link — assert the H3 shape directly).
      expect(out).toContain('<h3>Plain Sub</h3>');
    });

    it('renders a bold ### heading inside a section as <h3><strong>…</strong></h3>', () => {
      const out = render('## Sec\n▶ [0:00–0:30](https://www.youtube.com/watch?v=v1&t=0s)\nLead.\n\n### **Bold Sub**\n▶ [1:00–2:00](https://www.youtube.com/watch?v=v1&t=60s)\nb.\n');
      expect(out).toContain('<h3><strong>Bold Sub</strong> <a class="ts"');
    });

    it('does NOT fold a ### inside a fenced code block', () => {
      const out = render('## Sec\n▶ [0:00–0:30](https://www.youtube.com/watch?v=v1&t=0s)\nLead.\n\n```\n### Not A Heading\n▶ [9:99–9:99](x)\n```\n');
      expect(out).toContain('### Not A Heading'); // survives verbatim inside <pre><code>
      expect(out).not.toContain('<h3>Not A Heading');
    });

    it('does NOT fold ###x (no space → prose)', () => {
      const out = render('## Sec\n▶ [0:00–0:30](https://www.youtube.com/watch?v=v1&t=0s)\nLead.\n\n###notaheading text\n');
      expect(out).not.toContain('<h3>notaheading');
    });

    it('handles a section whose body starts immediately with ### (no gold lead)', () => {
      const out = render('## Sec\n▶ [0:00–0:30](https://www.youtube.com/watch?v=v1&t=0s)\n### Sub\n▶ [0:36–1:42](https://www.youtube.com/watch?v=v1&t=36s)\nb.\n');
      expect(out).toContain('<h3>Sub <a class="ts"');
      // no gold lead emitted for a section with no prose paragraph before the first ###
      expect(out).not.toMatch(/<p class="lead">/);
    });

    it('consumes a malformed ▶ line under a ### (no raw glyph leak, no .ts link)', () => {
      const out = render('## Sec\n▶ [0:00–0:30](https://www.youtube.com/watch?v=v1&t=0s)\nLead.\n\n### Sub\n▶ not-a-valid-ts-line\nbody.\n');
      expect(out).toContain('<h3>Sub</h3>'); // no trailing .ts (malformed → null)
      expect(out).not.toContain('▶');
      expect(out).not.toContain('not-a-valid-ts-line');
    });

    it('emits data-start on <h2> + an "↑ summary" control when hasSummary', () => {
      const out = renderDeepDiveHtml(FM + '## Sec\n▶ [0:00–0:30](https://www.youtube.com/watch?v=v1&t=0s)\nbody\n', 'v1-deep-dive.md', true);
      expect(out).toMatch(/<h2 data-start="0"/);
      expect(out).toContain('class="dig" data-type="summary"');
      expect(out).toContain('a.dig'); // NAV_SCRIPT present
    });
    it('omits the dig control by default', () => {
      const out = renderDeepDiveHtml(FM + '## Sec\n▶ [0:00–0:30](https://www.youtube.com/watch?v=v1&t=0s)\nbody\n', 'v1-deep-dive.md');
      expect(out).not.toContain('class="dig"');
    });
  });
});
