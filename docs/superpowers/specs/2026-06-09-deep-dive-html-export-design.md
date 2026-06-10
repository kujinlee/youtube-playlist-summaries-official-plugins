# Design Spec: Deep-Dive HTML Export (faithful render)

**Date:** 2026-06-09
**Status:** Approved

---

## Problem

The summary HTML export ("magazine-skim", shipped) reprocesses a dense prose summary into a
scannable lead+bullets page via a Gemini transform. A **deep-dive** artifact is the opposite
kind of document: it is the in-depth analysis a user reads fully, and it contains high-value
` ```ascii ` ASCII-art diagrams plus richly-structured headings/lists. Running the magazine-skim
transform on it would **destroy** the diagrams and the depth — the transform is the wrong model.

There is currently no on-screen, colorable HTML view of a deep-dive (only the `.md` in Obsidian
and the PDF).

## Goal

Add a **"View Deep Dive HTML"** menu action that renders a video's deep-dive `.md` **faithfully**
to a self-contained, styled HTML page — every section, list, and especially the ` ```ascii `
diagrams preserved in monospace, with colored headings and a Korean serif fallback. No LLM, no
content loss. It is "the PDF, but as a screen-readable, colorable HTML page."

### Scope

- **Deep-dive artifact only** (`video.deepDiveMd` → `htmls/<base>-deep-dive.html`).
- **Faithful markdown→HTML render** — no Gemini, no transform, no content restructuring.
- **Lazy generate-on-view** — no Generate button, no SSE job, no status bar.

---

## Deep-dive artifact structure (observed)

Unlike the summary `.md`, a deep-dive `.md` (produced by `lib/deep-dive.ts`) has:
- YAML frontmatter (incl. `deep-dive` tag, `video_id`, `lang`, `type`, `audience`, `score`).
- `# {title} (Deep Dive)` H1 + a `**Channel:** … | **Duration:** … | **URL:** …` meta line + `---`.
- A free-form Gemini body using `### **N. Heading**` (H3, bold, numbered) sections — **not** `## N.`,
  and **no** `> [!summary]` callout.
- Multiple ` ```ascii ` fenced ASCII-art diagrams (the highest-value content).

The summary parser/renderer assume `## N.` sections + a callout, so they do **not** apply here.

---

## Approach

**Selected: faithful markdown→HTML render via `markdown-it` (`html: false`), generated lazily
on first view and cached.**

- **Engine — `markdown-it` (new dependency), `html: false`.** Renders fenced code to
  `<pre><code>` (monospace ASCII preserved). With `html: false`, raw HTML in the (Gemini-generated)
  markdown is escaped/ignored — safe by default. Chosen over `marked` (passes raw HTML through →
  needs a separate sanitizer) and over reusing `md-to-pdf`'s HTML (spins Puppeteer — heavy/slow).
- **Lazy generate-on-view.** The menu is a single link; the serve route renders + caches on first
  view if missing. No Gemini means the render is sub-second, so no progress UI is warranted.
- **No job lock.** The render is deterministic and the write is atomic (temp→rename), so concurrent
  first-views just write identical bytes — last rename wins, harmless. (Contrast: the summary
  feature needed a per-video job lock because the Gemini transform is slow and non-idempotent.)

Rejected: the magazine-skim transform (destroys diagrams/depth); a bespoke full-markdown renderer
(re-implements markdown, error-prone); an explicit Generate+SSE flow (heavyweight for a sub-second
operation).

---

## Architecture

### New files

| File | Responsibility |
|---|---|
| `lib/html-doc/render-deep-dive.ts` | **Pure** `renderDeepDiveHtml(md) → string`. Strip YAML frontmatter; extract `lang`/`video_id` for `<head>`; render the body with `markdown-it` (`html:false`); wrap in self-contained HTML + CSS (monospace `<pre>`, colored headings, KO serif, readable column). No I/O. |
| `lib/html-doc/generate-deep-dive.ts` | `runDeepDiveHtml(videoId, outputFolder) → string`. Read `video.deepDiveMd`; render; atomic-write `htmls/<base>.html` (where `base = deepDiveMd` minus `.md`, already ending in `-deep-dive`); set `deepDiveHtml` in the index; return the relative path. |

### Modified files

| File | Change |
|---|---|
| `types/index.ts` | Add `deepDiveHtml: z.string().nullable().optional()` to `VideoSchema`. |
| `app/api/html/[id]/route.ts` | Accept `type=deep-dive` (in addition to `summary`); for deep-dive, serve the cached file, **lazily generating it if the file is missing**. |
| `components/VideoMenu.tsx` | Add a **"View Deep Dive HTML"** link next to "View Deep Dive PDF", enabled when `deepDiveMd` is set, `target=_blank`. |
| `lib/deep-dive.ts` | On (re)generation, set `deepDiveHtml: null` and delete any stale `htmls/<base>.html`, so the next view regenerates from the new markdown. |

**Notably absent** (vs the summary feature): no Gemini, no POST route, no SSE stream, no status bar,
no `app/page.tsx` change.

### Data flow (lazy generate-on-view)

1. Click **View Deep Dive HTML** → `GET /api/html/<id>?outputFolder=…&type=deep-dive` (new tab).
2. Serve route: validate → `readIndex` → deep-dive branch.
3. Cached file exists on disk → serve (`text/html; charset=utf-8`).
4. Else if `deepDiveMd` exists → `runDeepDiveHtml` (render + atomic write + set `deepDiveHtml`) → serve.
5. Else → 404.

---

## Contracts

### Output file format

- **Filename:** `htmls/<base>.html`, where `<base>` = `video.deepDiveMd` minus `.md` (the
  deep-dive filename already ends in `-deep-dive`, so e.g. `<slug>-deep-dive.md` →
  `htmls/<slug>-deep-dive.html` — NOT a doubled `-deep-dive-deep-dive`). Mirrors how the PDF is
  `pdfs/<slug>-deep-dive.pdf`.
- **Self-contained:** all CSS inlined in a `<style>` block.
- **`<head>` provenance:** `<meta name="generator" content="deep-dive-html v1">`,
  `<meta name="source-md" content="<base>.md">`, `<meta name="video-id" content="…">`,
  `<html lang="…">` from frontmatter.
- **CSS:** monospace `<pre>`/`<code>` (so ` ```ascii ` diagrams don't collapse), colored headings,
  Korean serif fallback (`'Nanum Myeongjo','Apple SD Gothic Neo'`), readable max-width column.
- The existing serve-route path-traversal regex `/^htmls\/[A-Za-z0-9._-]+\.html$/` already admits the
  `-deep-dive` suffix (hyphens allowed).

### URL contract

| Component | Link text | Full URL (all params) |
|---|---|---|
| VideoMenu | **View Deep Dive HTML** (link, `target=_blank`) | `GET /api/html/<id>?outputFolder=<folder>&type=deep-dive` |

### Serve route (`type=deep-dive`)

- `type` validation widens to `summary | deep-dive`; anything else → 400 (the summary path is
  unchanged).
- Resolve `base = deepDiveMd.replace(/\.md$/,'')` (already ends in `-deep-dive`), cache path
  `htmls/<base>.html`.
- **Serve-or-generate keyed on the FILE existing on disk** (not the `deepDiveHtml` flag): if present
  → serve; else if `deepDiveMd` exists → generate + serve; else → 404. (A flag set but file deleted
  still regenerates — no 404 on a missing-but-flagged file.)
- Same path-traversal guard (regex + resolved-path containment) and `text/html; charset=utf-8`.

### Menu state

| State | Menu shows |
|---|---|
| `deepDiveMd` set | **View Deep Dive HTML** (enabled link) |
| `deepDiveMd` absent | disabled item (mirrors the existing "Open Deep Dive in Obsidian" / "View Deep Dive PDF" disabled pattern) |

---

## Error Handling

- `markdown-it` render throw (unlikely) → serve route returns 500; nothing cached.
- Missing `deepDiveMd` → 404; missing `outputFolder` → 400; invalid/missing `type` → 400; path-guard
  failure → 400/404, never 200.
- Atomic write: temp file (`crypto.randomUUID()` suffix) → `rename`, mirroring the summary orchestrator.

### Security — raw-HTML escaping

`markdown-it` is configured with `html: false`, so raw HTML embedded in the (Gemini-generated)
deep-dive markdown is escaped/rendered inert rather than passed through. Explicitly unit-tested:
a `<script>` and an `<img onerror=…>` in the source markdown render as inert text.

---

## Testing (TDD layers)

- **Unit — `render-deep-dive.ts`:** frontmatter stripped; headings/lists rendered; ` ```ascii `
  block → `<pre><code>` with content byte-preserved; raw-HTML injection escaped (`<script>`,
  `<img onerror>`); KO content; self-contained + provenance meta; `<head>` `lang` from frontmatter.
- **Unit — `generate-deep-dive.ts`:** writes `htmls/<base>.html` (e.g. `…-deep-dive.html`, no
  doubled suffix), sets `deepDiveHtml`, atomic; throws when `deepDiveMd` missing.
- **Unit — `lib/deep-dive.ts`:** regeneration sets `deepDiveHtml: null` and removes the stale file.
- **Route — serve (`app/api/html/[id]`):** deep-dive cached → 200; **missing → lazy-generates → 200**
  (and `deepDiveHtml` now set); no `deepDiveMd` → 404; invalid `type` → 400; traversal value → not
  200; the existing summary path still works.
- **Component — VideoMenu:** "View Deep Dive HTML" enabled when `deepDiveMd` set / disabled when not;
  href carries `outputFolder` + `type=deep-dive`.
- **Integration:** a real deep-dive `.md` → serve route lazily renders → asserts an ASCII diagram
  block is present and monospace-wrapped (`<pre>`), and frontmatter is absent from the body.
- **E2E (Playwright, route boundary per `dev-process`):** click "View Deep Dive HTML" → tab serves
  HTML; assert both link params (`outputFolder` + `type=deep-dive`). Fixture set includes a video
  with `deepDiveMd` set and one without.

---

## Out of Scope

- Summary-and-deep-dive combined views, or a deep-dive skim/TL;DR box (the hybrid option — deferred).
- Regenerating the corpus or changing deep-dive generation prompts.
- An explicit "Regenerate Deep Dive HTML" control (lazy-gen + clear-on-deep-dive-regen covers it).
