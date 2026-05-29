import { VideoSchema, FILTER_DEFAULTS } from '../../types';

describe('VideoSchema personal review fields', () => {
  const minValidVideo = {
    id: 'abc123',
    title: 'Test',
    youtubeUrl: 'https://youtube.com/watch?v=abc123',
    language: 'en',
    durationSeconds: 60,
    archived: false,
    ratings: { usefulness: 3, depth: 3, originality: 3, recency: 3, completeness: 3 },
    overallScore: 3,
    summaryMd: null,
    summaryPdf: null,
    deepDiveMd: null,
    deepDivePdf: null,
    processedAt: '2024-01-01T00:00:00.000Z',
  };

  it('accepts a video without personalScore or personalNote', () => {
    expect(() => VideoSchema.parse(minValidVideo)).not.toThrow();
  });

  it('accepts personalScore in range 1–5', () => {
    for (const score of [1, 2, 3, 4, 5]) {
      expect(() => VideoSchema.parse({ ...minValidVideo, personalScore: score })).not.toThrow();
    }
  });

  it('rejects personalScore of 0', () => {
    expect(() => VideoSchema.parse({ ...minValidVideo, personalScore: 0 })).toThrow();
  });

  it('rejects personalScore of 6', () => {
    expect(() => VideoSchema.parse({ ...minValidVideo, personalScore: 6 })).toThrow();
  });

  it('rejects a non-integer personalScore (e.g. 1.5)', () => {
    expect(() => VideoSchema.parse({ ...minValidVideo, personalScore: 1.5 })).toThrow();
  });

  it('accepts personalNote up to 500 chars', () => {
    expect(() => VideoSchema.parse({ ...minValidVideo, personalNote: 'a'.repeat(500) })).not.toThrow();
  });

  it('rejects personalNote over 500 chars', () => {
    expect(() => VideoSchema.parse({ ...minValidVideo, personalNote: 'a'.repeat(501) })).toThrow();
  });
});

describe('FILTER_DEFAULTS', () => {
  it('has minPersonalScore: 0', () => {
    expect(FILTER_DEFAULTS.minPersonalScore).toBe(0);
  });
});
