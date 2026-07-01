import crypto from 'crypto';
import path from 'path';
import { NextResponse } from 'next/server';
import { assertOutputFolder, assertVideoId, readIndex } from '../../../../../lib/index-store';
import { buildDocHtml } from '../../../../../lib/html-doc/build-doc-html';
import { generateDocPdf } from '../../../../../lib/pdf/generate-doc-pdf';
import { pdfRelPath } from '../../../../../lib/pdf/pdf-path';
import { assertIndexRelPathWithin } from '../../../../../lib/paths/assert-within';
import { createJob, deleteJob, emitJobEvent, getActiveJob, releaseJobLock } from '../../../../../lib/job-registry';
import { logError, errorSummary } from '../../../../../lib/dev-logger';

type Params = { params: Promise<{ id: string }> };

// Keep a finished job subscribable briefly so a just-issued client subscribe can replay the
// terminal event; then GC it. .unref() so the timer never keeps the process alive (tests/CI).
const GRACE_MS = 15_000;

export async function POST(request: Request, { params }: Params) {
  const { id: videoId } = await params;
  const body = await request.json().catch(() => null);
  const outputFolder = body?.outputFolder;
  const type = body?.type;

  if (!outputFolder) return NextResponse.json({ error: 'outputFolder is required' }, { status: 400 });
  try {
    assertOutputFolder(outputFolder);
    assertVideoId(videoId);
  } catch {
    return NextResponse.json({ error: 'invalid request' }, { status: 400 });
  }
  if (type !== 'summary' && type !== 'dig-deeper') {
    return NextResponse.json({ error: 'unsupported or missing type' }, { status: 400 });
  }

  let video;
  try {
    const index = readIndex(outputFolder);
    video = index.videos.find((v) => v.id === videoId);
    if (!video) return NextResponse.json({ error: 'video not found' }, { status: 404 });
  } catch (err) {
    const e = err as { statusCode?: number; message?: string };
    if (e.statusCode === 400) return NextResponse.json({ error: e.message }, { status: 400 });
    throw err;
  }

  // One live PDF job per (folder, video, type).
  const key = `${outputFolder}::${videoId}::${type}`;
  const existing = getActiveJob(key);
  if (existing) return NextResponse.json({ jobId: existing });

  // Build the doc HTML up front so an unavailable doc fails fast with the right HTTP status.
  const build = await buildDocHtml(video, outputFolder, type);
  if (!build.ok) {
    const status = build.reason === 'invalid-path' ? 400 : 404;
    return NextResponse.json({ error: build.reason }, { status });
  }

  let rel: string;
  try {
    rel = pdfRelPath(video, type);
    assertIndexRelPathWithin(outputFolder, rel);
  } catch {
    return NextResponse.json({ error: 'invalid path' }, { status: 400 });
  }
  const absOut = path.resolve(outputFolder, rel);

  const jobId = crypto.randomUUID();
  createJob(jobId, key);
  let finished = false;
  const onTerminal = () => {
    finished = true;
    releaseJobLock(jobId);                                   // free the lock → a later re-save is allowed
    const t = setTimeout(() => deleteJob(jobId), GRACE_MS);  // keep buffer for a late EventSource subscribe
    (t as { unref?: () => void }).unref?.();
  };

  emitJobEvent(jobId, { type: 'start' });
  emitJobEvent(jobId, { type: 'step', step: 'Rendering PDF…', current: 1, total: 1 });
  generateDocPdf(build.html, absOut)
    .then(() => {
      if (finished) return;
      emitJobEvent(jobId, { type: 'done', total: 1, current: 1, log: path.basename(rel) });
      onTerminal();
    })
    .catch((err) => {
      if (finished) return;
      logError(`pdf:${videoId}`, err);
      emitJobEvent(jobId, { type: 'error', log: errorSummary(err) });
      onTerminal();
    });

  return NextResponse.json({ jobId });
}
