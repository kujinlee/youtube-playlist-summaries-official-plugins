import type { Video } from '@/types';
import { nextSerial, backfillOrder } from './serial-assign';
import { applySerial } from './serial-filename';

/** The nullable filename fields on a Video that carry an NNN_ serial prefix. */
export const PATH_FIELDS = [
  'summaryMd', 'deepDiveMd',
  'summaryHtml', 'deepDiveHtml', 'digDeeperMd', 'digDeeperHtml',
] as const;

export type RenameOp = { field: (typeof PATH_FIELDS)[number] | 'model'; from: string; to: string };
export type VideoPlan = { id: string; serial: number; renames: RenameOp[] };

export function planMigration(videos: Video[]): {
  assignments: Array<{ id: string; serial: number }>;
  perVideo: VideoPlan[];
} {
  const start = nextSerial(videos);
  const assignments = backfillOrder(videos).map((vid, i) => ({ id: vid.id, serial: start + i }));
  const serialById = new Map<string, number>(assignments.map((a) => [a.id, a.serial]));

  const perVideo: VideoPlan[] = [];
  for (const vid of videos) {
    const serial = vid.serialNumber ?? serialById.get(vid.id);
    if (serial == null) continue; // no file / not targeted
    const renames: RenameOp[] = [];
    for (const f of PATH_FIELDS) {
      const cur = vid[f] as string | null | undefined;
      if (!cur) continue;
      const to = applySerial(cur, serial);
      if (to !== cur) renames.push({ field: f, from: cur, to });
    }
    if (vid.summaryMd) {
      const base = vid.summaryMd.replace(/\.md$/, '');
      const modelFrom = `models/${base}.json`;
      const modelTo = applySerial(modelFrom, serial);
      if (modelTo !== modelFrom) renames.push({ field: 'model', from: modelFrom, to: modelTo });
    }
    perVideo.push({ id: vid.id, serial, renames });
  }
  return { assignments, perVideo };
}
