import crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ProgressEvent, Video, PlaylistIndex } from '../../../types';
import type { Version as DocVersion } from '../../../lib/version';

jest.mock('../../../lib/deep-dive/write-doc');
jest.mock('../../../lib/html-doc/generate-deep-dive');

import { ensureDeepDiveHtml } from '../../../lib/deep-dive/ensure';
import { readIndex } from '../../../lib/index-store';
import * as writeDoc from '../../../lib/deep-dive/write-doc';
import * as generateDeepDive from '../../../lib/html-doc/generate-deep-dive';

const mockWriteDeepDiveDoc = jest.mocked(writeDoc.writeDeepDiveDoc);
const mockRunDeepDiveHtml = jest.mocked(generateDeepDive.runDeepDiveHtml);
const mockReRenderDeepDiveHtml = jest.mocked(generateDeepDive.reRenderDeepDiveHtml);

const VIDEO_ID = 'testVideoId1';
const SUMMARY_BASE = '001_test-video';
const MD_FILE = `${SUMMARY_BASE}-deep-dive.md`;
const HTML_PATH = `htmls/${SUMMARY_BASE}-deep-dive.html`;
const CURRENT: DocVersion = { major: 2, minor: 0 };

// A homedir-rooted temp folder so assertOutputFolder passes.
function makeTempDir(): string {
  const dir = path.join(os.homedir(), `.ddtest-${crypto.randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function makeVideo(overrides: Partial<Video> = {}): Video {
  return {
    id: VIDEO_ID,
    title: 'Test Video',
    youtubeUrl: 'https://youtube.com/watch?v=testVideoId1',
    language: 'en',
    durationSeconds: 300,
    archived: false,
    ratings: { usefulness: 3, depth: 3, originality: 3, recency: 3, completeness: 3 },
    overallScore: 3,
    summaryMd: `${SUMMARY_BASE}.md`,
    summaryPdf: `${SUMMARY_BASE}.pdf`,
    deepDiveMd: null,
    deepDivePdf: null,
    processedAt: new Date().toISOString(),
    ...overrides,
  };
}

function writeIndex(outputFolder: string, video: Video): void {
  const index: PlaylistIndex = {
    playlistUrl: 'https://youtube.com/playlist?list=PLtest',
    outputFolder,
    videos: [video],
  };
  fs.writeFileSync(path.join(outputFolder, 'playlist-index.json'), JSON.stringify(index, null, 2), 'utf-8');
}

function storedVideo(outputFolder: string): Video {
  return readIndex(outputFolder).videos.find((v) => v.id === VIDEO_ID)!;
}

describe('ensureDeepDiveHtml', () => {
  let outputFolder: string;

  beforeEach(() => {
    outputFolder = makeTempDir();
    mockWriteDeepDiveDoc.mockResolvedValue({ deepDiveMd: MD_FILE });
    mockRunDeepDiveHtml.mockResolvedValue({ html: '<html></html>', htmlPath: HTML_PATH });
    mockReRenderDeepDiveHtml.mockReturnValue({ status: 'rerendered', htmlPath: HTML_PATH });
  });

  afterEach(() => {
    fs.rmSync(outputFolder, { recursive: true, force: true });
    jest.clearAllMocks();
  });

  // ── Guards ──────────────────────────────────────────────────────────────────
  it('throws when the video is not in the index', async () => {
    writeIndex(outputFolder, makeVideo());
    await expect(ensureDeepDiveHtml('nopeVideoId9', outputFolder, () => {}, CURRENT)).rejects.toThrow(
      /not found in index/i,
    );
  });

  // ── Branch 1: no deepDiveMd → full regenerate (#1) ────────────────────────────
  it('no deepDiveMd → writeDeepDiveDoc + runDeepDiveHtml, stamps md+html+version in ONE update', async () => {
    writeIndex(outputFolder, makeVideo({ deepDiveMd: null }));
    await ensureDeepDiveHtml(VIDEO_ID, outputFolder, () => {}, CURRENT);

    expect(mockWriteDeepDiveDoc).toHaveBeenCalled();
    expect(mockRunDeepDiveHtml).toHaveBeenCalledWith(VIDEO_ID, outputFolder);
    expect(mockReRenderDeepDiveHtml).not.toHaveBeenCalled();

    const v = storedVideo(outputFolder);
    expect(v.deepDiveMd).toBe(MD_FILE);
    expect(v.deepDiveHtml).toBe(HTML_PATH);
    expect(v.deepDiveVersion).toEqual(CURRENT);
  });

  // ── Branch 1: major-stale → regenerate (#2) ───────────────────────────────────
  it('major-stale (stored {1,0}) with deepDiveMd present → regenerate cascade, stamp current', async () => {
    writeIndex(outputFolder, makeVideo({ deepDiveMd: MD_FILE, deepDiveHtml: HTML_PATH, deepDiveVersion: { major: 1, minor: 0 } }));
    await ensureDeepDiveHtml(VIDEO_ID, outputFolder, () => {}, CURRENT);

    expect(mockWriteDeepDiveDoc).toHaveBeenCalled();
    expect(mockRunDeepDiveHtml).toHaveBeenCalled();
    expect(storedVideo(outputFolder).deepDiveVersion).toEqual(CURRENT);
  });

  // ── absent deepDiveVersion treated as pre-feature {1,0} → major-stale (#3) ─────
  it('absent deepDiveVersion with md+html present → treated as {1,0}, regenerates', async () => {
    writeIndex(outputFolder, makeVideo({ deepDiveMd: MD_FILE, deepDiveHtml: HTML_PATH, deepDiveVersion: undefined }));
    await ensureDeepDiveHtml(VIDEO_ID, outputFolder, () => {}, CURRENT);
    expect(mockWriteDeepDiveDoc).toHaveBeenCalled();
  });

  // ── Branch 2: md present, current major, no html → build html only (#4) ───────
  it('md present, current version, no deepDiveHtml → runDeepDiveHtml only (no writeDeepDiveDoc), stamp html+version', async () => {
    writeIndex(outputFolder, makeVideo({ deepDiveMd: MD_FILE, deepDiveHtml: null, deepDiveVersion: CURRENT }));
    await ensureDeepDiveHtml(VIDEO_ID, outputFolder, () => {}, CURRENT);

    expect(mockWriteDeepDiveDoc).not.toHaveBeenCalled();
    expect(mockRunDeepDiveHtml).toHaveBeenCalledWith(VIDEO_ID, outputFolder);

    const v = storedVideo(outputFolder);
    expect(v.deepDiveHtml).toBe(HTML_PATH);
    expect(v.deepDiveVersion).toEqual(CURRENT);
  });

  // ── Branch 3: minor-stale → cheap re-render (#5) ──────────────────────────────
  it('minor-stale with md+html present → reRenderDeepDiveHtml (no Gemini, no full build), stamp', async () => {
    writeIndex(outputFolder, makeVideo({ deepDiveMd: MD_FILE, deepDiveHtml: HTML_PATH, deepDiveVersion: { major: 2, minor: 0 } }));
    await ensureDeepDiveHtml(VIDEO_ID, outputFolder, () => {}, { major: 2, minor: 1 });

    expect(mockWriteDeepDiveDoc).not.toHaveBeenCalled();
    expect(mockRunDeepDiveHtml).not.toHaveBeenCalled();
    expect(mockReRenderDeepDiveHtml).toHaveBeenCalledWith(VIDEO_ID, outputFolder);
    expect(storedVideo(outputFolder).deepDiveVersion).toEqual({ major: 2, minor: 1 });
  });

  // ── Branch 4 (no-op): current + html present → nothing (#16) ──────────────────
  it('current + html present → no-op, no updateVideoFields, emits start+done only', async () => {
    writeIndex(outputFolder, makeVideo({ deepDiveMd: MD_FILE, deepDiveHtml: HTML_PATH, deepDiveVersion: CURRENT }));
    const before = storedVideo(outputFolder);
    const events: ProgressEvent[] = [];
    await ensureDeepDiveHtml(VIDEO_ID, outputFolder, (e) => events.push(e), CURRENT);

    expect(mockWriteDeepDiveDoc).not.toHaveBeenCalled();
    expect(mockRunDeepDiveHtml).not.toHaveBeenCalled();
    expect(mockReRenderDeepDiveHtml).not.toHaveBeenCalled();
    expect(events.map((e) => e.type)).toEqual(['start', 'done']);
    // index unchanged
    expect(storedVideo(outputFolder)).toEqual(before);
  });

  // ── Atomicity: writeDeepDiveDoc throws → NO stamp (#9) ────────────────────────
  it('writeDeepDiveDoc throws → does not stamp; index deepDiveMd/version untouched', async () => {
    writeIndex(outputFolder, makeVideo({ deepDiveMd: null, deepDiveVersion: undefined }));
    mockWriteDeepDiveDoc.mockRejectedValueOnce(new Error('all paths failed'));

    await expect(ensureDeepDiveHtml(VIDEO_ID, outputFolder, () => {}, CURRENT)).rejects.toThrow(/all paths failed/);

    expect(mockRunDeepDiveHtml).not.toHaveBeenCalled();
    const v = storedVideo(outputFolder);
    expect(v.deepDiveMd).toBeNull();
    expect(v.deepDiveVersion).toBeUndefined();
  });

  // ── Atomicity: runDeepDiveHtml throws after md write → NO stamp (#10) ──────────
  it('runDeepDiveHtml throws after .md write → does not stamp; deepDiveMd stays absent', async () => {
    writeIndex(outputFolder, makeVideo({ deepDiveMd: null, deepDiveVersion: undefined }));
    mockRunDeepDiveHtml.mockRejectedValueOnce(new Error('render boom'));

    await expect(ensureDeepDiveHtml(VIDEO_ID, outputFolder, () => {}, CURRENT)).rejects.toThrow(/render boom/);

    const v = storedVideo(outputFolder);
    expect(v.deepDiveMd).toBeNull();
    expect(v.deepDiveHtml).toBeUndefined();
    expect(v.deepDiveVersion).toBeUndefined();
  });

  // ── #14: minor-stale but .md deleted → reRender skips → full regenerate fallback
  it('minor-stale but .md missing (reRender → skipped-no-md) → full regenerate fallback, stamp', async () => {
    writeIndex(outputFolder, makeVideo({ deepDiveMd: MD_FILE, deepDiveHtml: HTML_PATH, deepDiveVersion: { major: 2, minor: 0 } }));
    mockReRenderDeepDiveHtml.mockReturnValueOnce({ status: 'skipped-no-md' });

    await ensureDeepDiveHtml(VIDEO_ID, outputFolder, () => {}, { major: 2, minor: 1 });

    expect(mockReRenderDeepDiveHtml).toHaveBeenCalled();
    expect(mockWriteDeepDiveDoc).toHaveBeenCalled();
    expect(mockRunDeepDiveHtml).toHaveBeenCalledWith(VIDEO_ID, outputFolder);
    const v = storedVideo(outputFolder);
    expect(v.deepDiveMd).toBe(MD_FILE);
    expect(v.deepDiveHtml).toBe(HTML_PATH);
    expect(v.deepDiveVersion).toEqual({ major: 2, minor: 1 });
  });

  // ── #15: html-missing wins over minor-stale ───────────────────────────────────
  it('html missing AND minor-stale → takes the html-build branch (not re-render)', async () => {
    writeIndex(outputFolder, makeVideo({ deepDiveMd: MD_FILE, deepDiveHtml: null, deepDiveVersion: { major: 2, minor: 0 } }));
    await ensureDeepDiveHtml(VIDEO_ID, outputFolder, () => {}, { major: 2, minor: 1 });

    expect(mockRunDeepDiveHtml).toHaveBeenCalled();
    expect(mockReRenderDeepDiveHtml).not.toHaveBeenCalled();
    expect(mockWriteDeepDiveDoc).not.toHaveBeenCalled();
    expect(storedVideo(outputFolder).deepDiveVersion).toEqual({ major: 2, minor: 1 });
  });

  // ── #12: done emitted AFTER the stamp ─────────────────────────────────────────
  it('done event is emitted AFTER updateVideoFields stamps the version (call order)', async () => {
    // Seed a stored version that DIFFERS from `current` so the done-time read can only match
    // `current` if the stamp already ran before `done`. stored {1,0} → needsRegenerate → stamps {2,0}.
    const STORED: DocVersion = { major: 1, minor: 0 };
    writeIndex(outputFolder, makeVideo({ deepDiveMd: MD_FILE, deepDiveHtml: HTML_PATH, deepDiveVersion: STORED }));
    let versionAtDone: DocVersion | undefined = { major: -1, minor: -1 };
    await ensureDeepDiveHtml(
      VIDEO_ID,
      outputFolder,
      (e) => {
        if (e.type === 'done') versionAtDone = storedVideo(outputFolder).deepDiveVersion;
      },
      CURRENT,
    );
    // CURRENT differs from the seeded STORED, so this only holds if the stamp ran before 'done'.
    expect(STORED).not.toEqual(CURRENT);
    expect(versionAtDone).toEqual(CURRENT);
  });

  // ── start emitted first ───────────────────────────────────────────────────────
  it('emits start first and done last on a working branch', async () => {
    writeIndex(outputFolder, makeVideo({ deepDiveMd: null }));
    const events: ProgressEvent[] = [];
    await ensureDeepDiveHtml(VIDEO_ID, outputFolder, (e) => events.push(e), CURRENT);
    expect(events[0]).toMatchObject({ type: 'start' });
    expect(events[events.length - 1]).toMatchObject({ type: 'done' });
  });
});
