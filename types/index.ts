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

// --- VideoType and Audience: Gemini-classified fields ---
export const VideoTypeSchema = z.enum([
  'Tutorial', 'Analysis', 'Case Study', 'Framework', 'Demo', 'Interview',
]);
export type VideoType = z.infer<typeof VideoTypeSchema>;

export const AudienceSchema = z.enum(['Beginner', 'Intermediate', 'Advanced']);
export type Audience = z.infer<typeof AudienceSchema>;

// --- VideoMeta: intermediate shape from YouTube API, before ratings/summary exist ---
export const VideoMetaSchema = z.object({
  videoId: z.string(), // YouTube video ID (not the playlist item ID)
  title: z.string(),
  youtubeUrl: z.string().url(),
  durationSeconds: z.number().int().nonnegative(),
  channelTitle: z.string().optional(),
  videoPublishedAt: z.string().datetime().optional(),
  addedToPlaylistAt: z.string().datetime().optional(),
});
export type VideoMeta = z.infer<typeof VideoMetaSchema>;

export const DocVersionSchema = z.object({
  major: z.number().int().nonnegative(),
  minor: z.number().int().nonnegative(),
});

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
  summaryHtml: z.string().nullable().optional(),
  deepDiveHtml: z.string().nullable().optional(),
  deepDiveVersion: DocVersionSchema.optional(), // absent ⇒ pre-feature {1,0}; stamped to CURRENT_DEEP_DIVE_VERSION on (re)generation
  processedAt: z.string().datetime(),
  videoType: VideoTypeSchema.optional(),
  audience: AudienceSchema.optional(),
  channel: z.string().optional(),
  tags: z.array(z.string()).optional(),
  removedFromPlaylist: z.boolean().optional(),
  playlistIndex: z.number().int().positive().optional(),
  videoPublishedAt: z.string().datetime().optional(),
  addedToPlaylistAt: z.string().datetime().optional(),
  personalScore: z.number().int().min(1).max(5).optional(),
  personalNote: z.string().max(500).optional(),
  tldr: z.string().optional(),
  takeaways: z.array(z.string()).optional(),
  corrections: z.string().optional(),
  docVersion: DocVersionSchema.optional(), // absent ⇒ pre-feature {1,0}; stamped to CURRENT_DOC_VERSION on (re)generation
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
    total: z.number().int().nonnegative().optional(),
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
    total: z.number().int().nonnegative().optional(),
    succeeded: z.number().int().nonnegative().optional(),
    failed: z.number().int().nonnegative().optional(),
  }),
  z.object({
    type: z.literal('error'),
    videoId: z.string().optional(),
    title: z.string().optional(),
    log: z.string(),
  }),
  z.object({
    type: z.literal('cancelled'),
  }),
]);
export type ProgressEvent = z.infer<typeof ProgressEventSchema>;
export type ProgressEventType = ProgressEvent['type'];

// --- Gemini response type for generateSummary ---
export interface GeminiSummaryResponse {
  summary: string;
  ratings: Ratings;
  overallScore: number;
  videoType?: VideoType;
  audience?: Audience;
  tags?: string[];
  tldr?: string;
  takeaways?: string[];
}

// --- Filter state for client-side filtering ---
export interface FilterState {
  searchText: string;
  language: 'all' | 'en' | 'ko';
  videoType: 'all' | VideoType;
  audience: 'all' | Audience;
  minScore: number;
  minPersonalScore: number;  // 0 = no filter; 1–5 = minimum personal score; unscored shown dimmed
}
export const FILTER_DEFAULTS: FilterState = {
  searchText: '',
  language: 'all',
  videoType: 'all',
  audience: 'all',
  minScore: 0,
  minPersonalScore: 0,
};

// --- Sort types for GET /api/videos ---
type RatingSortColumn = keyof Ratings;
// 'overall' maps to Video.overallScore; all others map directly to Ratings fields.
export type SortColumn = 'name' | 'overall' | RatingSortColumn | 'language' | 'videoType' | 'audience' | 'playlistIndex' | 'videoPublishedAt' | 'addedToPlaylistAt' | 'personalScore';
export type SortOrder = 'asc' | 'desc';
