/**
 * Tests for GET /api/videos/[id]/dig-state
 *
 * Behaviors:
 *  1. Doc exists — dug sections present → { sectionIds: [..] }
 *  2. Doc absent / never dug → { sectionIds: [] }
 *  3. Bad outputFolder / videoId → 400
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { GET } from '../../app/api/videos/[id]/dig-state/route';
import * as companionDoc from '../../lib/dig/companion-doc';

jest.mock('../../lib/dig/companion-doc');
const mockReadDugSectionIds = companionDoc.readDugSectionIds as jest.Mock;

let dir: string;
const VIDEO_ID = 'vid12345';

function video(extra: Record<string, unknown> = {}) {
  return {
    id: VIDEO_ID,
    title: 'T',
    youtubeUrl: 'https://youtu.be/x',
    language: 'en',
    durationSeconds: 60,
    archived: false,
    ratings: { usefulness: 4, depth: 4, originality: 4, recency: 4, completeness: 4 },
    overallScore: 4,
    summaryMd: 'test-video.md',
    digDeeperMd: null,
    processedAt: '2026-06-09T00:00:00.000Z',
    ...extra,
  };
}

function writeIndex(v: unknown) {
  fs.writeFileSync(
    path.join(dir, 'playlist-index.json'),
    JSON.stringify({ playlistUrl: 'https://x.test/p', outputFolder: dir, videos: [v] }),
  );
}

function url(extraQuery = '') {
  return new Request(
    `http://localhost/api/videos/${VIDEO_ID}/dig-state?outputFolder=${encodeURIComponent(dir)}${extraQuery}`,
  );
}

const ctx = { params: Promise.resolve({ id: VIDEO_ID }) };

// Must be under homedir — assertOutputFolder (not mocked) enforces this on macOS
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.homedir(), '.tmp-digstate-'));
  jest.clearAllMocks();
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── B3: bad outputFolder / videoId → 400 ─────────────────────────────────────

it('400s without outputFolder', async () => {
  const res = await GET(
    new Request(`http://localhost/api/videos/${VIDEO_ID}/dig-state`),
    ctx,
  );
  expect(res.status).toBe(400);
});

it('400s when outputFolder is outside home directory', async () => {
  const res = await GET(
    new Request(`http://localhost/api/videos/${VIDEO_ID}/dig-state?outputFolder=/etc`),
    ctx,
  );
  expect(res.status).toBe(400);
});

it('400s when videoId is invalid', async () => {
  const badCtx = { params: Promise.resolve({ id: '../etc/passwd' }) };
  writeIndex(video());
  const res = await GET(url(), badCtx);
  expect(res.status).toBe(400);
});

// ── B2: doc absent / never dug → { sectionIds: [] } ─────────────────────────

it('returns { sectionIds: [] } when digDeeperMd is null on the video', async () => {
  writeIndex(video({ digDeeperMd: null }));
  const res = await GET(url(), ctx);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body).toEqual({ sectionIds: [] });
  expect(mockReadDugSectionIds).not.toHaveBeenCalled();
});

it('returns { sectionIds: [] } when digDeeperMd is absent on the video', async () => {
  // digDeeperMd omitted entirely
  writeIndex(video());
  const res = await GET(url(), ctx);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body).toEqual({ sectionIds: [] });
  expect(mockReadDugSectionIds).not.toHaveBeenCalled();
});

it('returns { sectionIds: [] } when readDugSectionIds returns [] (file missing)', async () => {
  writeIndex(video({ digDeeperMd: 'test-video-dig-deeper.md' }));
  mockReadDugSectionIds.mockResolvedValue([]);
  const res = await GET(url(), ctx);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body).toEqual({ sectionIds: [] });
});

// ── B1: doc exists with dug sections → { sectionIds: [..] } ─────────────────

it('returns { sectionIds: [60, 120] } when companion doc has two dug sections', async () => {
  writeIndex(video({ digDeeperMd: 'test-video-dig-deeper.md' }));
  mockReadDugSectionIds.mockResolvedValue([60, 120]);

  const res = await GET(url(), ctx);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body).toEqual({ sectionIds: [60, 120] });
});

it('calls readDugSectionIds with the resolved companion doc path', async () => {
  writeIndex(video({ digDeeperMd: 'test-video-dig-deeper.md' }));
  mockReadDugSectionIds.mockResolvedValue([60]);

  await GET(url(), ctx);

  const expectedPath = path.join(dir, 'test-video-dig-deeper.md');
  expect(mockReadDugSectionIds).toHaveBeenCalledWith(expectedPath);
});

it('404s when video is not found in the index', async () => {
  writeIndex(video({ id: 'other-video' }));
  const res = await GET(url(), ctx);
  expect(res.status).toBe(404);
});
