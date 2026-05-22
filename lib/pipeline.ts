import fs from 'fs';
import path from 'path';
import { fetchPlaylistVideos, fetchTranscript, detectLanguage } from './youtube';
import { generateSummary } from './gemini';
import { generatePdf } from './pdf';
import { assertOutputFolder, assertVideoId, upsertVideo, readIndex, writeIndex } from './index-store';
import type { ProgressEvent, Video, VideoMeta, RatingValue, VideoType, Audience } from '../types';

const VALID_VIDEO_TYPES: VideoType[] = ['Tutorial', 'Analysis', 'Case Study', 'Framework', 'Demo', 'Interview'];
const VALID_AUDIENCES: Audience[] = ['Beginner', 'Intermediate', 'Advanced'];

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
  const pdfFilename = file.replace(/\.md$/, '.pdf');
  const pdfPath = path.join(path.dirname(mdPath), pdfFilename);
  const summaryPdf = fs.existsSync(pdfPath) ? pdfFilename : null;

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

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export function formatDuration(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

const RANK_PREFIX = /^\d+_/;
const FILENAME_FIELDS = ['summaryMd', 'summaryPdf', 'deepDiveMd', 'deepDivePdf'] as const;

export function migrateToSlugFilenames(outputFolder: string): void {
  const index = readIndex(outputFolder);
  let anyChanged = false;

  const videos = index.videos.map((video) => {
    const updates: Partial<Video> = {};
    for (const field of FILENAME_FIELDS) {
      const current = video[field];
      if (!current || !RANK_PREFIX.test(current)) continue;
      const newName = current.replace(RANK_PREFIX, '');
      const src = path.join(outputFolder, current);
      const dst = path.join(outputFolder, newName);
      try {
        if (fs.existsSync(src) && !fs.existsSync(dst)) fs.renameSync(src, dst);
        updates[field] = newName;
      } catch {
        // leave unchanged if rename fails
      }
    }
    if (Object.keys(updates).length > 0) { anyChanged = true; return { ...video, ...updates }; }
    return video;
  });

  if (anyChanged) writeIndex(outputFolder, { ...index, videos });
}

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

  // Recover any .md files written in a prior interrupted run before processing new videos.
  recoverOrphanedVideos(outputFolder);

  // Build the set of already-indexed IDs so we can skip re-processing them.
  const alreadyIndexed = new Set(readIndex(outputFolder).videos.map((v) => v.id));

  onProgress({ type: 'start', total });

  for (let i = 0; i < metas.length; i++) {
    const meta = metas[i];
    const current = i + 1;
    try {
      assertVideoId(meta.videoId); // defense-in-depth before any path construction

      if (alreadyIndexed.has(meta.videoId)) {
        onProgress({ type: 'step', videoId: meta.videoId, title: meta.title, step: 'Already processed — skipped', current, total });
        continue;
      }

      onProgress({ type: 'step', videoId: meta.videoId, title: meta.title, step: 'Fetching transcript…', current, total });
      const transcript = await fetchTranscript(meta.videoId);

      const language = detectLanguage(transcript);

      onProgress({ type: 'step', videoId: meta.videoId, title: meta.title, step: 'Generating summary…', current, total });
      const { summary, ratings, overallScore, videoType, audience, tags } = await generateSummary(transcript, language);

      const baseName = slugify(meta.title);
      const mdPath = path.join(outputFolder, `${baseName}.md`);
      const pdfPath = path.join(outputFolder, `${baseName}.pdf`);

      const structuralTags = ['video-summary', language];
      const allTags = [...structuralTags, ...(tags ?? [])];

      const frontmatterLines = [
        '---',
        'tags:',
        ...allTags.map((t) => `  - ${t}`),
        `video_id: "${meta.videoId}"`,
        ...(meta.channelTitle ? [`channel: "${meta.channelTitle}"`] : []),
        `lang: ${language.toUpperCase()}`,
        ...(videoType ? [`type: ${videoType}`] : []),
        ...(audience ? [`audience: ${audience}`] : []),
        `score: ${overallScore}`,
        '---',
      ];

      const metaParts = [
        meta.channelTitle && `**Channel:** ${meta.channelTitle}`,
        `**Duration:** ${formatDuration(meta.durationSeconds)}`,
        `**URL:** ${meta.youtubeUrl}`,
      ].filter(Boolean).join(' | ');

      const mdContent = [
        frontmatterLines.join('\n'),
        '',
        `# ${meta.title}`,
        '',
        metaParts,
        '',
        '---',
        '',
        summary,
      ].join('\n');

      await fs.promises.writeFile(mdPath, mdContent, 'utf-8');

      const video: Video = {
        id: meta.videoId,
        title: meta.title,
        youtubeUrl: meta.youtubeUrl,
        language,
        durationSeconds: meta.durationSeconds,
        archived: false,
        ratings,
        overallScore,
        summaryMd: `${baseName}.md`,
        summaryPdf: `${baseName}.pdf`,
        deepDiveMd: null,
        deepDivePdf: null,
        processedAt: new Date().toISOString(),
        ...(videoType !== undefined && { videoType }),
        ...(audience !== undefined && { audience }),
        ...(meta.channelTitle !== undefined && { channel: meta.channelTitle }),
        ...(tags !== undefined && { tags }),
      };
      // Index updated immediately after md write — reduces orphan window to PDF generation only.
      upsertVideo(outputFolder, video);

      onProgress({ type: 'step', videoId: meta.videoId, title: meta.title, step: 'Generating PDF…', current, total });
      await generatePdf(mdContent, pdfPath);

      onProgress({ type: 'step', videoId: meta.videoId, title: meta.title, step: 'Saved', current, total });
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
      upsertVideo(outputFolder, { ...video, removedFromPlaylist: false });
    }
  }

  onProgress({ type: 'done', total });
}
