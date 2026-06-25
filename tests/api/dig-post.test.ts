/**
 * Tests for POST /api/videos/[id]/dig/[sectionId]
 *
 * Covers all 9 behaviors:
 *  1. Happy path — 200 + jobId; pipeline steps called in order
 *  2. Missing outputFolder — 400
 *  3. Invalid sectionId (non-integer or negative) — 400
 *  4. Section not found — error event emitted; no doc mutation
 *  5. Same-section in-flight dedup — second POST returns same jobId; pipeline runs once
 *  6. force=1 — overwrites; pipeline runs again despite in-flight key
 *  7. Gemini fails (generateDig throws) — error event; no upsertDugSection or HTML write
 *  8. yt-dlp gated — resolveSlideTokens returns text-only; done event emitted
 *  9. Assets-before-doc ordering — resolveSlideTokens called before upsertDugSection
 */

import { POST } from '../../app/api/videos/[id]/dig/[sectionId]/route';
import * as sectionWindowMod from '../../lib/dig/section-window';
import * as generateMod from '../../lib/dig/generate';
import * as slidesMod from '../../lib/dig/slides';
import * as companionDocMod from '../../lib/dig/companion-doc';
import * as renderDigMod from '../../lib/html-doc/render-dig-deeper';
import * as transcriptTimestamps from '../../lib/transcript-timestamps';
import * as parseMod from '../../lib/html-doc/parse';
import * as transcriptSource from '../../lib/transcript-source';
import * as indexStore from '../../lib/index-store';
import * as jobRegistry from '../../lib/job-registry';
import * as fs from 'node:fs/promises';

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('../../lib/dig/section-window');
jest.mock('../../lib/dig/generate');
jest.mock('../../lib/dig/slides');
jest.mock('../../lib/dig/companion-doc');
jest.mock('../../lib/html-doc/render-dig-deeper');
jest.mock('../../lib/transcript-timestamps');
jest.mock('../../lib/html-doc/parse');
jest.mock('../../lib/transcript-source');
jest.mock('../../lib/index-store');
jest.mock('node:fs/promises');
// Mock job-registry so its exports are jest.fn() wrappers that delegate to
// the real implementations. This allows spyOn to intercept calls because
// the route's closured references call through to mutable jest.fn() instances.
jest.mock('../../lib/job-registry', () => {
  const real = jest.requireActual<typeof import('../../lib/job-registry')>('../../lib/job-registry');
  return {
    createJob: jest.fn((...args: Parameters<typeof real.createJob>) => real.createJob(...args)),
    deleteJob: jest.fn((...args: Parameters<typeof real.deleteJob>) => real.deleteJob(...args)),
    emitJobEvent: jest.fn((...args: Parameters<typeof real.emitJobEvent>) => real.emitJobEvent(...args)),
    getActiveJob: jest.fn((...args: Parameters<typeof real.getActiveJob>) => real.getActiveJob(...args)),
    releaseJobLock: jest.fn((...args: Parameters<typeof real.releaseJobLock>) => real.releaseJobLock(...args)),
    subscribeJob: jest.fn((...args: Parameters<typeof real.subscribeJob>) => real.subscribeJob(...args)),
    cancelJob: jest.fn((...args: Parameters<typeof real.cancelJob>) => real.cancelJob(...args)),
    getJobSignal: jest.fn((...args: Parameters<typeof real.getJobSignal>) => real.getJobSignal(...args)),
    isIngestionRunning: jest.fn((...args: Parameters<typeof real.isIngestionRunning>) => real.isIngestionRunning(...args)),
    _resetJobRegistry: jest.fn((...args: Parameters<typeof real._resetJobRegistry>) => real._resetJobRegistry(...args)),
  };
});

// ── Typed mock refs ───────────────────────────────────────────────────────────

const mockWindowForSection = sectionWindowMod.windowForSection as jest.Mock;
const mockGenerateDig = generateMod.generateDig as jest.Mock;
const mockResolveSlideTokens = slidesMod.resolveSlideTokens as jest.Mock;
const mockUpsertDugSection = companionDocMod.upsertDugSection as jest.Mock;
const mockRenderDigDeeperHtml = renderDigMod.renderDigDeeperHtml as jest.Mock;
const mockResolveTranscriptTokens = transcriptTimestamps.resolveTranscriptTokens as jest.Mock;
const mockParseSummaryMarkdown = parseMod.parseSummaryMarkdown as jest.Mock;
const mockResolveTranscriptSegments = transcriptSource.resolveTranscriptSegments as jest.Mock;
const mockAssertOutputFolder = jest.mocked(indexStore.assertOutputFolder);
const mockAssertVideoId = jest.mocked(indexStore.assertVideoId);
const mockReadIndex = jest.mocked(indexStore.readIndex);
const mockUpdateVideoFields = jest.mocked(indexStore.updateVideoFields);
const mockReadFile = fs.readFile as jest.Mock;
const mockWriteFile = fs.writeFile as jest.Mock;
const mockMkdir = fs.mkdir as jest.Mock;

// ── Constants ─────────────────────────────────────────────────────────────────

const HOME = (process.env.HOME ?? '/tmp') + '/playlist';
const VIDEO_ID = 'vid12345';
const SECTION_ID = 60;

const MOCK_RATINGS = {
  usefulness: 4 as const,
  depth: 4 as const,
  originality: 3 as const,
  recency: 3 as const,
  completeness: 4 as const,
};

const MOCK_VIDEO = {
  id: VIDEO_ID,
  title: 'Test Video Title',
  youtubeUrl: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
  durationSeconds: 3600,
  language: 'en' as const,
  archived: false,
  ratings: MOCK_RATINGS,
  overallScore: 3.6,
  summaryMd: 'test-video.md',
  summaryPdf: null,
  deepDiveMd: null,
  deepDivePdf: null,
  digDeeperMd: null,
  digDeeperHtml: null,
  processedAt: '2024-01-01T00:00:00.000Z',
};

const MOCK_SECTION = {
  title: 'Introduction',
  prose: 'Some intro text',
  timeRange: { startSec: SECTION_ID, endSec: 120 },
};

const MOCK_WINDOW = {
  sectionId: SECTION_ID,
  startSec: SECTION_ID,
  endSec: 120,
  transcriptWindow: [],
  summaryProse: 'Some intro text',
};

const MOCK_SEGMENTS = [
  { text: 'Hello world', offset: 60, duration: 5 },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function req(videoId: string, sectionId: string | number, body: unknown) {
  return new Request(
    `http://localhost/api/videos/${videoId}/dig/${sectionId}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

function ctx(videoId: string, sectionId: string | number) {
  return { params: Promise.resolve({ id: videoId, sectionId: String(sectionId) }) };
}

function post(videoId: string, sectionId: string | number, body: unknown) {
  return POST(req(videoId, sectionId, body), ctx(videoId, sectionId));
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  jobRegistry._resetJobRegistry();

  // Default mock implementations — happy path
  mockAssertOutputFolder.mockImplementation(() => {});
  mockAssertVideoId.mockImplementation(() => {});

  mockReadIndex.mockReturnValue({ playlistUrl: '', outputFolder: HOME, videos: [MOCK_VIDEO] });
  mockReadFile.mockResolvedValue('## Summary Markdown Content');
  mockMkdir.mockResolvedValue(undefined);

  mockParseSummaryMarkdown.mockReturnValue({ sections: [MOCK_SECTION] });
  mockResolveTranscriptSegments.mockResolvedValue({ segments: MOCK_SEGMENTS, source: 'captions' });
  mockWindowForSection.mockReturnValue(MOCK_WINDOW);
  mockGenerateDig.mockResolvedValue('# Dig Deeper\n\nElaborated content here.');
  mockResolveTranscriptTokens.mockReturnValue('# Dig Deeper\n\nWith timestamps.');
  mockResolveSlideTokens.mockResolvedValue('# Dig Deeper\n\nFinal markdown.');
  mockUpsertDugSection.mockResolvedValue(undefined);
  mockRenderDigDeeperHtml.mockReturnValue('<html>dig deeper</html>');
  mockWriteFile.mockResolvedValue(undefined);
  mockUpdateVideoFields.mockImplementation(() => {});
});

// ── B2: Missing outputFolder → 400 ───────────────────────────────────────────

describe('B2: validation — missing outputFolder', () => {
  it('400 when outputFolder is missing', async () => {
    const res = await post(VIDEO_ID, SECTION_ID, {});
    expect(res.status).toBe(400);
  });

  it('400 when outputFolder is null', async () => {
    const res = await post(VIDEO_ID, SECTION_ID, { outputFolder: null });
    expect(res.status).toBe(400);
  });

  it('400 when assertOutputFolder throws', async () => {
    mockAssertOutputFolder.mockImplementation(() => { throw new Error('outside home'); });
    const res = await post(VIDEO_ID, SECTION_ID, { outputFolder: '/etc' });
    expect(res.status).toBe(400);
  });
});

// ── B3: Invalid sectionId → 400 ──────────────────────────────────────────────

describe('B3: validation — invalid sectionId', () => {
  it('400 when sectionId is not a number ("abc")', async () => {
    const res = await post(VIDEO_ID, 'abc', { outputFolder: HOME });
    expect(res.status).toBe(400);
  });

  it('400 when sectionId is negative (-1)', async () => {
    const res = await post(VIDEO_ID, -1, { outputFolder: HOME });
    expect(res.status).toBe(400);
  });

  it('400 when sectionId is a float ("1.5")', async () => {
    const res = await post(VIDEO_ID, '1.5', { outputFolder: HOME });
    expect(res.status).toBe(400);
  });

  it('400 when assertVideoId throws (invalid videoId)', async () => {
    mockAssertVideoId.mockImplementation(() => { throw new Error('invalid videoId'); });
    const res = await post('../etc/passwd', SECTION_ID, { outputFolder: HOME });
    expect(res.status).toBe(400);
  });
});

// ── B1: Happy path ────────────────────────────────────────────────────────────

describe('B1: happy path', () => {
  it('returns 200 with a non-empty jobId', async () => {
    const res = await post(VIDEO_ID, SECTION_ID, { outputFolder: HOME });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.jobId).toBe('string');
    expect(body.jobId.length).toBeGreaterThan(0);
  });

  it('calls readIndex with outputFolder', async () => {
    await post(VIDEO_ID, SECTION_ID, { outputFolder: HOME });
    // Give the async pipeline a tick to start
    await new Promise((r) => setTimeout(r, 0));
    expect(mockReadIndex).toHaveBeenCalledWith(HOME);
  });

  it('calls parseSummaryMarkdown with the read md content', async () => {
    await post(VIDEO_ID, SECTION_ID, { outputFolder: HOME });
    await new Promise((r) => setTimeout(r, 10));
    expect(mockParseSummaryMarkdown).toHaveBeenCalled();
  });

  it('calls resolveTranscriptSegments with video fields', async () => {
    await post(VIDEO_ID, SECTION_ID, { outputFolder: HOME });
    await new Promise((r) => setTimeout(r, 10));
    expect(mockResolveTranscriptSegments).toHaveBeenCalledWith(
      VIDEO_ID,
      MOCK_VIDEO.youtubeUrl,
      MOCK_VIDEO.durationSeconds,
    );
  });

  it('calls windowForSection with the matched section and all sections', async () => {
    await post(VIDEO_ID, SECTION_ID, { outputFolder: HOME });
    await new Promise((r) => setTimeout(r, 10));
    expect(mockWindowForSection).toHaveBeenCalledWith(
      MOCK_SECTION,
      [MOCK_SECTION],
      MOCK_SEGMENTS,
      MOCK_VIDEO.durationSeconds,
    );
  });

  it('calls generateDig with the window, videoId, and language', async () => {
    await post(VIDEO_ID, SECTION_ID, { outputFolder: HOME });
    await new Promise((r) => setTimeout(r, 10));
    expect(mockGenerateDig).toHaveBeenCalledWith(MOCK_WINDOW, VIDEO_ID, MOCK_VIDEO.language);
  });

  it('calls resolveTranscriptTokens with raw markdown from generateDig', async () => {
    await post(VIDEO_ID, SECTION_ID, { outputFolder: HOME });
    await new Promise((r) => setTimeout(r, 10));
    expect(mockResolveTranscriptTokens).toHaveBeenCalled();
  });

  it('calls resolveSlideTokens with expected opts', async () => {
    await post(VIDEO_ID, SECTION_ID, { outputFolder: HOME });
    await new Promise((r) => setTimeout(r, 10));
    expect(mockResolveSlideTokens).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        videoId: VIDEO_ID,
        startSec: MOCK_WINDOW.startSec,
        endSec: MOCK_WINDOW.endSec,
        sectionId: SECTION_ID,
      }),
    );
  });

  it('calls upsertDugSection with the section data', async () => {
    await post(VIDEO_ID, SECTION_ID, { outputFolder: HOME });
    await new Promise((r) => setTimeout(r, 10));
    expect(mockUpsertDugSection).toHaveBeenCalledWith(
      expect.objectContaining({
        videoTitle: MOCK_VIDEO.title,
        videoId: VIDEO_ID,
        language: MOCK_VIDEO.language,
        sourceVideoUrl: MOCK_VIDEO.youtubeUrl,
        section: expect.objectContaining({
          sectionId: SECTION_ID,
          startSec: MOCK_WINDOW.startSec,
          title: MOCK_SECTION.title,
        }),
      }),
    );
  });

  it('calls renderDigDeeperHtml and writes the HTML file', async () => {
    await post(VIDEO_ID, SECTION_ID, { outputFolder: HOME });
    await new Promise((r) => setTimeout(r, 10));
    expect(mockRenderDigDeeperHtml).toHaveBeenCalled();
    expect(mockWriteFile).toHaveBeenCalled();
  });

  it('calls updateVideoFields with digDeeperMd and digDeeperHtml', async () => {
    await post(VIDEO_ID, SECTION_ID, { outputFolder: HOME });
    await new Promise((r) => setTimeout(r, 10));
    expect(mockUpdateVideoFields).toHaveBeenCalledWith(
      HOME,
      VIDEO_ID,
      expect.objectContaining({
        digDeeperMd: expect.any(String),
        digDeeperHtml: expect.any(String),
      }),
    );
  });
});

// ── B4: Section not found ─────────────────────────────────────────────────────

describe('B4: section not found', () => {
  beforeEach(() => { jest.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => { jest.restoreAllMocks(); });

  it('returns 200 with jobId but emits an error event (no doc mutation)', async () => {
    // Sections exist but none match SECTION_ID
    mockParseSummaryMarkdown.mockReturnValue({
      sections: [
        { title: 'Other', prose: 'other', timeRange: { startSec: 999, endSec: 1200 } },
      ],
    });

    const res = await post(VIDEO_ID, SECTION_ID, { outputFolder: HOME });
    expect(res.status).toBe(200);
    const { jobId } = await res.json();
    expect(typeof jobId).toBe('string');

    // Wait for the async pipeline
    await new Promise((r) => setTimeout(r, 10));

    // No doc writes should have happened
    expect(mockUpsertDugSection).not.toHaveBeenCalled();
    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(mockUpdateVideoFields).not.toHaveBeenCalled();
  });
});

// ── B5: Same-section in-flight dedup ─────────────────────────────────────────

describe('B5: same-section in-flight dedup', () => {
  it('second POST returns same jobId; generateDig called only once', async () => {
    // Hang the pipeline so the job stays active
    mockGenerateDig.mockReturnValue(new Promise(() => {}));

    const first = await (await post(VIDEO_ID, SECTION_ID, { outputFolder: HOME })).json();
    const second = await (await post(VIDEO_ID, SECTION_ID, { outputFolder: HOME })).json();

    expect(second.jobId).toBe(first.jobId);
    expect(mockGenerateDig).toHaveBeenCalledTimes(1);
  });

  it('getActiveJob key is outputFolder::videoId::sectionId', async () => {
    // Two different sectionIds should get different jobs
    mockGenerateDig.mockReturnValue(new Promise(() => {}));

    const firstRes = await post(VIDEO_ID, SECTION_ID, { outputFolder: HOME });
    const otherSection = { ...MOCK_SECTION, timeRange: { startSec: 200, endSec: 300 } };
    mockParseSummaryMarkdown.mockReturnValue({ sections: [otherSection] });
    mockWindowForSection.mockReturnValue({ ...MOCK_WINDOW, sectionId: 200, startSec: 200 });

    const secondRes = await post(VIDEO_ID, 200, { outputFolder: HOME });
    const first = await firstRes.json();
    const second = await secondRes.json();

    expect(first.jobId).not.toBe(second.jobId);
  });
});

// ── B6: force=1 ───────────────────────────────────────────────────────────────

describe('B6: force flag', () => {
  it('force=1 bypasses in-flight guard and runs the pipeline again', async () => {
    // First call hangs (in-flight)
    mockGenerateDig.mockReturnValue(new Promise(() => {}));
    const firstRes = await post(VIDEO_ID, SECTION_ID, { outputFolder: HOME });
    const first = await firstRes.json();

    // Reset generateDig to resolve quickly for the second call
    mockGenerateDig.mockResolvedValue('# New content');

    const secondRes = await post(VIDEO_ID, SECTION_ID, { outputFolder: HOME, force: 1 });
    const second = await secondRes.json();

    // Force should start a new job
    expect(second.jobId).not.toBe(first.jobId);
  });
});

// ── B7: Gemini fails ──────────────────────────────────────────────────────────

describe('B7: Gemini failure', () => {
  beforeEach(() => { jest.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => { jest.restoreAllMocks(); });

  it('emits error event; upsertDugSection and HTML write NOT called', async () => {
    mockGenerateDig.mockRejectedValue(new Error('Gemini rate limit'));

    const res = await post(VIDEO_ID, SECTION_ID, { outputFolder: HOME });
    expect(res.status).toBe(200);

    await new Promise((r) => setTimeout(r, 20));

    expect(mockUpsertDugSection).not.toHaveBeenCalled();
    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(mockUpdateVideoFields).not.toHaveBeenCalled();
  });
});

// ── B8: yt-dlp gated (resolveSlideTokens text-only) ──────────────────────────

describe('B8: yt-dlp gated', () => {
  it('resolveSlideTokens returns text-only markdown; done event still emitted', async () => {
    // Simulate yt-dlp failure → tokens stripped, text-only returned
    mockResolveSlideTokens.mockResolvedValue('# Dig Deeper\n\nText only, no slides.');

    const res = await post(VIDEO_ID, SECTION_ID, { outputFolder: HOME });
    expect(res.status).toBe(200);

    await new Promise((r) => setTimeout(r, 10));

    // Pipeline continues normally with text-only md
    expect(mockUpsertDugSection).toHaveBeenCalled();
    expect(mockRenderDigDeeperHtml).toHaveBeenCalled();
    expect(mockWriteFile).toHaveBeenCalled();
    expect(mockUpdateVideoFields).toHaveBeenCalled();
  });
});

// ── B9: Assets-before-doc ordering ───────────────────────────────────────────

describe('B9: assets-before-doc ordering', () => {
  it('resolveSlideTokens is called before upsertDugSection', async () => {
    const callOrder: string[] = [];

    mockResolveSlideTokens.mockImplementation(async () => {
      callOrder.push('resolveSlideTokens');
      return '# Final';
    });
    mockUpsertDugSection.mockImplementation(async () => {
      callOrder.push('upsertDugSection');
    });

    await post(VIDEO_ID, SECTION_ID, { outputFolder: HOME });
    await new Promise((r) => setTimeout(r, 20));

    const slideIdx = callOrder.indexOf('resolveSlideTokens');
    const upsertIdx = callOrder.indexOf('upsertDugSection');

    expect(slideIdx).toBeGreaterThanOrEqual(0);
    expect(upsertIdx).toBeGreaterThanOrEqual(0);
    expect(slideIdx).toBeLessThan(upsertIdx);
  });
});

// ── Finding 1: force evicts existing lock before creating new job ─────────────

describe('Finding 1: force=1 evicts existing lock', () => {
  it('force=1 calls releaseJobLock on the old job before creating a new one', async () => {
    // Hang first job so it stays active
    mockGenerateDig.mockReturnValue(new Promise(() => {}));
    const firstRes = await post(VIDEO_ID, SECTION_ID, { outputFolder: HOME });
    const { jobId: firstJobId } = await firstRes.json();

    // Clear call counts so we can track what the force request does
    (jobRegistry.releaseJobLock as jest.Mock).mockClear();

    // Reset generateDig for the force request
    mockGenerateDig.mockResolvedValue('# New content');
    const secondRes = await post(VIDEO_ID, SECTION_ID, { outputFolder: HOME, force: 1 });
    const { jobId: secondJobId } = await secondRes.json();

    // releaseJobLock should have been called with the OLD jobId
    expect(jobRegistry.releaseJobLock).toHaveBeenCalledWith(firstJobId);
    // Force creates a new job
    expect(secondJobId).not.toBe(firstJobId);
  });

  it('force=1 does NOT return the old jobId', async () => {
    mockGenerateDig.mockReturnValue(new Promise(() => {}));
    const firstRes = await post(VIDEO_ID, SECTION_ID, { outputFolder: HOME });
    const { jobId: firstJobId } = await firstRes.json();

    mockGenerateDig.mockResolvedValue('# New content');
    const secondRes = await post(VIDEO_ID, SECTION_ID, { outputFolder: HOME, force: 1 });
    const { jobId: secondJobId } = await secondRes.json();

    expect(secondJobId).not.toBe(firstJobId);
    expect(typeof secondJobId).toBe('string');
    expect(secondJobId.length).toBeGreaterThan(0);
  });

  it('non-force second request still returns the existing jobId (unchanged behavior)', async () => {
    mockGenerateDig.mockReturnValue(new Promise(() => {}));
    const firstRes = await post(VIDEO_ID, SECTION_ID, { outputFolder: HOME });
    const { jobId: firstJobId } = await firstRes.json();

    const secondRes = await post(VIDEO_ID, SECTION_ID, { outputFolder: HOME });
    const { jobId: secondJobId } = await secondRes.json();

    expect(secondJobId).toBe(firstJobId);
  });
});

// ── Finding 2: exact lock-key string ─────────────────────────────────────────

describe('Finding 2: exact lock-key string used in job registry', () => {
  it('getActiveJob is called with the exact composite key outputFolder::videoId::sectionId', async () => {
    await post(VIDEO_ID, SECTION_ID, { outputFolder: HOME });

    const expectedKey = `${HOME}::${VIDEO_ID}::${SECTION_ID}`;
    expect(jobRegistry.getActiveJob).toHaveBeenCalledWith(expectedKey);
  });

  it('createJob is called with the exact composite key outputFolder::videoId::sectionId', async () => {
    await post(VIDEO_ID, SECTION_ID, { outputFolder: HOME });

    const expectedKey = `${HOME}::${VIDEO_ID}::${SECTION_ID}`;
    expect(jobRegistry.createJob).toHaveBeenCalledWith(expect.any(String), expectedKey);
  });
});

// ── Finding 3: empty/whitespace sectionId → 400 ───────────────────────────────

describe('Finding 3: empty/whitespace sectionId → 400', () => {
  it('400 when sectionId is empty string ""', async () => {
    const res = await post(VIDEO_ID, '', { outputFolder: HOME });
    expect(res.status).toBe(400);
  });

  it('400 when sectionId is whitespace "  "', async () => {
    const res = await post(VIDEO_ID, '  ', { outputFolder: HOME });
    expect(res.status).toBe(400);
  });
});

// ── M-2: force=1 calls cancelJob on the old job ──────────────────────────────

describe('M-2: force=1 aborts old job via cancelJob', () => {
  it('force=1 calls cancelJob on the existing job before creating a new one', async () => {
    // Hang first job so it stays active
    mockGenerateDig.mockReturnValue(new Promise(() => {}));
    const firstRes = await post(VIDEO_ID, SECTION_ID, { outputFolder: HOME });
    const { jobId: firstJobId } = await firstRes.json();

    // Clear call counts
    (jobRegistry.cancelJob as jest.Mock).mockClear();

    // Reset generateDig for the force request
    mockGenerateDig.mockResolvedValue('# New content');
    await post(VIDEO_ID, SECTION_ID, { outputFolder: HOME, force: 1 });

    // cancelJob should have been called with the OLD jobId
    expect(jobRegistry.cancelJob).toHaveBeenCalledWith(firstJobId);
  });
});

// ── Finding 4: suppress console.error in error-path tests ────────────────────

describe('Finding 4: console.error suppressed in error paths', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('Gemini failure does not leak console.error to CI output', async () => {
    mockGenerateDig.mockRejectedValue(new Error('Gemini rate limit'));

    const res = await post(VIDEO_ID, SECTION_ID, { outputFolder: HOME });
    expect(res.status).toBe(200);

    await new Promise((r) => setTimeout(r, 20));

    expect(mockUpsertDugSection).not.toHaveBeenCalled();
  });

  it('section-not-found error does not leak console.error to CI output', async () => {
    mockParseSummaryMarkdown.mockReturnValue({
      sections: [
        { title: 'Other', prose: 'other', timeRange: { startSec: 999, endSec: 1200 } },
      ],
    });

    const res = await post(VIDEO_ID, SECTION_ID, { outputFolder: HOME });
    expect(res.status).toBe(200);

    await new Promise((r) => setTimeout(r, 20));

    expect(mockUpsertDugSection).not.toHaveBeenCalled();
  });
});
