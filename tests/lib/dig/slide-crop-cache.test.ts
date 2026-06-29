// tests/lib/dig/slide-crop-cache.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { lookupOrComputeBox } from '../../../lib/dig/slide-crop-cache';

const box = { trimTop: 0.2, trimBot: 0.05, width: 1280, height: 720 };
const mkAsset = (dir: string, name: string, bytes = 'x') => {
  const p = path.join(dir, name); fs.writeFileSync(p, bytes); return p;
};

describe('lookupOrComputeBox', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crop-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('computes once, then serves from cache', async () => {
    const asset = mkAsset(dir, '0-1-2.jpg');
    const resolve = jest.fn().mockResolvedValue(box);
    expect(await lookupOrComputeBox(asset, resolve)).toEqual(box);
    expect(await lookupOrComputeBox(asset, resolve)).toEqual(box);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(path.join(dir, '.crop-cache.json'))).toBe(true);
  });

  it('recomputes when the file changes under the same name (H1 guard)', async () => {
    const asset = mkAsset(dir, '0-1-2.jpg', 'aaa');
    const resolve = jest.fn()
      .mockResolvedValueOnce(box)
      .mockResolvedValueOnce({ ...box, trimTop: 0.3 });
    await lookupOrComputeBox(asset, resolve);
    fs.writeFileSync(asset, 'bbbbbb');
    expect(await lookupOrComputeBox(asset, resolve)).toEqual({ ...box, trimTop: 0.3 });
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it('caches a null (no-op) result so it is not recomputed', async () => {
    const asset = mkAsset(dir, '0-1-2.jpg');
    const resolve = jest.fn().mockResolvedValue(null);
    await lookupOrComputeBox(asset, resolve);
    await lookupOrComputeBox(asset, resolve);
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('returns "missing" for an absent file and writes no cache entry (M3)', async () => {
    const resolve = jest.fn();
    expect(await lookupOrComputeBox(path.join(dir, 'gone.jpg'), resolve)).toBe('missing');
    expect(resolve).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(dir, '.crop-cache.json'))).toBe(false);
  });

  it('rebuilds on malformed cache JSON instead of throwing', async () => {
    const asset = mkAsset(dir, '0-1-2.jpg');
    fs.writeFileSync(path.join(dir, '.crop-cache.json'), '{ not json');
    const resolve = jest.fn().mockResolvedValue(box);
    expect(await lookupOrComputeBox(asset, resolve)).toEqual(box);
  });

  it('serializes concurrent writes without losing entries', async () => {
    const a1 = mkAsset(dir, '0-1-2.jpg');
    const a2 = mkAsset(dir, '0-3-4.jpg');
    const resolve = jest.fn().mockResolvedValue(box);
    await Promise.all([lookupOrComputeBox(a1, resolve), lookupOrComputeBox(a2, resolve)]);
    const cache = JSON.parse(fs.readFileSync(path.join(dir, '.crop-cache.json'), 'utf8'));
    expect(Object.keys(cache).sort()).toEqual(['0-1-2.jpg', '0-3-4.jpg']);
  });
});
