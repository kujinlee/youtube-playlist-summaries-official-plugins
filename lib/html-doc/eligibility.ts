import { isOlder, CURRENT_DOC_VERSION } from '../doc-version';
import type { Video } from '../../types';
import type { BatchMode } from './batch';

/** A video can be batch-selected only if it has a summary to generate HTML from. */
export function summarySelectable(v: Video): boolean {
  return !!v.summaryMd;
}

/** True when the summary HTML is missing or stale (and there is a summary to build from). */
export function summaryNeedsWork(v: Video): boolean {
  return !!v.summaryMd && (!v.summaryHtml || isOlder(v.docVersion ?? { major: 1, minor: 0 }, CURRENT_DOC_VERSION));
}

/**
 * True when the video has outstanding work for the given batch mode.
 * - 'summary': same as summaryNeedsWork (missing or stale summary HTML).
 * - 'summary-dig': summary needs work OR the summary is current but was never dug.
 *   A video with no summaryMd is never eligible (nothing to generate from).
 */
export function videoNeedsBatchWork(v: Video, mode: BatchMode): boolean {
  if (mode === 'summary') return summaryNeedsWork(v);
  return summaryNeedsWork(v) || (!!v.summaryMd && !v.digDeeperMd);
}
