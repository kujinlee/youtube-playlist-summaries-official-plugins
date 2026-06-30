import { VideoSchema } from '@/types';

describe('Video.serialNumber', () => {
  const base = {
    id: 'vid123', title: 'T', youtubeUrl: 'https://youtube.com/watch?v=vid123',
    language: 'en', durationSeconds: 1, archived: false,
    ratings: { usefulness: 3, depth: 3, originality: 3, recency: 3, completeness: 3 },
    overallScore: 3, summaryMd: 'a.md', deepDiveMd: null,
    processedAt: '2026-01-01T00:00:00.000Z',
  };
  it('accepts a positive integer serialNumber', () => {
    expect(VideoSchema.parse({ ...base, serialNumber: 7 }).serialNumber).toBe(7);
  });
  it('is optional (absent is valid)', () => {
    expect(VideoSchema.parse(base).serialNumber).toBeUndefined();
  });
  it('rejects zero / negative / non-integer', () => {
    expect(() => VideoSchema.parse({ ...base, serialNumber: 0 })).toThrow();
    expect(() => VideoSchema.parse({ ...base, serialNumber: -1 })).toThrow();
    expect(() => VideoSchema.parse({ ...base, serialNumber: 1.5 })).toThrow();
  });
});
