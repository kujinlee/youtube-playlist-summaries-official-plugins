import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseFirstSceneChange, pickLargestFile } from '@/lib/dig/slides';

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
