import { renderMagazineHtml } from '../../../lib/html-doc/render';
import type { ParsedSummary, MagazineModel } from '../../../lib/html-doc/types';

const parsed: ParsedSummary = {
  title: 'Deep Dive into LLMs',
  channel: 'Andrej Karpathy',
  duration: '3:31:24',
  url: 'https://youtu.be/x',
  lang: 'EN',
  videoId: '7xTGNNLPyMI',
  tldr: 'This video details how LLMs are built.',
  takeaways: ['LLMs begin with filtered internet text.'],
  sections: [
    { numeral: '1', title: 'The Foundation', prose: 'p' },
    { numeral: null, title: 'Conclusion', prose: 'p' },
  ],
  sourceMd: 'deep-dive-into-llms.md',
};

const model: MagazineModel = {
  sections: [
    { lead: 'An LLM starts as raw internet text.', bullets: [{ label: 'Source', text: 'Common Crawl.' }] },
    { lead: 'A multi-stage pipeline.', bullets: [{ label: 'Stages', text: 'pre-train, SFT, RL.' }] },
  ],
};

describe('renderMagazineHtml', () => {
  it('produces a self-contained document with inlined CSS and provenance meta', () => {
    const html = renderMagazineHtml(parsed, model);
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('<style>');
    expect(html).not.toContain('<link');                 // no external CSS
    expect(html).toContain('<meta name="generator" content="magazine-skim v1">');
    expect(html).toContain('<meta name="video-id" content="7xTGNNLPyMI">');
    expect(html).toContain('<meta name="source-md" content="deep-dive-into-llms.md">');
    expect(html).toContain('<title>Deep Dive into LLMs</title>');
  });

  it('includes a Korean serif fallback in the font stack', () => {
    expect(renderMagazineHtml(parsed, model)).toContain('Nanum Myeongjo');
  });

  it('renders lead + bullets per section, zipped by index', () => {
    const html = renderMagazineHtml(parsed, model);
    expect(html).toContain('An LLM starts as raw internet text.');
    // Label is NOT rendered — only the plain bullet text (B1 design decision).
    expect(html).toContain('<li>Common Crawl.</li>');
    expect(html).not.toContain('<strong>Source:</strong>');
    expect(html).toContain('The Foundation');
  });

  it('shows a ghost numeral for numbered sections and none for null', () => {
    const html = renderMagazineHtml(parsed, model);
    expect(html).toContain('class="ghost">1<');
    expect(html).not.toContain('class="ghost">2<');     // Conclusion has null numeral
  });

  it('omits the callout block when tldr is null', () => {
    const noTldr = { ...parsed, tldr: null, takeaways: [] };
    expect(renderMagazineHtml(noTldr, model)).not.toContain('class="callout"');
  });

  it('HTML-escapes transformed content (no injection)', () => {
    const evil: MagazineModel = {
      sections: [
        { lead: '<script>alert(1)</script> & "q"', bullets: [{ label: 'a<b', text: 'x & y' }] },
        model.sections[1],
      ],
    };
    const html = renderMagazineHtml(parsed, evil);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    // Label is not rendered; only the escaped bullet text appears.
    expect(html).toContain('x &amp; y');
    expect(html).not.toContain('a&lt;b');  // label must not appear at all
  });

  it('HTML-escapes parsed meta — title, channel, tldr, takeaways (no injection)', () => {
    const evilParsed = {
      ...parsed,
      title: 'A & B <x>',
      channel: 'Chan <i>',
      tldr: 'TL;DR <b>"q"</b> & more',
      takeaways: ['take <script>x</script>'],
    };
    const html = renderMagazineHtml(evilParsed, model);
    expect(html).not.toContain('<script>x</script>');
    expect(html).not.toContain('<title>A & B <x></title>');
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(html).toContain('A &amp; B &lt;x&gt;');     // title escaped
    expect(html).toContain('Chan &lt;i&gt;');          // channel escaped in meta line
    expect(html).toContain('&amp; more');              // tldr escaped
  });

  it('renders Korean content without mangling', () => {
    const ko = { ...parsed, lang: 'KO', title: '한국어 제목' };
    const koModel: MagazineModel = {
      sections: [
        { lead: '한 문장 요약.', bullets: [{ label: '출처', text: '인터넷 텍스트.' }] },
        model.sections[1],
      ],
    };
    const html = renderMagazineHtml(ko, koModel);
    expect(html).toContain('한국어 제목');
    expect(html).toContain('인터넷 텍스트.');
  });

  it('keeps light-mode colors identical (no visual regression) via CSS vars', () => {
    const html = renderMagazineHtml(parsed, model);
    // EVERY light palette value must equal the previously-hardcoded hex (exhaustive — H4).
    const LIGHT_EXPECTED: Record<string, string> = {
      page: '#eef0f3', card: '#fbf9f6', ink: '#2a2622', meta: '#8a8276', rule: '#ece7df',
      ghost: '#f0e7d6', gold: '#b07700', goldline: '#e0a800', li: '#4a463f', foot: '#9a917f',
      shadow: '0 1px 3px rgba(0,0,0,.08)',
    };
    for (const [k, v] of Object.entries(LIGHT_EXPECTED)) {
      expect(html).toContain(`--${k}:${v}`);
    }
    // Structural rules now reference the vars
    expect(html).toContain('background:var(--page)');
    expect(html).toContain('color:var(--ink)');
  });

  it('#6 — lead is lighter-weight and slightly smaller (color unchanged)', () => {
    const html = renderMagazineHtml(parsed, model);
    // New values: font-weight:400, font-size:1.02rem (was 600 / 1.12rem).
    expect(html).toContain('.lead{font-size:1.02rem');
    expect(html).toContain('font-weight:400');
    // Old values must NOT appear for the lead rule.
    expect(html).not.toContain('.lead{font-size:1.12rem');
    // Gold color must still be present.
    expect(html).toContain('color:var(--gold)');
  });

  it('ships warm Dark A values (all of them) and a system-dark media query', () => {
    const html = renderMagazineHtml(parsed, model);
    // Exhaustive + anchored: the full dark declaration list must appear inside the explicit
    // [data-theme="dark"] block. Key order must match the DARK palette object in render.ts.
    const DARK_EXPECTED: Record<string, string> = {
      page: '#1a1714', card: '#221d18', ink: '#e8e2d6', meta: '#9a9082', rule: '#332c24',
      ghost: '#2e2820', gold: '#e6b54d', goldline: '#e0a800', li: '#cfc8ba', foot: '#8a8174',
      shadow: '0 1px 3px rgba(0,0,0,.5)',
    };
    const darkDecls = Object.entries(DARK_EXPECTED).map(([k, v]) => `--${k}:${v}`).join(';');
    expect(html).toContain(`[data-theme="dark"]{${darkDecls}}`);
    expect(html).toContain('@media(prefers-color-scheme:dark){:root:not([data-theme])');
  });

  it('injects the theme toggle + scripts and never hardcodes data-theme on <html>', () => {
    const html = renderMagazineHtml(parsed, model);
    expect(html).toContain('id="theme-toggle"');
    expect(html).toContain("localStorage.getItem('html-doc-theme')");
    expect(html).toContain("setItem('html-doc-theme',next)");
    expect(html).not.toMatch(/<html[^>]*data-theme=/);
  });

  it('includes a Print button hidden in print', () => {
    const html = renderMagazineHtml(parsed, model);
    expect(html).toContain('id="print-btn"');
    expect(html).toContain('onclick="window.print()"');
    expect(html).toContain('#theme-toggle,#print-btn{display:none}');
  });
});

describe('renderMagazineHtml — meta URL link', () => {
  it('renders the original-video URL as a clickable full-URL link in the meta line', () => {
    const html = renderMagazineHtml(parsed, model);
    expect(html).toContain(
      '<a href="https://youtu.be/x" target="_blank" rel="noopener noreferrer">https://youtu.be/x</a>',
    );
    // styling hooks: muted link in the meta line
    expect(html).toContain('.doc-meta a{color:inherit;text-decoration:none}');
    expect(html).toContain('.doc-meta a:hover{text-decoration:underline}');
  });

  it('omits the meta URL link when url is null (no trailing separator)', () => {
    const noUrl = { ...parsed, url: null };
    const html = renderMagazineHtml(noUrl, model);
    expect(html).not.toContain('<a href');
    expect(html).toContain('Andrej Karpathy · 3:31:24');
  });

  it('does not link a non-http(s) url (injection guard)', () => {
    const evilUrl = { ...parsed, url: 'javascript:alert(1)' };
    const html = renderMagazineHtml(evilUrl, model);
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('<a href');
  });

  it('does not link a data: url (injection guard)', () => {
    const evilUrl = { ...parsed, url: 'data:text/html,<h1>x</h1>' };
    const html = renderMagazineHtml(evilUrl, model);
    expect(html).not.toContain('href="data:');
    expect(html).not.toContain('<a href');
  });

  it('omits the meta URL link when url is an empty string', () => {
    const emptyUrl = { ...parsed, url: '' };
    const html = renderMagazineHtml(emptyUrl, model);
    expect(html).not.toContain('<a href');
  });
});

describe('renderMagazineHtml — section timestamps', () => {
  const withTs: ParsedSummary = {
    ...parsed,
    sections: [
      {
        numeral: '1',
        title: 'The Foundation',
        prose: 'p',
        timeRange: {
          startSec: 135,
          endSec: 330,
          label: '2:15–5:30',
          url: 'https://www.youtube.com/watch?v=vid123&t=135s',
        },
      },
      { numeral: null, title: 'Conclusion', prose: 'p', timeRange: null },
    ],
  };

  it('renders the timestamp as a parenthesized link at the end of the title (muted), followed by dig control', () => {
    const html = renderMagazineHtml(withTs, model);
    // Lives inside the <h2>, after the title, parenthesized — not its own prominent line.
    // The dig control follows the ts link inside the same <h2>.
    expect(html).toContain(
      '<h2>The Foundation <a class="ts" href="https://www.youtube.com/watch?v=vid123&amp;t=135s" target="_blank" rel="noopener noreferrer">(2:15–5:30)</a>',
    );
    // dig control is inside <h2> (D1: always present for timestamped sections)
    expect(html).toContain('data-section="135"');
    // ▶ is now in the dig control label — presence is expected
    expect(html).toContain('dig deeper ▶');
  });

  it('renders no .ts anchor for sections without a timeRange', () => {
    const html = renderMagazineHtml(withTs, model);
    // Only one anchor total (the first section); the Conclusion has none.
    expect(html.match(/class="ts"/g) ?? []).toHaveLength(1);
  });

  it('HTML-escapes the label and url in the timestamp anchor', () => {
    const evil: ParsedSummary = {
      ...parsed,
      sections: [
        { numeral: '1', title: 'T', prose: 'p', timeRange: { startSec: 0, endSec: 10, label: 'A & B', url: 'https://youtu.be/x?v=1&t=0s' } },
        { numeral: null, title: 'C', prose: 'p', timeRange: null },
      ],
    };
    const html = renderMagazineHtml(evil, model);
    expect(html).toContain('>(A &amp; B)</a>');
    expect(html).toContain('href="https://youtu.be/x?v=1&amp;t=0s"');
  });

  it('emits data-start on the section + a dig-deeper control when hasDeepDive', () => {
    const html = renderMagazineHtml(withTs, model, true);
    expect(html).toMatch(/<section data-start="135">/);
    // New markup: data-section (POST-driven) instead of data-type
    expect(html).toContain('class="dig"');
    expect(html).toContain('data-section="135"');
    expect(html).toContain('data-t="135"');
    expect(html).toContain('dig deeper');
    expect(html).toContain('a.dig'); // NAV_SCRIPT present (unique token)
  });
  it('emits dig control even when deepDiveMd is absent (deepDiveMd: null, no hasDeepDive)', () => {
    // NEW BEHAVIOR (D1): control must appear on every timestamped section regardless of hasDeepDive
    const html = renderMagazineHtml(withTs, model); // hasDeepDive defaults to false
    expect(html).toContain('class="dig"');
    expect(html).toContain('data-section="135"');
    expect(html).toContain('data-t="135"');
    expect(html).toContain('dig deeper');
  });
  it('omits the dig control when section has no timestamp (startSec null)', () => {
    // Only the Conclusion section (no timeRange) should have no control
    const html = renderMagazineHtml(withTs, model);
    // Section 0 has timestamp → has dig; section 1 has none → no second dig
    expect((html.match(/class="dig"/g) ?? []).length).toBe(1);
  });
  it('dig control carries data-section attribute (not data-type)', () => {
    const html = renderMagazineHtml(withTs, model);
    expect(html).toContain('data-section="135"');
    expect(html).not.toContain('data-type="deep-dive"');
  });
  it('emits data-start="0" for a 0:00 section (presence-gated, not truthiness)', () => {
    const zero = { ...withTs, sections: [
      { ...withTs.sections[0], timeRange: { ...withTs.sections[0].timeRange!, startSec: 0 } },
      withTs.sections[1],
    ] };
    expect(renderMagazineHtml(zero, model)).toMatch(/<section data-start="0">/);
    // Dig control also present for startSec=0 section (presence-gated)
    expect(renderMagazineHtml(zero, model)).toContain('data-section="0"');
  });
  it('puts data-start only on timeRange sections (section1 null → bare <section>)', () => {
    const html = renderMagazineHtml(withTs, model);
    expect((html.match(/<section data-start=/g) ?? []).length).toBe(1); // only section0
  });
});
