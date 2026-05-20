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
    summaryMd: null,
    summaryPdf: null,
    deepDiveMd: null,
    deepDivePdf: null,
    processedAt: new Date().toISOString(),
  };
}

describe('archiveVideo', () => {
  let outputFolder: string;

  beforeEach(() => {
    outputFolder = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(outputFolder, { recursive: true, force: true });
  });

  it('moves all four file types to archived/ subfolder', async () => {
    upsertVideo(outputFolder, makeVideo(VIDEO_ID));
    fs.writeFileSync(path.join(outputFolder, `${VIDEO_ID}.md`), 'summary');
    fs.writeFileSync(path.join(outputFolder, `${VIDEO_ID}.pdf`), 'pdf');
    fs.writeFileSync(path.join(outputFolder, `${VIDEO_ID}-deep-dive.md`), 'deep');
    fs.writeFileSync(path.join(outputFolder, `${VIDEO_ID}-deep-dive.pdf`), 'deep-pdf');

    await archiveVideo(outputFolder, VIDEO_ID);

    const archivedDir = path.join(outputFolder, 'archived');
    expect(fs.existsSync(path.join(archivedDir, `${VIDEO_ID}.md`))).toBe(true);
    expect(fs.existsSync(path.join(archivedDir, `${VIDEO_ID}.pdf`))).toBe(true);
    expect(fs.existsSync(path.join(archivedDir, `${VIDEO_ID}-deep-dive.md`))).toBe(true);
    expect(fs.existsSync(path.join(archivedDir, `${VIDEO_ID}-deep-dive.pdf`))).toBe(true);
    expect(fs.existsSync(path.join(outputFolder, `${VIDEO_ID}.md`))).toBe(false);
    expect(fs.existsSync(path.join(outputFolder, `${VIDEO_ID}.pdf`))).toBe(false);
  });

  it('does not throw when only some files are present', async () => {
    upsertVideo(outputFolder, makeVideo(VIDEO_ID));
    fs.writeFileSync(path.join(outputFolder, `${VIDEO_ID}.md`), 'summary');
    // no pdf, no deep-dive files

    await expect(archiveVideo(outputFolder, VIDEO_ID)).resolves.toBeUndefined();

    expect(fs.existsSync(path.join(outputFolder, 'archived', `${VIDEO_ID}.md`))).toBe(true);
  });

  it('sets video.archived to true in the index', async () => {
    upsertVideo(outputFolder, makeVideo(VIDEO_ID));
    fs.writeFileSync(path.join(outputFolder, `${VIDEO_ID}.md`), 'summary');

    await archiveVideo(outputFolder, VIDEO_ID);

    const index = readIndex(outputFolder);
    expect(index.videos.find((v) => v.id === VIDEO_ID)?.archived).toBe(true);
  });

  it('creates archived/ directory if it does not exist', async () => {
    upsertVideo(outputFolder, makeVideo(VIDEO_ID));
    fs.writeFileSync(path.join(outputFolder, `${VIDEO_ID}.md`), 'summary');

    await archiveVideo(outputFolder, VIDEO_ID);

    expect(fs.existsSync(path.join(outputFolder, 'archived'))).toBe(true);
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

  it('moves files from archived/ back to root', async () => {
    upsertVideo(outputFolder, makeVideo(VIDEO_ID));
    fs.writeFileSync(path.join(outputFolder, `${VIDEO_ID}.md`), 'summary');
    fs.writeFileSync(path.join(outputFolder, `${VIDEO_ID}.pdf`), 'pdf');
    await archiveVideo(outputFolder, VIDEO_ID);

    await unarchiveVideo(outputFolder, VIDEO_ID);

    expect(fs.existsSync(path.join(outputFolder, `${VIDEO_ID}.md`))).toBe(true);
    expect(fs.existsSync(path.join(outputFolder, `${VIDEO_ID}.pdf`))).toBe(true);
    expect(fs.existsSync(path.join(outputFolder, 'archived', `${VIDEO_ID}.md`))).toBe(false);
    expect(fs.existsSync(path.join(outputFolder, 'archived', `${VIDEO_ID}.pdf`))).toBe(false);
  });

  it('sets video.archived to false in the index', async () => {
    upsertVideo(outputFolder, makeVideo(VIDEO_ID, true));
    const archivedDir = path.join(outputFolder, 'archived');
    fs.mkdirSync(archivedDir, { recursive: true });
    fs.writeFileSync(path.join(archivedDir, `${VIDEO_ID}.md`), 'summary');

    await unarchiveVideo(outputFolder, VIDEO_ID);

    const index = readIndex(outputFolder);
    expect(index.videos.find((v) => v.id === VIDEO_ID)?.archived).toBe(false);
  });

  it('does not throw when some files are absent in archived/', async () => {
    upsertVideo(outputFolder, makeVideo(VIDEO_ID, true));
    const archivedDir = path.join(outputFolder, 'archived');
    fs.mkdirSync(archivedDir, { recursive: true });
    fs.writeFileSync(path.join(archivedDir, `${VIDEO_ID}.md`), 'summary');
    // no pdf, no deep-dive

    await expect(unarchiveVideo(outputFolder, VIDEO_ID)).resolves.toBeUndefined();
  });

  it('does not throw when videoId is not in the index', async () => {
    // No upsertVideo — videoId unknown to index
    const archivedDir = path.join(outputFolder, 'archived');
    fs.mkdirSync(archivedDir, { recursive: true });
    fs.writeFileSync(path.join(archivedDir, `${VIDEO_ID}.md`), 'summary');

    await expect(unarchiveVideo(outputFolder, VIDEO_ID)).resolves.toBeUndefined();
  });
});

describe('archiveVideo — no-op when video not in index', () => {
  let outputFolder: string;

  beforeEach(() => {
    outputFolder = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(outputFolder, { recursive: true, force: true });
  });

  it('does not throw when videoId is not in the index', async () => {
    // No upsertVideo — videoId unknown to index
    fs.writeFileSync(path.join(outputFolder, `${VIDEO_ID}.md`), 'summary');

    await expect(archiveVideo(outputFolder, VIDEO_ID)).resolves.toBeUndefined();
  });
});
