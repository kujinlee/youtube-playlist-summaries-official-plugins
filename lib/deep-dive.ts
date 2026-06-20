import fs from 'fs';
import path from 'path';
import { generateDeepDive, generateDeepDiveCombined, generateDeepDiveFromTranscript } from './gemini';
import { fetchTranscript } from './youtube';
import { generatePdf } from './pdf';
import { assertOutputFolder, assertVideoId, readIndex, updateVideoFields } from './index-store';
import type { ProgressEvent } from '../types';

function formatDuration(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

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
  // Step 1: transcript fetch; Step 2: generation; Step 3: PDF.
  onProgress({ type: 'step', videoId, step: 'Fetching transcript…', current: 1, total: 3 });

  let deepDiveRaw: string;
  let mode: 'combined' | 'transcript' | 'video';
  const errors: string[] = [];
  const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

  let transcript: string | null = null;
  try { transcript = await fetchTranscript(videoId); }
  catch (e) { errors.push(`transcript fetch: ${msg(e)}`); }

  onProgress({ type: 'step', videoId, step: 'Generating deep-dive analysis…', current: 2, total: 3 });

  if (transcript !== null) {
    try {
      deepDiveRaw = await generateDeepDiveCombined(video.youtubeUrl, transcript, video.language);
      mode = 'combined';
    } catch (e1) {
      errors.push(`combined: ${msg(e1)}`);
      try {
        deepDiveRaw = await generateDeepDiveFromTranscript(transcript, video.language);
        mode = 'transcript';
      } catch (e2) {
        errors.push(`transcript-only: ${msg(e2)}`);
        try {
          deepDiveRaw = await generateDeepDive(video.youtubeUrl, video.language);
          mode = 'video';
        } catch (e3) {
          errors.push(`video-only: ${msg(e3)}`);
          throw new Error(`Deep-dive failed on all paths. ${errors.join('; ')}`);
        }
      }
    }
  } else {
    try {
      deepDiveRaw = await generateDeepDive(video.youtubeUrl, video.language);
      mode = 'video';
    } catch (e3) {
      errors.push(`video-only: ${msg(e3)}`);
      throw new Error(`Deep-dive failed. ${errors.join('; ')}`);
    }
  }

  onProgress({ type: 'step', videoId, step: `Deep-dive generated (${mode})`, current: 2, total: 3 });

  // Derive filename from summary filename — keeps human-readable rank-slug naming consistent
  const base = (video.summaryMd ?? videoId).replace(/\.md$/, '');
  const mdFilename = `${base}-deep-dive.md`;
  const pdfFilename = `pdfs/${base}-deep-dive.pdf`;

  // Invalidate any cached deep-dive HTML so the next view regenerates from the new markdown.
  try { fs.unlinkSync(path.join(outputFolder, 'htmls', `${base}-deep-dive.html`)); }
  catch { /* no cached html — fine */ }

  // Strip any leading H1 Gemini may have generated — we add our own standardized header
  const body = deepDiveRaw.replace(/^#\s+[^\n]*\n+/, '');

  const structuralTags = ['video-summary', 'deep-dive', video.language];
  const allTags = [...structuralTags, ...(video.tags ?? [])];

  const frontmatterLines = [
    '---',
    'tags:',
    ...allTags.map((t) => `  - ${t}`),
    `video_id: "${video.id}"`,
    ...(video.channel ? [`channel: "${video.channel}"`] : []),
    `lang: ${video.language.toUpperCase()}`,
    ...(video.videoType ? [`type: ${video.videoType}`] : []),
    ...(video.audience ? [`audience: ${video.audience}`] : []),
    `score: ${video.overallScore}`,
    '---',
  ];

  const metaParts = [
    video.channel && `**Channel:** ${video.channel}`,
    `**Duration:** ${formatDuration(video.durationSeconds)}`,
    `**URL:** ${video.youtubeUrl}`,
  ].filter(Boolean).join(' | ');

  const mdContent = [
    frontmatterLines.join('\n'),
    '',
    `# ${video.title} (Deep Dive)`,
    '',
    metaParts,
    '',
    '---',
    '',
    body,
  ].join('\n');

  const mdPath = path.join(outputFolder, mdFilename);
  await fs.promises.writeFile(mdPath, mdContent, 'utf-8');

  await fs.promises.mkdir(path.join(outputFolder, 'pdfs'), { recursive: true });
  const pdfPath = path.join(outputFolder, pdfFilename);
  onProgress({ type: 'step', videoId, step: 'Generating PDF…', current: 3, total: 3 });
  await generatePdf(mdContent, pdfPath);

  updateVideoFields(outputFolder, videoId, {
    deepDiveMd: mdFilename,
    deepDivePdf: pdfFilename,
  });

  onProgress({ type: 'done' });
}
