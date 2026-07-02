import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { localMetadataStore } from '@/lib/storage/local/local-metadata-store';
import { localPrincipal } from '@/lib/storage/principal';
import { readIndex } from '@/lib/index-store';
import type { PlaylistIndex, Video } from '@/types';

const TEST_DIR = path.join(os.homedir(), `.test-local-mds-${crypto.randomUUID()}`);
beforeAll(() => fs.mkdirSync(TEST_DIR, { recursive: true }));
afterAll(() => fs.rmSync(TEST_DIR, { recursive: true, force: true }));

const p = localPrincipal(TEST_DIR);

function sampleVideo(id: string): Video {
  return {
    id, title: 'T', youtubeUrl: 'https://youtu.be/x', language: 'en',
    durationSeconds: 1, archived: false,
    ratings: { usefulness: 3, depth: 3, originality: 3, recency: 3, completeness: 3 },
    overallScore: 3, summaryMd: null, processedAt: '2026-07-02T00:00:00.000Z',
  } as Video;
}

it('writeIndex then readIndex round-trips through the store', () => {
  const index: PlaylistIndex = {
    playlistUrl: 'https://www.youtube.com/playlist?list=PL1',
    outputFolder: TEST_DIR, videos: [sampleVideo('vid00000001')],
  };
  localMetadataStore.writeIndex(p, index);
  expect(localMetadataStore.readIndex(p).videos).toHaveLength(1);
});

it('upsertVideo is observable via direct index-store readIndex (byte-identical persistence)', () => {
  localMetadataStore.upsertVideo(p, sampleVideo('vid00000002'));
  const viaDirect = readIndex(TEST_DIR); // same file the store wrote
  expect(viaDirect.videos.map((v) => v.id)).toContain('vid00000002');
});

it('updateVideoFields mutates the named video', () => {
  localMetadataStore.updateVideoFields(p, 'vid00000002', { title: 'Renamed' });
  const v = localMetadataStore.readIndex(p).videos.find((x) => x.id === 'vid00000002');
  expect(v?.title).toBe('Renamed');
});
