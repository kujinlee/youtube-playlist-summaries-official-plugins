import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { dryRunReport } from '@/scripts/backfill-serial-prefix';
import { writeIndex } from '@/lib/index-store';
import type { PlaylistIndex } from '@/types';

function makeVideo(id: string, processedAt: string, summaryMd: string | null) {
  return {
    id,
    title: `Video ${id}`,
    youtubeUrl: `https://www.youtube.com/watch?v=${id}`,
    language: 'en' as const,
    durationSeconds: 300,
    archived: false,
    ratings: { usefulness: 3 as const, depth: 3 as const, originality: 3 as const, recency: 3 as const, completeness: 3 as const },
    overallScore: 3,
    summaryMd,
    deepDiveMd: null,
    processedAt,
  };
}

describe('dryRunReport', () => {
  let outputFolder: string;

  beforeEach(() => {
    // Must be under homedir — assertOutputFolder enforces this
    outputFolder = path.join(os.homedir(), `.tmp-backfill-${crypto.randomUUID()}`);
    fs.mkdirSync(outputFolder, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(outputFolder, { recursive: true, force: true });
  });

  it('dry-run report lists planned renames without touching disk', () => {
    // Seed temp index with one video whose summaryMd is set and NO serialNumber
    const index: PlaylistIndex = {
      playlistUrl: 'https://www.youtube.com/playlist?list=TEST',
      outputFolder,
      videos: [makeVideo('video1', new Date('2025-01-01').toISOString(), 'alpha.md')],
    };
    writeIndex(outputFolder, index);

    // Also create the real file
    fs.writeFileSync(path.join(outputFolder, 'alpha.md'), 'x');

    // Call dryRunReport
    const report = dryRunReport(outputFolder);

    // Assert the returned string contains the planned rename (001_alpha.md)
    expect(report).toContain('001_alpha.md');

    // Assert no file was renamed (still alpha.md, not 001_alpha.md)
    expect(fs.existsSync(path.join(outputFolder, 'alpha.md'))).toBe(true);
  });

  it('omits phantom renames whose source file does not exist on disk', () => {
    // Two videos: one with a real .md on disk, one whose .md is referenced but missing.
    const index: PlaylistIndex = {
      playlistUrl: 'https://www.youtube.com/playlist?list=TEST',
      outputFolder,
      videos: [
        makeVideo('real', new Date('2025-01-01').toISOString(), 'present.md'),
        makeVideo('ghost', new Date('2025-01-02').toISOString(), 'missing.md'),
      ],
    };
    writeIndex(outputFolder, index);
    fs.writeFileSync(path.join(outputFolder, 'present.md'), 'x'); // only the real one exists

    const report = dryRunReport(outputFolder);

    // The real file's rename is listed…
    expect(report).toContain('001_present.md');
    // …but the missing file's rename is filtered out (no forever-pending phantom).
    expect(report).not.toContain('missing.md');
  });
});
