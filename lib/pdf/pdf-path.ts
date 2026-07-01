import path from 'path';
import type { Video } from '@/types';

/**
 * Derive the PDF output path (relative to outputFolder) for a doc.
 *
 * Pure string derivation — path containment is enforced by the caller via
 * `assertIndexRelPathWithin(outputFolder, rel)`.
 *
 * - summary:    `pdfs/{basename(summaryMd) sans .md}.pdf`
 * - dig-deeper: `pdfs/{basename(digDeeperMd) with -dig-deeper.md -> -dig-deeper}.pdf`
 *
 * `base` matches how the serve route derives filenames, so the PDF sits alongside the
 * htmls/{base}.html it renders.
 */
export function pdfRelPath(video: Video, type: 'summary' | 'dig-deeper'): string {
  let base: string;
  if (type === 'dig-deeper') {
    if (!video.digDeeperMd) throw new Error('no dig-deeper doc for this video');
    const b = path.basename(video.digDeeperMd);
    base = b.endsWith('-dig-deeper.md')
      ? `${b.slice(0, -'-dig-deeper.md'.length)}-dig-deeper`
      : b.replace(/\.md$/, '');
  } else {
    if (!video.summaryMd) throw new Error('no summary for this video');
    base = path.basename(video.summaryMd).replace(/\.md$/, '');
  }
  return `pdfs/${base}.pdf`;
}
