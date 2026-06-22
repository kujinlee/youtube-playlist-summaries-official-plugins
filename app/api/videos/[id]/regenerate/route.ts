import path from 'path';
import fs from 'fs';
import { NextResponse } from 'next/server';
import { assertOutputFolder, assertVideoId, readIndex, updateVideoFields } from '../../../../../lib/index-store';
import { fixSummary, extractQuickView } from '../../../../../lib/gemini';
import { stripQuickViewCallout, insertQuickViewCallout } from '../../../../../lib/pipeline';
import { logError, errorSummary } from '../../../../../lib/dev-logger';

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id: videoId } = await params;

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const outputFolder = body?.outputFolder;
  const corrections = body?.corrections;

  if (!outputFolder || typeof outputFolder !== 'string') {
    return NextResponse.json({ error: 'outputFolder is required' }, { status: 400 });
  }

  if (corrections !== undefined && typeof corrections !== 'string') {
    return NextResponse.json({ error: 'corrections must be a string' }, { status: 400 });
  }

  try {
    assertOutputFolder(outputFolder);
    assertVideoId(videoId);
  } catch {
    return NextResponse.json({ error: 'invalid request' }, { status: 400 });
  }

  const index = readIndex(outputFolder);
  const video = index.videos.find((v) => v.id === videoId);

  if (!video) {
    return NextResponse.json({ error: 'video not found' }, { status: 404 });
  }

  if (!video.summaryMd) {
    return NextResponse.json({ error: 'no summary file for this video' }, { status: 422 });
  }

  try {
    const mdPath = path.join(outputFolder, video.summaryMd);
    let mdContent = await fs.promises.readFile(mdPath, 'utf-8');

    // Save corrections to index before the Gemini call so a subsequent
    // page-refresh shows the latest corrections even if Gemini fails.
    const trimmedCorrections = typeof corrections === 'string' ? corrections.trim() : undefined;
    if (trimmedCorrections) {
      updateVideoFields(outputFolder, videoId, { corrections: trimmedCorrections });
    } else if (corrections === '') {
      updateVideoFields(outputFolder, videoId, { corrections: undefined });
    }

    // Apply text corrections if provided (works on prose only — callout is stripped first)
    const stripped = stripQuickViewCallout(mdContent);
    const fixed = trimmedCorrections ? await fixSummary(stripped, trimmedCorrections) : stripped;

    // Re-extract tldr/takeaways from corrected content and re-insert callout
    const { tldr, takeaways } = await extractQuickView(fixed);
    const updatedContent = insertQuickViewCallout(fixed, tldr, takeaways, video.tags ?? []);

    await fs.promises.writeFile(mdPath, updatedContent, 'utf-8');

    // Update index with refreshed quick-view data; clear stale HTML cache
    updateVideoFields(outputFolder, videoId, { tldr, takeaways, summaryHtml: null });

    return NextResponse.json({
      tldr,
      takeaways,
      corrections: trimmedCorrections,
      summaryHtml: null,
    });
  } catch (err) {
    logError(`regenerate:${videoId}`, err);
    return NextResponse.json({ error: errorSummary(err) }, { status: 500 });
  }
}
