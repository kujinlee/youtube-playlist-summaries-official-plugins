import type { Video } from '@/types';
import { applySerial } from './serial-filename';
import { PATH_FIELDS } from './serial-migrate';

/** Each path field on a Video. */
type PathField = (typeof PATH_FIELDS)[number];

// Compile-time contract: every PATH_FIELDS entry must be a real Video key. If a
// field is renamed or removed from the schema, `tsc` fails here rather than the
// invariant silently skipping it via the `vid[field]` access below.
type _AssertPathFieldsAreVideoKeys = PathField extends keyof Video ? true : never;
const _pathFieldsAreVideoKeys: _AssertPathFieldsAreVideoKeys = true;
void _pathFieldsAreVideoKeys;

export type SerialViolation = {
  id: string;
  serial: number;
  field: PathField;
  value: string;
  expected: string;
  reason: 'prefix' | 'missing';
};

/**
 * Verify the serial-prefix invariant: every populated path field on a serialled
 * video must carry its matching `NNN_` prefix AND resolve on disk.
 *
 * A video without a `serialNumber` is not yet serialled, so its bare filenames
 * are legal — it is skipped entirely (the skip is `== null`, i.e. only null /
 * undefined; a numeric serial including 0 is processed faithfully — serial
 * *validity* is the schema's job, not this invariant's). Null/absent fields are
 * skipped too.
 *
 * `exists` is dependency-injected so this stays pure and hermetically testable.
 * It takes the field's value verbatim (the index-relative path) and returns
 * whether that file is present. Callers own rooting: pass a resolver that joins
 * the value to the output folder before `existsSync`. This checks *existence*,
 * not path-containment — guarding against `../` traversal is the resolver's job.
 *
 * Prefix is checked before disk: a mis-prefixed path's existence is meaningless,
 * so a single, prefix-first violation is reported per field.
 */
export function checkSerialInvariant(
  videos: Video[],
  exists: (relPath: string) => boolean,
): SerialViolation[] {
  const violations: SerialViolation[] = [];
  for (const vid of videos) {
    const serial = vid.serialNumber;
    if (serial == null) continue;
    for (const field of PATH_FIELDS) {
      const value = vid[field as keyof Video] as string | null | undefined;
      if (!value) continue;
      const expected = applySerial(value, serial);
      if (value !== expected) {
        violations.push({ id: vid.id, serial, field, value, expected, reason: 'prefix' });
      } else if (!exists(value)) {
        violations.push({ id: vid.id, serial, field, value, expected, reason: 'missing' });
      }
    }
  }
  return violations;
}
