import crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { PlaylistIndex, Video } from '../../../types';

// Integration test: real ensureDeepDiveHtml → real writeDeepDiveDoc → real runDeepDiveHtml.
// Only the external Gemini/YouTube boundary is mocked (per the project's mocking-boundaries rule).
// This exercises the exact seam where the first-gen bug lived: writeDeepDiveDoc writes the .md but
// does NOT stamp the index, then runDeepDiveHtml must render from that just-written file even though
// the index still has deepDiveMd:null. The previous code read the index here and threw
// "deep dive not available: video has no deepDiveMd".
jest.mock('../../../lib/gemini');
jest.mock('../../../lib/youtube');

import { ensureDeepDiveHtml } from '../../../lib/deep-dive/ensure';
import { readIndex } from '../../../lib/index-store';
import * as gemini from '../../../lib/gemini';
import * as youtube from '../../../lib/youtube';
import type { Version } from '../../../lib/version';

const mockGenerateDeepDive = jest.mocked(gemini.generateDeepDive);
const mockFetchTranscript = jest.mocked(youtube.fetchTranscriptSegments);

const VIDEO_ID = 'intgVideoId1';
const SUMMARY_BASE = '001_integration-video';
const CURRENT: Version = { major: 3, minor: 0 };

function makeTempDir(): string {
  const dir = path.join(os.homedir(), `.ddint-${crypto.randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function makeVideo(overrides: Partial<Video> = {}): Video {
  return {
    id: VIDEO_ID,
    title: 'Integration Video',
    youtubeUrl: 'https://youtube.com/watch?v=intgVideoId1',
    language: 'en',
    durationSeconds: 300,
    archived: false,
    ratings: { usefulness: 3, depth: 3, originality: 3, recency: 3, completeness: 3 },
    overallScore: 3,
    summaryMd: `${SUMMARY_BASE}.md`,
    summaryPdf: null,
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

describe('ensureDeepDiveHtml — first-gen integration (real write-doc + real generate-deep-dive)', () => {
  let outputFolder: string;

  beforeEach(() => {
    outputFolder = makeTempDir();
    // No transcript → write-doc falls to the video-only Gemini path (only this mock needed).
    mockFetchTranscript.mockResolvedValue([]);
    mockGenerateDeepDive.mockResolvedValue('### **1. Overview**\n\nDeep dive body content.\n');
  });

  afterEach(() => {
    fs.rmSync(outputFolder, { recursive: true, force: true });
    jest.clearAllMocks();
  });

  it('first-ever deep dive (index deepDiveMd:null) writes .md, renders HTML, and stamps the index', async () => {
    writeIndex(outputFolder, makeVideo({ deepDiveMd: null }));

    await expect(
      ensureDeepDiveHtml(VIDEO_ID, outputFolder, () => {}, CURRENT),
    ).resolves.toBeUndefined();

    const expectedMd = `${SUMMARY_BASE}-deep-dive.md`;
    const expectedHtml = `htmls/${SUMMARY_BASE}-deep-dive.html`;

    // The .md and HTML both exist on disk
    expect(fs.existsSync(path.join(outputFolder, expectedMd))).toBe(true);
    expect(fs.existsSync(path.join(outputFolder, expectedHtml))).toBe(true);
    expect(fs.readFileSync(path.join(outputFolder, expectedHtml), 'utf-8')).toContain('Deep dive body content.');

    // And the index is stamped atomically with all three fields
    const v = readIndex(outputFolder).videos.find((x) => x.id === VIDEO_ID)!;
    expect(v.deepDiveMd).toBe(expectedMd);
    expect(v.deepDiveHtml).toBe(expectedHtml);
    expect(v.deepDiveVersion).toEqual(CURRENT);
  });
});
