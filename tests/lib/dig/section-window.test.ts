import { windowForSection } from '@/lib/dig/section-window';
import type { ParsedSection } from '@/lib/html-doc/types';
import type { TranscriptSegment } from '@/lib/transcript-timestamps';

const seg = (offset: number): TranscriptSegment => ({ text: `s${offset}`, offset, duration: 10 });

// sec() helper: builds minimal ParsedSection; cast required because SectionTimeRange
// also requires label/url fields — windowForSection only reads startSec, endSec, prose.
const sec = (startSec: number | null, prose = 'body'): ParsedSection => ({
  numeral: '1',
  title: 'T',
  prose,
  timeRange: startSec == null ? null : { startSec, endSec: startSec + 1, label: '', url: '' },
});

// ── Behavior 1 & 4: mid-list window + transcript slice ─────────────────────────────────────
test('mid-list window ends at next section start; transcript sliced [start,end)', () => {
  const a = sec(100), b = sec(200);
  const w = windowForSection(a, [a, b], [seg(100), seg(150), seg(250)], 999)!;
  expect(w).toMatchObject({ sectionId: 100, startSec: 100, endSec: 200 });
  expect(w.transcriptWindow.map((s) => s.offset)).toEqual([100, 150]); // 250 excluded
});

// ── Behavior 2: last section uses durationSeconds ──────────────────────────────────────────
test('last section ends at duration', () => {
  const a = sec(100), b = sec(200);
  expect(windowForSection(b, [a, b], [], 900)!.endSec).toBe(900);
});

// ── Behavior 3: no timeRange → null ───────────────────────────────────────────────────────
test('section without timeRange is not dig-enabled', () => {
  const a = sec(null);
  expect(windowForSection(a, [a], [], 900)).toBeNull();
});

// ── Behavior 5: empty window (no segments in range) ───────────────────────────────────────
test('empty transcript window is still a valid result', () => {
  const a = sec(100), b = sec(200);
  const w = windowForSection(a, [a, b], [seg(300), seg(500)], 999)!;
  expect(w.transcriptWindow).toEqual([]);
  expect(w).toMatchObject({ sectionId: 100, startSec: 100, endSec: 200 });
});

// ── Behavior 6: blank prose falls back to title ────────────────────────────────────────────
test('empty prose falls back to title', () => {
  const a = sec(100, '   ');
  const b = sec(200);
  expect(windowForSection(a, [a, b], [], 900)!.summaryProse).toBe('T');
});

// ── Behavior 7: duplicate startSec — next-by-index wins ───────────────────────────────────
test('duplicate startSec uses next-by-index for endSec (L1 collision)', () => {
  const a = sec(100);
  const b = sec(100, 'dupe'); // same startSec, different index
  const w = windowForSection(a, [a, b], [], 999)!;
  // a is at index 0; b is at index 1; endSec = b.timeRange.startSec = 100
  // (documented collision: both share the same startSec)
  expect(w.endSec).toBe(100);
});

// ── Behavior 8: skip null-timeRange sections for endSec ────────────────────────────────────
test('skips sections without timeRange when finding endSec', () => {
  const a = sec(100);
  const n = sec(null); // non-dig-enabled section, timeRange: null
  const b = sec(300);
  const w = windowForSection(a, [a, n, b], [seg(100), seg(200)], 999)!;
  // a is at index 0; next dig-enabled is b at index 2; endSec = b.timeRange.startSec = 300
  expect(w.endSec).toBe(300);
  expect(w.transcriptWindow.map((s) => s.offset)).toEqual([100, 200]);
});
