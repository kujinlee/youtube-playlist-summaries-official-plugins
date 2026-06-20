import fs from 'fs';
import path from 'path';
import { assertOutputFolder, assertVideoId, readIndex, updateVideoFields } from '../index-store';
import { writeSummaryDoc } from '../pipeline';
import { runHtmlDoc } from './generate';
import { reRenderSummaryHtml } from './rerender';
import { CURRENT_DOC_VERSION, isOlder, needsResummarize, type DocVersion } from '../doc-version';
import type { ProgressEvent } from '../../types';

const PRE_FEATURE: DocVersion = { major: 1, minor: 0 };

/**
 * Bring a video's summary HTML to `current` (default CURRENT_DOC_VERSION), doing the minimum work:
 * major-stale → re-summarize (.md, Gemini) + full HTML rebuild; minor-stale with a cached model →
 * cheap re-render; no HTML yet → full build; already current → nothing. Leaves summaryHtml + docVersion
 * current. `current` is injectable for tests. Throws if the video lacks a source note.
 */
export async function ensureHtmlDoc(
  videoId: string,
  outputFolder: string,
  onProgress: (e: ProgressEvent) => void,
  current: DocVersion = CURRENT_DOC_VERSION,
): Promise<void> {
  assertOutputFolder(outputFolder);
  assertVideoId(videoId);

  const video = readIndex(outputFolder).videos.find((v) => v.id === videoId);
  if (!video) throw new Error(`Video not found in index: ${videoId}`);
  if (!video.summaryMd) throw new Error('no summary note for this video');

  const stored: DocVersion = video.docVersion ?? PRE_FEATURE;
  const base = video.summaryMd.replace(/\.md$/, '');

  const forwardSteps = (e: ProgressEvent) => { if (e.type === 'step') onProgress(e); };

  onProgress({ type: 'start' });

  if (needsResummarize(stored, current)) {
    onProgress({ type: 'step', videoId, step: 'Re-summarizing (adding timestamps)…', current: 1, total: 2 });
    const r = await writeSummaryDoc({
      videoId: video.id, title: video.title, youtubeUrl: video.youtubeUrl,
      channel: video.channel, durationSeconds: video.durationSeconds, outputFolder, baseName: base,
    });
    updateVideoFields(outputFolder, videoId, {
      language: r.language, ratings: r.ratings, overallScore: r.overallScore,
      videoType: r.videoType, audience: r.audience, tags: r.tags, tldr: r.tldr, takeaways: r.takeaways,
    });
    try { fs.unlinkSync(path.join(outputFolder, 'models', `${base}.json`)); } catch { /* no model — fine */ }
    onProgress({ type: 'step', videoId, step: 'Building HTML…', current: 2, total: 2 });
    await runHtmlDoc(videoId, outputFolder, forwardSteps);
  } else if (!video.summaryHtml) {
    onProgress({ type: 'step', videoId, step: 'Building HTML…', current: 1, total: 1 });
    await runHtmlDoc(videoId, outputFolder, forwardSteps);
  } else if (isOlder(stored, current)) {
    onProgress({ type: 'step', videoId, step: 'Re-rendering HTML…', current: 1, total: 1 });
    const rr = reRenderSummaryHtml(videoId, outputFolder);
    if (rr.status !== 'rerendered') await runHtmlDoc(videoId, outputFolder, forwardSteps);
  } else {
    onProgress({ type: 'done' });
    return;
  }

  updateVideoFields(outputFolder, videoId, { docVersion: current });
  onProgress({ type: 'done' });
}
