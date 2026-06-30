import { NextResponse } from 'next/server';
import { cancelJob } from '../../../../../lib/job-registry';

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const jobId: unknown = body?.jobId;
  if (typeof jobId !== 'string' || !jobId) {
    return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
  }
  const cancelled = cancelJob(jobId); // aborts the job's AbortSignal; runBatchDocs emits 'cancelled' next iter
  return NextResponse.json({ cancelled });
}
