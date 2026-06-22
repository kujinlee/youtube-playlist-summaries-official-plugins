# Deep-Dive & Summary HTML Doc: Timestamp, Gold, and URL Refinements

**Date:** 2026-06-21
**Branch:** `fix/doc-timestamp-gold-url`
**Status:** Design — approved for planning

## Problem

Three rendering issues surfaced while reviewing generated HTML docs (screenshot of a Deep Dive doc):

1. **Deep-dive timestamps are gold and lead the paragraph.** The `▶ [label](url)` line sits at the
   front of each section's first paragraph and is colored gold. The summary doc already renders the
   same information far more cleanly — a muted, parenthesized link trailing the section title. The two
   docs should match.

2. **The gold emphasis block is too verbose.** CSS rule `.dd h2 + p { color: var(--gold) }` paints the
   *entire* first paragraph after every heading gold. Gold is meant to emphasize a punchy lead-in; when
   the whole (often long) paragraph is gold, the emphasis loses its effect.

3. **The original-video URL is missing / not clickable.** The summary doc parses the URL
   (`parse.ts` → `parsed.url`) but never renders it. The deep-dive doc prints the URL as plain text
   (markdown-it has `linkify` off), so it is not clickable. Both docs should show the full URL as a
   clickable link in the meta line.

All three are **rendering-layer** fixes. The source `.md` files already contain every needed value
(timestamps, URL, prose) — **no Gemini regeneration is required.** A plain re-render of each doc applies
the fixes.

## Scope

- `lib/html-doc/render.ts` — summary renderer (URL only).
- `lib/html-doc/render-deep-dive.ts` — deep-dive renderer (timestamp relocation, gold scoping, URL).
- No changes to Gemini prompts, the markdown writers (`write-doc.ts`), the index, or the serve routes.
- Existing re-render paths (`reRenderDeepDiveHtml`, summary re-render) already read from `.md`, so they
  pick up the new rendering automatically.

## Decisions (locked with user)

| # | Decision |
|---|----------|
| 1 | Deep-dive timestamp → muted, parenthesized, **trailing the `<h2>` title** — identical to the summary's `.ts` style. Same href/label the `.md` already encodes; nothing re-derived. |
| 2 | Gold → **first sentence only** of each section's lead paragraph (heuristic split). The rest of the lead is normal ink. |
| 3 | Video link → **full clickable URL** (`https://www.youtube.com/watch?v=…`) in the meta line of **both** docs. |

## Design

### Change A — Summary URL (`render.ts`)

`metaLine` currently joins `[channel, duration]`. Append the URL as a clickable full-URL link when
present and well-formed:

```
Dan Blumberg · 42:13 · https://www.youtube.com/watch?v=1zYbDymqg_g   ← the URL is an <a>
```

- Build the link only when `parsed.url` matches `^https?://` (reject `javascript:`, `data:`, etc.).
- `esc()` the href and the visible text.
- Render as `<a href="…" target="_blank" rel="noopener noreferrer">…full url…</a>`.
- CSS: add `.doc-meta a { color: inherit; text-decoration: none }` and
  `.doc-meta a:hover { text-decoration: underline }` so the link reads as muted meta text, underlining
  on hover.

### Change B — Deep-dive URL (`render-deep-dive.ts`)

The standardized header line (written by `write-doc.ts`) is:

```
**Channel:** … | **Duration:** … | **URL:** https://www.youtube.com/watch?v=…
```

Before rendering, rewrite **only that header occurrence** so markdown-it produces a real link:

```
**URL:** https://…   →   **URL:** [https://…](https://…)
```

- Regex targets `**URL:** <url>` with an `https?://` URL; one occurrence (the header).
- No global `linkify` flip — body rendering stays byte-for-byte unchanged except for this line.

### Change C — Deep-dive section restructure (`render-deep-dive.ts`)

Replace the "dump the whole body through markdown-it" approach with **structured section rendering**
for the body, mirroring the summary's section model. The renderer:

1. Strips frontmatter (unchanged).
2. Splits the body into a **preamble** (everything before the first `## ` heading — our H1, meta line,
   `---`) and a list of **sections** (each starting at a `## ` heading). Splitting is **fence-aware**:
   a `## ` line inside a ```` ``` ```` / `~~~` fence does not start a section (same rule as `parse.ts`).
3. Renders the preamble with `md.render` (after Change B's URL rewrite).
4. For each section:
   - **Heading + timestamp.** Parse the heading text. Extract the leading `▶ [label](url)` line from the
     section body using the **same rules as the summary** (`parse.ts` / `extractTimeRange`): only the
     first non-blank line may carry it; a well-formed `▶ [label](url)` yields a trailing link; a
     malformed `▶ …` line is consumed (removed from prose) but yields no link. Emit:
     ```html
     <h2>Title <a class="ts" href="URL" target="_blank" rel="noopener noreferrer">(LABEL)</a></h2>
     ```
     When no `▶` line is present (e.g. a video-only deep dive with no transcript), emit just `<h2>Title</h2>`.
   - **Lead paragraph + gold first sentence.** Take the first prose paragraph (lines up to the first
     blank line). Split off its first sentence with a heuristic terminator regex
     (`.!?。！？` followed by whitespace or end-of-string). Emit:
     ```html
     <p class="lead"><span class="lead-accent">FIRST SENTENCE</span> REST…</p>
     ```
     The first sentence is inline-rendered via `md.renderInline` (preserves inline bold/links/code); the
     remainder is inline-rendered too. If there is no terminator, the whole (short) paragraph is the
     first sentence and is fully gold.
   - **Rest of section.** Everything after the first paragraph is rendered with `md.render` (preserves
     h3/h4, lists, blockquotes, code blocks).
5. CSS: **remove** `.dd h2 + p { … color: var(--gold) … }`; **add** `.dd .lead` (the prior lead sizing —
   `font-size:1.02rem; line-height:1.55; margin:.3em 0 .9em; max-width:92%`, color now normal `--ink`)
   and `.dd .lead-accent { color: var(--gold); font-weight:400 }`. Gold now lands only on the opening
   sentence.

The `.ts` CSS class (muted, `font-size:.85rem`, `white-space:nowrap`, underline-on-hover) is added to
the deep-dive stylesheet, copied from the summary's `render.ts` so both docs share the look.

### Sentence-split heuristic

```
/^([\s\S]*?[.!?。！？])(\s+)([\s\S]*)$/
```

- Group 1 = first sentence (greedy-minimal up to the first terminator), group 3 = remainder.
- Known acceptable limitations (decimals like `3.5`, abbreviations like `Dr.`) may occasionally split
  early; user accepted this trade-off. When no match, the whole paragraph is treated as one sentence.

## Components & boundaries

| Unit | Responsibility | Depends on |
|------|----------------|------------|
| `render.ts` | Summary HTML; now also renders the meta URL link. | `types`, `theme` |
| `render-deep-dive.ts` | Deep-dive HTML; section splitter, ▶ extraction, gold-first-sentence, URL linkify. | `theme`, markdown-it |
| (shared rules) | ▶ extraction + sentence split logic — small pure helpers inside `render-deep-dive.ts`, testable in isolation. | — |

The ▶-extraction rules are duplicated from `parse.ts` conceptually; the spec keeps them as small local
helpers in `render-deep-dive.ts` rather than importing `parse.ts` (which is summary-shaped: numerals,
callout, bullet sections). If the duplication proves bothersome later, a shared `timestamp-line.ts`
helper can be factored out — out of scope here.

## Error handling / edge cases

| Case | Behavior |
|------|----------|
| Section has no `▶` line | No trailing `.ts` link; lead still gold-first-sentence. |
| Malformed `▶ …` line | Consumed (not leaked into prose); no link — matches summary. |
| Lead paragraph has no sentence terminator | Whole paragraph is the first sentence (fully gold). |
| Lead paragraph empty (heading immediately followed by a list/code) | No `.lead` paragraph; render the block content normally; gold not applied. |
| Summary/deep-dive URL absent | Meta line omits the link (no empty `·`). |
| URL not `http(s)` | Treated as absent (injection guard); not linked. |
| `▶` line present but section body otherwise empty | Heading + ts link, no lead, no rest. |
| Body with no `## ` sections at all | Entire body rendered as preamble (md.render) — current behavior preserved. |

## Testing (TDD — parsing/transformation)

Unit tests against `renderDeepDiveHtml` and `renderMagazineHtml`:

- **Timestamp relocation:** `▶ [0:07–1:29](url?t=7s)` after a `## Heading` → `<a class="ts" …>(0:07–1:29)</a>`
  inside the `<h2>`, with the exact href; the `▶` text no longer appears in the body.
- **Gold scope:** lead paragraph with two sentences → `<span class="lead-accent">` wraps only the first;
  second sentence is outside the span. Single-sentence lead → whole paragraph in the span.
- **No-▶ section** (video-only fixture) → heading has no `.ts` link; lead still gold-first-sentence.
- **Malformed ▶** → no link, line not leaked into prose.
- **Rich section body** (lead paragraph followed by an h3 + list + code fence) → lead handled specially,
  rest rendered intact (list/code present in output).
- **Fence-aware split:** a `## ` line inside a code fence does not start a new section.
- **Deep-dive URL:** header `**URL:** https://…` renders as an `<a href>` (clickable).
- **Summary URL:** `renderMagazineHtml` output meta line contains a clickable full-URL `<a>`; absent URL →
  no link; `javascript:` URL → not linked (injection guard).
- **Regression:** existing deep-dive render tests (frontmatter strip, title, theme toggle, source-md meta)
  still pass.

Full `npm test` + `tsc --noEmit` before commit. Dual review (Claude + Codex adversarial) per task.

## Out of scope

- Changing Gemini prompts or `.md` content.
- Re-running summaries/deep-dives (a re-render suffices).
- Factoring a shared timestamp/section parser between summary and deep-dive renderers.
