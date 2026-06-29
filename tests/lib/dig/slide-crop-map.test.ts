// tests/lib/dig/slide-crop-map.test.ts
import path from 'node:path';
import { prepareSlideCropMap } from '../../../lib/dig/slide-crop-map';
import type { DugSection } from '../../../lib/dig/companion-doc';

const mdPath = '/data/deck/raw/275_x-dig-deeper.md';
const docDir = path.dirname(mdPath);
const sec = (bodyMarkdown: string): DugSection =>
  ({ sectionId: 0, title: 't', genVersion: 8, bodyMarkdown } as unknown as DugSection);
const box = { trimTop: 0.2, trimBot: 0.05, width: 1280, height: 720 };

describe('prepareSlideCropMap', () => {
  it('collects assets/ refs, resolves to abs paths, dedupes', async () => {
    const dug = [
      sec('text ![a](assets/v/0-1-2.jpg) more ![dup](assets/v/0-1-2.jpg)'),
      sec('![b](assets/v/0-3-4.jpg)'),
    ];
    const lookup = jest.fn().mockResolvedValue(box);
    const map = await prepareSlideCropMap(dug, mdPath, lookup);
    expect(new Set(map.keys())).toEqual(new Set([
      path.resolve(docDir, 'assets/v/0-1-2.jpg'),
      path.resolve(docDir, 'assets/v/0-3-4.jpg'),
    ]));
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('ignores external URLs and path-traversal refs', async () => {
    const dug = [sec('![x](https://e.com/i.png) ![bad](assets/../../etc/passwd)')];
    const lookup = jest.fn().mockResolvedValue(null);
    const map = await prepareSlideCropMap(dug, mdPath, lookup);
    expect(map.size).toBe(0);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('omits missing assets from the map', async () => {
    const lookup = jest.fn().mockResolvedValue('missing');
    const map = await prepareSlideCropMap([sec('![m](assets/v/gone.jpg)')], mdPath, lookup);
    expect(map.size).toBe(0);
  });

  it('returns an empty map when DIG_CROP=off', async () => {
    const prev = process.env.DIG_CROP;
    process.env.DIG_CROP = 'off';
    try {
      const lookup = jest.fn().mockResolvedValue(box);
      const map = await prepareSlideCropMap([sec('![a](assets/v/0-1-2.jpg)')], mdPath, lookup);
      expect(map.size).toBe(0);
      expect(lookup).not.toHaveBeenCalled();
    } finally { process.env.DIG_CROP = prev; }
  });
});
