import { summaryNeedsWork, summarySelectable } from '../../../lib/html-doc/eligibility';
import type { Video } from '../../../types';

function v(over: Partial<Video> = {}): Video {
  return {
    id: 'x', title: 'T', youtubeUrl: 'https://youtu.be/x', language: 'en',
    durationSeconds: 1, archived: false,
    ratings: { usefulness: 3, depth: 3, originality: 3, recency: 3, completeness: 3 },
    overallScore: 3, summaryMd: '1_t.md', summaryPdf: null, deepDiveMd: null, deepDivePdf: null,
    summaryHtml: null, processedAt: '2026-06-29T00:00:00.000Z', docVersion: { major: 3, minor: 3 },
    ...over,
  } as Video;
}

describe('summary eligibility', () => {
  it('selectable iff summaryMd present', () => {
    expect(summarySelectable(v({ summaryMd: '1_t.md' }))).toBe(true);
    expect(summarySelectable(v({ summaryMd: null }))).toBe(false);
  });
  it('needs work when summaryHtml missing', () => {
    expect(summaryNeedsWork(v({ summaryHtml: null }))).toBe(true);
  });
  it('needs work when docVersion older than current', () => {
    expect(summaryNeedsWork(v({ summaryHtml: 'h.html', docVersion: { major: 2, minor: 0 } }))).toBe(true);
  });
  it('no work when current', () => {
    expect(summaryNeedsWork(v({ summaryHtml: 'h.html', docVersion: { major: 3, minor: 3 } }))).toBe(false);
  });
  it('no work when no summaryMd (nothing to generate from)', () => {
    expect(summaryNeedsWork(v({ summaryMd: null, summaryHtml: null }))).toBe(false);
  });
});
