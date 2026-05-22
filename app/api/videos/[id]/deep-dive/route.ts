import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { assertOutputFolder, assertVideoId } from '../../../../../lib/index-store';
import { runDeepDive } from '../../../../../lib/deep-dive';
import { createJob, deleteJob, emitJobEvent } from '../../../../../lib/job-registry';
import type { ProgressEvent } from '../../../../../types';

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id: videoId } = await params;
  const body = await request.json().catch(() => null);
  const outputFolder = body?.outputFolder;

  if (!outputFolder) return NextResponse.json({ error: 'outputFolder is required' }, { status: 400 });

  try {
    assertOutputFolder(outputFolder);
    assertVideoId(videoId);
  } catch {
    return NextResponse.json({ error: 'invalid request' }, { status: 400 });
  }

  const jobId = crypto.randomUUID();
  createJob(jobId);
  let finished = false;

  runDeepDive(videoId, outputFolder, (event: ProgressEvent) => {
    emitJobEvent(jobId, event);
    if (event.type === 'done' || event.type === 'error') {
      finished = true;
      deleteJob(jobId);
    }
  }).catch((err) => {
    if (finished) return;
    finished = true;
    console.error('[deep-dive] failed for video', videoId, err);
    emitJobEvent(jobId, { type: 'error', log: err instanceof Error ? err.message : String(err) });
    deleteJob(jobId);
  });

  return NextResponse.json({ jobId });
}
