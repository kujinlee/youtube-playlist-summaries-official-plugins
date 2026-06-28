import {
  formatTimestamp,
  parseClockToSeconds,
  buildWatchUrl,
  timestampLine,
  buildIndexedTranscript,
  resolveTranscriptTokens,
} from '../../lib/transcript-timestamps';
import type { TranscriptSegment } from '../../lib/transcript-timestamps';

describe('formatTimestamp', () => {
  it('formats sub-hour durations as m:ss', () => {
    expect(formatTimestamp(0)).toBe('0:00');
    expect(formatTimestamp(75)).toBe('1:15');
    expect(formatTimestamp(135)).toBe('2:15');
    expect(formatTimestamp(599)).toBe('9:59');
  });
  it('formats >= 1h durations as h:mm:ss', () => {
    expect(formatTimestamp(3600)).toBe('1:00:00');
    expect(formatTimestamp(5025)).toBe('1:23:45');
  });
  it('floors fractional seconds and clamps negatives to 0', () => {
    expect(formatTimestamp(135.9)).toBe('2:15');
    expect(formatTimestamp(-5)).toBe('0:00');
  });
});

describe('parseClockToSeconds', () => {
  it('parses m:ss and h:mm:ss', () => {
    expect(parseClockToSeconds('2:15')).toBe(135);
    expect(parseClockToSeconds('1:23:45')).toBe(5025);
    expect(parseClockToSeconds('0:00')).toBe(0);
  });
  it('returns NaN for non-numeric input', () => {
    expect(Number.isNaN(parseClockToSeconds('abc'))).toBe(true);
  });
  it('returns NaN for empty, malformed, too-few, or too-many parts', () => {
    expect(Number.isNaN(parseClockToSeconds(''))).toBe(true);
    expect(Number.isNaN(parseClockToSeconds('1::2'))).toBe(true);
    expect(Number.isNaN(parseClockToSeconds('5'))).toBe(true);
    expect(Number.isNaN(parseClockToSeconds('1:23:45:67'))).toBe(true);
  });
});

describe('buildWatchUrl', () => {
  it('builds a watch URL with an integer t param', () => {
    expect(buildWatchUrl('z02Y-1OvWSM', 135)).toBe(
      'https://www.youtube.com/watch?v=z02Y-1OvWSM&t=135s',
    );
  });
  it('floors and clamps the start', () => {
    expect(buildWatchUrl('abc', 135.9)).toBe('https://www.youtube.com/watch?v=abc&t=135s');
    expect(buildWatchUrl('abc', -1)).toBe('https://www.youtube.com/watch?v=abc&t=0s');
  });
});

describe('timestampLine', () => {
  it('renders the ▶ line with an en dash and start-anchored URL', () => {
    expect(timestampLine(135, 330, 'z02Y-1OvWSM')).toBe(
      '▶ [2:15–5:30](https://www.youtube.com/watch?v=z02Y-1OvWSM&t=135s)',
    );
  });
});

const SEGS: TranscriptSegment[] = [
  { text: 'intro words', offset: 0, duration: 5 },     // idx 0  @0:00
  { text: 'core claim', offset: 135, duration: 10 },   // idx 1  @2:15
  { text: 'more detail', offset: 330, duration: 20 },  // idx 2  @5:30
  { text: 'wrap up', offset: 600, duration: 30 },      // idx 3  @10:00, ends 10:30 (630)
];

describe('buildIndexedTranscript', () => {
  it('prefixes each segment with [idx @m:ss]', () => {
    expect(buildIndexedTranscript(SEGS.slice(0, 2))).toBe('[0 @0:00] intro words\n[1 @2:15] core claim');
  });
});

describe('resolveTranscriptTokens', () => {
  const md = '## 1. A\n[[TS:0]]\n\nbody a\n\n## 2. B\n[[TS:1]]\n\nbody b\n\n## Conclusion\n[[TS:3]]\n\nend';

  it('replaces own-line tokens with ▶ lines; end = next token start, last = video duration', () => {
    const out = resolveTranscriptTokens(md, SEGS, 'vid123');
    expect(out).toContain('▶ [0:00–2:15](https://www.youtube.com/watch?v=vid123&t=0s)');
    expect(out).toContain('▶ [2:15–10:00](https://www.youtube.com/watch?v=vid123&t=135s)');
    expect(out).toContain('▶ [10:00–10:30](https://www.youtube.com/watch?v=vid123&t=600s)'); // last → duration
    expect(out).not.toMatch(/\[\[TS:/); // no raw tokens remain
  });

  it('returns markdown unchanged when there are no tokens at all', () => {
    const plain = '## 1. A\n\nbody';
    expect(resolveTranscriptTokens(plain, SEGS, 'vid123')).toBe(plain);
  });

  it('strips a stray inline token even when there is NO own-line token (spec §8)', () => {
    const inlineOnly = '## 1. A\n\nbody with stray [[TS:2]] inline only';
    const out = resolveTranscriptTokens(inlineOnly, SEGS, 'vid123');
    expect(out).not.toMatch(/\[\[TS:/);
    expect(out).toContain('body with stray  inline only');
  });

  it('leaves a token inside a fenced code block untouched (fence-aware)', () => {
    const fenced = '## 1. A\n[[TS:0]]\n\n```\nexample [[TS:1]] literal\n```\n';
    const out = resolveTranscriptTokens(fenced, SEGS, 'vid123');
    expect(out).toContain('▶ [0:00–'); // own-line token outside the fence resolved
    expect(out).toContain('example [[TS:1]] literal'); // fenced token preserved verbatim
  });

  it('leaves an OWN-LINE token inside a fenced block untouched', () => {
    const fenced = '## 1. A\n[[TS:0]]\n\n```\n[[TS:1]]\n```\n';
    const out = resolveTranscriptTokens(fenced, SEGS, 'vid123');
    expect(out).toContain('▶ [0:00–'); // real own-line token (outside fence) resolved
    expect(out).toContain('```\n[[TS:1]]\n```'); // own-line token INSIDE the fence preserved verbatim
  });

  it('keeps the valid token, drops the out-of-range one', () => {
    const bad = '## 1. A\n[[TS:0]]\n\n## 2. B\n[[TS:99]]\n\n';
    const out = resolveTranscriptTokens(bad, SEGS, 'vid123');
    expect(out).toContain('▶ [0:00–10:30]');
    expect(out).not.toMatch(/\[\[TS:/);
  });

  it('keeps the first document candidate when offsets decrease', () => {
    const bad = '## 1. A\n[[TS:2]]\n\n## 2. B\n[[TS:1]]\n\n';
    const out = resolveTranscriptTokens(bad, SEGS, 'vid123');
    expect(out).toContain('▶ [5:30–10:30]');
    expect((out.match(/▶/g) ?? []).length).toBe(1);
  });

  it('degrades when videoId is missing or segments are empty', () => {
    expect(resolveTranscriptTokens(md, SEGS, null)).not.toMatch(/▶|\[\[TS:/);
    expect(resolveTranscriptTokens(md, [], 'vid123')).not.toMatch(/▶|\[\[TS:/);
  });

  it('strips a stray inline (non-own-line) token even on the valid path', () => {
    const inlineTok = '## 1. A\n[[TS:0]]\n\nbody with stray [[TS:2]] inline';
    const out = resolveTranscriptTokens(inlineTok, SEGS, 'vid123');
    expect(out).toContain('▶ [0:00–'); // own-line token resolved
    expect(out).not.toMatch(/\[\[TS:/); // inline stray stripped
  });
});

describe('resolveTranscriptTokens — malformed token hardening (Codex)', () => {
  it('drops a negative-index token, keeps the valid one', () => {
    const bad = '## 1. A\n[[TS:0]]\n\n## 2. B\n[[TS:-1]]\n\nbody';
    const out = resolveTranscriptTokens(bad, SEGS, 'vid123');
    expect(out).toContain('▶ [0:00–10:30]');
    expect(out).not.toMatch(/\[\[TS:/);
  });

  it('treats a float token as invalid (degrades — does NOT resolve to index 1)', () => {
    const bad = '## 1. A\n[[TS:1.5]]\n\nbody';
    const out = resolveTranscriptTokens(bad, SEGS, 'vid123');
    expect(out).not.toMatch(/▶/);
    expect(out).not.toMatch(/\[\[TS:/);
  });

  it('strips a malformed non-digit inline token on the no-own-line-token path', () => {
    const inlineBad = '## 1. A\n\nbody [[TS:abc]] inline';
    const out = resolveTranscriptTokens(inlineBad, SEGS, 'vid123');
    expect(out).not.toMatch(/\[\[TS:/);
  });

  it('keeps only the token whose offset is below videoDuration', () => {
    const badSegs = [
      { text: 'a', offset: 100, duration: 5 },
      { text: 'b', offset: 90, duration: 5 }, // out of chronological order
    ];
    const md = '## 1. A\n[[TS:0]]\n\n## 2. B\n[[TS:1]]\n\nbody';
    // videoDuration = floor(90+5) = 95; idx0 (off100) excluded (>=95); idx1 (off90) kept
    const out = resolveTranscriptTokens(md, badSegs, 'vid123');
    expect(out).toContain('▶ [1:30–1:35]');
    expect((out.match(/▶/g) ?? []).length).toBe(1);
  });

  it('drops a malformed own-line token, keeps the valid one', () => {
    const bad = '## 1. A\n[[TS:0]]\n\n## 2. B\n[[TS:a]b]]\n\nbody';
    const out = resolveTranscriptTokens(bad, SEGS, 'vid123');
    expect(out).toContain('▶ [0:00–10:30]');
    expect(out).not.toMatch(/\[\[TS:/);
  });

  it('scrubs an embedded-] inline token on the no-own-line path', () => {
    const out = resolveTranscriptTokens('## 1. A\n\nbody [[TS:a]b]] x', SEGS, 'vid123');
    expect(out).not.toMatch(/\[\[TS:/);
  });

  it('degrades when the final segment (used for video duration) has non-finite timing', () => {
    const badLast = [
      { text: 'a', offset: 0, duration: 5 },
      { text: 'b', offset: 10, duration: NaN }, // last row feeds videoDuration
    ];
    const out = resolveTranscriptTokens('## 1. A\n[[TS:0]]\n\nbody', badLast, 'vid123');
    expect(out).not.toMatch(/▶|\[\[TS:/);
  });

  // The dig prompt formerly asked Gemini to cite the transcript inline. Gemini
  // fused the [[ ]] citation wrapper with the `[i @m:ss]` DISPLAY format it sees
  // in buildIndexedTranscript, emitting `[[0 @1:09]]` — a shape that matches
  // neither OWN_LINE_TOKEN nor ANY_TOKEN, so it leaked into the reader's doc as
  // literal text. The safety strip must scrub this malformed citation shape too.
  it('strips a malformed [[<index> @<clock>]] citation token inline (display-format echo)', () => {
    const inline = '## 1. A\n\nThe model is stateless [[0 @1:09]] and forgets context.';
    const out = resolveTranscriptTokens(inline, SEGS, 'vid123');
    expect(out).not.toMatch(/\[\[/);             // no raw citation token of any shape
    expect(out).toContain('The model is stateless  and forgets context.');
  });

  it('strips a multi-digit / h:mm:ss malformed citation token inline', () => {
    const inline = '## 1. A\n\nclaim [[12 @1:09:23]] more text';
    const out = resolveTranscriptTokens(inline, SEGS, 'vid123');
    expect(out).not.toMatch(/\[\[/);
  });

  // H1 (adversarial): an LLM may pad the wrapper — `[[ 0 @ 1:09 ]]`. Whitespace
  // right after `[[` or before `]]` must not let the leak through.
  it('strips a malformed citation token padded with whitespace inside the wrapper', () => {
    const inline = '## 1. A\n\nclaim [[ 0 @ 1:09 ]] more text';
    const out = resolveTranscriptTokens(inline, SEGS, 'vid123');
    expect(out).not.toMatch(/\[\[/);
  });

  it('strips a malformed citation token on its own line', () => {
    const ownLine = '## 1. A\n[[TS:0]]\n\nbody\n[[3 @5:30]]\n\nmore';
    const out = resolveTranscriptTokens(ownLine, SEGS, 'vid123');
    expect(out).toContain('▶ [0:00–10:30]'); // valid own-line token still resolves
    expect(out).not.toMatch(/\[\[/);          // malformed own-line token scrubbed
  });

  it('does NOT strip a genuine Obsidian wikilink (no digits-then-@ shape)', () => {
    const wiki = '## 1. A\n\nSee [[Some Note]] and [[2024 Roadmap]] for details.';
    const out = resolveTranscriptTokens(wiki, SEGS, 'vid123');
    expect(out).toContain('[[Some Note]]');
    expect(out).toContain('[[2024 Roadmap]]'); // digits but no `@` → not a citation
  });
});

describe('resolveTranscriptTokens — windowed segments', () => {
  it('windowed segments resolve the tail token when full duration is passed', () => {
    // window = two segments at 600s and 660s; full video is 1279s long
    const segments = [
      { text: 'a', offset: 600, duration: 30 },
      { text: 'b', offset: 660, duration: 30 },
    ];
    // [[TS:1]] is the last (tail) segment — without a duration bound it would be dropped.
    const out = resolveTranscriptTokens('## Section\n[[TS:1]]\n\nbody', segments, 'vid123', 1279);
    expect(out).toContain('t=660s');            // tail token survived (the URL param)
    expect(out).not.toContain('[[TS:1]]');      // token was replaced, not left raw
    // B-1: the tail token's END must use the passed full duration (21:19), not the window end,
    // proving videoDuration gates the :119 end computation too — not just the :97 candidate filter.
    expect(out).toContain('21:19');             // formatTimestamp(1279)
  });

  it('omitting videoDuration preserves prior behavior (no signature break)', () => {
    const segments = [{ text: 'a', offset: 10, duration: 5 }];
    const out = resolveTranscriptTokens('## Section\n[[TS:0]]\n\nbody', segments, 'vid123');
    expect(out).toContain('t=10s');             // the URL param
  });
});

describe('resolveTranscriptTokens — lenient selection', () => {
  it('keeps valid tokens and drops only an out-of-range one (partial)', () => {
    const md = '## 1. A\n[[TS:0]]\n\n## 2. B\n[[TS:99]]\n\nbody';
    const out = resolveTranscriptTokens(md, SEGS, 'vid123');
    expect(out).toContain('▶ [0:00–10:30](https://www.youtube.com/watch?v=vid123&t=0s)'); // only kept → end=duration
    expect(out).not.toMatch(/\[\[TS:/);
  });

  it('keeps the longer increasing tail, dropping a spuriously-large early token (LIS)', () => {
    // offsets in doc order: [600(idx3), 0(idx0), 135(idx1), 330(idx2)] → LIS keeps idx0,1,2
    const md = '## A\n[[TS:3]]\n\n## B\n[[TS:0]]\n\n## C\n[[TS:1]]\n\n## D\n[[TS:2]]\n\nx';
    const out = resolveTranscriptTokens(md, SEGS, 'vid123');
    expect(out).toContain('▶ [0:00–2:15]');   // idx0 → next kept idx1
    expect(out).toContain('▶ [2:15–5:30]');   // idx1 → idx2
    expect(out).toContain('▶ [5:30–10:30]');  // idx2 (last kept) → duration
    expect((out.match(/▶/g) ?? []).length).toBe(3); // idx3 (offset 600) dropped
  });

  it('candidate-removes an in-range index whose offset is NaN, keeps the sibling', () => {
    const segs = [{ text: 'a', offset: 0, duration: 5 }, { text: 'b', offset: NaN, duration: 5 }, { text: 'c', offset: 200, duration: 10 }];
    const md = '## A\n[[TS:0]]\n\n## B\n[[TS:1]]\n\n## C\n[[TS:2]]\n\nx';
    const out = resolveTranscriptTokens(md, segs, 'vid123');
    expect((out.match(/▶/g) ?? []).length).toBe(2); // idx1 (NaN offset) dropped; idx0,idx2 kept
    expect(out).not.toMatch(/\[\[TS:/);
  });

  it('does not count a malformed token inside a fence (left verbatim)', () => {
    const md = '## A\n[[TS:0]]\n\n```\n[[TS:99]]\n```\n';
    const out = resolveTranscriptTokens(md, SEGS, 'vid123');
    expect(out).toContain('▶ [0:00–10:30]');     // sole own-line token kept, end=duration (fenced not counted)
    expect(out).toContain('```\n[[TS:99]]\n```'); // fenced token verbatim
  });

  it('single kept token renders start..videoDuration', () => {
    const md = '## A\n[[TS:1]]\n\nbody';
    const out = resolveTranscriptTokens(md, SEGS, 'vid123');
    expect(out).toContain('▶ [2:15–10:30](https://www.youtube.com/watch?v=vid123&t=135s)');
  });

  it('all-decreasing offsets → keeps exactly the FIRST document candidate', () => {
    const md = '## A\n[[TS:3]]\n\n## B\n[[TS:2]]\n\n## C\n[[TS:1]]\n\nx'; // offsets 600,330,135 decreasing
    const out = resolveTranscriptTokens(md, SEGS, 'vid123');
    expect((out.match(/▶/g) ?? []).length).toBe(1);
    expect(out).toContain('▶ [10:00–10:30]'); // idx3 (off600), first doc candidate; end=duration
  });

  it('duplicate offsets → drops the later-in-document duplicate', () => {
    const segs = [{ text: 'a', offset: 0, duration: 5 }, { text: 'b', offset: 100, duration: 5 }, { text: 'c', offset: 100, duration: 5 }, { text: 'd', offset: 200, duration: 5 }];
    const md = '## A\n[[TS:0]]\n\n## B\n[[TS:1]]\n\n## C\n[[TS:2]]\n\n## D\n[[TS:3]]\n\nx';
    const out = resolveTranscriptTokens(md, segs, 'vid123');
    expect((out.match(/▶/g) ?? []).length).toBe(3); // idx0,idx1,idx3 kept; idx2 (dup offset 100) dropped
  });

  it('warns "kept M of N" on a partial result', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    resolveTranscriptTokens('## A\n[[TS:0]]\n\n## B\n[[TS:99]]\n\nx', SEGS, 'vid123');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('kept 1 of 2'));
    warn.mockRestore();
  });

  it('warns "dropped all N" when every token is invalid', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const out = resolveTranscriptTokens('## A\n[[TS:98]]\n\n## B\n[[TS:99]]\n\nx', SEGS, 'vid123');
    expect(out).not.toMatch(/▶/);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('dropped all 2'));
    warn.mockRestore();
  });
});
