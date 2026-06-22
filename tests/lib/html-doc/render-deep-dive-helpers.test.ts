import {
  splitSections, extractTimestamp, linkifyHeaderUrl, takeFirstParagraph, splitFirstSentence,
} from '../../../lib/html-doc/render-deep-dive';

describe('splitSections', () => {
  it('separates preamble from ## sections', () => {
    const { preamble, sections } = splitSections('# Title\n\nintro\n\n## One\na\n\n## Two\nb');
    expect(preamble).toContain('# Title');
    expect(preamble).toContain('intro');
    expect(sections.map((s) => s.heading)).toEqual(['One', 'Two']);
    expect(sections[0].lines.join('\n')).toContain('a');
  });

  it('does not treat a ## inside a code fence as a section', () => {
    const { sections } = splitSections('## Real\n```\n## not a heading\n```\nbody');
    expect(sections).toHaveLength(1);
    expect(sections[0].lines.join('\n')).toContain('## not a heading');
  });

  it('does not match ### (h3) as a section', () => {
    const { preamble, sections } = splitSections('### H3 only\ntext');
    expect(sections).toHaveLength(0);
    expect(preamble).toContain('### H3 only');
  });
});

describe('extractTimestamp', () => {
  it('removes a well-formed ▶ line and returns label+url', () => {
    const lines = ['▶ [0:07–1:29](https://www.youtube.com/watch?v=x&t=7s)', 'Lead prose.'];
    const ts = extractTimestamp(lines);
    expect(ts).toEqual({ label: '0:07–1:29', url: 'https://www.youtube.com/watch?v=x&t=7s' });
    expect(lines).toEqual(['Lead prose.']);
  });

  it('consumes a malformed ▶ line but returns null', () => {
    const lines = ['▶ not a link', 'Lead prose.'];
    expect(extractTimestamp(lines)).toBeNull();
    expect(lines).toEqual(['Lead prose.']);
  });

  it('returns null and leaves lines intact when no ▶ line', () => {
    const lines = ['Lead prose.', 'more'];
    expect(extractTimestamp(lines)).toBeNull();
    expect(lines).toEqual(['Lead prose.', 'more']);
  });

  it('only inspects the first non-blank line for the ▶', () => {
    const lines = ['', 'Lead prose.', '▶ [1:00–2:00](https://youtu.be/x?t=60s)'];
    expect(extractTimestamp(lines)).toBeNull();
    expect(lines).toContain('▶ [1:00–2:00](https://youtu.be/x?t=60s)');
  });

  it('accepts a well-formed ▶ link without a ?t= param (diverges from parse.ts)', () => {
    const lines = ['▶ [0:00–1:00](https://youtu.be/x)', 'Lead.'];
    expect(extractTimestamp(lines)).toEqual({ label: '0:00–1:00', url: 'https://youtu.be/x' });
    expect(lines).toEqual(['Lead.']);
  });
});

describe('linkifyHeaderUrl', () => {
  it('wraps the **URL:** value in a markdown link', () => {
    const out = linkifyHeaderUrl('**Channel:** C | **Duration:** 1:00 | **URL:** https://youtu.be/x');
    expect(out).toContain('**URL:** [https://youtu.be/x](https://youtu.be/x)');
  });

  it('leaves a non-http URL untouched', () => {
    const out = linkifyHeaderUrl('**URL:** mailto:a@b.com');
    expect(out).toBe('**URL:** mailto:a@b.com');
  });
});

describe('takeFirstParagraph', () => {
  it('splits the first paragraph from the rest', () => {
    const { para, rest } = takeFirstParagraph(['Lead line one.', 'line two.', '', '### Sub', '- x']);
    expect(para).toBe('Lead line one.\nline two.');
    expect(rest).toContain('### Sub');
  });

  it('returns empty para when the section opens with a block construct', () => {
    const { para, rest } = takeFirstParagraph(['- bullet', '- bullet2']);
    expect(para).toBe('');
    expect(rest).toContain('- bullet');
  });

  it('treats a blockquote opener as a block (no lead)', () => {
    expect(takeFirstParagraph(['> quoted', 'more']).para).toBe('');
  });

  it('treats a table-row opener as a block (no lead)', () => {
    expect(takeFirstParagraph(['| a | b |', '| - | - |']).para).toBe('');
  });
});

describe('splitFirstSentence', () => {
  it('splits off the first sentence', () => {
    const { first, rest } = splitFirstSentence('Johnson was unconventional. An author of books.');
    expect(first).toBe('Johnson was unconventional.');
    expect(rest).toBe('An author of books.');
  });

  it('returns the whole text as first when there is no terminator', () => {
    const { first, rest } = splitFirstSentence('a single clause with no end');
    expect(first).toBe('a single clause with no end');
    expect(rest).toBe('');
  });

  it('handles a Korean sentence terminator', () => {
    const { first, rest } = splitFirstSentence('이것은 문장입니다. 다음 문장.');
    expect(first).toBe('이것은 문장입니다.');
    expect(rest).toBe('다음 문장.');
  });
});
