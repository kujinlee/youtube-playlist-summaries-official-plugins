import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { numEnv, pickLargestFrom } from '@/lib/dig/slides';

describe('numEnv', () => {
  const KEY = 'DIG_TEST_NUMENV';
  const original = process.env[KEY];
  afterEach(() => {
    if (original === undefined) delete process.env[KEY];
    else process.env[KEY] = original;
  });

  it('returns the parsed value for a valid decimal override', () => {
    process.env[KEY] = '0.6';
    expect(numEnv(KEY, 0.4)).toBeCloseTo(0.6);
  });
  it('returns the parsed value for an integer override', () => {
    process.env[KEY] = '12';
    expect(numEnv(KEY, 8)).toBe(12);
  });
  it('returns a finite negative override', () => {
    process.env[KEY] = '-3';
    expect(numEnv(KEY, 8)).toBe(-3);
  });
  it('falls back to the default when the var is unset', () => {
    delete process.env[KEY];
    expect(numEnv(KEY, 8)).toBe(8);
  });
  it('falls back to the default when the value is non-numeric', () => {
    process.env[KEY] = 'abc';
    expect(numEnv(KEY, 8)).toBe(8);
  });
  it('falls back to the default for a non-finite literal like "Infinity"', () => {
    process.env[KEY] = 'Infinity';
    expect(numEnv(KEY, 8)).toBe(8);
  });
  // Characterization: Number('') === 0, which IS finite, so an empty var
  // resolves to 0 rather than the default. Documents the real footgun
  // (e.g. DIG_SAMPLE_FPS="" → 0 frames sampled), not an aspiration.
  it('resolves an empty-string var to 0, not the default', () => {
    process.env[KEY] = '';
    expect(numEnv(KEY, 8)).toBe(0);
  });
});

describe('pickLargestFrom', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pick-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('returns the largest file by byte size (minOrdinal=1 → all frames eligible)', () => {
    fs.writeFileSync(path.join(dir, 'f_001.jpg'), Buffer.alloc(10));
    fs.writeFileSync(path.join(dir, 'f_002.jpg'), Buffer.alloc(100));
    fs.writeFileSync(path.join(dir, 'f_003.jpg'), Buffer.alloc(50));
    expect(pickLargestFrom(dir, 1)).toBe(path.join(dir, 'f_002.jpg'));
  });
  it('returns null for an empty directory', () => {
    expect(pickLargestFrom(dir, 1)).toBeNull();
  });
  it('skips frames below minOrdinal', () => {
    fs.writeFileSync(path.join(dir, 'f_001.jpg'), Buffer.alloc(999));
    fs.writeFileSync(path.join(dir, 'f_005.jpg'), Buffer.alloc(50));
    expect(pickLargestFrom(dir, 3)).toBe(path.join(dir, 'f_005.jpg'));
  });
  it('returns null when all frames are below minOrdinal', () => {
    fs.writeFileSync(path.join(dir, 'f_001.jpg'), Buffer.alloc(999));
    fs.writeFileSync(path.join(dir, 'f_002.jpg'), Buffer.alloc(200));
    expect(pickLargestFrom(dir, 5)).toBeNull();
  });
});
