// tests/lib/dig/slide-crop.integration.test.ts
import path from 'node:path';
import { imageDims, profileRows, resolveCropBox, THR_TOP } from '../../../lib/dig/slide-crop';

const FIX = path.join(__dirname, '__fixtures__', 'letterbox.png');

describe('ffmpeg profile (integration — real ffmpeg)', () => {
  it('imageDims returns 1280×720', async () => {
    expect(await imageDims(FIX)).toEqual({ width: 1280, height: 720 });
  });

  it('profileRows length === height, separates white bar from black bands', async () => {
    const rows = await profileRows(FIX, THR_TOP);
    expect(rows.length).toBe(720);
    expect(rows[0]).toBe(0);                                  // black top
    expect(Math.max(...rows.slice(200, 220))).toBeGreaterThan(0); // white bar registers
  });

  it('resolveCropBox crops the dead bands and carries native dims', async () => {
    const box = await resolveCropBox(FIX);
    expect(box).not.toBeNull();
    expect(box!.width).toBe(1280);
    expect(box!.height).toBe(720);
    expect(box!.trimTop).toBeGreaterThan(0.1);
  });

  it('resolveCropBox returns null on a missing/garbage path (fail-closed)', async () => {
    expect(await resolveCropBox('/no/such/file.png')).toBeNull();
  });
});
