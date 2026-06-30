import { assertOutputFolder, assertVideoId, readIndex } from '../index-store';
import { ensureHtmlDoc } from './ensure';
import { summaryNeedsWork } from './eligibility';
import type { ProgressEvent } from '../../types';

export type BatchMode = 'summary' | 'summary-dig';

/**
 * Generate docs for the given videos, skipping ones already up-to-date.
 * Sequential + best-effort: a per-item failure emits a non-fatal {type:'error', videoId}
 * and the loop continues. Phase A implements mode 'summary' (summary HTML only).
 */
export async function runBatchDocs(
  videoIds: string[],
  mode: BatchMode,
  outputFolder: string,
  onProgress: (e: ProgressEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  assertOutputFolder(outputFolder);

  // PRE-PASS (cheap, no Gemini): keep only videos whose summary needs work.
  const index = readIndex(outputFolder);
  const byId = new Map(index.videos.map((v) => [v.id, v]));
  const work = videoIds.filter((id) => {
    const v = byId.get(id);
    return v ? summaryNeedsWork(v) : false;
  });

  onProgress({ type: 'start', total: work.length });

  let succeeded = 0;
  let failed = 0;
  for (let i = 0; i < work.length; i++) {
    if (signal?.aborted) {
      onProgress({ type: 'cancelled' });
      return;
    }
    const videoId = work[i];
    const video = byId.get(videoId);
    assertVideoId(videoId);
    onProgress({
      type: 'step', videoId, title: video?.title,
      step: 'Generating HTML doc…', current: i + 1, total: work.length,
    });
    try {
      await ensureHtmlDoc(videoId, outputFolder, () => {}); // no-op: keep its sub-steps off the batch stream
      succeeded++;
    } catch (err) {
      failed++;
      // eslint-disable-next-line no-console
      console.warn(`[batch-docs] ${videoId} failed: ${err instanceof Error ? err.message : String(err)}`);
      onProgress({ type: 'error', videoId, title: video?.title, log: err instanceof Error ? err.message : String(err) });
    }
  }

  onProgress({ type: 'done', succeeded, failed, total: work.length });
}
