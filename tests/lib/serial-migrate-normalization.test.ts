import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  findByNormalizedName,
  resolveOnDisk,
  runPhaseA,
  runPhaseBUntilStable,
} from '@/lib/serial-migrate-exec';
import { readIndex, writeIndex } from '@/lib/index-store';
import type { Video, PlaylistIndex } from '@/types';

// A Korean title kept in NFC; the bug is that the index can store a different
// normalization than the bytes on disk (or a mixed form), so a byte-exact lookup misses.
const TITLE_NFC = '팔란티어-대체될까'.normalize('NFC');

function makeVideo(id: string, processedAt: string, summaryMd: string | null, serialNumber?: number): Video {
  return {
    id,
    title: `Video ${id}`,
    youtubeUrl: `https://www.youtube.com/watch?v=${id}`,
    language: 'ko',
    durationSeconds: 300,
    archived: false,
    ratings: { usefulness: 3, depth: 3, originality: 3, recency: 3, completeness: 3 },
    overallScore: 3,
    summaryMd,
    deepDiveMd: null,
    processedAt,
    ...(serialNumber !== undefined ? { serialNumber } : {}),
  };
}

describe('serial migration — Unicode normalization robustness', () => {
  let outputFolder: string;

  beforeEach(() => {
    outputFolder = path.join(os.homedir(), `.tmp-serial-norm-${crypto.randomUUID()}`);
    fs.mkdirSync(outputFolder, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(outputFolder, { recursive: true, force: true });
  });

  describe('findByNormalizedName', () => {
    it('finds a file whose on-disk name differs from the query only by Unicode normalization (NFD on disk, NFC query)', () => {
      const onDiskName = TITLE_NFC.normalize('NFD') + '.md';
      fs.writeFileSync(path.join(outputFolder, onDiskName), 'x');
      const found = findByNormalizedName(outputFolder, TITLE_NFC + '.md');
      expect(found).not.toBeNull();
      expect(fs.existsSync(found as string)).toBe(true);
    });

    it('resolves a subdir-prefixed relPath (e.g. pdfs/<name>)', () => {
      fs.mkdirSync(path.join(outputFolder, 'pdfs'));
      const onDiskName = TITLE_NFC.normalize('NFD') + '.pdf';
      fs.writeFileSync(path.join(outputFolder, 'pdfs', onDiskName), 'x');
      const found = findByNormalizedName(outputFolder, `pdfs/${TITLE_NFC}.pdf`);
      expect(found).not.toBeNull();
    });

    it('returns null when no normalization-equivalent file exists', () => {
      fs.writeFileSync(path.join(outputFolder, 'unrelated.md'), 'x');
      expect(findByNormalizedName(outputFolder, `${TITLE_NFC}.md`)).toBeNull();
    });

    it('returns null when the directory does not exist', () => {
      expect(findByNormalizedName(outputFolder, 'pdfs/nope.pdf')).toBeNull();
    });
  });

  describe('resolveOnDisk falls back to a normalization-tolerant scan', () => {
    afterEach(() => jest.restoreAllMocks());

    it('uses the NFC scan when the byte-exact existsSync lookup misses (the production failure mode)', () => {
      // The file is genuinely on disk, but we force existsSync to report "missing" to
      // simulate a normalization-sensitive filesystem (Linux/CI) or a mixed-form name that
      // APFS's existsSync does NOT match. Without the fallback, resolveOnDisk returns null.
      const onDiskName = TITLE_NFC.normalize('NFD') + '.md';
      fs.writeFileSync(path.join(outputFolder, onDiskName), 'x');
      jest.spyOn(fs, 'existsSync').mockReturnValue(false); // byte-exact lookup always misses

      const r = resolveOnDisk(outputFolder, TITLE_NFC + '.md');

      expect(r).not.toBeNull();
      // The scan (real readdirSync, not mocked) found the on-disk file by NFC equality.
      expect(path.basename((r as { abs: string }).abs)).toBe(onDiskName);
    });

    it('returns null (no infinite work) when the byte-exact lookup misses and no NFC match exists', () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(false);
      expect(resolveOnDisk(outputFolder, `${TITLE_NFC}.md`)).toBeNull();
    });
  });

  describe('runPhaseBUntilStable', () => {
    it('renames every file-bearing video and converges (final pass renames 0)', () => {
      const index: PlaylistIndex = {
        playlistUrl: 'https://youtube.com/playlist?list=T',
        outputFolder,
        videos: [
          makeVideo('v1', '2025-01-01T00:00:00Z', 'alpha.md'),
          makeVideo('v2', '2025-01-02T00:00:00Z', 'beta.md'),
        ],
      };
      writeIndex(outputFolder, index);
      fs.writeFileSync(path.join(outputFolder, 'alpha.md'), 'a');
      fs.writeFileSync(path.join(outputFolder, 'beta.md'), 'b');

      runPhaseA(outputFolder);
      const r = runPhaseBUntilStable(outputFolder);

      expect(r.renamed).toBe(2);
      // Exactly 2: pass 1 renames both, pass 2 renames 0 and stops. A higher count would
      // mean a pass generated spurious renames (e.g. re-reading a stale index).
      expect(r.passes).toBe(2);
      expect(fs.existsSync(path.join(outputFolder, '001_alpha.md'))).toBe(true);
      expect(fs.existsSync(path.join(outputFolder, '002_beta.md'))).toBe(true);

      // Idempotent: a fresh convergence run does nothing.
      const again = runPhaseBUntilStable(outputFolder);
      expect(again.renamed).toBe(0);
      expect(again.conflicts).toEqual([]);
    });

    it('stops after a single pass when there is nothing to rename (phantom ops never spin)', () => {
      // serialNumber set but the file is absent → planMigration emits a rename op, but Phase B
      // can't apply it (no source) → renamed 0 on pass 1 → loop stops. (maxPasses=10 default is
      // a backstop, not the stopping condition here.)
      writeIndex(outputFolder, {
        playlistUrl: 'https://youtube.com/playlist?list=T',
        outputFolder,
        videos: [makeVideo('v1', '2025-01-01T00:00:00Z', 'ghost.md', 5)],
      });
      const r = runPhaseBUntilStable(outputFolder, 3);
      expect(r.renamed).toBe(0);
      expect(r.passes).toBe(1);
    });
  });
});
