import { subscribeJob } from '../../../../../lib/job-registry';
import type { ProgressEvent } from '../../../../../types';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get('jobId');
  if (!jobId) {
    return new Response(JSON.stringify({ error: 'jobId is required' }), { status: 400 });
  }

  let unsubscribe: (() => void) | null = null;
  const stream = new ReadableStream({
    start(controller) {
      unsubscribe = subscribeJob(jobId, (event: ProgressEvent) => {
        const chunk = new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
        controller.enqueue(chunk);
        const isFatal =
          event.type === 'done' ||
          event.type === 'cancelled' ||
          (event.type === 'error' && !('videoId' in event && event.videoId));
        if (isFatal) {
          unsubscribe?.();
          unsubscribe = null;
          controller.close();
        }
      });
      if (!unsubscribe) controller.close();
    },
    cancel() {
      unsubscribe?.();
    },
  });

  if (!unsubscribe) {
    return new Response(JSON.stringify({ error: 'job not found' }), { status: 404 });
  }
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  });
}
