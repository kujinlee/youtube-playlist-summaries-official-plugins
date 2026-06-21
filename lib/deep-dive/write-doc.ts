import fs from 'fs';
import path from 'path';
import { generateDeepDive, generateDeepDiveCombined, generateDeepDiveFromTranscript } from '../gemini';
import { fetchTranscriptSegments } from '../youtube';
import type { ProgressEvent, Video } from '../../types';
import type { TranscriptSegment } from '../transcript-timestamps';

function formatDuration(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Run the Gemini deep-dive cascade and write ONLY the deep-dive `.md` file for `video`.
 *
 * Mirrors the summary's writeSummaryDoc: it produces the source artifact (the markdown)
 * and nothing else — it does NOT call updateVideoFields (the orchestrator persists
 * atomically after the HTML render succeeds) and it does NOT generate a PDF.
 *
 * Emits ONLY `step` progress events — never `start`/`done` (those are the orchestrator's).
 * Throws if every generation path fails (the .md is not written in that case).
 */
export async function writeDeepDiveDoc(
  video: Video,
  outputFolder: string,
  onProgress: (event: ProgressEvent) => void,
): Promise<{ deepDiveMd: string }> {
  const videoId = video.id;

  onProgress({ type: 'step', videoId, step: 'Fetching transcript…', current: 1, total: 3 });

  let deepDiveRaw: string;
  let mode: 'combined' | 'transcript' | 'video';
  const errors: string[] = [];
  const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

  let segments: TranscriptSegment[] | null = null;
  try { segments = await fetchTranscriptSegments(videoId); }
  catch (e) { errors.push(`transcript fetch: ${msg(e)}`); }

  onProgress({ type: 'step', videoId, step: 'Generating deep-dive analysis…', current: 2, total: 3 });

  // An empty (but non-null) transcript has no content to index — treat it like a missing
  // transcript and fall to the video-only path, rather than wasting a combined call on an
  // empty <transcript> and producing a ▶-less doc via the transcript path.
  if (segments !== null && segments.length > 0) {
    try {
      deepDiveRaw = await generateDeepDiveCombined(video.youtubeUrl, segments, video.language, videoId);
      mode = 'combined';
    } catch (e1) {
      errors.push(`combined: ${msg(e1)}`);
      try {
        deepDiveRaw = await generateDeepDiveFromTranscript(segments, video.language, videoId);
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
  const base = (video.summaryMd ?? video.id).replace(/\.md$/, '');
  const mdFilename = `${base}-deep-dive.md`;

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

  return { deepDiveMd: mdFilename };
}
