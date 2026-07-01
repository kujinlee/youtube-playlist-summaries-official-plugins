# YouTube Playlist Summaries

A Next.js web app that ingests a YouTube playlist, generates AI summaries and multi-dimensional ratings for each video using Gemini, and presents them in a sortable, filterable list. Summaries are saved as Markdown in a local output folder — ready to open directly in Obsidian — and can be opened as styled HTML docs that print or save to PDF from the browser.

## Features

- **Playlist ingestion** — paste a YouTube playlist URL, stream per-video progress via SSE
- **AI summaries** — Gemini generates structured summaries with five quality ratings (usefulness, depth, originality, recency, completeness)
- **Dig deeper** — on-demand, per-section elaboration with slide screenshots, grounded in the video clip
- **Sortable list** — sort by any rating dimension or overall score, ascending or descending
- **HTML docs** — open any summary as a styled, themeable HTML doc; print or save to PDF straight from the browser
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
| HTML docs | `markdown-it` (print / save-to-PDF in browser) |
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
| `GEMINI_DEEPDIVE_MODEL` | Model for dig-deeper section analysis (default: `gemini-2.5-pro`) |
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
   - **Summary doc** — opens the summary as a styled HTML doc (print / save-to-PDF in the browser); dig into any section on demand
   - **Archive / Unarchive** — moves files to/from `archived/` subfolder

## Output folder layout

```
output-folder/
├── playlist-index.json       ← metadata index
├── {videoId}.md              ← summary (Markdown)
├── {videoId}-dig-deeper.md   ← dig-deeper companion (accumulates dug sections)
├── htmls/                    ← cached HTML docs (print / save-to-PDF in browser)
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
    videos/[id]/archive/route.ts  ← POST archive/unarchive
    settings/route.ts             ← GET/POST output folder setting
components/
  Header.tsx                      ← URL/folder inputs + submit
  SortBar.tsx                     ← column sort controls
  VideoList.tsx                   ← list + archive filter
  VideoRow.tsx / VideoMenu.tsx    ← per-video row and action menu
lib/
  gemini.ts                       ← all Gemini API calls
  youtube.ts                      ← YouTube Data API + transcripts
  pipeline.ts                     ← ingestion orchestration
  index-store.ts                  ← read/write playlist-index.json
  archive.ts                      ← file move logic
types/index.ts                    ← shared TypeScript types + Zod schemas
docs/
  design-spec.md                  ← full feature specification
  ADR.md                          ← architecture decision records
  available-skills.md             ← all Claude Code skills/agents/commands with trigger types
```

## Development (Claude Code)

This project is built with Claude Code using a gate-based workflow (brainstorm → spec → plan → TDD → review).

| Doc | Purpose |
|---|---|
| [`docs/available-skills.md`](docs/available-skills.md) | All Claude Code skills, agents, and commands available in this project — invoke strings, trigger type (`auto + /slash`, `/command`, `agent`), and descriptions |
| [`docs/dev-process.md`](docs/dev-process.md) | Phase-by-phase development workflow and per-task checklist |
| [`docs/plugins.md`](docs/plugins.md) | Required plugins, skill conflict resolution, and cleanup guidance |

To regenerate the skills reference after installing or updating plugins, say **"sync docs"** or run `/sync-docs` — the `sync-docs` skill handles it. Or run directly:

```bash
python3 scripts/regen-skills-doc.py
```
