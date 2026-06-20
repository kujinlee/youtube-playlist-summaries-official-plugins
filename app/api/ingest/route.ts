import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { assertOutputFolder } from '../../../lib/index-store';
import { runIngestion } from '../../../lib/pipeline';
import { createJob, deleteJob, emitJobEvent, isIngestionRunning, getJobSignal } from '../../../lib/job-registry';
import { logError, errorSummary } from '../../../lib/dev-logger';
import type { ProgressEvent } from '../../../types';

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const playlistUrl = body?.playlistUrl;
  const outputFolder = body?.outputFolder;

  if (!playlistUrl) return NextResponse.json({ error: 'playlistUrl is required' }, { status: 400 });
  if (!outputFolder) return NextResponse.json({ error: 'outputFolder is required' }, { status: 400 });

  try {
    assertOutputFolder(outputFolder);
  } catch {
    return NextResponse.json({ error: 'invalid outputFolder' }, { status: 400 });
  }

  if (isIngestionRunning(outputFolder)) {
    return NextResponse.json({ error: 'Ingestion already running for this folder' }, { status: 409 });
  }

  const jobId = crypto.randomUUID();
  createJob(jobId, outputFolder);
  let finished = false;

  const signal = getJobSignal(jobId);

  // Start pipeline in background; do not await
  runIngestion(playlistUrl, outputFolder, (event: ProgressEvent) => {
    emitJobEvent(jobId, event);
    // Per-video errors (videoId present) are non-fatal — the pipeline continues.
    // Terminal events: done, cancelled, or a fatal error (no videoId).
    const isFatal =
      event.type === 'done' ||
      event.type === 'cancelled' ||
      (event.type === 'error' && !('videoId' in event && event.videoId));
    if (isFatal) {
      finished = true;
      deleteJob(jobId);
    }
  }, signal).catch((err) => {
    if (finished) return;
    finished = true;
    logError(`ingest:${outputFolder}`, err);
    emitJobEvent(jobId, { type: 'error', log: errorSummary(err) });
    deleteJob(jobId);
  });

  return NextResponse.json({ jobId });
}
