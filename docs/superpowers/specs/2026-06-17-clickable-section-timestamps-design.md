# Clickable Section Timestamps — Design Spec

**Date:** 2026-06-17
**Status:** Draft — pending user review
**Scope:** Add per-section clickable YouTube timestamps to the summary and deep-dive exports, so a
reader can jump from a section straight to that part of the source video.

---

## 1. Goal

The summary/deep-dive HTML is great for skimming; sometimes the reader wants to watch the original
video for a specific span. Attach a **start–end time range to each section**, rendered as a
clickable link that opens YouTube at the section's start time. Because the link is stored as a
markdown link in the `.md`, it is clickable in **both** the HTML export and Obsidian.

## 2. Decisions (locked during brainstorming)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Granularity | **Per section** (one range per `##` heading / deep-dive heading) |
| D2 | Click behavior | **Jump to start, new tab** — `watch?v=ID&t=<startSec>s`; `–end` is a display label (YouTube URLs can't auto-stop) |
| D3 | Scope | **Both** exports — summary and deep-dive |
| D4 | Attribution | **Segment-index lookup** — Gemini emits a real transcript segment index; our code resolves the true timestamp; validated + graceful degradation |
| D5 | `.md` placement | **Own line under the heading**: `▶ [02:15–05:30](url)` (heading parsing unchanged; old docs still parse; clean in Obsidian) |

## 3. Foundational change: keep transcript timing

`lib/youtube.ts:73` currently flattens the transcript to text (`segments.map(s => s.text).join(' ')`),
discarding each segment's `offset`/`duration`. Add:

```ts
export interface TranscriptSegment { text: string; offset: number; duration: number } // seconds
export async function fetchTranscriptSegments(videoId: string): Promise<TranscriptSegment[]>;
```
- `offset`/`duration` are converted to **seconds** (the `youtube-transcript` library returns ms).
- `fetchTranscript` (text) stays as a thin wrapper (`segments.map(s => s.text).join(' ')`) for the
  language-detection path and any caller that only needs text.

## 4. Attribution: segment-index → real timestamp

### 4.1 Summary (`generateSummary`)
- The transcript is sent to Gemini as an **indexed list**: `[<i> @mm:ss] <text>` per segment.
- The summary JSON gains a `startSeg: number` per section (the index of the segment where the
  section's content begins).
- Our code resolves each section's range:
  - `startSec = segments[startSeg].offset`
  - `endSec = segments[nextSection.startSeg].offset` (end of the **last** section = video duration)
- **Validation** (per doc): every `startSeg` is an integer in `[0, segments.length)` **and**
  strictly increasing across sections. If validation fails, or the transcript has no usable
  offsets, **degrade gracefully** — emit the summary with **no** timestamp lines (the doc still
  generates normally). Degradation is logged, never thrown.

### 4.2 Deep-dive (`generateDeepDive`)
The deep-dive returns free-form markdown (not JSON), so it uses an inline **token**:
- The prompt instructs Gemini to place `[[TS:<index>]]` immediately after each **top-level (`##`)
  heading** (not `###`/`####` sub-headings), where `<index>` is the starting transcript segment
  index for that heading's content.
- Post-processing replaces every `[[TS:<index>]]` token with a `▶ [mm:ss–mm:ss](url)` line,
  resolving the real timestamp from `segments[index].offset`; each token's end = the next token's
  start in document order (last = video duration).
- Same validation/degradation: tokens with out-of-range or non-monotonic indices are dropped (that
  token resolves to nothing); a wholesale failure leaves the deep-dive untouched.

### 4.3 Where the resolved data lives
- **Summary**: `parse.ts` reads the `▶ [range](url)` line into a new `ParsedSection.timeRange`
  field. `render.ts` renders it (the renderer already receives `parsed`). **No magazine-model
  change** — and because `timeRange` comes from the `.md`, the offline **re-render (persist-model)
  preserves timestamps for free**.
- **Deep-dive**: the resolved `▶ [range](url)` line is written into the deep-dive `.md`; the
  deep-dive HTML renders the `.md` faithfully via markdown-it, so the link is clickable with **no
  deep-dive renderer change**.

## 5. Output File Format

### 5.1 Summary `.md` — timestamp line
One optional line immediately after each `## N. Title` heading (and after `## Conclusion`):
```
▶ [<start>–<end>](https://www.youtube.com/watch?v=<videoId>&t=<startSec>s)
```
- `<start>`/`<end>` formatted `m:ss` (or `h:mm:ss` for ≥ 1h videos).
- The line is **optional** — absent when timestamps degraded or for pre-feature summaries.

**Annotated sample (summary section):**
```markdown
## 1. The Core Claim
▶ [2:15–5:30](https://www.youtube.com/watch?v=z02Y-1OvWSM&t=135s)

Attention layers can simulate one step of optimization…
```

### 5.2 Deep-dive `.md` — timestamp line
Same line, inserted after a heading by token resolution:
```markdown
## 1. High-Level Summary
▶ [0:00–3:42](https://www.youtube.com/watch?v=z02Y-1OvWSM&t=0s)

The video explains…
```

### 5.3 Parsed model
```ts
interface SectionTimeRange { startSec: number; endSec: number; label: string; url: string }
// ParsedSection gains: timeRange: SectionTimeRange | null
```

## 6. URL Contracts

| Component | Link text | Full URL |
|-----------|-----------|----------|
| Summary section timestamp | `▶ 2:15–5:30` | `https://www.youtube.com/watch?v=<videoId>&t=<startSec>s` |
| Deep-dive heading timestamp | `▶ 0:00–3:42` | `https://www.youtube.com/watch?v=<videoId>&t=<startSec>s` |

- `<startSec>` is an integer (floor of `segments[startSeg].offset`).
- `target="_blank" rel="noopener"` in the rendered HTML (new tab; the `.md`/Obsidian link opens per Obsidian's own behavior).
- Only the **start** is encoded in the URL; the `–end` is display-only.

## 7. Rendering (summary HTML)

`render.ts` renders `parsed.sections[i].timeRange` (when present) as a small clickable element near
the section heading: `<a href="…&t=135s" target="_blank" rel="noopener" class="ts">▶ 2:15–5:30</a>`.
Styled to be unobtrusive (uses the existing meta/gold token, small). Absent `timeRange` → nothing
rendered (no layout change for old/degraded docs). The deep-dive HTML needs no change (markdown-it
renders the `.md` link).

## 8. Error Handling

| Condition | Behavior |
|-----------|----------|
| Transcript has no/zero-offset segments | No timestamps; summary/deep-dive generate normally (logged) |
| Gemini `startSeg` out of range or non-monotonic (summary) | Drop ALL timestamps for that doc (degrade); generate normally |
| Deep-dive token index invalid | Drop that token only; others resolve |
| `videoId` missing | No timestamps (can't build the URL) |
| `parse.ts` sees a malformed `▶` line | Ignore it (treat as no timeRange); never throw |

## 9. Onboarding existing docs

Existing summaries/deep-dives have no timestamps until **regenerated** (a Gemini call). No backfill;
documented as a one-time per-doc regeneration, same pattern as the persist-model feature.

## 10. Non-Goals

- Auto-stopping at the end time (YouTube watch URLs can't; would need an embed — explicitly deferred).
- Per-bullet or per-paragraph timestamps (per-section only).
- An embedded in-page player.
- Backfilling timestamps onto existing docs without regeneration.

## 11. File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `lib/youtube.ts` | `fetchTranscriptSegments` (+ keep `fetchTranscript`). | Modify |
| `lib/gemini.ts` | Summary prompt: indexed transcript + `startSeg`; deep-dive prompt: `[[TS:i]]` tokens; index→timestamp resolution + validation. | Modify |
| `lib/transcript-timestamps.ts` | Pure: resolve indices→ranges, validate monotonic/range, format `m:ss`, build URL, render the `▶` line, resolve deep-dive tokens. | Create |
| `lib/html-doc/parse.ts` | Extract the `▶` line into `ParsedSection.timeRange`. | Modify |
| `lib/html-doc/render.ts` | Render the section timestamp link. | Modify |
| `lib/html-doc/types.ts` | `SectionTimeRange`, `ParsedSection.timeRange`. | Modify |
| (pipeline callers) | Pass segments through generate flow. | Modify |
