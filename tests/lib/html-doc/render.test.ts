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
    expect(html).toContain('<strong>Source:</strong> Common Crawl.');
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
    expect(html).toContain('x &amp; y');
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

  it('ships warm Dark A values and a system-dark media query', () => {
    const html = renderMagazineHtml(parsed, model);
    expect(html).toContain('[data-theme="dark"]{--page:#1a1714');
    expect(html).toContain('--gold:#e6b54d');
    expect(html).toContain('@media(prefers-color-scheme:dark){:root:not([data-theme])');
  });

  it('injects the theme toggle + scripts and never hardcodes data-theme on <html>', () => {
    const html = renderMagazineHtml(parsed, model);
    expect(html).toContain('id="theme-toggle"');
    expect(html).toContain("localStorage.getItem('html-doc-theme')");
    expect(html).toContain("setItem('html-doc-theme',next)");
    expect(html).not.toMatch(/<html[^>]*data-theme=/);
  });
});
