import type { Video } from '@/types';

export function nextSerial(videos: Video[]): number {
  const max = videos.reduce((m, v) => (v.serialNumber && v.serialNumber > m ? v.serialNumber : m), 0);
  return max + 1;
}

export function backfillOrder(videos: Video[]): Video[] {
  return videos
    .filter((v) => v.summaryMd != null && v.serialNumber == null)
    .sort((a, b) =>
      a.processedAt < b.processedAt ? -1 :
      a.processedAt > b.processedAt ? 1 :
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    );
}
