# YouTube Playlist Summaries

A Next.js web app that ingests a YouTube playlist, generates AI summaries and multi-dimensional ratings for each video using Gemini, and presents them in a sortable, filterable list. Summaries are saved as Markdown and PDF files in a local output folder — ready to open directly in Obsidian.

## Features

- **Playlist ingestion** — paste a YouTube playlist URL, stream per-video progress via SSE
- **AI summaries** — Gemini generates structured summaries with five quality ratings (usefulness, depth, originality, recency, completeness)
- **On-demand deep dive** — richer Gemini analysis using native YouTube video understanding (no upload required)
- **Sortable list** — sort by any rating dimension or overall score, ascending or descending
- **PDF export** — every summary and deep dive is saved as a PDF viewable in the browser
- **Obsidian integration** — one-click `obsidian://open` URI to open notes in your vault
- **Archive** — move videos to an `archived/` subfolder; greyed-out rows stay visible when "Show Archive" is checked
- **Bilingual** — summaries are generated in the video's language (English or Korean)

## Tech stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router) + TypeScript |
| Styling | Tailwind CSS |
| AI | Gemini 2.5 Flash / Pro via `@google/generative-ai` |
| YouTube metadata | YouTube Data API v3 |
| Transcripts | `youtube-transcript` |
| PDF generation | `md-to-pdf` |
| Progress streaming | Server-Sent Events (SSE) |
| Testing | Jest + Testing Library + Playwright |

## Prerequisites

- Node.js 18+
- [Gemini API key](https://aistudio.google.com/app/apikey)
- [YouTube Data API v3 key](https://console.cloud.google.com/apis/library/youtube.googleapis.com)
- (Optional) [Obsidian](https://obsidian.md) with the output folder opened as a vault

## Setup

```bash
git clone https://github.com/kujinlee/youtube-playlist-summaries-official-plugins.git
cd youtube-playlist-summaries-official-plugins
npm install
cp .env.local.example .env.local
# Edit .env.local and fill in your API keys and output folder path
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment variables

Copy `.env.local.example` to `.env.local` and set:

| Variable | Description |
|---|---|
| `GEMINI_API_KEY` | Gemini API key |
| `GEMINI_SUMMARY_MODEL` | Model for summaries (default: `gemini-2.5-flash`) |
| `GEMINI_DEEPDIVE_MODEL` | Model for deep dives (default: `gemini-2.5-pro`) |
| `YOUTUBE_API_KEY` | YouTube Data API v3 key |
| `OUTPUT_FOLDER` | Absolute (or relative) path to the output folder |

The output folder is created automatically on first ingest. If you use it as an Obsidian vault, set `OUTPUT_FOLDER` to the vault's absolute path.

## Usage

1. Paste a YouTube playlist URL into the **Playlist URL** field
2. Confirm the **Output folder** path
3. Click **Fetch & Summarize** — a progress bar streams per-video status
4. When done, the video list appears sorted by name
5. Click **☰** on any row to open the per-video menu:
   - **Open in Obsidian** — opens the summary note in Obsidian
   - **View Summary PDF** — renders the PDF in a new browser tab
   - **Deep Dive** — triggers a richer Gemini analysis (streams progress)
   - **Open Deep Dive in Obsidian** / **View Deep Dive PDF** — available after deep dive completes
   - **Archive / Unarchive** — moves files to/from `archived/` subfolder

## Output folder layout

```
output-folder/
├── playlist-index.json       ← metadata index
├── {videoId}.md              ← summary (Markdown)
├── {videoId}.pdf             ← summary (PDF)
├── {videoId}-deep-dive.md    ← deep dive (generated on demand)
├── {videoId}-deep-dive.pdf
└── archived/
    └── ...                   ← archived video files
```

## Testing

```bash
npm test              # Jest unit + component tests (~224 tests, ~17s)
npm run test:e2e      # Playwright E2E tests (~9 tests, ~7s, requires dev server)
```

E2E tests mock all API routes via Playwright's `page.route()` — no real API keys needed. See `docs/ADR.md` for the rationale behind the three-tier test strategy.

## Project structure

```
app/
  page.tsx                        ← main page
  api/
    videos/route.ts               ← GET video list
    ingest/route.ts               ← POST start ingestion
    ingest/stream/route.ts        ← GET SSE progress stream
    videos/[id]/deep-dive/        ← POST + GET stream
    videos/[id]/archive/route.ts  ← POST archive/unarchive
    pdf/[id]/route.ts             ← GET PDF file
    settings/route.ts             ← GET/POST output folder setting
components/
  Header.tsx                      ← URL/folder inputs + submit
  SortBar.tsx                     ← column sort controls
  VideoList.tsx                   ← list + archive filter
  VideoRow.tsx / VideoMenu.tsx    ← per-video row and action menu
  DeepDiveOverlay.tsx             ← SSE-driven deep dive progress
lib/
  gemini.ts                       ← all Gemini API calls
  youtube.ts                      ← YouTube Data API + transcripts
  pipeline.ts                     ← ingestion orchestration
  index-store.ts                  ← read/write playlist-index.json
  pdf.ts                          ← md-to-pdf wrapper
  archive.ts                      ← file move logic
types/index.ts                    ← shared TypeScript types + Zod schemas
docs/
  design-spec.md                  ← full feature specification
  ADR.md                          ← architecture decision records
```
