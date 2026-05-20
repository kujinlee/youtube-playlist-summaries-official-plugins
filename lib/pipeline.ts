import fs from 'fs';
import path from 'path';
import { fetchPlaylistVideos, fetchTranscript, detectLanguage } from './youtube';
import { generateSummary } from './gemini';
import { generatePdf } from './pdf';
import { assertOutputFolder, assertVideoId, upsertVideo, readIndex, writeIndex } from './index-store';
import type { ProgressEvent, Video } from '../types';

export async function runIngestion(
  playlistUrl: string,
  outputFolder: string,
  onProgress: (event: ProgressEvent) => void,
): Promise<void> {
  // Check cheap env guard before I/O-bound assertOutputFolder
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) throw new Error('YOUTUBE_API_KEY is not set');

  assertOutputFolder(outputFolder);

  const metas = await fetchPlaylistVideos(playlistUrl, apiKey);
  const total = metas.length;

  // Stamp playlistUrl into the index before processing — upsertVideo reads-then-writes
  // and would silently carry forward the empty string it gets from a new index.
  const existing = readIndex(outputFolder);
  writeIndex(outputFolder, { ...existing, playlistUrl, outputFolder });

  onProgress({ type: 'start', total });

  for (let i = 0; i < metas.length; i++) {
    const meta = metas[i];
    const current = i + 1;
    try {
      assertVideoId(meta.videoId); // defense-in-depth before any path construction

      onProgress({ type: 'step', videoId: meta.videoId, title: meta.title, step: 'Fetching transcript…', current, total });
      const transcript = await fetchTranscript(meta.videoId);

      const language = detectLanguage(transcript);

      onProgress({ type: 'step', videoId: meta.videoId, title: meta.title, step: 'Generating summary…', current, total });
      const { summary, ratings, overallScore } = await generateSummary(transcript, language);

      const mdContent = `# ${meta.title}\n\n${summary}`;
      const mdPath = path.join(outputFolder, `${meta.videoId}.md`);
      await fs.promises.writeFile(mdPath, mdContent, 'utf-8');

      const pdfPath = path.join(outputFolder, `${meta.videoId}.pdf`);
      onProgress({ type: 'step', videoId: meta.videoId, title: meta.title, step: 'Generating PDF…', current, total });
      await generatePdf(mdContent, pdfPath);

      const video: Video = {
        id: meta.videoId,
        title: meta.title,
        youtubeUrl: meta.youtubeUrl,
        language,
        durationSeconds: meta.durationSeconds,
        archived: false,
        ratings,
        overallScore,
        summaryMd: `${meta.videoId}.md`,
        summaryPdf: `${meta.videoId}.pdf`,
        deepDiveMd: null,
        deepDivePdf: null,
        processedAt: new Date().toISOString(),
      };
      upsertVideo(outputFolder, video);

      onProgress({ type: 'step', videoId: meta.videoId, title: meta.title, step: 'Saved', current, total });
    } catch (err) {
      const log = err instanceof Error ? err.message : String(err);
      onProgress({ type: 'error', videoId: meta.videoId, title: meta.title, log });
    }
  }

  onProgress({ type: 'done', total });
}
