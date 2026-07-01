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

  it('strips retired deep-dive and PDF keys from legacy index entries', () => {
    const dir = path.join(TEST_DIR, 'legacy-deepdive');
    fs.mkdirSync(dir, { recursive: true });
    // Simulate an index file written before the PDF-generation and deep-dive
    // removals — it still carries the fields those efforts retired.
    const legacy = {
      playlistUrl: 'https://www.youtube.com/playlist?list=PLlegacy',
      outputFolder: dir,
      videos: [
        {
          ...makeVideo(),
          summaryPdf: 'abc12345678.pdf',
          deepDiveMd: 'abc12345678-deep-dive.md',
          deepDiveHtml: 'htmls/abc12345678-deep-dive.html',
          deepDivePdf: 'abc12345678-deep-dive.pdf',
          deepDiveVersion: { major: 2, minor: 2 },
        },
      ],
    };
    fs.writeFileSync(path.join(dir, 'playlist-index.json'), JSON.stringify(legacy), 'utf-8');

    const result = readIndex(dir);

    const v = result.videos[0] as Record<string, unknown>;
    expect(v.summaryPdf).toBeUndefined();
    expect(v.deepDiveMd).toBeUndefined();
    expect(v.deepDiveHtml).toBeUndefined();
    expect(v.deepDivePdf).toBeUndefined();
    expect(v.deepDiveVersion).toBeUndefined();
    // Non-retired fields are untouched.
    expect(v.summaryMd).toBeNull();
    expect(v.id).toBe('abc12345678');
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

    updateVideoFields(dir, 'vid333333333', { summaryMd: 'vid333333333.md', digDeeperMd: 'vid333333333-dig-deeper.md' });

    const result = readIndex(dir);
    expect(result.videos[0].summaryMd).toBe('vid333333333.md');
    expect(result.videos[0].digDeeperMd).toBe('vid333333333-dig-deeper.md');
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
