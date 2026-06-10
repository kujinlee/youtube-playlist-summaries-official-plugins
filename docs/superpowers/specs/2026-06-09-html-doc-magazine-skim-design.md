# Design Spec: HTML Doc Export (Magazine-Skim)

**Date:** 2026-06-09  
**Status:** Approved

---

## Problem

Video summaries are dense prose. Even rendered as styled HTML, the numbered `##` sections
read as a "wall of text" — styling alone cannot break a paragraph into scannable points. A
prototype (four switchable presentations of `deep-dive-into-llms-like-chatgpt.md`, 2026-06-09)
confirmed the wall-of-text problem is a **content-structure** problem, not a styling one: only
restructuring prose into *lead sentence + bullets* makes it scannable.

## Goal

Add an **HTML doc** export option to the video action menu, alongside the existing PDF export.
On demand, it reprocesses a video's existing summary `.md` into a **"Magazine-skim"** HTML page:
serif headings, ghosted section numerals, a colored lead sentence per section, and muted
supporting bullets (prototype variant **V4**).

This is a **pilot** for an export-time transform. If it proves valuable, a follow-up will change
the Gemini summary-generation prompt to emit this structure natively (improving Obsidian + PDF +
HTML at once) and regenerate the corpus. That follow-up is **out of scope here.**

### Scope (pilot)

- **Summary `.md` only** — not the deep-dive artifact (different structure; separate follow-up).
- **Export-time transform** of existing files — does **not** touch the ingest pipeline or the
  Gemini summary prompt.

---

## Approach

**Approach selected: Structured transform + pure-TS renderer (Approach 1).**

Gemini returns **structured JSON** (sections → lead + bullets), Zod-validated — matching the
existing `generateSummary` convention. A **pure** function renders that model into self-contained
V4 HTML. No Pandoc (it was only a feasibility probe; shipping it would add a runtime system
dependency and cede layout control).

Rejected:
- **Approach 2 (markdown-rewrite → Pandoc + Lua filter):** adds `pandoc` as an app runtime
  dependency, gives poor control over the V4 layout (ghost numerals, per-section structure), and
  uses two lossy text passes.
- **Approach 3 (two-pass transform + separate render service):** overkill for a pilot.

### Caching model

**Generate-once, cache, explicit regenerate.** First generation writes `htmls/<baseName>.html`
into the playlist folder and records `summaryHtml` in `playlist-index.json`. The menu then offers
**View** (instant, serves the cached file — no LLM) and **Regenerate** (re-runs the transform).
This mirrors the PDF mental model and places the HTML in the Obsidian vault. A cached file is
**always** the good bulleted version (see Error Handling — hard-fail, no partial cache).

---

## Architecture

### New files

| File | Purpose |
|---|---|
| `lib/html-doc/parse.ts` | Deterministic parser: summary `.md` → `{ meta, tldr, takeaways, sections[] }`. No LLM. |
| `lib/html-doc/transform.ts` | Gemini call: `[{ title, prose }]` → `MagazineModel` (Zod-validated). Only non-deterministic piece. |
| `lib/html-doc/render.ts` | **Pure** `renderMagazineHtml(parsed, transformed) → string`. Self-contained V4 HTML. No I/O. |
| `lib/html-doc/generate.ts` | Orchestrator (mirrors `lib/deep-dive.ts`): parse → transform → render → atomic-write → update index → emit progress. |
| `app/api/videos/[id]/html-doc/route.ts` | `POST { outputFolder }` → start job, return `{ jobId }`. |
| `app/api/videos/[id]/html-doc/stream/route.ts` | SSE progress stream (`?jobId=`). |
| `app/api/html/[id]/route.ts` | `GET ?outputFolder=&type=summary` → serve cached `htmls/<baseName>.html` as `text/html`. |

### Modified files

| File | Change |
|---|---|
| `types/index.ts` | Add `summaryHtml?: string` to `Video`; add new `ProgressEvent` step labels. |
| `components/VideoMenu.tsx` | Add HTML menu items (see Menu States). |
| `components/VideoRow.tsx` (+ existing deep-dive client handler) | Wire POST → SSE → open-tab flow, mirroring the deep-dive trigger. |

### Key separation

`transform.ts` (impure, LLM) is isolated from `render.ts` (pure, deterministic) and `parse.ts`
(pure, deterministic). Rendering and parsing are exhaustively unit-testable without Gemini; the
transform is tested against a mocked `lib/gemini` (the project's mocking boundary).

### Data flow (first generation)

1. User clicks **Generate HTML doc** → `POST /api/videos/<id>/html-doc { outputFolder }` → `{ jobId }`.
2. Client subscribes to the SSE stream; status bar shows progress.
3. Orchestrator: read `video.summaryMd` → `parse.ts` extracts meta + tldr + takeaways + sections
   → `transform.ts` (Gemini) returns lead+bullets per section → `render.ts` → atomic-write
   `htmls/<baseName>.html` → set `summaryHtml` in `playlist-index.json` → emit `done`.
4. On `done`, client opens `GET /api/html/<id>?outputFolder=…&type=summary` in a new tab and
   refreshes the row (menu flips to **View / Regenerate**).
5. Subsequent **View** clicks hit the GET serve route directly — instant, no LLM.

**Deliberate split from PDF:** meta (title, channel, duration, URL) and the TL;DR / Key Takeaways
are parsed **deterministically from the markdown**, never from the LLM. Only the numbered-section
*prose* goes through the transform. This keeps titles, links, and the existing quick-reference exact.

---

## Contracts

### Parsing (`parse.ts`, deterministic)

Extracts, without the LLM:
- **Meta:** `title` (`# …`), `channel`/`duration`/`URL` (bold header line), `lang`, `videoId` (frontmatter).
- **TL;DR + Key Takeaways:** read out of the existing `> [!summary]` callout (already structured).
- **Sections:** split on `## ` into `{ numeral, title, prose }`. Strip any leading `N. ` ordinal
  from the heading into `numeral` (e.g. `## 1. The Foundation…` → `numeral: "1"`,
  `title: "The Foundation…"`). Headings without an ordinal (e.g. `## Conclusion`) get
  `numeral: null` and render with **no** ghost numeral — avoiding double-numbering, since V4
  renders the numeral separately from the title.

If the callout is absent/unparseable, `tldr`/`takeaways` are `null` and the rendered callout block
is omitted (render handles the optional case). Zero `##` sections → hard fail (nothing to transform).

### Transform (`transform.ts`)

- **Input:** `[{ title, prose }]` (numbered sections).
- **Model:** `gemini-2.5-flash`, `responseMimeType: application/json`.
- **Output — Zod `MagazineModelSchema`:**
  ```ts
  { sections: Array<{
      lead: string,                                   // ≤25-word thesis of the section
      bullets: Array<{ label: string, text: string }> // 3–7 per section; label = 1–3 words
  }> }
  ```
- **Prompt rules:** keep section order; one `lead` per section; 3–7 bullets each; **faithful to
  the source — introduce no new facts**.
- **Validation guard:** `sections.length` **must equal** input length, else hard fail (no partial render).

### Output file format

- **Filename:** `htmls/<baseName>.html`, `<baseName>` = `video.summaryMd` minus `.md`.
  Example: `summaryMd: "deep-dive-into-llms-like-chatgpt.md"` → `htmls/deep-dive-into-llms-like-chatgpt.html`.
  (Mirrors `pdfs/<baseName>.pdf`.)
- **`<head>` provenance:** `<title>` = video title; `<meta charset>` + viewport;
  `<meta name="generator" content="magazine-skim v1">`; `<meta name="source-md" content="<baseName>.md">`;
  `<meta name="video-id" content="…">`.
- **Self-contained:** all CSS inlined in a `<style>` block (portable, Obsidian-openable, no external assets).
- **Korean serif fallback:** V4 uses a serif stack; Georgia has no Hangul glyphs, so the stack
  includes `'Nanum Myeongjo', 'Apple SD Gothic Neo'` (≈half the corpus is KO).
- **Annotated sample body:**
  ```html
  <body><article class="v4">
    <h1 class="doc-title">Deep Dive into LLMs like ChatGPT</h1>
    <p class="doc-meta">Andrej Karpathy · 3:31:24 · score 4.8</p>     <!-- parsed meta -->
    <div class="callout">…TL;DR + Key Takeaways (parsed, not transformed)…</div>
    <section>
      <span class="ghost">1</span>
      <h2>The Foundation: Data and Tokenization</h2>
      <p class="lead">An LLM starts as raw internet text…</p>          <!-- transform.lead -->
      <ul><li><strong>Source:</strong> Common Crawl…</li>…</ul>        <!-- transform.bullets -->
    </section>
    …
    <footer>Skim view generated from <code>…-chatgpt.md</code> · full text in the source note</footer>
  </article></body>
  ```
  The footer states plainly that this is a lossy skim view and points back to the `.md`.

### URL contracts

| Component | Action / link text | Full URL (all params) |
|---|---|---|
| VideoMenu | **View HTML doc** (link, `target=_blank`) | `GET /api/html/<id>?outputFolder=<folder>&type=summary` |
| VideoMenu | **Generate / Regenerate HTML doc** (action) | `POST /api/videos/<id>/html-doc` — body `{ outputFolder }` |
| Client | SSE subscribe | `GET /api/videos/<id>/html-doc/stream?jobId=<jobId>` |

### Overlay / status-bar dismissal (non-blocking)

| Mechanism | Trigger | Result |
|---|---|---|
| Progress | job `start`/`step` | Status bar "Generating HTML doc…"; user keeps working |
| Auto-open + dismiss | `done` | Opens View URL in new tab; status bar clears |
| Error persist + manual ✕ | `error` | Status bar shows error message; stays until dismissed; **no file written** |

### Menu states (`summaryHtml` null vs set)

| State | Menu shows |
|---|---|
| `summaryMd` absent | HTML items hidden/disabled (nothing to transform) |
| `summaryMd` set, `summaryHtml` null | **Generate HTML doc** (enabled) |
| `summaryHtml` set | **View HTML doc** (link) + **Regenerate HTML doc** (action) |
| Job running for this video | **Generating…** (disabled), prevents double-submit |

---

## Error Handling

- Transform error / malformed JSON / Zod fail / **section-count mismatch** → emit `error`, write
  nothing, index untouched, menu stays at *Generate*. (Hard-fail; no degraded/partial cache.)
- `summaryMd` missing on disk → `error` ("source note not found").
- Reuse `assertOutputFolder` + `assertVideoId`. Serve route returns 400 (bad params) / 404
  (`summaryHtml` unset or file gone).
- **Atomic write:** temp file → `rename`, mirroring the PDF caller.
- **Concurrency:** if a job for this video is already live, return that `jobId` rather than
  starting a second.

### Security — HTML escaping

The prototype treated content as trusted (`esc = identity`). Production **must HTML-escape all
transform output** (`lead`, `label`, `text`) and parsed meta before interpolation — it is
LLM-generated text inserted into HTML. Explicitly unit-tested (a bullet containing
`<script>` / `&` / `"` renders inert).

---

## Testing (TDD layers)

- **Unit — `render.ts` (pure, the bulk):** model → HTML; cases: normal, **KO content**, missing
  takeaways/callout, escaping (`<`, `&`, `"`), ghost numerals, footer, single section.
- **Unit — `parse.ts`:** meta/callout/section extraction; edge cases: no callout, zero `##`
  sections, baseName derivation.
- **Unit — `transform.ts` (mocked `lib/gemini`):** valid response; count-mismatch → throw;
  malformed JSON → throw; Zod-invalid → throw.
- **Unit — `generate.ts` (mocked transform + fs):** correct path/index update, atomic write,
  progress events; hard-fail path writes nothing.
- **API tests (mock at lib boundary):** POST → `jobId`; serve route 200/400/404; SSE event shape.
- **Component (`@testing-library`):** all four VideoMenu states.
- **E2E (Playwright, Gemini mocked at API boundary):** click → generate → tab opens; fixtures
  include a **KO video** and both `summaryHtml` null *and* set; assert **all** params on the View
  link (`outputFolder` + `type`); status-bar dismissal paths.

---

## Out of Scope

- Deep-dive artifact HTML export (follow-up).
- Changing the Gemini summary-generation prompt / regenerating the corpus (follow-up, contingent
  on this pilot proving valuable).
- Graceful degradation to prose on transform failure (deferred; hard-fail for now).
- Bullets + collapsible full-prose view (deferred; bullets-only for now).
