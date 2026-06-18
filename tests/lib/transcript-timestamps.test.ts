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

  it('degrades (strips ALL tokens, no ▶ lines) when any index is out of range', () => {
    const bad = '## 1. A\n[[TS:0]]\n\n## 2. B\n[[TS:99]]\n\n';
    const out = resolveTranscriptTokens(bad, SEGS, 'vid123');
    expect(out).not.toMatch(/▶/);
    expect(out).not.toMatch(/\[\[TS:/);
  });

  it('degrades when indices are not strictly increasing', () => {
    const bad = '## 1. A\n[[TS:2]]\n\n## 2. B\n[[TS:1]]\n\n';
    const out = resolveTranscriptTokens(bad, SEGS, 'vid123');
    expect(out).not.toMatch(/▶/);
    expect(out).not.toMatch(/\[\[TS:/);
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
  it('degrades AND strips a malformed non-digit own-line token (no raw token leaks)', () => {
    const bad = '## 1. A\n[[TS:0]]\n\n## 2. B\n[[TS:-1]]\n\nbody';
    const out = resolveTranscriptTokens(bad, SEGS, 'vid123');
    expect(out).not.toMatch(/▶/);
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

  it('degrades when segment offsets are non-monotonic even though indices increase', () => {
    const badSegs = [
      { text: 'a', offset: 100, duration: 5 },
      { text: 'b', offset: 90, duration: 5 }, // out of chronological order
    ];
    const md = '## 1. A\n[[TS:0]]\n\n## 2. B\n[[TS:1]]\n\nbody';
    const out = resolveTranscriptTokens(md, badSegs, 'vid123');
    expect(out).not.toMatch(/▶/);
    expect(out).not.toMatch(/\[\[TS:/);
  });
});
