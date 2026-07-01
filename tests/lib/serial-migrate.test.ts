import { planMigration } from '@/lib/serial-migrate';
import type { Video } from '@/types';

const v = (over: Partial<Video>): Video => ({
  id: 'x', title: 'T', youtubeUrl: 'u', language: 'en', durationSeconds: 1, archived: false,
  ratings: { usefulness: 3, depth: 3, originality: 3, recency: 3, completeness: 3 },
  overallScore: 3, summaryMd: 's.md',
  processedAt: '2026-01-01T00:00:00.000Z', ...over,
});

it('assigns serials in backfill order and plans md+model renames', () => {
  const { assignments, perVideo } = planMigration([
    v({ id: 'a', processedAt: '2026-01-01T00:00:00.000Z', summaryMd: 'alpha.md' }),
  ]);
  expect(assignments).toEqual([{ id: 'a', serial: 1 }]);
  const ops = perVideo[0].renames;
  expect(ops).toContainEqual({ field: 'summaryMd', from: 'alpha.md', to: '001_alpha.md' });
  expect(ops).toContainEqual({ field: 'model', from: 'models/alpha.json', to: 'models/001_alpha.json' });
});

it('skips already-prefixed fields (idempotent)', () => {
  const { perVideo } = planMigration([v({ id: 'a', serialNumber: 1, summaryMd: '001_alpha.md' })]);
  expect(perVideo[0].renames.find((o) => o.field === 'summaryMd')).toBeUndefined();
});

it('continues max+1 over existing serials', () => {
  const { assignments } = planMigration([
    v({ id: 'old', serialNumber: 9 }),
    v({ id: 'new', summaryMd: 'n.md', processedAt: '2026-02-01T00:00:00.000Z' }),
  ]);
  expect(assignments).toEqual([{ id: 'new', serial: 10 }]);
});

it('plans renames for existing-serial unprefixed video', () => {
  const { assignments, perVideo } = planMigration([
    v({
      id: 'b',
      serialNumber: 5,
      summaryMd: 'foo.md',
      summaryHtml: 'htmls/foo.html',
    }),
  ]);
  expect(assignments).toEqual([]);
  const renames = perVideo[0].renames;
  expect(renames).toContainEqual({ field: 'summaryMd', from: 'foo.md', to: '005_foo.md' });
  expect(renames).toContainEqual({
    field: 'summaryHtml',
    from: 'htmls/foo.html',
    to: 'htmls/005_foo.html',
  });
  expect(renames).toContainEqual({ field: 'model', from: 'models/foo.json', to: 'models/005_foo.json' });
});
