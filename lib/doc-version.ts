import { isOlder } from './version';

/** Document output version. MAJOR = summary/.md format (bump ⇒ re-summarize). MINOR = HTML render/style (bump ⇒ re-render). */
export interface DocVersion {
  major: number;
  minor: number;
}

/** The version current code produces. major 3 = fuller magazine bullets + divider-normalized .md (major 2 = ▶ timestamps). minor = HTML render/style: 1 = lighter lead + label-less bullets, 2 = timestamp moved into the title as a muted (label) link. */
export const CURRENT_DOC_VERSION: DocVersion = { major: 3, minor: 2 };

export { isOlder };

/** True when reaching `current` from `stored` requires regenerating the .md (a summary-format / major advance). */
export function needsResummarize(stored: DocVersion, current: DocVersion): boolean {
  return stored.major < current.major;
}
