import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { assertOutputFolder, assertVideoId } from '@/lib/index-store';
import { cancelJob, createJob, deleteJob, emitJobEvent, getActiveJob, getJobSignal, releaseJobLock } from '@/lib/job-registry';
import { logError, errorSummary } from '@/lib/dev-logger';
import { digSection } from '@/lib/dig/dig-section';
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
    if (existing) {
      cancelJob(existing);
      releaseJobLock(existing);
    }
  }

  const jobId = crypto.randomUUID();
  createJob(jobId, key);
  const signal = getJobSignal(jobId);
  let finished = false;

  const onTerminal = () => {
    finished = true;
    releaseJobLock(jobId);
    const t = setTimeout(() => deleteJob(jobId), GRACE_MS);
    (t as { unref?: () => void }).unref?.();
  };

  digSection(videoId, sectionIdInt, outputFolder, signal, (event: ProgressEvent) => {
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
