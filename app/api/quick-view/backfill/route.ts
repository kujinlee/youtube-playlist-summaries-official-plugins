import path from 'path';
import fs from 'fs';
import { getPrincipal, getMetadataStore } from '../../../../lib/storage/resolve';
import { extractQuickView } from '../../../../lib/gemini';
import { insertQuickViewCallout } from '../../../../lib/pipeline';
import type { ProgressEvent } from '../../../../types';

// Allow long-running backfills (182 videos × ~10s = ~30 min).
// Without this Next.js applies a short default timeout in production.
export const maxDuration = 1800; // 30 minutes

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const outputFolder = searchParams.get('outputFolder');

  if (!outputFolder) {
    return new Response(JSON.stringify({ error: 'outputFolder is required' }), { status: 400 });
  }

  let principal;
  try {
    principal = getPrincipal(outputFolder);
  } catch {
    return new Response(JSON.stringify({ error: 'invalid outputFolder' }), { status: 400 });
  }

  const store = getMetadataStore();
  const index = store.readIndex(principal);
  const eligible = index.videos.filter(
    (v): v is typeof v & { summaryMd: string } => !!v.summaryMd && !v.tldr,
  );
  const total = eligible.length;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function emit(event: ProgressEvent) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }
      // SSE comment keeps the connection alive through long Gemini calls.
      // Proxies and browsers drop idle SSE connections after ~30–60s.
      function heartbeat() {
        controller.enqueue(encoder.encode(': keep-alive\n\n'));
      }

      emit({ type: 'start', total });

      let succeeded = 0;
      let failed = 0;

      for (let i = 0; i < eligible.length; i++) {
        const video = eligible[i]!;
        const current = i + 1;

        // Heartbeat keeps the SSE connection alive during long Gemini calls.
        heartbeat();

        try {
          const mdPath = path.join(outputFolder, video.summaryMd);
          const mdContent = await fs.promises.readFile(mdPath, 'utf-8');

          const { tldr, takeaways } = await extractQuickView(mdContent);
          const updatedContent = insertQuickViewCallout(mdContent, tldr, takeaways, video.tags ?? []);

          await fs.promises.writeFile(mdPath, updatedContent, 'utf-8');

          // Index updated immediately after the .md write.
          store.updateVideoFields(principal, video.id, { tldr, takeaways });

          succeeded++;
          // Emit step as soon as core work (Gemini + index) is done.
          emit({ type: 'step', videoId: video.id, title: video.title, step: 'done', current, total });
        } catch (err) {
          failed++;
          const log = err instanceof Error ? err.message : String(err);
          emit({ type: 'error', videoId: video.id, title: video.title, log });
        }

        // Rate-limit Gemini calls between iterations.
        if (i < eligible.length - 1) {
          await new Promise<void>((resolve) => setTimeout(resolve, 200));
        }
      }

      emit({ type: 'done', total, succeeded, failed });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',   // disable nginx/proxy buffering so events arrive in real-time
    },
  });
}
