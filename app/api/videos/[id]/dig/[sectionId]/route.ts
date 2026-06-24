import crypto from 'crypto';
import path from 'path';
import fs from 'node:fs/promises';
import { NextResponse } from 'next/server';
import { assertOutputFolder, assertVideoId, readIndex, updateVideoFields } from '@/lib/index-store';
import { createJob, deleteJob, emitJobEvent, getActiveJob, releaseJobLock } from '@/lib/job-registry';
import { logError, errorSummary } from '@/lib/dev-logger';
import { parseSummaryMarkdown } from '@/lib/html-doc/parse';
import { resolveTranscriptSegments } from '@/lib/transcript-source';
import { windowForSection } from '@/lib/dig/section-window';
import { generateDig } from '@/lib/dig/generate';
import { resolveTranscriptTokens } from '@/lib/transcript-timestamps';
import { resolveSlideTokens } from '@/lib/dig/slides';
import { upsertDugSection } from '@/lib/dig/companion-doc';
import { renderDigDeeperHtml } from '@/lib/html-doc/render-dig-deeper';
import type { ProgressEvent } from '@/types';

type Params = { params: Promise<{ id: string; sectionId: string }> };

const GRACE_MS = 15_000;

export async function POST(request: Request, { params }: Params) {
  const { id: videoId, sectionId: sectionIdParam } = await params;
  const body = await request.json().catch(() => null);
  const outputFolder = body?.outputFolder;
  const force = Boolean(body?.force);

  if (!outputFolder) return NextResponse.json({ error: 'outputFolder is required' }, { status: 400 });

  // Validate sectionId: must be a non-empty, non-negative integer
  if (!sectionIdParam || sectionIdParam.trim() === '') {
    return NextResponse.json({ error: 'invalid sectionId' }, { status: 400 });
  }
  const sectionIdInt = Number(sectionIdParam);
  if (!Number.isInteger(sectionIdInt) || sectionIdInt < 0) {
    return NextResponse.json({ error: 'invalid sectionId' }, { status: 400 });
  }

  try {
    assertOutputFolder(outputFolder);
    assertVideoId(videoId);
  } catch {
    return NextResponse.json({ error: 'invalid request' }, { status: 400 });
  }

  const key = `${outputFolder}::${videoId}::${sectionIdInt}`;
  if (!force) {
    const existing = getActiveJob(key);
    if (existing) return NextResponse.json({ jobId: existing });
  } else {
    const existing = getActiveJob(key);
    if (existing) releaseJobLock(existing);
  }

  const jobId = crypto.randomUUID();
  createJob(jobId, key);
  let finished = false;

  const onTerminal = () => {
    finished = true;
    releaseJobLock(jobId);
    const t = setTimeout(() => deleteJob(jobId), GRACE_MS);
    (t as { unref?: () => void }).unref?.();
  };

  runDigPipeline(videoId, sectionIdInt, outputFolder, (event: ProgressEvent) => {
    emitJobEvent(jobId, event);
    if (event.type === 'done' || event.type === 'error') onTerminal();
  }).catch((err) => {
    if (finished) return;
    logError(`dig:${videoId}:${sectionIdInt}`, err);
    emitJobEvent(jobId, { type: 'error', log: errorSummary(err) });
    onTerminal();
  });

  return NextResponse.json({ jobId });
}

async function runDigPipeline(
  videoId: string,
  sectionIdInt: number,
  outputFolder: string,
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
  const finalMd = await resolveSlideTokens(mdWithTs, {
    videoId,
    startSec: window.startSec,
    endSec: window.endSec,
    assetsRoot,
    sectionId: sectionIdInt,
  });

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
    },
  });

  // Step 11: Render dig deeper HTML
  const htmlsDir = path.join(outputFolder, 'htmls');
  await fs.mkdir(htmlsDir, { recursive: true });

  const digDeeperHtmlFilename = `${summaryBasename}-dig-deeper.html`;
  const digDeeperHtmlPath = path.join(htmlsDir, digDeeperHtmlFilename);
  const htmlContent = renderDigDeeperHtml(finalMd, digDeeperPath);

  // Step 12: Write HTML file
  await fs.writeFile(digDeeperHtmlPath, htmlContent, 'utf8');

  // Step 13: Update index with digDeeperMd and digDeeperHtml
  updateVideoFields(outputFolder, videoId, {
    digDeeperMd: digDeeperFilename,
    digDeeperHtml: digDeeperHtmlFilename,
  });

  emit({ type: 'done' });
}
