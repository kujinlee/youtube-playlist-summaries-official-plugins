import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { assertOutputFolder } from '../../../../lib/index-store';
import { runBatchDocs, type BatchMode } from '../../../../lib/html-doc/batch';
import { createJob, deleteJob, emitJobEvent, getActiveJob, releaseJobLock, getJobSignal } from '../../../../lib/job-registry';
import { logError, errorSummary } from '../../../../lib/dev-logger';
import type { ProgressEvent } from '../../../../types';

const GRACE_MS = 15_000;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const outputFolder: unknown = body?.outputFolder;
  const videoIds: unknown = body?.videoIds;
  const mode: BatchMode = body?.mode ?? 'summary';

  if (typeof outputFolder !== 'string' || !outputFolder) {
    return NextResponse.json({ error: 'outputFolder is required' }, { status: 400 });
  }
  if (!Array.isArray(videoIds) || videoIds.length === 0 || !videoIds.every((x) => typeof x === 'string')) {
    return NextResponse.json({ error: 'videoIds[] is required' }, { status: 400 });
  }
  // Phase A supports only 'summary'. Phase B will accept 'summary-dig'. Reject explicitly so a
  // caller does not silently get summary-only behavior for a dig request.
  if (mode !== 'summary') {
    return NextResponse.json({ error: "mode 'summary-dig' is not supported yet" }, { status: 400 });
  }
  try {
    assertOutputFolder(outputFolder);
  } catch {
    return NextResponse.json({ error: 'invalid outputFolder' }, { status: 400 });
  }

  const key = `${outputFolder}::batch-docs`;
  if (getActiveJob(key)) {
    return NextResponse.json({ error: 'A batch is already running for this folder' }, { status: 409 });
  }

  const jobId = crypto.randomUUID();
  createJob(jobId, key);
  let finished = false;
  const signal = getJobSignal(jobId);

  const onTerminal = () => {
    finished = true;
    releaseJobLock(jobId);
    const t = setTimeout(() => deleteJob(jobId), GRACE_MS);
    (t as { unref?: () => void }).unref?.();
  };

  runBatchDocs(videoIds as string[], mode, outputFolder, (event: ProgressEvent) => {
    emitJobEvent(jobId, event);
    const isFatal =
      event.type === 'done' ||
      event.type === 'cancelled' ||
      (event.type === 'error' && !('videoId' in event && event.videoId));
    if (isFatal) onTerminal();
  }, signal).catch((err) => {
    if (finished) return;
    logError(`batch-docs:${outputFolder}`, err);
    emitJobEvent(jobId, { type: 'error', log: errorSummary(err) });
    onTerminal();
  });

  return NextResponse.json({ jobId });
}
