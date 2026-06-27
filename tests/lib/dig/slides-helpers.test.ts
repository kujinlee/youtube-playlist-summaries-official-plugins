import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { numEnv, parseFirstSceneChange, pickLargestFile } from '@/lib/dig/slides';

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

describe('parseFirstSceneChange', () => {
  it('returns the first decimal pts_time from ffmpeg showinfo output', () => {
    const out = '[Parsed_showinfo_1 @ 0x1] n:0 pts:96000 pts_time:3.200000 pos:1\n' +
                '[Parsed_showinfo_1 @ 0x1] n:1 pts:210000 pts_time:7.000000 pos:2\n';
    expect(parseFirstSceneChange(out, 8)).toBeCloseTo(3.2);
  });
  it('parses an integer pts_time (real ffmpeg emits e.g. pts_time:1)', () => {
    expect(parseFirstSceneChange('x pts_time:1 y', 8)).toBe(1);
  });
  it('returns the fallback when no scene change is present', () => {
    expect(parseFirstSceneChange('no scene info here', 8)).toBe(8);
  });
  it('returns the fallback when pts_time is zero or non-finite', () => {
    expect(parseFirstSceneChange('pts_time:0', 8)).toBe(8);
    expect(parseFirstSceneChange('pts_time:abc', 8)).toBe(8);
  });
});

describe('pickLargestFile', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pick-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('returns the largest file by byte size', () => {
    fs.writeFileSync(path.join(dir, 'a.jpg'), Buffer.alloc(10));
    fs.writeFileSync(path.join(dir, 'b.jpg'), Buffer.alloc(100));
    fs.writeFileSync(path.join(dir, 'c.jpg'), Buffer.alloc(50));
    expect(pickLargestFile(dir)).toBe(path.join(dir, 'b.jpg'));
  });
  it('returns null for an empty directory', () => {
    expect(pickLargestFile(dir)).toBeNull();
  });
});
