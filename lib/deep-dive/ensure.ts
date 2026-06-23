import { assertOutputFolder, assertVideoId, readIndex, updateVideoFields } from '../index-store';
import { writeDeepDiveDoc } from './write-doc';
import { runDeepDiveHtml, reRenderDeepDiveHtml } from '../html-doc/generate-deep-dive';
import { CURRENT_DEEP_DIVE_VERSION, needsRegenerate, type DeepDiveVersion } from './version';
import { isOlder } from '../version';
import type { ProgressEvent } from '../../types';

const PRE_FEATURE: DeepDiveVersion = { major: 1, minor: 0 };

/**
 * Bring a video's deep-dive HTML to `current` (default CURRENT_DEEP_DIVE_VERSION), doing the
 * minimum work: no .md or major-stale → re-run the Gemini cascade (.md) + full HTML build; .md
 * present but no HTML → full HTML build; minor-stale → cheap re-render from the existing .md
 * (falling back to a full regenerate if the .md is gone); already current → nothing.
 *
 * Persists everything in ONE updateVideoFields per success branch, AFTER the render succeeds, so a
 * mid-flight failure never leaves a half-stamped index. Emits `start` first and `done` last (after
 * the stamp). The no-op branch emits start+done and early-returns without touching the index.
 * `current` is injectable for tests.
 */
export async function ensureDeepDiveHtml(
  videoId: string, outputFolder: string,
  onProgress: (e: ProgressEvent) => void,
  current: DeepDiveVersion = CURRENT_DEEP_DIVE_VERSION,
  force = false,
): Promise<void> {
  assertOutputFolder(outputFolder);
  assertVideoId(videoId);
  const video = readIndex(outputFolder).videos.find((v) => v.id === videoId);
  if (!video) throw new Error(`Video not found in index: ${videoId}`);
  const stored: DeepDiveVersion = video.deepDiveVersion ?? PRE_FEATURE;
  onProgress({ type: 'start' });

  if (force || !video.deepDiveMd || needsRegenerate(stored, current)) {
    const { deepDiveMd } = await writeDeepDiveDoc(video, outputFolder, onProgress);
    onProgress({ type: 'step', videoId, step: 'Building HTML…', current: 1, total: 1 });
    // Pass the just-written .md — the index isn't stamped until the updateVideoFields below,
    // so a first-ever generation has no deepDiveMd in the index for runDeepDiveHtml to read.
    const { htmlPath } = await runDeepDiveHtml(videoId, outputFolder, deepDiveMd);
    updateVideoFields(outputFolder, videoId, { deepDiveMd, deepDiveHtml: htmlPath, deepDiveVersion: current });
  } else if (!video.deepDiveHtml) {
    onProgress({ type: 'step', videoId, step: 'Building HTML…', current: 1, total: 1 });
    const { htmlPath } = await runDeepDiveHtml(videoId, outputFolder);
    updateVideoFields(outputFolder, videoId, { deepDiveHtml: htmlPath, deepDiveVersion: current });
  } else if (isOlder(stored, current)) {
    onProgress({ type: 'step', videoId, step: 'Re-rendering HTML…', current: 1, total: 1 });
    const rr = reRenderDeepDiveHtml(videoId, outputFolder);
    if (rr.status === 'rerendered') {
      updateVideoFields(outputFolder, videoId, { deepDiveHtml: rr.htmlPath, deepDiveVersion: current });
    } else {
      // .md missing → full regenerate (NOT runDeepDiveHtml which would throw)
      const { deepDiveMd } = await writeDeepDiveDoc(video, outputFolder, onProgress);
      const { htmlPath } = await runDeepDiveHtml(videoId, outputFolder, deepDiveMd);
      updateVideoFields(outputFolder, videoId, { deepDiveMd, deepDiveHtml: htmlPath, deepDiveVersion: current });
    }
  } else {
    onProgress({ type: 'done' });
    return;
  }
  onProgress({ type: 'done' });
}
