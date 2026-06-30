import path from 'path';
import fs from 'node:fs/promises';
import { readIndex, updateVideoFields } from '@/lib/index-store';
import { parseSummaryMarkdown } from '@/lib/html-doc/parse';
import { resolveTranscriptSegments } from '@/lib/transcript-source';
import { windowForSection } from '@/lib/dig/section-window';
import { generateDig, DIG_GENERATOR_VERSION } from '@/lib/dig/generate';
import { resolveTranscriptTokens } from '@/lib/transcript-timestamps';
import { resolveSlideTokens } from '@/lib/dig/slides';
import { upsertDugSection } from '@/lib/dig/companion-doc';
import type { ProgressEvent } from '@/types';

export async function digSection(
  videoId: string,
  sectionIdInt: number,
  outputFolder: string,
  signal: AbortSignal | undefined,
  emit: (event: ProgressEvent) => void,
): Promise<void> {
  // Step 1: Read video from index
  const index = readIndex(outputFolder);
  const video = index.videos.find((v) => v.id === videoId);
  if (!video) {
    emit({ type: 'error', log: `Video not found in index: ${videoId}` });
    return;
  }

  // Step 2: Read summary .md content
  const summaryMdName = video.summaryMd ?? `${videoId}.md`;
  const summaryMdPath = path.join(outputFolder, summaryMdName);
  const mdContent = await fs.readFile(summaryMdPath, 'utf8');

  // Step 3: Parse summary markdown
  const parsed = parseSummaryMarkdown(mdContent);
  const sections = parsed.sections;

  // Step 4: Find the matching section
  const section = sections.find((s) => s.timeRange?.startSec === sectionIdInt);
  if (!section) {
    emit({ type: 'error', log: `Section not found: sectionId=${sectionIdInt}` });
    return;
  }

  // Step 5: Resolve transcript segments
  const { segments } = await resolveTranscriptSegments(
    videoId,
    video.youtubeUrl,
    video.durationSeconds,
  );

  // Step 6: Build section window
  const window = windowForSection(section, sections, segments, video.durationSeconds);
  if (!window) {
    emit({ type: 'error', log: `windowForSection returned null for sectionId=${sectionIdInt}` });
    return;
  }

  // Step 7: Generate dig deeper markdown via Gemini
  const rawMd = await generateDig(window, videoId, video.language);

  // Step 8: Resolve transcript tokens
  const mdWithTs = resolveTranscriptTokens(rawMd, segments, videoId, video.durationSeconds);

  // Step 9: Resolve slide tokens (assets written here)
  const assetsRoot = path.join(outputFolder, 'assets');
  const { markdown: finalMd, slides } = await resolveSlideTokens(mdWithTs, {
    videoId,
    startSec: window.startSec,
    endSec: window.endSec,
    assetsRoot,
    sectionId: sectionIdInt,
  });

  // Guard: if the pipeline was aborted (force re-dig), skip the write.
  if (signal?.aborted) {
    emit({ type: 'error', log: 'Pipeline aborted before write' });
    return;
  }

  // Step 10: Upsert dug section into companion doc
  const summaryBasename = path.basename(summaryMdName, '.md');
  const digDeeperFilename = `${summaryBasename}-dig-deeper.md`;
  const digDeeperPath = path.join(outputFolder, digDeeperFilename);

  await upsertDugSection({
    digDeeperPath,
    videoTitle: video.title,
    videoId,
    language: video.language,
    sourceVideoUrl: video.youtubeUrl,
    section: {
      sectionId: sectionIdInt,
      startSec: window.startSec,
      title: section.title,
      bodyMarkdown: finalMd,
      generatedAt: new Date().toISOString(),
      genVersion: DIG_GENERATOR_VERSION,
      slides,
    },
  });

  // Step 11: Update index with digDeeperMd (HTML is rendered fresh by GET)
  updateVideoFields(outputFolder, videoId, {
    digDeeperMd: digDeeperFilename,
  });

  emit({ type: 'done' });
}
