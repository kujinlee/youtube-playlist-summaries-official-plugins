import type { Version } from '../version';

/** Deep-dive output version. MAJOR = .md/prompt format (bump ⇒ re-run cascade). MINOR = HTML render/style (bump ⇒ cheap re-render from .md). */
export type DeepDiveVersion = Version;

/** The version current code produces. major 2 = ▶ section timestamps. */
export const CURRENT_DEEP_DIVE_VERSION: DeepDiveVersion = { major: 2, minor: 0 };

/** True when reaching `current` from `stored` requires re-running the Gemini cascade (a .md-format / major advance). */
export function needsRegenerate(stored: DeepDiveVersion, current: DeepDiveVersion): boolean {
  return stored.major < current.major;
}
