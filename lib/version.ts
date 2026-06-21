/** A two-part version. */
export interface Version {
  major: number;
  minor: number;
}

/** True when `a` is an older version than `b` (major dominates, then minor). */
export function isOlder(a: Version, b: Version): boolean {
  return a.major < b.major || (a.major === b.major && a.minor < b.minor);
}
