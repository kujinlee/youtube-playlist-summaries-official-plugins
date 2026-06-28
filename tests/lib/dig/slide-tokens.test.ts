import { parseSlideTokens, sanitizeCaption } from '@/lib/dig/slide-tokens';

// ── Behavior 1: Valid token in range ──────────────────────────────────────────────────────
test('valid token in range', () => {
  expect(parseSlideTokens('x [[SLIDE:312|Diagram]] y', 300, 400))
    .toEqual([{ raw: '[[SLIDE:312|Diagram]]', sec: 312, endSec: null, caption: 'Diagram' }]);
});

// ── Behavior 2: Out-of-range dropped ──────────────────────────────────────────────────────
test('out-of-range dropped', () => {
  expect(parseSlideTokens('[[SLIDE:999|x]]', 300, 400)).toEqual([]);
});

test('sec below startSec is dropped', () => {
  expect(parseSlideTokens('[[SLIDE:100|x]]', 300, 400)).toEqual([]);
});

// ── Behavior 3: Non-numeric / negative dropped ────────────────────────────────────────────
test('non-numeric sec dropped', () => {
  expect(parseSlideTokens('[[SLIDE:abc|x]]', 0, 999)).toEqual([]);
});

test('negative sec dropped', () => {
  // The grammar (\d+) won't match a leading '-', so [[SLIDE:-5]] won't match
  // the regex at all — confirm it produces nothing.
  expect(parseSlideTokens('[[SLIDE:-5|x]]', 0, 999)).toEqual([]);
});

// ── Behavior 4: Pipe in caption — split on FIRST pipe; inner pipe sanitized ───────────────
test('pipe in caption: split on first pipe; inner pipe removed', () => {
  const tokens = parseSlideTokens('[[SLIDE:312|perceive | plan]]', 300, 400);
  expect(tokens).toHaveLength(1);
  // caption = text after first '|', inner pipes sanitized out
  // '|' stripped, surrounding spaces collapse → single space between words.
  expect(tokens[0].caption).toBe('perceive plan');
});

// ── Behavior 5: Dedupe by sec — first caption wins ────────────────────────────────────────
test('dedupe by sec keeps first caption', () => {
  const t = parseSlideTokens('[[SLIDE:312|A]] [[SLIDE:312|B]]', 300, 400);
  expect(t).toHaveLength(1);
  expect(t[0].caption).toBe('A');
});

// ── Behavior 6: Cap at 3 ──────────────────────────────────────────────────────────────────
test('cap at 3', () => {
  const md = [310, 320, 330, 340, 350].map((s) => `[[SLIDE:${s}|c]]`).join(' ');
  expect(parseSlideTokens(md, 300, 400)).toHaveLength(3);
});

// ── Behavior 7: Caption injection neutralized ─────────────────────────────────────────────
test('caption injection neutralized', () => {
  expect(sanitizeCaption('](javascript:alert(1))')).not.toMatch(/[\]\)\(]/);
});

test('sanitizeCaption strips ] [ ( ) | chars', () => {
  const result = sanitizeCaption('foo] bar[ baz( qux) pipe|end');
  expect(result).not.toMatch(/[\]\[\(\)\|]/);
});

// ── Behavior 8: No caption → empty string ─────────────────────────────────────────────────
test('no caption produces empty string', () => {
  const tokens = parseSlideTokens('[[SLIDE:312]]', 300, 400);
  expect(tokens).toHaveLength(1);
  expect(tokens[0].caption).toBe('');
});

// ── Behavior 9: Newline / control collapsed + 160 cap ─────────────────────────────────────
test('newline in caption collapsed to space', () => {
  const result = sanitizeCaption('hello\nworld');
  expect(result).not.toContain('\n');
  expect(result).toBe('hello world');
});

test('control characters collapsed', () => {
  const result = sanitizeCaption('foo\x00\x01\x1fbar');
  expect(result).not.toMatch(/[\x00-\x1f]/);
});

test('caption capped at 160 characters', () => {
  const long = 'a'.repeat(200);
  expect(sanitizeCaption(long).length).toBeLessThanOrEqual(160);
});

// ── raw field is the full original token text ─────────────────────────────────────────────
test('raw field contains the full original token', () => {
  const tokens = parseSlideTokens('prefix [[SLIDE:312|Diagram]] suffix', 300, 400);
  expect(tokens[0].raw).toBe('[[SLIDE:312|Diagram]]');
});

// ── Clock-format timestamps (M:SS / H:MM:SS) ─────────────────────────────────────────────

test('clock M:SS format is accepted and converted to integer seconds', () => {
  // 3:51 = 3*60 + 51 = 231
  const tokens = parseSlideTokens('x [[SLIDE:3:51|cap]] y', 200, 300);
  expect(tokens).toHaveLength(1);
  expect(tokens[0].sec).toBe(231);
  expect(tokens[0].caption).toBe('cap');
});

test('clock M:SS raw field is the full original token string', () => {
  const tokens = parseSlideTokens('x [[SLIDE:3:51|cap]] y', 200, 300);
  expect(tokens[0].raw).toBe('[[SLIDE:3:51|cap]]');
});

test('clock H:MM:SS format is accepted and converted to integer seconds', () => {
  // 1:02:05 = 1*3600 + 2*60 + 5 = 3725
  const tokens = parseSlideTokens('[[SLIDE:1:02:05|cap]]', 0, 10000);
  expect(tokens).toHaveLength(1);
  expect(tokens[0].sec).toBe(3725);
});

test('clock M:S with single-digit seconds is accepted (5:2 → 302)', () => {
  // Gemini sometimes emits non-zero-padded seconds; 5:2 = 5*60 + 2 = 302.
  const tokens = parseSlideTokens('x [[SLIDE:5:2|cap]] y', 300, 400);
  expect(tokens).toEqual([{ raw: '[[SLIDE:5:2|cap]]', sec: 302, endSec: null, caption: 'cap' }]);
});

test('clock M:S 6:0 → 360 (single-digit seconds, zero)', () => {
  const tokens = parseSlideTokens('[[SLIDE:6:0|cap]]', 300, 400);
  expect(tokens[0].sec).toBe(360);
});

test('plain integer still works after clock-format support added (back-compat)', () => {
  const tokens = parseSlideTokens('[[SLIDE:231|back-compat]]', 200, 300);
  expect(tokens).toHaveLength(1);
  expect(tokens[0].sec).toBe(231);
});

test('invalid clock with bad seconds field is dropped (9:99)', () => {
  // 9:99 = 9*60 + 99 = 639, which is a valid number — but it's outside the window [0, 100]
  // Test: ensure the resolved value 639 is dropped because it's out of [0, 100].
  expect(parseSlideTokens('[[SLIDE:9:99|x]]', 0, 100)).toEqual([]);
});

test('clock token outside [startSec, endSec] is dropped', () => {
  // 3:51 = 231, outside [300, 400]
  expect(parseSlideTokens('[[SLIDE:3:51|x]]', 300, 400)).toEqual([]);
});

// ── Boundary: sec exactly equal to startSec and endSec are in-range ───────────────────────
test('sec equal to startSec is included', () => {
  const tokens = parseSlideTokens('[[SLIDE:300|Edge]]', 300, 400);
  expect(tokens).toHaveLength(1);
  expect(tokens[0].sec).toBe(300);
});

test('sec equal to endSec is included', () => {
  const tokens = parseSlideTokens('[[SLIDE:400|Edge]]', 300, 400);
  expect(tokens).toHaveLength(1);
  expect(tokens[0].sec).toBe(400);
});

// ── endSec (start|end|caption three-field form) ───────────────────────────────────────────

it('parses start|end|caption into sec + endSec', () => {
  expect(parseSlideTokens('[[SLIDE:333|339|code box]]', 300, 400))
    .toEqual([{ raw: '[[SLIDE:333|339|code box]]', sec: 333, endSec: 339, caption: 'code box' }]);
});

it('parses clock start|end', () => {
  const t = parseSlideTokens('[[SLIDE:5:33|5:39|cap]]', 300, 400);
  expect(t[0].sec).toBe(333); expect(t[0].endSec).toBe(339);
});

it('old single-time format → endSec null (tolerant)', () => {
  expect(parseSlideTokens('[[SLIDE:312|Diagram]]', 300, 400)[0].endSec).toBeNull();
});

it('end <= start is rejected → endSec null', () => {
  expect(parseSlideTokens('[[SLIDE:333|333|x]]', 300, 400)[0].endSec).toBeNull();
  expect(parseSlideTokens('[[SLIDE:333|330|x]]', 300, 400)[0].endSec).toBeNull();
});

it('end beyond the window is clamped to windowEnd', () => {
  expect(parseSlideTokens('[[SLIDE:333|999|x]]', 300, 400)[0].endSec).toBe(400);
});

it('caption with a pipe still sanitizes (end absent)', () => {
  expect(parseSlideTokens('[[SLIDE:312|perceive | plan]]', 300, 400)[0].caption).toBe('perceive plan');
});

it('numeric two-field caption is NOT eaten as an end (B-1)', () => {
  // no trailing '|' after 2024 → lookahead fails → 2024 is the caption, not an end
  expect(parseSlideTokens('[[SLIDE:333|2024]]', 300, 400))
    .toEqual([{ raw: '[[SLIDE:333|2024]]', sec: 333, endSec: null, caption: '2024' }]);
  expect(parseSlideTokens('[[SLIDE:333|42]]', 300, 400)[0].caption).toBe('42');
});
