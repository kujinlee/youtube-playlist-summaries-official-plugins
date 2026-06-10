# Design Spec: Deep-Dive HTML Export (faithful render)

**Date:** 2026-06-09
**Status:** Approved (revised per adversarial review)

> **Adversarial review (Claude-opus fallback; Codex rate-limited until 2026-07-03) — resolved inline.**
> See `docs/reviews/deep-dive-html-spec-review.md`. Resolutions: **B-1** Unicode path regex (fixes
> KO-slug 404 for deep-dive AND the shipped summary path); **H-1** drop the `deepDiveHtml` index field
> so there is no index write on the GET path (no clobber race); **H-2** serve in-memory rendered bytes;
> **H-3** archive deletes cached `htmls/*.html` + clears `summaryHtml`; **H-4** keep the preamble
> (faithful), tested; **M-1/2/3** test `javascript:`-link blocking, pin `source-md`=`deepDiveMd`, CSS
> targets `h1`–`h4`; **L-1** add `@types/markdown-it`. A real Codex pass is still owed before merge.

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

- **Deep-dive artifact only** (`video.deepDiveMd` → `htmls/<base>.html`, where `<base>` already ends in `-deep-dive`).
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
| `lib/html-doc/render-deep-dive.ts` | **Pure** `renderDeepDiveHtml(md) → string`. Strip YAML frontmatter; extract `lang`/`video_id` for `<head>`; render the body with `markdown-it` (`html:false`); wrap in self-contained HTML + CSS (monospace `<pre>`, colored headings `h1`–`h4`, KO serif, readable column). No I/O. |
| `lib/html-doc/generate-deep-dive.ts` | `runDeepDiveHtml(videoId, outputFolder) → string`. Read `video.deepDiveMd`; render; atomic-write `htmls/<base>.html` (where `base = deepDiveMd` minus `.md`, already ending in `-deep-dive`); **return the rendered HTML string**. Does **not** write the index (see review fix H-1). |

### Modified files

| File | Change |
|---|---|
| `app/api/html/[id]/route.ts` | (1) Widen `type` to `summary \| deep-dive`. (2) For deep-dive, serve the cached file, **lazily generating it if the file is missing**, serving the in-memory bytes. (3) **B-1 fix:** widen the path guard regex to Unicode (`/^htmls\/[\p{L}\p{N}._-]+\.html$/u`) so Korean-slug filenames are admitted — this **also fixes the shipped summary path's KO 404**. |
| `components/VideoMenu.tsx` | Add a **"View Deep Dive HTML"** link next to "View Deep Dive PDF", enabled when `deepDiveMd` is set, `target=_blank`. |
| `lib/deep-dive.ts` | On (re)generation, delete any stale `htmls/<base>.html` so the next view regenerates from the new markdown. (No index field to clear.) |
| `lib/archive.ts` | **H-3 fix:** on archive/unarchive, delete the video's cached `htmls/*.html` (summary + deep-dive) and clear `summaryHtml`. Fixes the deep-dive orphan AND the pre-existing summary stale-serve-after-archive gap. |

**No `deepDiveHtml` index field** (review fix H-1): the lazy model needs none — the menu link always
shows when `deepDiveMd` exists, and the serve route keys purely on the cache file's existence. So
there is **no `types/index.ts` change** and **no index write on the GET path** (eliminating the
read-modify-write clobber race that generating-inside-a-GET would otherwise create against concurrent
Archive/Deep-Dive writes).

**Notably absent** (vs the summary feature): no Gemini, no POST route, no SSE stream, no status bar,
no `app/page.tsx` change, no index field.

### Data flow (lazy generate-on-view)

1. Click **View Deep Dive HTML** → `GET /api/html/<id>?outputFolder=…&type=deep-dive` (new tab).
2. Serve route: validate → `readIndex` → deep-dive branch → `base = deepDiveMd` minus `.md`.
3. Cached `htmls/<base>.html` exists on disk → read + serve (`text/html; charset=utf-8`).
4. Else if `deepDiveMd` exists → `runDeepDiveHtml` (render + atomic write) → serve the **returned
   in-memory bytes** (no write-then-re-read — review fix H-2).
5. Else → 404.

Concurrent first-views both render identical bytes and atomic-write (temp→rename); last rename wins,
harmless. No index mutation, so no lock is needed.

---

## Contracts

### Output file format

- **Filename:** `htmls/<base>.html`, where `<base>` = `video.deepDiveMd` minus `.md` (the
  deep-dive filename already ends in `-deep-dive`, so e.g. `<slug>-deep-dive.md` →
  `htmls/<slug>-deep-dive.html` — NOT a doubled `-deep-dive-deep-dive`). Mirrors how the PDF is
  `pdfs/<slug>-deep-dive.pdf`.
- **Self-contained:** all CSS inlined in a `<style>` block.
- **`<head>` provenance:** `<meta name="generator" content="deep-dive-html v1">`,
  `<meta name="source-md" content="…">` = `video.deepDiveMd` **verbatim** (review fix M-2),
  `<meta name="video-id" content="…">`, `<html lang="…">` from frontmatter.
- **CSS:** monospace `<pre>`/`<code>` (so ` ```ascii ` diagrams don't collapse); colored headings
  targeting the levels that actually occur (`h1`–`h4` — the deep-dive body uses `###`/`####`, review
  fix M-3); a **sans-serif body stack with Korean coverage** (`'Apple SD Gothic Neo','Malgun Gothic'`)
  — sans (not the summary's magazine serif) suits a long-form technical article with code/diagrams;
  readable max-width column. (Deviates intentionally from the summary feature's serif; review fix L-2.)
- **Path guard (B-1 fix):** the serve-route path-traversal regex is widened to Unicode
  `/^htmls\/[\p{L}\p{N}._-]+\.html$/u` so Korean-slug filenames pass; the resolved-path containment
  check (`path.resolve` + prefix) remains the real traversal backstop.

### URL contract

| Component | Link text | Full URL (all params) |
|---|---|---|
| VideoMenu | **View Deep Dive HTML** (link, `target=_blank`) | `GET /api/html/<id>?outputFolder=<folder>&type=deep-dive` |

### Serve route (`type=deep-dive`)

- `type` validation widens to `summary | deep-dive`; anything else → 400 (the summary path is
  unchanged — keep the "summary still works" assertion).
- Resolve `base = deepDiveMd.replace(/\.md$/,'')` (already ends in `-deep-dive`), cache path
  `htmls/<base>.html`.
- **Serve-or-generate keyed on the FILE existing on disk** (there is no `deepDiveHtml` flag): if the
  cache file is present → serve it; else if `deepDiveMd` exists → `runDeepDiveHtml` (render + atomic
  write) → serve the returned bytes; else → 404.
- Widened-Unicode path regex + resolved-path containment guard; `text/html; charset=utf-8`.
- **400 vs 404 corners:** missing `outputFolder` → 400; invalid/missing `type` → 400; path-guard
  failure → 400; video not found → 404; `deepDiveMd` null → 404; render throw → 500 (nothing cached).

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

### Security — raw-HTML escaping + link safety

- `markdown-it` is configured with `html: false`, so raw HTML embedded in the (Gemini-generated)
  deep-dive markdown is escaped/rendered inert rather than passed through. Explicitly unit-tested:
  a `<script>` and an `<img onerror=…>` in the source markdown render as inert text.
- **Link safety (M-1):** the design relies on `markdown-it`'s default `validateLink`, which blocks
  `javascript:`/`vbscript:`/`data:` (non-image) hrefs. Named here explicitly and unit-tested: a
  `[x](javascript:alert(1))` link renders without an executable href.
- Threat model is modest (the user views their own locally-generated content), but escaping + link
  validation are cheap and tested rather than assumed.

### Preamble (faithful render decision — H-4)

The Gemini deep-dive body often opens with a conversational preamble line (e.g. "Of course. Here is
a comprehensive deep-dive analysis…"). `lib/deep-dive.ts` strips only a leading H1, not this line.
**Decision: keep it** — the render is faithful and stays consistent with the PDF and the Obsidian
`.md`, which show the same body. (Suppressing the preamble belongs in the deep-dive *generation*
prompt, not this renderer.) Tested: the renderer strips frontmatter and renders the body intact
without crashing on the preamble.

### Staleness & archive

- **Regeneration:** when `lib/deep-dive.ts` (re)writes `deepDiveMd`, it deletes any stale
  `htmls/<base>.html`; the next view regenerates from the new markdown. (No index field to clear.)
- **Archive (H-3):** `lib/archive.ts` deletes the video's cached `htmls/*.html` (summary + deep-dive)
  on archive/unarchive and clears `summaryHtml`, so an archived video never serves HTML whose source
  `.md` has moved. (Also closes the pre-existing summary stale-serve-after-archive gap.)

---

## Testing (TDD layers)

- **Unit — `render-deep-dive.ts`:** frontmatter stripped; headings (`h1`–`h4`) / lists rendered;
  ` ```ascii ` block → `<pre><code>` with content byte-preserved; raw-HTML injection escaped
  (`<script>`, `<img onerror>`); **`javascript:` link href dropped** (M-1); preamble line kept +
  body intact (H-4); KO content; self-contained + provenance meta (`source-md` = `deepDiveMd`);
  `<head>` `lang` from frontmatter.
- **Unit — `generate-deep-dive.ts`:** writes `htmls/<base>.html` (e.g. `…-deep-dive.html`, no
  doubled suffix), **returns the HTML string**, atomic write, **no index write**; throws when
  `deepDiveMd` missing.
- **Unit — `lib/deep-dive.ts`:** regeneration removes the stale `htmls/<base>.html`.
- **Unit — `lib/archive.ts`:** archive removes the video's cached `htmls/*.html` and clears
  `summaryHtml`.
- **Route — serve (`app/api/html/[id]`):** deep-dive cached → 200; **missing → lazy-generates → 200**;
  no `deepDiveMd` → 404; invalid `type` → 400; traversal value → not 200; **Korean-slug filename →
  200, not 404 (B-1)** — for BOTH the deep-dive AND the summary path; the existing summary path still
  works.
- **Component — VideoMenu:** "View Deep Dive HTML" enabled when `deepDiveMd` set / disabled when not;
  href carries `outputFolder` + `type=deep-dive`.
- **Integration:** a real deep-dive `.md` (incl. a Korean-slug one) → serve route lazily renders →
  asserts an ASCII diagram block is present and monospace-wrapped (`<pre>`), frontmatter absent, and
  the KO-filename case returns 200.
- **E2E (Playwright, route boundary per `dev-process`):** click "View Deep Dive HTML" → tab serves
  HTML; assert both link params (`outputFolder` + `type=deep-dive`). Fixture set includes a video
  with `deepDiveMd` set and one without.

### Dependency

Add `markdown-it` (runtime) + `@types/markdown-it` (dev) — both currently absent. Plain Node
libraries, unaffected by the project's modified-Next.js note (per `AGENTS.md`).

---

## Out of Scope

- Summary-and-deep-dive combined views, or a deep-dive skim/TL;DR box (the hybrid option — deferred).
- Regenerating the corpus or changing deep-dive generation prompts.
- An explicit "Regenerate Deep Dive HTML" control (lazy-gen + clear-on-deep-dive-regen covers it).
