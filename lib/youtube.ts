import { google } from 'googleapis';
import { YoutubeTranscript } from 'youtube-transcript';
import type { VideoMeta } from '../types';
import type { TranscriptSegment } from './transcript-timestamps';

function parseDuration(iso: string): number {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  return (parseInt(match[1] ?? '0') * 3600) +
         (parseInt(match[2] ?? '0') * 60) +
          parseInt(match[3] ?? '0');
}

export async function fetchPlaylistVideos(playlistUrl: string, apiKey: string): Promise<VideoMeta[]> {
  let playlistId: string | null;
  try {
    playlistId = new URL(playlistUrl).searchParams.get('list');
  } catch {
    throw new Error(`Invalid playlist URL: ${playlistUrl}`);
  }
  if (!playlistId) throw new Error(`No playlist ID found in URL: ${playlistUrl}`);

  const yt = google.youtube({ version: 'v3', auth: apiKey });

  const videoIds: string[] = [];
  const addedDates: Record<string, string | undefined> = {};
  let pageToken: string | undefined;
  let pageCount = 0;
  const MAX_PAGES = 100;
  do {
    if (pageCount++ >= MAX_PAGES) throw new Error(`Playlist exceeded ${MAX_PAGES} pages: ${playlistUrl}`);
    const res = await yt.playlistItems.list({
      part: ['contentDetails', 'snippet'],
      playlistId,
      maxResults: 50,
      pageToken,
    });
    for (const item of res.data.items ?? []) {
      if (item.contentDetails?.videoId) {
        videoIds.push(item.contentDetails.videoId);
        addedDates[item.contentDetails.videoId] = item.snippet?.publishedAt ?? undefined;
      }
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  const videos: VideoMeta[] = [];
  for (let i = 0; i < videoIds.length; i += 50) {
    const res = await yt.videos.list({
      part: ['snippet', 'contentDetails'],
      id: videoIds.slice(i, i + 50),
    });
    for (const item of res.data.items ?? []) {
      if (!item.id) continue;
      videos.push({
        videoId: item.id,
        title: item.snippet?.title ?? '',
        channelTitle: item.snippet?.channelTitle ?? undefined,
        youtubeUrl: `https://www.youtube.com/watch?v=${item.id}`,
        durationSeconds: parseDuration(item.contentDetails?.duration ?? ''),
        videoPublishedAt: item.snippet?.publishedAt ?? undefined,
        addedToPlaylistAt: addedDates[item.id],
      });
    }
  }
  // videos.list doesn't guarantee response order matches input — restore playlist order
  const videoMap = new Map(videos.map((v) => [v.videoId, v]));
  return videoIds.map((id) => videoMap.get(id)).filter(Boolean) as VideoMeta[];
}

export async function fetchTranscript(videoId: string): Promise<string> {
  try {
    const segments = await YoutubeTranscript.fetchTranscript(videoId);
    return segments.map((s) => s.text).join(' ');
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to fetch transcript for video ${videoId}: ${cause}`, { cause: err });
  }
}

export async function fetchTranscriptSegments(videoId: string): Promise<TranscriptSegment[]> {
  try {
    const segments = await YoutubeTranscript.fetchTranscript(videoId);
    // youtube-transcript returns offset/duration in milliseconds; store seconds.
    // Defensive: drop any row with a non-string text or non-finite timing (Codex MEDIUM).
    return segments
      .filter((s) => s && typeof s.text === 'string' && Number.isFinite(s.offset) && Number.isFinite(s.duration))
      .map((s) => ({ text: s.text, offset: s.offset / 1000, duration: s.duration / 1000 }));
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to fetch transcript for video ${videoId}: ${cause}`, { cause: err });
  }
}

export function detectLanguage(transcript: string): 'en' | 'ko' {
  // Korean Syllables (U+AC00–U+D7A3), Hangul Jamo (U+1100–U+11FF), Compatibility Jamo (U+3130–U+318F)
  const korean = (transcript.match(/[가-힣ᄀ-ᇿ㄰-㆏]/g) ?? []).length;
  return korean / Math.max(transcript.length, 1) > 0.1 ? 'ko' : 'en';
}

export async function fetchPlaylistTitle(playlistId: string, apiKey: string): Promise<string> {
  const yt = google.youtube({ version: 'v3', auth: apiKey });
  const res = await yt.playlists.list({ part: ['snippet'], id: [playlistId] });
  return res.data.items?.[0]?.snippet?.title ?? playlistId;
}

export class ChannelNotFoundError extends Error {}

export function buildPlaylistUrl(id: string): string {
  return `https://youtube.com/playlist?list=${id}`;
}

const HANDLE_RE = /^[A-Za-z0-9._-]{1,30}$/;
const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{20,}$/;
const YT_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);

// Strict, YouTube-host-only parse (Codex H2). {} for anything invalid → callers map to ChannelNotFound.
export function parseChannelHandle(input: string): { handle?: string; channelId?: string } {
  const trimmed = input.trim();
  if (!trimmed) return {};
  const looksUrl = /^https?:\/\//i.test(trimmed) || /^(www\.|m\.)?youtube\.com\//i.test(trimmed);
  if (looksUrl) {
    let url: URL;
    try { url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`); } catch { return {}; }
    if (!YT_HOSTS.has(url.hostname.toLowerCase())) return {};
    const at = url.pathname.match(/^\/@([A-Za-z0-9._-]{1,30})$/);
    if (at) return { handle: at[1] };
    const chan = url.pathname.match(/^\/channel\/(UC[A-Za-z0-9_-]{20,})$/);
    if (chan) return { channelId: chan[1] };
    return {};
  }
  if (/[/\s]/.test(trimmed)) return {};       // no path/space in a non-URL form
  if (CHANNEL_ID_RE.test(trimmed)) return { channelId: trimmed };
  const bare = trimmed.replace(/^@/, '');
  if (bare.includes('@')) return {};          // embedded @ (e.g. x@y)
  if (HANDLE_RE.test(bare)) return { handle: bare };
  return {};
}

export async function resolveChannelId(input: string, apiKey: string): Promise<{ channelId: string; channelTitle: string }> {
  const parsed = parseChannelHandle(input);
  const yt = google.youtube({ version: 'v3', auth: apiKey });
  const pick = (item?: { id?: string | null; snippet?: { title?: string | null } | null }) => {
    if (!item?.id) throw new ChannelNotFoundError(`channel not found: ${input}`);
    return { channelId: item.id, channelTitle: item.snippet?.title ?? item.id };
  };
  if (parsed.channelId) return pick((await yt.channels.list({ part: ['snippet'], id: [parsed.channelId] })).data.items?.[0]);
  if (parsed.handle) return pick((await yt.channels.list({ part: ['snippet'], forHandle: parsed.handle })).data.items?.[0]);
  throw new ChannelNotFoundError(`unrecognized channel input: ${input}`);
}

export async function fetchChannelPlaylists(channelId: string, apiKey: string): Promise<{ id: string; title: string; itemCount?: number; thumbnailUrl?: string }[]> {
  const yt = google.youtube({ version: 'v3', auth: apiKey });
  const res = await yt.playlists.list({ part: ['snippet', 'contentDetails'], channelId, maxResults: 50 });
  return (res.data.items ?? []).filter((i) => i.id).map((i) => ({
    id: i.id as string,
    title: i.snippet?.title ?? (i.id as string),
    itemCount: i.contentDetails?.itemCount ?? undefined,
    thumbnailUrl: i.snippet?.thumbnails?.medium?.url ?? i.snippet?.thumbnails?.default?.url ?? undefined,
  }));
}
