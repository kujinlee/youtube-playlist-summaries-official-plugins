import fs from 'fs';
import path from 'path';
import { generateDeepDive, generateDeepDiveFromTranscript } from './gemini';
import { fetchTranscript } from './youtube';
import { generatePdf } from './pdf';
import { assertOutputFolder, assertVideoId, readIndex, updateVideoFields } from './index-store';
import type { ProgressEvent } from '../types';

export async function runDeepDive(
  videoId: string,
  outputFolder: string,
  onProgress: (event: ProgressEvent) => void,
): Promise<void> {
  assertOutputFolder(outputFolder);
  assertVideoId(videoId);

  const index = readIndex(outputFolder);
  const video = index.videos.find((v) => v.id === videoId);
  if (!video) {
    throw new Error(`Video not found in index: ${videoId}`);
  }

  onProgress({ type: 'start' });
  onProgress({ type: 'step', videoId, step: 'Generating deep-dive analysis…' });

  let deepDiveContent: string;
  let mode: 'url' | 'transcript-fallback';

  try {
    deepDiveContent = await generateDeepDive(video.youtubeUrl, video.language);
    mode = 'url';
  } catch (urlErr) {
    const urlMsg = urlErr instanceof Error ? urlErr.message : String(urlErr);
    onProgress({ type: 'step', videoId, step: 'URL failed — fetching transcript for fallback…' });
    let transcript: string;
    try {
      transcript = await fetchTranscript(videoId);
    } catch (fetchErr) {
      throw new Error(`Deep-dive failed: URL error: ${urlMsg}`, { cause: fetchErr });
    }
    try {
      deepDiveContent = await generateDeepDiveFromTranscript(transcript, video.language);
      mode = 'transcript-fallback';
    } catch (transcriptErr) {
      throw new Error(`Deep-dive failed on both paths. URL error: ${urlMsg}`, { cause: transcriptErr });
    }
  }

  const mdFilename = `${videoId}-deep-dive.md`;
  const mdPath = path.join(outputFolder, mdFilename);
  await fs.promises.writeFile(mdPath, deepDiveContent, 'utf-8');

  const pdfFilename = `${videoId}-deep-dive.pdf`;
  const pdfPath = path.join(outputFolder, pdfFilename);
  onProgress({ type: 'step', videoId, step: 'Generating PDF…' });
  await generatePdf(deepDiveContent, pdfPath);

  updateVideoFields(outputFolder, videoId, {
    deepDiveMd: mdFilename,
    deepDivePdf: pdfFilename,
  });

  onProgress({ type: 'step', videoId, step: `mode: ${mode}` });
  onProgress({ type: 'done' });
}
