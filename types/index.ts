import { z } from 'zod';

// --- Rating value: integer 1–5 ---
export const RatingValueSchema = z.union([
  z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5),
]);
export type RatingValue = z.infer<typeof RatingValueSchema>;

// --- Ratings ---
export const RatingsSchema = z.object({
  usefulness: RatingValueSchema,
  depth: RatingValueSchema,
  originality: RatingValueSchema,
  recency: RatingValueSchema,
  completeness: RatingValueSchema,
});
export type Ratings = z.infer<typeof RatingsSchema>;

// --- VideoMeta: intermediate shape from YouTube API, before ratings/summary exist ---
export const VideoMetaSchema = z.object({
  videoId: z.string(), // YouTube video ID (not the playlist item ID)
  title: z.string(),
  youtubeUrl: z.string().url(),
  durationSeconds: z.number().int().nonnegative(),
});
export type VideoMeta = z.infer<typeof VideoMetaSchema>;

// --- Video: one entry in playlist-index.json ---
export const VideoSchema = z.object({
  id: z.string(),
  title: z.string(),
  youtubeUrl: z.string().url(),
  language: z.enum(['en', 'ko']),
  durationSeconds: z.number().int().nonnegative(),
  archived: z.boolean(),
  ratings: RatingsSchema,
  overallScore: z.number().min(1).max(5), // average of 5 ratings, may be fractional
  summaryMd: z.string().nullable(),
  summaryPdf: z.string().nullable(),
  deepDiveMd: z.string().nullable(),
  deepDivePdf: z.string().nullable(),
  processedAt: z.string().datetime(),
});
export type Video = z.infer<typeof VideoSchema>;

// --- PlaylistIndex: root of playlist-index.json ---
export const PlaylistIndexSchema = z.object({
  playlistUrl: z.string().url(),
  outputFolder: z.string(),
  videos: z.array(VideoSchema),
});
export type PlaylistIndex = z.infer<typeof PlaylistIndexSchema>;

// --- ProgressEvent: discriminated union for SSE events ---
export const ProgressEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('start'),
    total: z.number().int().positive().optional(),
    log: z.string().optional(),
  }),
  z.object({
    type: z.literal('step'),
    videoId: z.string().optional(),
    title: z.string().optional(),
    step: z.string(),
    current: z.number().int().positive().optional(),
    total: z.number().int().positive().optional(),
  }),
  z.object({
    type: z.literal('done'),
    current: z.number().int().positive().optional(),
    total: z.number().int().positive().optional(),
  }),
  z.object({
    type: z.literal('error'),
    videoId: z.string().optional(),
    title: z.string().optional(),
    log: z.string(),
  }),
]);
export type ProgressEvent = z.infer<typeof ProgressEventSchema>;
export type ProgressEventType = ProgressEvent['type'];

// --- Gemini response type for generateSummary ---
export interface GeminiSummaryResponse {
  summary: string;
  ratings: Ratings;
}

// --- Sort types for GET /api/videos ---
type RatingSortColumn = keyof Ratings;
// 'overall' maps to Video.overallScore; all others map directly to Ratings fields.
export type SortColumn = 'name' | 'overall' | RatingSortColumn;
export type SortOrder = 'asc' | 'desc';
