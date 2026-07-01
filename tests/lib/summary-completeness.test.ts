import { checkSummaryCompleteness } from '../../lib/summary-completeness';

const withSections = (body: string) =>
  `## 1. A\n▶ [0:00–1:00](u)\nsome text.\n\n## Conclusion\n▶ [1:00–2:00](u)\n${body}`;

describe('checkSummaryCompleteness', () => {
  it('accepts a summary ending on terminal punctuation', () => {
    expect(checkSummaryCompleteness(withSections('Wrapped up nicely.')).complete).toBe(true);
  });
  it('flags a summary ending mid-sentence', () => {
    const r = checkSummaryCompleteness(withSections('this leads to information being'));
    expect(r.complete).toBe(false);
    expect(r.reason).toMatch(/mid-sentence/);
  });
  it('flags mid-word / comma / semicolon / dangling colon / dangling paren endings', () => {
    for (const end of ['into a single', 'first,', 'moreover;', 'The key points:', 'as shown (']) {
      expect(checkSummaryCompleteness(withSections(end)).complete).toBe(false);
    }
  });
  it('flags a bare ) ending (parenthetical/link close is not a sentence end)', () => {
    expect(checkSummaryCompleteness(withSections('see the diagram (above)')).complete).toBe(false);
  });
  it('accepts an ellipsis ending', () => {
    expect(checkSummaryCompleteness(withSections('and so on…')).complete).toBe(true);
  });
  it('accepts a trailing horizontal rule after complete prose (doc-236 case)', () => {
    expect(checkSummaryCompleteness(withSections('Done.\n\n-----')).complete).toBe(true);
  });
  it('accepts terminal punctuation followed by a closing quote', () => {
    expect(checkSummaryCompleteness(withSections('he said "go."')).complete).toBe(true);
  });
  it('ignores trailing whitespace / multiple blank lines when finding the last line', () => {
    expect(checkSummaryCompleteness(withSections('All wrapped up.   \n\n\n   ')).complete).toBe(true);
  });
  it('accepts a closed fenced code block ending', () => {
    expect(
      checkSummaryCompleteness('## 1. A\n▶ [0:00–1:00](u)\ntext.\n\n## Conclusion\n▶ [1:00–2:00](u)\nSee:\n```\ncode\n```').complete,
    ).toBe(true);
  });
  it('flags table-row / URL-only / link-only endings as suspicious (low confidence)', () => {
    for (const end of ['| a | b |', 'https://example.com/x', '[text](https://example.com)']) {
      const r = checkSummaryCompleteness(withSections(end));
      expect(r.complete).toBe(false);
      expect(r.confidence).toBe('low');
    }
  });
  it('flags a summary ending on a bare ▶ timestamp line with no prose body', () => {
    expect(
      checkSummaryCompleteness('## 1. A\n▶ [0:00–1:00](u)\nbody.\n\n## Conclusion\n▶ [1:00–2:00](u)').complete,
    ).toBe(false);
  });
  it('flags prose cut off inside a list item', () => {
    expect(checkSummaryCompleteness(withSections('- The agent must recover from')).complete).toBe(false);
  });
  it('flags zero-section and empty input', () => {
    expect(checkSummaryCompleteness('no headings here, just text.').complete).toBe(false);
    expect(checkSummaryCompleteness('   ').complete).toBe(false);
  });
  it('flags an unterminated code fence (low confidence); a shorter inner ``` in a 4-backtick block is not a closer', () => {
    const r = checkSummaryCompleteness('## 1. A\n▶ [0:00–1:00](u)\n````\n```\ncode without close');
    expect(r.complete).toBe(false);
    expect(r.confidence).toBe('low');
  });
  it('treats a fence line with trailing text as NOT a closer → unterminated (low confidence)', () => {
    // ```` ```stuff ```` after an opener is content, not a valid closer → fence stays open.
    const r = checkSummaryCompleteness('## 1. A\n▶ [0:00–1:00](u)\n```\ncode\n```not a closer\nmore');
    expect(r.complete).toBe(false);
    expect(r.confidence).toBe('low');
  });
  it('works on a full on-disk .md (frontmatter + H1 + meta + callout), not just the raw body', () => {
    const full = [
      '---', 'tags:', '  - video-summary', 'video_id: "abc"', 'score: 4', '---', '',
      '# Some Title', '', '**Channel:** C | **Duration:** 1:00 | **URL:** https://x', '', '---', '',
      '> [!summary] Quick Reference', '> **TL;DR:** short.', '',
      '## 1. A', '▶ [0:00–1:00](u)', 'body.', '', '## Conclusion', '▶ [1:00–2:00](u)', 'Final wrap-up.',
    ].join('\n');
    expect(checkSummaryCompleteness(full).complete).toBe(true);
    expect(checkSummaryCompleteness(full.replace('Final wrap-up.', 'Final wrap-up cut off')).complete).toBe(false);
  });
  it('flags an unresolved trailing [[TS:i]] token', () => {
    expect(checkSummaryCompleteness(withSections('[[TS:3]]')).complete).toBe(false);
  });
  it('never throws (fails closed)', () => {
    // @ts-expect-error deliberate bad input
    expect(() => checkSummaryCompleteness(null)).not.toThrow();
  });
});
