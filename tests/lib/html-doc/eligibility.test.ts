import { summaryNeedsWork, summarySelectable, videoNeedsBatchWork } from '../../../lib/html-doc/eligibility';
import type { Video } from '../../../types';

function v(over: Partial<Video> = {}): Video {
  return {
    id: 'x', title: 'T', youtubeUrl: 'https://youtu.be/x', language: 'en',
    durationSeconds: 1, archived: false,
    ratings: { usefulness: 3, depth: 3, originality: 3, recency: 3, completeness: 3 },
    overallScore: 3, summaryMd: '1_t.md',
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

describe('videoNeedsBatchWork', () => {
  it('summary mode: needs work iff summary missing/stale', () => {
    expect(videoNeedsBatchWork(v({ summaryHtml: null }), 'summary')).toBe(true);
    expect(videoNeedsBatchWork(v({ summaryHtml: 'h.html', docVersion: { major: 3, minor: 3 } }), 'summary')).toBe(false);
  });
  it('summary-dig: a current summary that was never dug still needs work', () => {
    expect(videoNeedsBatchWork(v({ summaryHtml: 'h.html', docVersion: { major: 3, minor: 3 }, digDeeperMd: null }), 'summary-dig')).toBe(true);
    expect(videoNeedsBatchWork(v({ summaryHtml: 'h.html', docVersion: { major: 3, minor: 3 }, digDeeperMd: 'x-dig-deeper.md' }), 'summary-dig')).toBe(false);
    expect(videoNeedsBatchWork(v({ summaryMd: null, summaryHtml: null, digDeeperMd: null }), 'summary-dig')).toBe(false); // no summary → nothing
  });
});
