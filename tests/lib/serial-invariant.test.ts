// tests/lib/serial-invariant.test.ts
import { checkSerialInvariant, type SerialViolation } from '@/lib/serial-invariant';
import type { Video } from '@/types';

/** Minimal valid Video; override only what each behavior needs. */
function makeVideo(overrides: Partial<Video>): Video {
  return {
    id: 'vid',
    title: 'Video',
    youtubeUrl: 'https://youtube.com/watch?v=vid',
    language: 'en',
    durationSeconds: 300,
    archived: false,
    ratings: { usefulness: 3, depth: 3, originality: 3, recency: 3, completeness: 3 },
    overallScore: 3,
    summaryMd: null,
    processedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const ALL_EXIST = () => true;
const NONE_EXIST = () => false;

describe('checkSerialInvariant', () => {
  it('returns no violations for a correctly-prefixed field that resolves', () => {
    const v = makeVideo({ serialNumber: 7, summaryMd: '007_x.md' });
    expect(checkSerialInvariant([v], ALL_EXIST)).toEqual([]);
  });

  it('flags an unprefixed field with reason "prefix" and the expected name', () => {
    const v = makeVideo({ serialNumber: 7, summaryMd: 'x.md' });
    expect(checkSerialInvariant([v], ALL_EXIST)).toEqual<SerialViolation[]>([
      { id: 'vid', serial: 7, field: 'summaryMd', value: 'x.md', expected: '007_x.md', reason: 'prefix' },
    ]);
  });

  it('flags a wrong-serial prefix with reason "prefix"', () => {
    const v = makeVideo({ serialNumber: 7, summaryMd: '002_x.md' });
    const out = checkSerialInvariant([v], ALL_EXIST);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ field: 'summaryMd', reason: 'prefix', expected: '007_x.md' });
  });

  it('flags a correctly-prefixed field that does not resolve with reason "missing"', () => {
    const v = makeVideo({ serialNumber: 7, summaryMd: '007_x.md' });
    expect(checkSerialInvariant([v], NONE_EXIST)).toEqual<SerialViolation[]>([
      { id: 'vid', serial: 7, field: 'summaryMd', value: '007_x.md', expected: '007_x.md', reason: 'missing' },
    ]);
  });

  it('skips a video with no serialNumber (bare filenames are legal pre-serial)', () => {
    const v = makeVideo({ serialNumber: undefined, summaryMd: 'x.md' });
    expect(checkSerialInvariant([v], NONE_EXIST)).toEqual([]);
  });

  it('skips null and absent path fields', () => {
    const v = makeVideo({ serialNumber: 7, summaryMd: null, summaryHtml: null });
    expect(checkSerialInvariant([v], NONE_EXIST)).toEqual([]);
  });

  it('preserves a subdirectory, prefixing only the basename', () => {
    const v = makeVideo({ serialNumber: 7, summaryHtml: 'htmls/x.html' });
    const out = checkSerialInvariant([v], ALL_EXIST);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ field: 'summaryHtml', reason: 'prefix', expected: 'htmls/007_x.html' });
  });

  it('reports only the offending field when a video mixes clean and dirty fields', () => {
    const v = makeVideo({ serialNumber: 7, summaryMd: '007_x.md', digDeeperMd: 'x-dig-deeper.md' });
    const out = checkSerialInvariant([v], ALL_EXIST);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ field: 'digDeeperMd', reason: 'prefix' });
  });

  it('reports a prefix violation (not missing) when the path is both unprefixed and absent', () => {
    const v = makeVideo({ serialNumber: 7, summaryMd: 'x.md' });
    const out = checkSerialInvariant([v], NONE_EXIST);
    expect(out).toHaveLength(1);
    expect(out[0].reason).toBe('prefix');
  });

  it('isolates violations per video across a list', () => {
    const clean = makeVideo({ id: 'a', serialNumber: 1, summaryMd: '001_a.md' });
    const dirty = makeVideo({ id: 'b', serialNumber: 2, summaryMd: 'b.md' });
    const out = checkSerialInvariant([clean, dirty], ALL_EXIST);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'b', field: 'summaryMd', reason: 'prefix' });
  });

  it('checks every nullable path field, not just summaryMd', () => {
    const v = makeVideo({
      serialNumber: 7,
      summaryHtml: 'x.html',
      digDeeperMd: 'x-dig-deeper.md',
    });
    const fields = checkSerialInvariant([v], ALL_EXIST).map((x) => x.field).sort();
    expect(fields).toEqual(['digDeeperMd', 'summaryHtml']);
  });

  // Structural coverage: if PATH_FIELDS grows, this asserts the loop reaches the
  // new field (a dirty value on every field must surface a violation). Pairs with
  // the compile-time PathField⊆keyof Video assertion in serial-invariant.ts.
  it('reaches all four PATH_FIELDS when every one is dirty', () => {
    const v = makeVideo({
      serialNumber: 7,
      summaryMd: 'a.md',
      summaryHtml: 'e.html',
      digDeeperMd: 'g.md',
      digDeeperHtml: 'h.html',
    });
    const out = checkSerialInvariant([v], ALL_EXIST);
    expect(out).toHaveLength(4);
    expect(out.every((x) => x.reason === 'prefix')).toBe(true);
  });

  // serialNumber is schema-positive, but the skip is `== null` not falsiness, so a
  // 0 (if it ever bypassed the schema) is processed faithfully as the `000_` serial
  // rather than silently skipped. Documents the validity/correctness separation.
  it('treats serialNumber 0 as a real serial (000_), not "unassigned"', () => {
    const v = makeVideo({ serialNumber: 0, summaryMd: 'x.md' });
    const out = checkSerialInvariant([v], ALL_EXIST);
    expect(out).toEqual<SerialViolation[]>([
      { id: 'vid', serial: 0, field: 'summaryMd', value: 'x.md', expected: '000_x.md', reason: 'prefix' },
    ]);
  });
});
