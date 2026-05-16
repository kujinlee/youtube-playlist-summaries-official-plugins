# YouTube Playlist Viewer — Design Spec

## Context

A Next.js + TypeScript web app that ingests a YouTube playlist, generates AI summaries and multi-dimensional ratings per video using Gemini, and presents them in a sortable, filterable list. Users can open summaries in Obsidian, view PDFs in the browser, request on-demand deep-dive analysis, and archive videos. Deep-dive uses Gemini's native YouTube video understanding — no video upload required.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js (App Router) + TypeScript |
| Styling | Tailwind CSS |
| AI | Gemini API via `@google/generative-ai` |
| YouTube metadata | YouTube Data API v3 |
| Transcripts | `youtube-transcript` npm package |
| PDF generation | `md-to-pdf` |
| Progress streaming | Server-Sent Events (SSE) |
| Testing | jest + ts-jest + @testing-library/react + Playwright |

---

## Environment Variables (`.env.local`)

```
GEMINI_API_KEY=
GEMINI_SUMMARY_MODEL=gemini-2.5-flash
GEMINI_DEEPDIVE_MODEL=gemini-2.5-pro
YOUTUBE_API_KEY=
OUTPUT_FOLDER=../youtube-playlist-summaries-official-plugins-data
```

> Gemini calls are isolated in `lib/gemini.ts`. Switching to Vertex AI = change that one file and add `GOOGLE_CLOUD_PROJECT` + `GOOGLE_CLOUD_LOCATION`.

---

## Data Model

### `playlist-index.json`

```typescript
interface Ratings {
  usefulness: number      // 1–5
  depth: number
  originality: number
  recency: number
  completeness: number
}

interface Video {
  id: string              // YouTube video ID
  title: string
  youtubeUrl: string      // https://www.youtube.com/watch?v={id}
  language: 'en' | 'ko'
  durationSeconds: number // from YouTube Data API contentDetails
  archived: boolean
  ratings: Ratings
  overallScore: number    // average of 5 ratings, computed at write time
  summaryMd: string | null
  summaryPdf: string | null
  deepDiveMd: string | null
  deepDivePdf: string | null
  processedAt: string     // ISO 8601
}

interface PlaylistIndex {
  playlistUrl: string
  outputFolder: string
  videos: Video[]
}
```

### Output Folder Layout

```
output-folder/
├── playlist-index.json
├── {videoId}.md
├── {videoId}.pdf
├── {videoId}-deep-dive.md        ← generated on demand
├── {videoId}-deep-dive.pdf
└── archived/
    └── {videoId}.md / .pdf / -deep-dive.md / -deep-dive.pdf
```

Archiving = physical move to `archived/` subfolder so Obsidian does not index archived content. Unarchiving = move back to root.

---

## API Routes

```
GET  /api/videos
  Query: ?sort=overall|name|usefulness|depth|originality|recency|completeness
         &order=asc|desc  &archived=true|false
  Returns: Video[]

POST /api/ingest
  Body: { playlistUrl: string, outputFolder?: string }
  Returns: { jobId: string }           ← unique ID for this ingestion run

GET  /api/ingest/stream
  Query: ?jobId=xxx
  Returns: SSE stream of ProgressEvent ← scoped to the given jobId

POST /api/videos/[id]/deep-dive
  Returns: { jobId: string }           ← unique ID for this deep-dive run

GET  /api/videos/[id]/deep-dive/stream
  Query: ?jobId=xxx
  Returns: SSE stream of ProgressEvent ← scoped to the given jobId

POST /api/videos/[id]/archive
  Body: { action: 'archive' | 'unarchive' }
  Returns: { ok: true }

GET  /api/pdf/[id]
  Query: ?type=summary|deep-dive
  Returns: PDF file stream

GET  /api/settings
  Returns: { outputFolder: string }

POST /api/settings
  Body: { outputFolder: string }
  Returns: { ok: true }
```

**Job orchestration:** The server maintains a `Map<jobId, EventEmitter>` in memory. `POST /api/ingest` generates a `jobId` (crypto.randomUUID), registers an emitter, starts the pipeline in the background, and returns `{ jobId }`. `GET /api/ingest/stream?jobId=xxx` subscribes to that emitter and forwards events as SSE. If the client connects before the pipeline starts, events are queued. The same pattern applies to deep-dive. This handles concurrent runs without cross-contamination.

### SSE Event Shape

```typescript
interface ProgressEvent {
  type: 'start' | 'step' | 'done' | 'error'
  videoId?: string
  title?: string
  step?: string      // e.g. "Fetching transcript…"
  current?: number   // e.g. 3
  total?: number     // e.g. 12
  log?: string       // full log text, shown on error
}
```

---

## Ingestion Pipeline

Triggered by `POST /api/ingest`, progress via SSE on `/api/ingest/stream`.

```
1. YouTube Data API v3  →  fetch all video IDs, titles, URLs, durationSeconds
2. For each video:
   a. youtube-transcript    →  fetch transcript text
   b. Detect language       →  'en' or 'ko' from transcript content
   c. Gemini (summary)      →  summary + ratings JSON in detected language
   d. Write {videoId}.md    →  formatted markdown to output folder
   e. md-to-pdf             →  {videoId}.pdf
   f. Update index          →  append Video entry to playlist-index.json
   g. SSE event             →  { type:'step', current, total, title, step }
3. SSE event               →  { type:'done' }
```

On error per video: emit `{ type:'error', videoId, log }`, continue with next video.

---

## Deep-Dive Pipeline

Triggered by `POST /api/videos/[id]/deep-dive`, progress via SSE on `/api/videos/[id]/deep-dive/stream`.

```
1. Read youtubeUrl from playlist-index.json
2. Gemini (deep-dive model)
   ← YouTube URL passed directly via fileData.fileUri (no upload)
   → detailed analysis with ASCII art diagrams for visual content
   → responds in video's language (en or ko)
3. Write {videoId}-deep-dive.md
4. md-to-pdf  →  {videoId}-deep-dive.pdf
5. Update index  →  set deepDiveMd + deepDivePdf fields
```

**Fallback:** If the YouTube URL call fails (private video, quota exceeded), `runDeepDive` refetches the transcript via `fetchTranscript(videoId)` and retries with a transcript-only prompt. The transcript text is not stored in the index — it is always fetched fresh. The log records which mode was used (`url` or `transcript-fallback`).

---

## UI Layout

```
Header
├── Playlist URL input
├── Output folder input  (default: $OUTPUT_FOLDER)
└── [ Fetch & Summarize ] button

Sort Bar  (hover each header to see full name)
└── [ Name | USE | DPT | ORI | RCN | CMP | OVR ↑↓ ]
     USE=Usefulness  DPT=Depth  ORI=Originality
     RCN=Recency  CMP=Completeness  OVR=Overall

Controls
└── ☐ Show Archive

Video List
└── VideoRow
    ├── Title  [EN|KO badge]
    ├── USE:4  DPT:3  ORI:5  RCN:4  CMP:3  OVR:3.8
    └── ☰ Menu
        ├── Open in Obsidian
        ├── View Summary PDF
        ├── Deep Dive
        ├── Open Deep Dive in Obsidian  (disabled if not generated)
        ├── View Deep Dive PDF          (disabled if not generated)
        └── Archive / Unarchive

Deep Dive Overlay
├── Progress bar + step label
├── ✓ Done  or  ✗ Error message
└── [ Show Logs ] → expandable log panel
```

**Visual rules:**
- Archived rows render greyed-out when "Show Archive" is checked
- Sort bar highlights active column with directional arrow
- Disabled menu items are rendered but not clickable

---

## Obsidian Integration

```
obsidian://open?vault={encodeURIComponent(outputFolder)}&file={encodeURIComponent(videoId)}
```

No Obsidian plugin required — standard URI scheme.

**Prerequisite:** The output folder must be opened as an Obsidian vault (File → Open Folder as Vault). Obsidian recognises vaults by their absolute folder path. The `vault` parameter in the URI is the absolute path to the output folder, not the vault name shown in the Obsidian UI. Archived files live under `archived/` which Obsidian indexes normally — archiving keeps them out of the active note list only if the user adds `archived/` to Obsidian's "Excluded files" list, or relies on the app's own Show Archive toggle.

---

## Filesystem Safety

All filesystem operations use two sanitisation rules enforced in `lib/index-store.ts` and `lib/archive.ts`:

1. **outputFolder** — resolved to an absolute path via `path.resolve()`. Any path that resolves outside the user's home directory (`os.homedir()`) is rejected with a 400 error. Symlinks are not followed (use `fs.lstat`, not `fs.stat`).
2. **videoId** — validated against `/^[A-Za-z0-9_-]{1,20}$/` before use in any file path. The YouTube video ID format is `[A-Za-z0-9_-]{11}` so this is a safe superset. Any videoId failing validation returns a 400 error.

These rules apply to all API routes that accept `outputFolder` or `[id]` path segments.

---

## Project File Structure

```
youtube-playlist-summaries-official-plugins/
├── app/
│   ├── page.tsx
│   └── api/
│       ├── videos/route.ts
│       ├── ingest/route.ts
│       ├── ingest/stream/route.ts
│       ├── videos/[id]/deep-dive/route.ts
│       ├── videos/[id]/deep-dive/stream/route.ts
│       ├── videos/[id]/archive/route.ts
│       ├── pdf/[id]/route.ts
│       └── settings/route.ts
├── components/
│   ├── Header.tsx
│   ├── SortBar.tsx
│   ├── VideoList.tsx
│   ├── VideoRow.tsx
│   ├── VideoMenu.tsx
│   └── DeepDiveOverlay.tsx
├── lib/
│   ├── gemini.ts          ← all Gemini API calls (swap here for Vertex AI)
│   ├── youtube.ts         ← YouTube Data API + transcript fetching
│   ├── pipeline.ts        ← ingestion pipeline orchestration
│   ├── index-store.ts     ← read/write playlist-index.json
│   ├── pdf.ts             ← md-to-pdf wrapper
│   └── archive.ts         ← file move logic
├── types/
│   └── index.ts           ← shared TypeScript types
├── docs/
│   ├── design-spec.md     ← this file
│   ├── dev-process.md
│   └── implementation-plan.md
├── .env.local
└── next.config.ts
```

---

## Verification Checklist

1. `npm run dev` → app loads at `localhost:3000`
2. Paste public playlist URL → Fetch & Summarize → SSE progress shows per video
3. Output folder contains `playlist-index.json`, `{videoId}.md`, `{videoId}.pdf`
4. Sort by each column → list reorders correctly
5. ☰ → Open in Obsidian → Obsidian opens the MD file in correct vault
6. ☰ → View Summary PDF → PDF renders in browser tab
7. ☰ → Deep Dive → overlay progress, `{videoId}-deep-dive.md/pdf` created
8. ☰ → Archive → file moves to `archived/`, row greyed when "Show Archive" checked
9. Korean playlist → summary and deep-dive returned in Korean
10. Private video URL for deep-dive → error shown, "Show Logs" reveals fallback log
