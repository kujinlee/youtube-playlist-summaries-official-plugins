import { parseSlideTokens, sanitizeCaption } from '@/lib/dig/slide-tokens';

// ── Behavior 1: Valid token in range ──────────────────────────────────────────────────────
test('valid token in range', () => {
  expect(parseSlideTokens('x [[SLIDE:312|Diagram]] y', 300, 400))
    .toEqual([{ raw: '[[SLIDE:312|Diagram]]', sec: 312, caption: 'Diagram' }]);
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
