import path from 'path';

const SERIAL_PREFIX = /^\d+_/;

/** Zero-pad to minimum 3 digits; widens automatically past 999. */
export function padSerial(n: number): string {
  return String(n).padStart(3, '0');
}

/** Remove a leading `NNN_` serial prefix from a basename (no-op if absent). */
export function stripSerialPrefix(basename: string): string {
  return basename.replace(SERIAL_PREFIX, '');
}

/**
 * Apply a serial prefix to a relative path, preserving directory + extension +
 * any `-deep-dive`/`-dig-deeper` suffix (those live in the basename already).
 * Strips any existing serial first → idempotent.
 */
export function applySerial(relPath: string, serial: number): string {
  const dir = path.dirname(relPath);   // '.' for bare names
  const base = path.basename(relPath);
  const prefixed = `${padSerial(serial)}_${stripSerialPrefix(base)}`;
  return dir === '.' ? prefixed : `${dir}/${prefixed}`;
}
