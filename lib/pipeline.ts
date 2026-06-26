import fs from 'fs';
import path from 'path';
import { fetchPlaylistVideos, detectLanguage } from './youtube';
import { generateSummary, extractQuickView } from './gemini';
import { resolveTranscriptSegments } from './transcript-source';
import { assertOutputFolder, assertVideoId, upsertVideo, readIndex, writeIndex } from './index-store';
import { slugify } from './slugify';
import { nextSerial } from './serial-assign';
import { applySerial, padSerial } from './serial-filename';
import type { ProgressEvent, Video, VideoMeta, RatingValue, VideoType, Audience, GeminiSummaryResponse } from '../types';
import { CURRENT_DOC_VERSION } from './doc-version';
import { padDividers } from './markdown-dividers';

const VALID_VIDEO_TYPES: VideoType[] = ['Tutorial', 'Analysis', 'Case Study', 'Framework', 'Demo', 'Interview'];
const VALID_AUDIENCES: Audience[] = ['Beginner', 'Intermediate', 'Advanced'];

export interface SummaryDocInput {
  videoId: string;
  title: string;
  youtubeUrl: string;
  channel?: string;
  durationSeconds: number;
  outputFolder: string;
  baseName: string;
}
export interface SummaryDocResult {
  language: 'en' | 'ko';
  ratings: GeminiSummaryResponse['ratings'];
  overallScore: number;
  videoType?: VideoType;
  audience?: Audience;
  tags?: string[];
  tldr?: string;
  takeaways?: string[];
  mdContent: string;
  summaryMd: string;
}

/**
 * Fetch transcript → generateSummary (emits ▶ timestamps) → build the summary .md → write it at
 * <baseName>.md. Shared by ingestion (new slug) and re-summarize (existing baseName). Does NOT write
 * the PDF — PDFs are no longer generated server-side.
 */
export async function writeSummaryDoc(input: SummaryDocInput): Promise<SummaryDocResult> {
  const { videoId, title, youtubeUrl, channel, durationSeconds, outputFolder, baseName } = input;
  const { segments } = await resolveTranscriptSegments(videoId, youtubeUrl, durationSeconds);
  const transcript = segments.map((s) => s.text).join(' '); // plain text for language detection only
  const language = detectLanguage(transcript);
  const { summary: rawSummary, ratings, overallScore, videoType, audience, tags, tldr, takeaways } =
    await generateSummary(segments, language, videoId);
  const summary = padDividers(rawSummary);

  const structuralTags = ['video-summary', language];
  const allTags = [...structuralTags, ...(tags ?? [])];
  const frontmatterLines = [
    '---', 'tags:', ...allTags.map((t) => `  - ${t}`),
    `video_id: "${videoId}"`,
    ...(channel ? [`channel: "${channel}"`] : []),
    `lang: ${language.toUpperCase()}`,
    ...(videoType ? [`type: ${videoType}`] : []),
    ...(audience ? [`audience: ${audience}`] : []),
    `score: ${overallScore}`, '---',
  ];
  const metaParts = [
    channel && `**Channel:** ${channel}`,
    `**Duration:** ${formatDuration(durationSeconds)}`,
    `**URL:** ${youtubeUrl}`,
  ].filter(Boolean).join(' | ');
  const baseContent = [frontmatterLines.join('\n'), '', `# ${title}`, '', metaParts, '', '---', '', summary].join('\n');
  let outTldr = tldr;
  let outTakeaways = takeaways;
  let mdContent: string;
  if (tldr && takeaways) {
    mdContent = insertQuickViewCallout(baseContent, tldr, takeaways, tags ?? []);
  } else {
    // generateSummary omitted tldr/takeaways → derive them from the full md so the Quick
    // Reference callout is never silently skipped (same primitive the backfill route uses).
    try {
      const qv = await extractQuickView(baseContent);
      outTldr = qv.tldr;
      outTakeaways = qv.takeaways;
      mdContent = insertQuickViewCallout(baseContent, qv.tldr, qv.takeaways, tags ?? []);
    } catch {
      // Extraction failed — write without the callout and clear the partial so the doc
      // stays eligible for the backfill route (filters on !v.tldr). Never fail the summary.
      mdContent = baseContent;
      outTldr = undefined;
      outTakeaways = undefined;
    }
  }

  await fs.promises.writeFile(path.join(outputFolder, `${baseName}.md`), mdContent, 'utf-8');
  return { language, ratings, overallScore, videoType, audience, tags, tldr: outTldr, takeaways: outTakeaways, mdContent, summaryMd: `${baseName}.md` };
}

export function parseFrontmatterField(content: string, key: string): string | null {
  const match = content.match(new RegExp(`^${key}:\\s*"?([^"\\n]*)"?\\s*$`, 'm'));
  return match?.[1]?.trim() ?? null;
}

function parseDurationString(dur: string): number {
  const parts = dur.split(':').map(Number);
  if (parts.length === 2) return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
  if (parts.length === 3) return (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0);
  return 0;
}

export function reconstructVideo(content: string, file: string, mdPath: string): Video | null {
  const videoId = parseFrontmatterField(content, 'video_id');
  if (!videoId) return null;

  const langRaw = parseFrontmatterField(content, 'lang');
  const language = langRaw?.toLowerCase() === 'ko' ? 'ko' : 'en';

  const scoreRaw = parseFrontmatterField(content, 'score');
  const overallScore = parseFloat(scoreRaw ?? '3') || 3;
  const rRaw = Math.max(1, Math.min(5, Math.round(overallScore)));
  const r = rRaw as RatingValue;
  const ratings = { usefulness: r, depth: r, originality: r, recency: r, completeness: r };

  const urlMatch = content.match(/\*\*URL:\*\*\s*(https?:\/\/\S+)/);
  const youtubeUrl = urlMatch?.[1] ?? `https://www.youtube.com/watch?v=${videoId}`;

  const durMatch = content.match(/\*\*Duration:\*\*\s*([\d:]+)/);
  const durationSeconds = durMatch ? parseDurationString(durMatch[1]) : 0;

  const titleMatch = content.match(/^#\s+(.+)$/m);
  const title = titleMatch?.[1]?.trim() ?? file.replace(/\.md$/, '');

  const videoTypeRaw = parseFrontmatterField(content, 'type');
  const audienceRaw = parseFrontmatterField(content, 'audience');
  const channelRaw = parseFrontmatterField(content, 'channel');

  const videoType = VALID_VIDEO_TYPES.includes(videoTypeRaw as VideoType)
    ? (videoTypeRaw as VideoType) : undefined;
  const audience = VALID_AUDIENCES.includes(audienceRaw as Audience)
    ? (audienceRaw as Audience) : undefined;

  const summaryMd = file;

  const serialMatch = file.match(/^(\d+)_/);
  const serialNumber = serialMatch ? parseInt(serialMatch[1], 10) : undefined;

  const pdfFilename = file.replace(/\.md$/, '.pdf');
  const pdfPath = path.join(path.dirname(mdPath), 'pdfs', pdfFilename);
  const summaryPdf = fs.existsSync(pdfPath) ? `pdfs/${pdfFilename}` : null;

  const processedAt = fs.statSync(mdPath).mtime.toISOString();

  return {
    id: videoId,
    title,
    youtubeUrl,
    language,
    durationSeconds,
    archived: false,
    ratings,
    overallScore,
    summaryMd,
    summaryPdf,
    deepDiveMd: null,
    deepDivePdf: null,
    processedAt,
    ...(videoType !== undefined && { videoType }),
    ...(audience !== undefined && { audience }),
    ...(channelRaw ? { channel: channelRaw } : {}),
    ...(serialNumber !== undefined && { serialNumber }),
  };
}

export function recoverOrphanedVideos(outputFolder: string): void {
  const index = readIndex(outputFolder);
  const indexedIds = new Set(index.videos.map((v) => v.id));

  let files: string[];
  try {
    files = fs.readdirSync(outputFolder).filter(
      (f) => f.endsWith('.md') && !f.includes('-deep-dive'),
    );
  } catch {
    return;
  }

  for (const file of files) {
    const mdPath = path.join(outputFolder, file);
    try {
      const content = fs.readFileSync(mdPath, 'utf-8');
      const videoId = parseFrontmatterField(content, 'video_id');
      if (!videoId || indexedIds.has(videoId)) continue;

      const video = reconstructVideo(content, file, mdPath);
      if (video) {
        upsertVideo(outputFolder, video);
        indexedIds.add(videoId);
      }
    } catch {
      // Skip files that can't be parsed or indexed
    }
  }
}

export { slugify };

export function formatDuration(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}


/**
 * Remove an existing Quick Reference callout block from markdown content.
 * Reverses `insertQuickViewCallout` so the callout can be re-generated
 * after corrections are applied. Returns content unchanged if no callout
 * is present or the format is unexpected.
 */
export function stripQuickViewCallout(mdContent: string): string {
  const START_MARKER = '\n\n> [!summary] Quick Reference';
  const END_MARKER = '\n\n---\n';
  const startIdx = mdContent.indexOf(START_MARKER);
  if (startIdx === -1) return mdContent; // no callout present
  const endIdx = mdContent.indexOf(END_MARKER, startIdx);
  if (endIdx === -1) return mdContent; // malformed — leave unchanged
  return mdContent.slice(0, startIdx) + mdContent.slice(endIdx);
}

export function insertQuickViewCallout(
  mdContent: string,
  tldr: string,
  takeaways: string[],
  tags: string[],
): string {
  // Idempotency guard: don't insert if callout already present
  if (mdContent.includes('> [!summary] Quick Reference')) return mdContent;

  // Find first "\n\n---\n" — the divider between metadata line and summary body
  const dividerIdx = mdContent.indexOf('\n\n---\n');
  if (dividerIdx === -1) return mdContent; // unexpected format, leave unchanged

  const lines = [
    '',
    '> [!summary] Quick Reference',
    `> **TL;DR:** ${tldr}`,
    '>',
    '> **Key Takeaways:**',
    ...takeaways.map((t) => `> - ${t}`),
  ];
  if (tags.length > 0) {
    lines.push('>');
    lines.push(`> **Concepts:** ${tags.join(' · ')}`);
  }

  return mdContent.slice(0, dividerIdx) + '\n' + lines.join('\n') + mdContent.slice(dividerIdx);
}

export async function runIngestion(
  playlistUrl: string,
  outputFolder: string,
  onProgress: (event: ProgressEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  // Check cheap env guard before I/O-bound assertOutputFolder
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) throw new Error('YOUTUBE_API_KEY is not set');

  assertOutputFolder(outputFolder);
  fs.mkdirSync(outputFolder, { recursive: true });

  const metas = await fetchPlaylistVideos(playlistUrl, apiKey);

  // Stamp playlistUrl into the index before processing — upsertVideo reads-then-writes
  // and would silently carry forward the empty string it gets from a new index.
  const existing = readIndex(outputFolder);
  writeIndex(outputFolder, { ...existing, playlistUrl, outputFolder });

  // Recover any .md files written in a prior interrupted run before processing new videos.
  recoverOrphanedVideos(outputFolder);

  // Build the set of already-indexed IDs so we can skip re-processing them.
  const alreadyIndexed = new Set(readIndex(outputFolder).videos.map((v) => v.id));

  // Progress is over NEW (not-yet-indexed) distinct videos only — skips are instant and
  // must not inflate the bar. playlistPos (below) stays the true playlist position.
  const newTotal = new Set(metas.filter((m) => !alreadyIndexed.has(m.videoId)).map((m) => m.videoId)).size;
  let newIndex = 0;

  onProgress({ type: 'start', total: newTotal });

  for (let i = 0; i < metas.length; i++) {
    // Check cancellation between videos — after any current video finishes cleanly.
    if (signal?.aborted) {
      onProgress({ type: 'cancelled' });
      return;
    }
    const meta = metas[i];
    const playlistPos = i + 1;
    try {
      assertVideoId(meta.videoId); // defense-in-depth before any path construction

      if (alreadyIndexed.has(meta.videoId)) {
        continue;
      }

      newIndex += 1;

      onProgress({ type: 'step', videoId: meta.videoId, title: meta.title, step: 'Fetching transcript…', current: newIndex, total: newTotal });
      const serial = nextSerial(readIndex(outputFolder).videos);
      const slug = slugify(meta.title);
      let baseSlug = slug;
      let counter = 2;
      // serial makes filenames unique; collision suffix kept for slug readability only.
      while (fs.existsSync(path.join(outputFolder, applySerial(`${baseSlug}.md`, serial)))) {
        baseSlug = `${slug}-${counter}`;
        counter++;
      }
      const baseName = `${padSerial(serial)}_${baseSlug}`;
      onProgress({ type: 'step', videoId: meta.videoId, title: meta.title, step: 'Generating summary…', current: newIndex, total: newTotal });
      const { language, ratings, overallScore, videoType, audience, tags, tldr, takeaways } =
        await writeSummaryDoc({
          videoId: meta.videoId, title: meta.title, youtubeUrl: meta.youtubeUrl,
          channel: meta.channelTitle, durationSeconds: meta.durationSeconds, outputFolder, baseName,
        });

      const video: Video = {
        id: meta.videoId,
        title: meta.title,
        youtubeUrl: meta.youtubeUrl,
        language,
        durationSeconds: meta.durationSeconds,
        archived: false,
        ratings,
        overallScore,
        serialNumber: serial,
        summaryMd: `${baseName}.md`,
        summaryPdf: null,
        deepDiveMd: null,
        deepDivePdf: null,
        processedAt: new Date().toISOString(),
        docVersion: CURRENT_DOC_VERSION,
        playlistIndex: playlistPos,
        ...(videoType !== undefined && { videoType }),
        ...(audience !== undefined && { audience }),
        ...(meta.channelTitle !== undefined && { channel: meta.channelTitle }),
        ...(tags !== undefined && { tags }),
        ...(tldr !== undefined && { tldr }),
        ...(takeaways !== undefined && { takeaways }),
        ...(meta.videoPublishedAt !== undefined && { videoPublishedAt: meta.videoPublishedAt }),
        ...(meta.addedToPlaylistAt !== undefined && { addedToPlaylistAt: meta.addedToPlaylistAt }),
      };
      // Index updated immediately after md write
      upsertVideo(outputFolder, video);
      // Mark as processed so within-run duplicates (same video appearing twice in the playlist) are skipped.
      alreadyIndexed.add(meta.videoId);

      onProgress({ type: 'step', videoId: meta.videoId, title: meta.title, step: 'Saved', current: newIndex, total: newTotal });
    } catch (err) {
      const log = err instanceof Error ? err.message : String(err);
      onProgress({ type: 'error', videoId: meta.videoId, title: meta.title, log });
    }
  }

  // Reconcile removedFromPlaylist: auto-archive on removal, clear flag if video returns.
  const currentIds = new Set(metas.map((m) => m.videoId));
  for (const video of readIndex(outputFolder).videos) {
    const stillInPlaylist = currentIds.has(video.id);
    if (!stillInPlaylist && !video.removedFromPlaylist) {
      upsertVideo(outputFolder, { ...video, archived: true, removedFromPlaylist: true });
    } else if (stillInPlaylist && video.removedFromPlaylist) {
      // Returned to the playlist → clear the removal flag AND un-archive. The video
      // was auto-archived ON REMOVAL (removedFromPlaylist=true), so restoring it to
      // the playlist should restore its visibility. A video the user MANUALLY archived
      // has removedFromPlaylist=false and never enters this branch, so it's untouched.
      upsertVideo(outputFolder, { ...video, archived: false, removedFromPlaylist: false });
    }
  }

  // Stamp playlistIndex for all videos (new videos already stamped above; this covers
  // already-indexed videos that were skipped during the main loop).
  const positionMap = new Map(metas.map((m, idx) => [m.videoId, idx + 1]));
  const publishedMap = new Map(metas.map((m) => [m.videoId, m.videoPublishedAt]));
  const addedMap = new Map(metas.map((m) => [m.videoId, m.addedToPlaylistAt]));
  const afterReconcile = readIndex(outputFolder);
  // playlistIndex tracks the CURRENT playlist position: in-playlist videos (always in
  // positionMap) are re-derived each sync; videos removed from the playlist (absent from
  // positionMap) keep their last-known index. videoPublishedAt/addedToPlaylistAt remain
  // write-once (stable per video).
  const videosWithIndex = afterReconcile.videos.map((v) => ({
    ...v,
    playlistIndex: positionMap.get(v.id) ?? v.playlistIndex,
    videoPublishedAt: v.videoPublishedAt ?? publishedMap.get(v.id),
    addedToPlaylistAt: v.addedToPlaylistAt ?? addedMap.get(v.id),
  }));
  writeIndex(outputFolder, { ...afterReconcile, videos: videosWithIndex });

  onProgress({ type: 'done', total: newTotal });
}
