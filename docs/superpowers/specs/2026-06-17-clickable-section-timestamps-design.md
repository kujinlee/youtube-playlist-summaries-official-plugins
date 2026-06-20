# Clickable Section Timestamps — Design Spec

**Date:** 2026-06-17
**Status:** Approved — scope narrowed to **summary only** (deep-dive deferred, see §12)
**Scope:** Add per-section clickable YouTube timestamps to the **summary** export, so a reader can
jump from a section straight to that part of the source video.

---

## 1. Goal

The summary HTML is great for skimming; sometimes the reader wants to watch the original video for a
specific span. Attach a **start–end time range to each section**, rendered as a clickable link that
opens YouTube at the section's start time. Because the link is stored as a markdown link in the
`.md`, it is clickable in **both** the HTML export and Obsidian.

## 2. Decisions (locked during brainstorming)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Granularity | **Per section** (one range per `##` heading) |
| D2 | Click behavior | **Jump to start, new tab** — `watch?v=ID&t=<startSec>s`; `–end` is a display label (YouTube URLs can't auto-stop) |
| D3 | Scope | **Summary only** for now. Deep-dive deferred — its primary path has no transcript (see §12) |
| D4 | Attribution | **Segment-index lookup** — Gemini emits a real transcript segment index; our code resolves the true timestamp; validated + graceful degradation |
| D5 | `.md` placement | **Own line under the heading**: `▶ [02:15–05:30](url)` (heading parsing unchanged; old docs still parse; clean in Obsidian) |

## 3. Foundational change: keep transcript timing

`lib/youtube.ts:70` (`fetchTranscript`) flattens the transcript to text
(`segments.map(s => s.text).join(' ')`), discarding each segment's `offset`/`duration`. Add a
parallel function that preserves timing:

```ts
// lib/transcript-timestamps.ts owns the type (pure, leaf module — no googleapis dependency).
export interface TranscriptSegment { text: string; offset: number; duration: number } // seconds

// lib/youtube.ts
export async function fetchTranscriptSegments(videoId: string): Promise<TranscriptSegment[]>;
```
- The `youtube-transcript` library returns `offset`/`duration` in **milliseconds**;
  `fetchTranscriptSegments` divides by 1000 to store **seconds**.
- `fetchTranscript` (text) stays unchanged for the deep-dive path and any text-only caller.
- The pipeline switches to `fetchTranscriptSegments` and derives the flat text locally
  (`segments.map(s => s.text).join(' ')`) for `detectLanguage` — **one** network fetch, not two.

## 4. Attribution: segment-index → real timestamp (summary)

### 4.1 How the index is emitted — inline `[[TS:<index>]]` token

`generateSummary` returns the summary as a single markdown **string** (not a per-section JSON array),
so the segment index is carried as an **inline token on its own line immediately after each `##`
heading**, identical in spirit to the placement in D5:

```
## 1. The Core Claim
[[TS:42]]

Attention layers can simulate…
```
- The transcript is sent to Gemini as an **indexed list**, one line per segment:
  `[<i> @<m:ss>] <text>`.
- The prompt instructs Gemini to place, immediately after each `## N. Title` heading (and after
  `## Conclusion`), a line containing **only** `[[TS:<index>]]`, where `<index>` is the bracket
  number of the transcript segment where that section's content begins, and indices **strictly
  increase** down the document.

This is chosen over a parallel `startSeg: number[]` JSON field because the token is **positionally
self-anchoring** — it cannot be mis-zipped onto the wrong `##` section the way an out-of-band array
can when section counts drift.

### 4.2 How our code resolves it (no hallucinated numbers survive)

`resolveTranscriptTokens(markdown, segments, videoId)` (in `lib/transcript-timestamps.ts`):
- Finds every own-line `[[TS:<index>]]` token in document order.
- **Validates**: every index is an integer in `[0, segments.length)` **and** strictly increasing.
- **Resolves** each surviving token to a `▶ [start–end](url)` line:
  - `startSec = floor(segments[index].offset)`
  - `endSec = floor(segments[nextToken.index].offset)`; the **last** token's end = video duration
    (`floor(lastSegment.offset + lastSegment.duration)`)
- **Degrades gracefully (all-or-nothing)**: if validation fails, `videoId` is missing, or the
  transcript has no segments, **all** tokens are stripped and the summary is emitted with no
  timestamp lines. Degradation is silent in the output (logged), never thrown. Any stray inline
  (non-own-line) token is also stripped so no raw `[[TS:…]]` ever reaches the reader.

### 4.3 Where the resolved data lives

`parse.ts` reads the `▶ [range](url)` line into a new `ParsedSection.timeRange` field. `render.ts`
renders it (the renderer already receives `parsed`). **No magazine-model change** — and because
`timeRange` comes from the `.md`, the offline **re-render (persist-model) preserves timestamps for
free** (re-render re-parses the same `.md`).

## 5. Output File Format

### 5.1 Summary `.md` — timestamp line
One optional line immediately after each `## N. Title` heading (and after `## Conclusion`):
```
▶ [<start>–<end>](https://www.youtube.com/watch?v=<videoId>&t=<startSec>s)
```
- `<start>`/`<end>` formatted `m:ss` (or `h:mm:ss` for ≥ 1h videos). The dash is an en dash `–`.
- The line is **optional** — absent when timestamps degraded or for pre-feature summaries.

**Annotated sample (summary section):**
```markdown
## 1. The Core Claim
▶ [2:15–5:30](https://www.youtube.com/watch?v=z02Y-1OvWSM&t=135s)

Attention layers can simulate one step of optimization…
```

### 5.2 Parsed model
```ts
interface SectionTimeRange { startSec: number; endSec: number; label: string; url: string }
// ParsedSection gains: timeRange?: SectionTimeRange | null
//   (optional, so existing ParsedSection fixtures compile unchanged; the parser always sets it)
```

## 6. URL Contracts

| Component | Link text | Full URL |
|-----------|-----------|----------|
| Summary section timestamp | `▶ 2:15–5:30` | `https://www.youtube.com/watch?v=<videoId>&t=<startSec>s` |

- `<startSec>` is an integer (floor of `segments[index].offset`).
- `target="_blank" rel="noopener noreferrer"` in the rendered HTML (new tab; `noreferrer` also avoids
  leaking a local file path to YouTube when the HTML is opened from disk; the `.md`/Obsidian link
  opens per Obsidian's own behavior).
- Only the **start** is encoded in the URL; the `–end` is display-only.

## 7. Rendering (summary HTML)

`render.ts` renders `parsed.sections[i].timeRange` (when present) as a small clickable element
between the section heading and the lead:
`<a class="ts" href="…&t=135s" target="_blank" rel="noopener noreferrer">▶ 2:15–5:30</a>`. Styled unobtrusively
with the existing gold token. Absent `timeRange` → nothing rendered (no layout change for
old/degraded docs).

## 8. Error Handling

| Condition | Behavior |
|-----------|----------|
| Transcript has no segments / no `videoId` | No timestamps; summary generates normally (logged) |
| Gemini `[[TS:i]]` index out of range or non-monotonic | Strip ALL timestamps for that doc (degrade); generate normally |
| Stray inline `[[TS:i]]` token (not own line) | Stripped from output (never shown raw) |
| `parse.ts` sees a malformed `▶` line | Consume the line but set `timeRange = null`; never throw |

## 9. Onboarding existing docs

Existing summaries have no timestamps until **regenerated** (a Gemini call). No backfill; documented
as a one-time per-doc regeneration, same pattern as the persist-model feature.

## 10. Non-Goals

- Auto-stopping at the end time (YouTube watch URLs can't; would need an embed — deferred).
- Per-bullet or per-paragraph timestamps (per-section only).
- An embedded in-page player.
- Backfilling timestamps onto existing docs without regeneration.

## 11. File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `lib/transcript-timestamps.ts` | Pure: `TranscriptSegment` type; format/parse `m:ss`; build watch URL; build the `▶` line; build the indexed transcript; resolve `[[TS:i]]` tokens with validation + degradation. | Create |
| `lib/youtube.ts` | `fetchTranscriptSegments` (+ keep `fetchTranscript`). | Modify |
| `lib/gemini.ts` | `generateSummary(segments, language, videoId)`: indexed transcript + `[[TS:i]]` instruction in the prompt; resolve tokens in the returned summary. | Modify |
| `lib/pipeline.ts` | Fetch segments; derive text for `detectLanguage`; pass `segments` + `videoId` to `generateSummary`. | Modify |
| `lib/html-doc/types.ts` | `SectionTimeRange`; `ParsedSection.timeRange?`. | Modify |
| `lib/html-doc/parse.ts` | Extract the `▶` line into `ParsedSection.timeRange`. | Modify |
| `lib/html-doc/render.ts` | Render the section timestamp link + `.ts` CSS. | Modify |

## 12. Deferred: deep-dive timestamps

Deep-dive timestamps are **out of scope** for this effort. Reason: the deep-dive's **primary** path
(`lib/deep-dive.ts` → `generateDeepDive(youtubeUrl)`) sends the *video file* to Gemini and has **no
transcript**, so segment-index attribution (D4) is impossible there; only the rare transcript-
fallback path could support it. Revisit as its own spec. Candidate approaches captured for later:

1. **Fallback-only** — timestamps only when the transcript-fallback path runs (sparse coverage).
2. **Dedicated attribution call** — after deep-dive content is generated, a separate cheap Gemini
   call maps its `##` headings → segment indices using a freshly fetched indexed transcript (uniform
   coverage on both paths; +1 Gemini call).

The summary mechanism in this spec (`resolveTranscriptTokens`, the indexed transcript) is written
generically so a future deep-dive effort can reuse it.
