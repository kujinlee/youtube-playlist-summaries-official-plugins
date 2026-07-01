import { ProgressEventSchema } from '@/types';

describe('ProgressEvent done.log', () => {
  it('accepts an optional log (saved filename) on a done event', () => {
    expect(ProgressEventSchema.safeParse({ type: 'done', current: 1, total: 1, log: '275_x.pdf' }).success).toBe(true);
  });

  it('still accepts a done event without log', () => {
    expect(ProgressEventSchema.safeParse({ type: 'done', current: 1, total: 1 }).success).toBe(true);
  });
});
