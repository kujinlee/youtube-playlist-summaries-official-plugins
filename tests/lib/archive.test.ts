import { archiveVideo, unarchiveVideo } from '../../lib/archive';
import { upsertVideo, readIndex } from '../../lib/index-store';
import crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Video } from '../../types';

// Must be under homedir — assertOutputFolder enforces this
function makeTempDir(): string {
  const dir = path.join(os.homedir(), `.tmp-archive-test-${crypto.randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const VIDEO_ID = 'test-video-01';
const SLUG = 'the-test-video-title';

// Files use title slugs (not videoId) matching what the pipeline writes.
function makeVideo(id: string, archived = false): Video {
  return {
    id,
    title: 'Test Video',
    youtubeUrl: `https://www.youtube.com/watch?v=${id}`,
    language: 'en',
    durationSeconds: 300,
    archived,
    ratings: { usefulness: 3, depth: 3, originality: 3, recency: 3, completeness: 3 },
    overallScore: 3,
    summaryMd: `${SLUG}.md`,
    processedAt: new Date().toISOString(),
  };
}

// Write a file and ensure parent directories exist
function writeFile(outputFolder: string, relPath: string, content: string): void {
  const full = path.join(outputFolder, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

describe('archiveVideo', () => {
  let outputFolder: string;

  beforeEach(() => {
    outputFolder = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(outputFolder, { recursive: true, force: true });
  });

  it('moves summaryMd to archived/', async () => {
    upsertVideo(outputFolder, makeVideo(VIDEO_ID));
    writeFile(outputFolder, `${SLUG}.md`, 'summary');

    await archiveVideo(outputFolder, VIDEO_ID);

    const archivedDir = path.join(outputFolder, 'archived');
    expect(fs.existsSync(path.join(archivedDir, `${SLUG}.md`))).toBe(true);
    // original removed
    expect(fs.existsSync(path.join(outputFolder, `${SLUG}.md`))).toBe(false);
  });

  it('does not throw when only some files are present', async () => {
    upsertVideo(outputFolder, makeVideo(VIDEO_ID));
    writeFile(outputFolder, `${SLUG}.md`, 'summary');
    // no pdf, no deep-dive files

    await expect(archiveVideo(outputFolder, VIDEO_ID)).resolves.toBeUndefined();

    expect(fs.existsSync(path.join(outputFolder, 'archived', `${SLUG}.md`))).toBe(true);
  });

  it('sets video.archived to true in the index', async () => {
    upsertVideo(outputFolder, makeVideo(VIDEO_ID));
    writeFile(outputFolder, `${SLUG}.md`, 'summary');

    await archiveVideo(outputFolder, VIDEO_ID);

    const index = readIndex(outputFolder);
    expect(index.videos.find((v) => v.id === VIDEO_ID)?.archived).toBe(true);
  });

  it('creates archived/ directory if it does not exist', async () => {
    upsertVideo(outputFolder, makeVideo(VIDEO_ID));
    writeFile(outputFolder, `${SLUG}.md`, 'summary');

    await archiveVideo(outputFolder, VIDEO_ID);

    expect(fs.existsSync(path.join(outputFolder, 'archived'))).toBe(true);
  });

  it('does not throw when videoId is not in the index', async () => {
    // No upsertVideo — videoId unknown to index; getFilePairs returns []
    writeFile(outputFolder, `${SLUG}.md`, 'summary');

    await expect(archiveVideo(outputFolder, VIDEO_ID)).resolves.toBeUndefined();
    // File stays in place since we had no index entry to find paths from
    expect(fs.existsSync(path.join(outputFolder, `${SLUG}.md`))).toBe(true);
  });
});

describe('unarchiveVideo', () => {
  let outputFolder: string;

  beforeEach(() => {
    outputFolder = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(outputFolder, { recursive: true, force: true });
  });

  it('moves files from archived/ back to original locations', async () => {
    upsertVideo(outputFolder, makeVideo(VIDEO_ID));
    writeFile(outputFolder, `${SLUG}.md`, 'summary');
    await archiveVideo(outputFolder, VIDEO_ID);

    await unarchiveVideo(outputFolder, VIDEO_ID);

    expect(fs.existsSync(path.join(outputFolder, `${SLUG}.md`))).toBe(true);
    expect(fs.existsSync(path.join(outputFolder, 'archived', `${SLUG}.md`))).toBe(false);
  });

  it('sets video.archived to false in the index', async () => {
    upsertVideo(outputFolder, makeVideo(VIDEO_ID, true));
    const archivedDir = path.join(outputFolder, 'archived');
    fs.mkdirSync(archivedDir, { recursive: true });
    writeFile(outputFolder, `archived/${SLUG}.md`, 'summary');

    await unarchiveVideo(outputFolder, VIDEO_ID);

    const index = readIndex(outputFolder);
    expect(index.videos.find((v) => v.id === VIDEO_ID)?.archived).toBe(false);
  });

  it('does not throw when some files are absent in archived/', async () => {
    upsertVideo(outputFolder, makeVideo(VIDEO_ID, true));
    const archivedDir = path.join(outputFolder, 'archived');
    fs.mkdirSync(archivedDir, { recursive: true });
    writeFile(outputFolder, `archived/${SLUG}.md`, 'summary');
    // no pdf, no deep-dive

    await expect(unarchiveVideo(outputFolder, VIDEO_ID)).resolves.toBeUndefined();
  });

  it('does not throw when videoId is not in the index', async () => {
    // No upsertVideo — videoId unknown to index
    const archivedDir = path.join(outputFolder, 'archived');
    fs.mkdirSync(archivedDir, { recursive: true });
    writeFile(outputFolder, `archived/${SLUG}.md`, 'summary');

    await expect(unarchiveVideo(outputFolder, VIDEO_ID)).resolves.toBeUndefined();
  });
});
