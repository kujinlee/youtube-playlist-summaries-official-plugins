import { nextSerial, backfillOrder } from '@/lib/serial-assign';
import type { Video } from '@/types';

const v = (over: Partial<Video>): Video => ({
  id: 'x', title: 'T', youtubeUrl: 'u', language: 'en', durationSeconds: 1, archived: false,
  ratings: { usefulness: 3, depth: 3, originality: 3, recency: 3, completeness: 3 },
  overallScore: 3, summaryMd: 's.md', summaryPdf: null, deepDiveMd: null, deepDivePdf: null,
  processedAt: '2026-01-01T00:00:00.000Z', ...over,
});

describe('nextSerial', () => {
  it('is 1 when no video has a serial', () => { expect(nextSerial([v({}), v({ id: 'y' })])).toBe(1); });
  it('is max+1 including archived', () => {
    expect(nextSerial([v({ serialNumber: 3 }), v({ id: 'y', serialNumber: 9, archived: true })])).toBe(10);
  });
});

describe('backfillOrder', () => {
  it('orders by processedAt asc, tie-break id, only files-without-serial', () => {
    const out = backfillOrder([
      v({ id: 'b', processedAt: '2026-01-02T00:00:00.000Z' }),
      v({ id: 'a', processedAt: '2026-01-01T00:00:00.000Z' }),
      v({ id: 'c', processedAt: '2026-01-01T00:00:00.000Z' }),
      v({ id: 'has', serialNumber: 5 }),          // already has serial → excluded
      v({ id: 'nofile', summaryMd: null }),        // no file → excluded
    ]);
    expect(out.map((x) => x.id)).toEqual(['a', 'c', 'b']);
  });
});
