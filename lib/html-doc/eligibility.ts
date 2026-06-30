import { isOlder, CURRENT_DOC_VERSION } from '../doc-version';
import type { Video } from '../../types';

/** A video can be batch-selected only if it has a summary to generate HTML from. */
export function summarySelectable(v: Video): boolean {
  return !!v.summaryMd;
}

/** True when the summary HTML is missing or stale (and there is a summary to build from). */
export function summaryNeedsWork(v: Video): boolean {
  return !!v.summaryMd && (!v.summaryHtml || isOlder(v.docVersion ?? { major: 1, minor: 0 }, CURRENT_DOC_VERSION));
}
