import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { assertOutputFolder, assertVideoId } from '../../../../../lib/index-store';
import { ensureHtmlDoc } from '../../../../../lib/html-doc/ensure';
import { CURRENT_DOC_VERSION } from '../../../../../lib/doc-version';
import { createJob, deleteJob, emitJobEvent, getActiveJob, releaseJobLock } from '../../../../../lib/job-registry';
import { logError, errorSummary } from '../../../../../lib/dev-logger';
import type { ProgressEvent } from '../../../../../types';

type Params = { params: Promise<{ id: string }> };

// Keep a finished job subscribable briefly so a just-issued client subscribe can replay the
// terminal event; then GC it. .unref() so the timer never keeps the process alive (tests/CI).
const GRACE_MS = 15_000;

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

  // Same-video double-submit guard: one live job per (folder, video).
  const key = `${outputFolder}::${videoId}`;
  const existing = getActiveJob(key);
  if (existing) return NextResponse.json({ jobId: existing });

  const jobId = crypto.randomUUID();
  createJob(jobId, key);
  let finished = false;

  const onTerminal = () => {
    finished = true;
    releaseJobLock(jobId);                       // free the lock now → a later Regenerate is allowed
    const t = setTimeout(() => deleteJob(jobId), GRACE_MS); // keep buffer for late subscribers
    (t as { unref?: () => void }).unref?.();
  };

  // `force: true` (Re-summarize) bypasses the version check in ensureHtmlDoc → always re-summarizes.
  const force = body?.force === true;
  ensureHtmlDoc(videoId, outputFolder, (event: ProgressEvent) => {
    emitJobEvent(jobId, event);
    if (event.type === 'done' || event.type === 'error') onTerminal();
  }, CURRENT_DOC_VERSION, force).catch((err) => {
    if (finished) return;
    logError(`html-doc:${videoId}`, err);
    emitJobEvent(jobId, { type: 'error', log: errorSummary(err) });
    onTerminal();
  });

  return NextResponse.json({ jobId });
}
