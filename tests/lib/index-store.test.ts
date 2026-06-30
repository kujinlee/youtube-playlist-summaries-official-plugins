import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { readIndex, updateVideoFields, upsertVideo, writeIndex } from '../../lib/index-store';
import type { PlaylistIndex, Video } from '../../types';
import { VideoSchema } from '../../types';

const TEST_DIR = path.join(os.homedir(), `.test-index-store-${crypto.randomUUID()}`);

function makeVideo(overrides: Partial<Video> = {}): Video {
  return {
    id: 'abc12345678',
    title: 'Test Video',
    youtubeUrl: 'https://www.youtube.com/watch?v=abc12345678',
    language: 'en',
    durationSeconds: 300,
    archived: false,
    ratings: { usefulness: 4, depth: 3, originality: 5, recency: 4, completeness: 3 },
    overallScore: 3.8,
    summaryMd: null,
    deepDiveMd: null,
    processedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeAll(() => fs.mkdirSync(TEST_DIR, { recursive: true }));
afterAll(() => fs.rmSync(TEST_DIR, { recursive: true, force: true }));

describe('readIndex', () => {
  it('returns empty index when file is missing', () => {
    const dir = path.join(TEST_DIR, 'empty');
    fs.mkdirSync(dir, { recursive: true });

    const result = readIndex(dir);

    expect(result.videos).toEqual([]);
    expect(result.outputFolder).toBe(dir);
  });

  it('rejects outputFolder outside home directory', () => {
    expect(() => readIndex('/etc')).toThrow(expect.objectContaining({ statusCode: 400 }));
  });
});

describe('writeIndex + readIndex', () => {
  it('round-trip preserves all fields', () => {
    const dir = path.join(TEST_DIR, 'roundtrip');
    fs.mkdirSync(dir, { recursive: true });

    const index: PlaylistIndex = {
      playlistUrl: 'https://www.youtube.com/playlist?list=PLtest123',
      outputFolder: dir,
      videos: [makeVideo()],
    };

    writeIndex(dir, index);
    const result = readIndex(dir);

    expect(result).toEqual(index);
  });
});

describe('upsertVideo', () => {
  it('adds a new video to an empty index', () => {
    const dir = path.join(TEST_DIR, 'upsert-add');
    fs.mkdirSync(dir, { recursive: true });

    const video = makeVideo({ id: 'vid111111111' });
    upsertVideo(dir, video);

    const result = readIndex(dir);
    expect(result.videos).toHaveLength(1);
    expect(result.videos[0]).toEqual(video);
  });

  it('replaces existing video by ID without adding a duplicate', () => {
    const dir = path.join(TEST_DIR, 'upsert-replace');
    fs.mkdirSync(dir, { recursive: true });

    const original = makeVideo({ id: 'vid222222222', title: 'Original' });
    const updated = makeVideo({ id: 'vid222222222', title: 'Updated' });

    upsertVideo(dir, original);
    upsertVideo(dir, updated);

    const result = readIndex(dir);
    expect(result.videos).toHaveLength(1);
    expect(result.videos[0].title).toBe('Updated');
  });

  it('rejects invalid videoId', () => {
    const dir = path.join(TEST_DIR, 'upsert-invalid-id');
    fs.mkdirSync(dir, { recursive: true });

    expect(() => upsertVideo(dir, makeVideo({ id: '../passwd' }))).toThrow(
      expect.objectContaining({ statusCode: 400 }),
    );
  });
});

describe('writeIndex', () => {
  it('rejects an index containing a video with an invalid ID', () => {
    const dir = path.join(TEST_DIR, 'write-invalid-id');
    fs.mkdirSync(dir, { recursive: true });

    const index: PlaylistIndex = {
      playlistUrl: 'https://www.youtube.com/playlist?list=PLtest123',
      outputFolder: dir,
      videos: [makeVideo({ id: '../passwd' })],
    };

    expect(() => writeIndex(dir, index)).toThrow(expect.objectContaining({ statusCode: 400 }));
  });
});

describe('updateVideoFields', () => {
  it('merges specified fields without losing unspecified ones', () => {
    const dir = path.join(TEST_DIR, 'update-fields');
    fs.mkdirSync(dir, { recursive: true });

    const video = makeVideo({ id: 'vid333333333', summaryMd: null });
    upsertVideo(dir, video);

    updateVideoFields(dir, 'vid333333333', { summaryMd: 'vid333333333.md', deepDiveMd: 'vid333333333-deep-dive.md' });

    const result = readIndex(dir);
    expect(result.videos[0].summaryMd).toBe('vid333333333.md');
    expect(result.videos[0].deepDiveMd).toBe('vid333333333-deep-dive.md');
    expect(result.videos[0].title).toBe(video.title);
    expect(result.videos[0].ratings).toEqual(video.ratings);
  });

  it('does not allow fields.id to override the video identity', () => {
    const dir = path.join(TEST_DIR, 'update-id-override');
    fs.mkdirSync(dir, { recursive: true });

    const video = makeVideo({ id: 'vid555555555' });
    upsertVideo(dir, video);

    updateVideoFields(dir, 'vid555555555', { id: 'vid999999999' } as Partial<Video>);

    const result = readIndex(dir);
    expect(result.videos[0].id).toBe('vid555555555');
  });

  it('throws when video ID not found in index', () => {
    const dir = path.join(TEST_DIR, 'update-missing');
    fs.mkdirSync(dir, { recursive: true });

    expect(() => updateVideoFields(dir, 'vid444444444', { summaryMd: 'x.md' })).toThrow('Video not found');
  });

  it('rejects invalid videoId', () => {
    const dir = path.join(TEST_DIR, 'update-invalid-id');
    fs.mkdirSync(dir, { recursive: true });

    expect(() => updateVideoFields(dir, '../passwd', {})).toThrow(
      expect.objectContaining({ statusCode: 400 }),
    );
  });
});

describe('VideoSchema', () => {
  it('carries digDeeperMd/digDeeperHtml fields', () => {
    const baseVideo = makeVideo();
    const parsed = VideoSchema.parse({
      ...baseVideo,
      digDeeperMd: 'x-dig-deeper.md',
      digDeeperHtml: 'x-dig-deeper.html',
    });
    expect(parsed.digDeeperMd).toBe('x-dig-deeper.md');
    expect(parsed.digDeeperHtml).toBe('x-dig-deeper.html');
  });
});
