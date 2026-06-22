import fs from 'fs';
import path from 'path';
import { ensureHtmlDoc } from '../../../lib/html-doc/ensure';
import * as pipeline from '../../../lib/pipeline';
import * as generate from '../../../lib/html-doc/generate';
import * as rerender from '../../../lib/html-doc/rerender';
import * as indexStore from '../../../lib/index-store';

jest.mock('../../../lib/pipeline');
jest.mock('../../../lib/html-doc/generate');
jest.mock('../../../lib/html-doc/rerender');
jest.mock('../../../lib/index-store');

const videoBase = {
  id: 'vid11111111', title: 'T', youtubeUrl: 'https://youtu.be/x', language: 'en' as const,
  durationSeconds: 5, archived: false, ratings: { usefulness: 3, depth: 3, originality: 3, recency: 3, completeness: 3 },
  overallScore: 3, summaryMd: 'base.md', summaryPdf: 'pdfs/base.pdf', deepDiveMd: null, deepDivePdf: null,
  processedAt: '2026-01-01T00:00:00.000Z', personalScore: 5,
};

beforeEach(() => {
  jest.clearAllMocks();
  (indexStore.assertOutputFolder as jest.Mock).mockReturnValue(undefined);
  (indexStore.assertVideoId as jest.Mock).mockReturnValue(undefined);
  (generate.runHtmlDoc as jest.Mock).mockResolvedValue(undefined);
  (pipeline.writeSummaryDoc as jest.Mock).mockResolvedValue({
    language: 'en', ratings: videoBase.ratings, overallScore: 4, tags: ['t'], summaryMd: 'base.md', mdContent: '#',
  });
});
function withVideo(v: object) {
  (indexStore.readIndex as jest.Mock).mockReturnValue({ videos: [{ ...videoBase, ...v }] });
}

describe('ensureHtmlDoc', () => {
  it('pre-feature (no docVersion) → re-summarizes, rebuilds, preserves personalScore, stamps current', async () => {
    withVideo({ docVersion: undefined, summaryHtml: 'htmls/base.html' });
    await ensureHtmlDoc('vid11111111', '/out', () => {});
    expect(pipeline.writeSummaryDoc).toHaveBeenCalledWith(expect.objectContaining({ baseName: 'base' }));
    expect(generate.runHtmlDoc).toHaveBeenCalled();
    expect(rerender.reRenderSummaryHtml).not.toHaveBeenCalled();
    const patches = (indexStore.updateVideoFields as jest.Mock).mock.calls.map((c) => c[2]);
    expect(patches).toEqual(expect.arrayContaining([expect.objectContaining({ overallScore: 4 })]));
    expect(patches).toEqual(expect.arrayContaining([expect.objectContaining({ docVersion: { major: 3, minor: 3 } })]));
    expect(patches.every((p) => !('personalScore' in p))).toBe(true);
  });

  it('current major but no HTML → full generate (no re-summarize), stamp', async () => {
    withVideo({ docVersion: { major: 3, minor: 3 }, summaryHtml: null });
    await ensureHtmlDoc('vid11111111', '/out', () => {});
    expect(pipeline.writeSummaryDoc).not.toHaveBeenCalled();
    expect(generate.runHtmlDoc).toHaveBeenCalled();
  });

  it('minor-stale with cached model → cheap re-render (no Gemini), stamp', async () => {
    withVideo({ docVersion: { major: 2, minor: 0 }, summaryHtml: 'htmls/base.html' });
    (rerender.reRenderSummaryHtml as jest.Mock).mockReturnValue({ status: 'rerendered', htmlPath: 'htmls/base.html' });
    await ensureHtmlDoc('vid11111111', '/out', () => {}, { major: 2, minor: 1 });
    expect(pipeline.writeSummaryDoc).not.toHaveBeenCalled();
    expect(rerender.reRenderSummaryHtml).toHaveBeenCalled();
    expect(generate.runHtmlDoc).not.toHaveBeenCalled();
  });

  it('current + HTML present → no work', async () => {
    withVideo({ docVersion: { major: 3, minor: 3 }, summaryHtml: 'htmls/base.html' });
    await ensureHtmlDoc('vid11111111', '/out', () => {});
    expect(pipeline.writeSummaryDoc).not.toHaveBeenCalled();
    expect(generate.runHtmlDoc).not.toHaveBeenCalled();
    expect(rerender.reRenderSummaryHtml).not.toHaveBeenCalled();
  });

  it('{3,0} stored is now minor-stale → cheap re-render (not re-summarize)', async () => {
    withVideo({ docVersion: { major: 3, minor: 0 }, summaryHtml: 'htmls/base.html' });
    (rerender.reRenderSummaryHtml as jest.Mock).mockReturnValue({ status: 'rerendered', htmlPath: 'htmls/base.html' });
    await ensureHtmlDoc('vid11111111', '/out', () => {});
    expect(pipeline.writeSummaryDoc).not.toHaveBeenCalled();
    expect(rerender.reRenderSummaryHtml).toHaveBeenCalled();
    expect(generate.runHtmlDoc).not.toHaveBeenCalled();
  });

  it('throws 422-style error when the video has no summaryMd', async () => {
    withVideo({ summaryMd: null });
    await expect(ensureHtmlDoc('vid11111111', '/out', () => {})).rejects.toThrow(/no summary/i);
  });

  // Relies on the default CURRENT_DOC_VERSION ({3,1}): stored {2,0} is a MAJOR advance → re-summarize
  // branch (unlike the nearby minor-stale test, which injects current: {2,1} to force the cheap re-render).
  it('major-stale ({2,0}) with cached model → deletes models/<base>.json so fuller bullets regenerate, calls writeSummaryDoc, does NOT call reRenderSummaryHtml', async () => {
    withVideo({ docVersion: { major: 2, minor: 0 }, summaryHtml: 'htmls/base.html' });
    const unlinkSpy = jest.spyOn(fs, 'unlinkSync').mockImplementation(() => undefined);
    try {
      await ensureHtmlDoc('vid11111111', '/out', () => {});
      expect(pipeline.writeSummaryDoc).toHaveBeenCalledWith(expect.objectContaining({ baseName: 'base' }));
      expect(unlinkSpy).toHaveBeenCalledWith(expect.stringContaining(path.join('models', 'base.json')));
      expect(rerender.reRenderSummaryHtml).not.toHaveBeenCalled();
    } finally {
      unlinkSpy.mockRestore();
    }
  });
});
