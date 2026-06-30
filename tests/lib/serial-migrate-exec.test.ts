import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runPhaseA, runPhaseB } from '@/lib/serial-migrate-exec';
import { readIndex, writeIndex } from '@/lib/index-store';
import type { Video, PlaylistIndex } from '@/types';

function makeVideo(id: string, processedAt: string, summaryMd: string | null): Video {
  return {
    id,
    title: `Video ${id}`,
    youtubeUrl: `https://www.youtube.com/watch?v=${id}`,
    language: 'en',
    durationSeconds: 300,
    archived: false,
    ratings: { usefulness: 3, depth: 3, originality: 3, recency: 3, completeness: 3 },
    overallScore: 3,
    summaryMd,
    processedAt,
  };
}

describe('runPhaseA', () => {
  let outputFolder: string;

  beforeEach(() => {
    // Must be under homedir — assertOutputFolder enforces this
    outputFolder = path.join(os.homedir(), `.tmp-serial-migrate-exec-${crypto.randomUUID()}`);
    fs.mkdirSync(outputFolder, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(outputFolder, { recursive: true, force: true });
  });

  it('Phase A assigns serials to all file-bearing videos in one write and is idempotent', () => {
    // Seed index with 2 videos (summaryMd set, no serialNumber), processedAt ordered
    const index: PlaylistIndex = {
      playlistUrl: 'https://www.youtube.com/playlist?list=TEST',
      outputFolder,
      videos: [
        makeVideo('video1', new Date('2025-01-01').toISOString(), 'summary-1.md'),
        makeVideo('video2', new Date('2025-01-02').toISOString(), 'summary-2.md'),
      ],
    };
    writeIndex(outputFolder, index);

    // First run: should assign serials
    const r1 = runPhaseA(outputFolder);
    expect(r1.assigned).toBe(2);
    const after = readIndex(outputFolder).videos.map((v) => v.serialNumber).sort();
    expect(after).toEqual([1, 2]);

    // Second run: idempotent
    const r2 = runPhaseA(outputFolder);
    expect(r2.assigned).toBe(0);
  });
});

describe('runPhaseB', () => {
  let outputFolder: string;

  beforeEach(() => {
    outputFolder = path.join(os.homedir(), `.tmp-serial-migrate-exec-b-${crypto.randomUUID()}`);
    fs.mkdirSync(outputFolder, { recursive: true });
    fs.mkdirSync(path.join(outputFolder, 'models'), { recursive: true });
    fs.mkdirSync(path.join(outputFolder, 'htmls'), { recursive: true });
    fs.mkdirSync(path.join(outputFolder, 'archived'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(outputFolder, { recursive: true, force: true });
  });

  function seedIndex(videos: Video[]): void {
    const index: PlaylistIndex = {
      playlistUrl: 'https://www.youtube.com/playlist?list=TEST',
      outputFolder,
      videos,
    };
    writeIndex(outputFolder, index);
  }

  function makeVideoB(overrides: Partial<Video> & { id: string }): Video {
    const { id } = overrides;
    return {
      title: `Video ${id}`,
      youtubeUrl: `https://www.youtube.com/watch?v=${id}`,
      language: 'en',
      durationSeconds: 300,
      archived: false,
      ratings: { usefulness: 3, depth: 3, originality: 3, recency: 3, completeness: 3 },
      overallScore: 3,
      summaryMd: null,
      processedAt: new Date('2025-01-01').toISOString(),
      ...overrides,
    };
  }

  it('Phase B renames md+model and updates the index fields per video', () => {
    // Seed: video with serialNumber:1, summaryMd:'alpha.md'
    seedIndex([
      makeVideoB({
        id: 'a',
        serialNumber: 1,
        summaryMd: 'alpha.md',
      }),
    ]);
    // Create actual files on disk
    fs.writeFileSync(path.join(outputFolder, 'alpha.md'), 'md content');
    fs.writeFileSync(
      path.join(outputFolder, 'models/alpha.json'),
      JSON.stringify({ sourceMd: 'alpha.md', data: 'model data' }),
    );

    const r = runPhaseB(outputFolder);

    expect(fs.existsSync(path.join(outputFolder, '001_alpha.md'))).toBe(true);
    expect(fs.existsSync(path.join(outputFolder, 'models/001_alpha.json'))).toBe(true);
    expect(readIndex(outputFolder).videos[0].summaryMd).toBe('001_alpha.md');
    expect(r.conflicts).toEqual([]);
  });

  it('aborts a video (conflict, no clobber) when target exists with different content', () => {
    seedIndex([
      makeVideoB({
        id: 'a',
        serialNumber: 1,
        summaryMd: 'alpha.md',
      }),
    ]);
    // Create source file AND conflicting target with DIFFERENT content
    fs.writeFileSync(path.join(outputFolder, 'alpha.md'), 'new content');
    fs.writeFileSync(path.join(outputFolder, '001_alpha.md'), 'OTHER');

    const r = runPhaseB(outputFolder);

    expect(r.conflicts).toContain('a');
    // Target file must be untouched
    expect(fs.readFileSync(path.join(outputFolder, '001_alpha.md'), 'utf8')).toBe('OTHER');
  });

  it('rewrites source-md meta in renamed summary HTML', () => {
    const htmlContent = `<html><head><meta name="source-md" content="alpha.md"></head><body></body></html>`;
    seedIndex([
      makeVideoB({
        id: 'a',
        serialNumber: 1,
        summaryMd: 'alpha.md',
        summaryHtml: 'htmls/alpha.html',
      }),
    ]);
    fs.writeFileSync(path.join(outputFolder, 'alpha.md'), 'md content');
    fs.writeFileSync(path.join(outputFolder, 'htmls/alpha.html'), htmlContent);

    runPhaseB(outputFolder);

    const html = fs.readFileSync(path.join(outputFolder, 'htmls/001_alpha.html'), 'utf8');
    expect(html).toContain('content="001_alpha.md"');
  });

  it('is idempotent on re-run (already-prefixed files → renamed:0)', () => {
    seedIndex([
      makeVideoB({
        id: 'a',
        serialNumber: 1,
        summaryMd: 'alpha.md',
      }),
    ]);
    fs.writeFileSync(path.join(outputFolder, 'alpha.md'), 'md content');

    runPhaseB(outputFolder);
    const r2 = runPhaseB(outputFolder);

    expect(r2.renamed).toBe(0);
    // M2: index must not be corrupted on re-run
    expect(readIndex(outputFolder).videos[0].summaryMd).toBe('001_alpha.md');
  });

  // M1: envelope provenance rewrite — models/<new-name>.json gets sourceMd updated.
  it('rewrites envelope sourceMd in renamed model JSON', () => {
    seedIndex([
      makeVideoB({
        id: 'a',
        serialNumber: 1,
        summaryMd: 'alpha.md',      }),
    ]);
    fs.writeFileSync(path.join(outputFolder, 'alpha.md'), 'md content');
    fs.writeFileSync(
      path.join(outputFolder, 'models/alpha.json'),
      JSON.stringify({ sourceMd: 'alpha.md', generatedAt: 't' }),
    );

    runPhaseB(outputFolder);

    expect(fs.existsSync(path.join(outputFolder, 'models/001_alpha.json'))).toBe(true);
    const envelope = JSON.parse(
      fs.readFileSync(path.join(outputFolder, 'models/001_alpha.json'), 'utf8'),
    );
    expect(envelope.sourceMd).toBe('001_alpha.md');  // rewritten to new md basename
    expect(envelope.generatedAt).toBe('t');           // other fields preserved
  });

  // B1: archived file renamed UNDER archived/, but the index field stays ROOT-relative.
  it('renames archived files under archived/ and stores a root-relative index field', () => {
    // The video is marked archived:true, and the file lives at archived/alpha.md
    seedIndex([
      makeVideoB({
        id: 'a',
        serialNumber: 1,
        summaryMd: 'alpha.md',        archived: true,
      }),
    ]);
    // File physically lives under archived/
    fs.writeFileSync(path.join(outputFolder, 'archived/alpha.md'), 'archived md');

    runPhaseB(outputFolder);

    // Physical file renamed under archived/
    expect(fs.existsSync(path.join(outputFolder, 'archived/001_alpha.md'))).toBe(true);
    // CRITICAL: index field must be root-relative '001_alpha.md', NOT 'archived/001_alpha.md'
    // If the B1 guard were removed (storing src.rel instead of op.to), this would be
    // 'archived/001_alpha.md' and the test would fail.
    expect(readIndex(outputFolder).videos[0].summaryMd).toBe('001_alpha.md');
  });

  // B2: crash mid-video (file renamed, index not yet updated) → re-run must converge the index.
  it('repairs a stale index field when the file was already renamed by a crashed run', () => {
    // Index still says 'alpha.md' but the file on disk is ALREADY '001_alpha.md'
    // (simulating a crash between rename and updateVideoFields)
    seedIndex([
      makeVideoB({
        id: 'a',
        serialNumber: 1,
        summaryMd: 'alpha.md',      }),
    ]);
    // Simulate crashed prior run: file already renamed, but index not updated
    fs.writeFileSync(path.join(outputFolder, '001_alpha.md'), 'already renamed');
    // alpha.md does NOT exist on disk — it was renamed in the crashed run

    const r = runPhaseB(outputFolder);

    expect(r.renamed).toBe(0); // nothing to physically rename
    // CRITICAL: index must converge to the new name.
    // If the B2 guard were removed (skipping on null src without probing op.to), this would
    // remain 'alpha.md' and the test would fail.
    expect(readIndex(outputFolder).videos[0].summaryMd).toBe('001_alpha.md');
    expect(r.conflicts).toEqual([]);
  });
});
