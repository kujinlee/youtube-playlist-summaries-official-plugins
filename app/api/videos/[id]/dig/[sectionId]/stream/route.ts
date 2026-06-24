import { subscribeJob } from '../../../../../../../lib/job-registry';
import type { ProgressEvent } from '../../../../../../../types';

type Params = { params: Promise<{ id: string; sectionId: string }> };

export async function GET(request: Request, _ctx: Params) {
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get('jobId');

  if (!jobId) {
    return new Response(JSON.stringify({ error: 'jobId is required' }), { status: 400 });
  }

  const encoder = new TextEncoder();

  // ReadableStream.start() is synchronous — unsubscribe is set (or stays null) before the
  // constructor returns, so we can check it for the 404 guard below.
  let unsubscribe: (() => void) | null = null;
  const stream = new ReadableStream({
    start(controller) {
      unsubscribe = subscribeJob(jobId, (event: ProgressEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        if (event.type === 'done' || event.type === 'error') {
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
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
