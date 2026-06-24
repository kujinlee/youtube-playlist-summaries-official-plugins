# Design Spec — On-Demand Section "Dig Deeper" with Slide Screenshots

**Date:** 2026-06-24
**Status:** Draft — awaiting user review
**Supersedes:** SP2 (full deep-dive coverage re-generation), which is abandoned in favor of this approach.

---

## 1. Motivation & Decision Summary

The full deep-dive doc has three problems: it is expensive to (re)generate (whole-video upload to `gemini-2.5-pro`, ~$1.40/doc at the >200k premium tier), it is eager (you pay for all 23 docs whether or not anyone reads them), and it is **text-only** — for the minority of videos that present slides/diagrams on screen, prose alone is a poor substitute for the actual visual.

This feature replaces the deep-dive doc with **on-demand, per-section elaboration**: the reader clicks "dig deeper" on a single summary section, and the system generates a deeper treatment of *just that section*, grounded in the video clip and transcript window, **inserting full-resolution screenshots of informative slides** where they exist.

### Decisions locked during brainstorming

| # | Decision | Rationale |
|---|---|---|
| D1 | **Replace** the full deep-dive doc entirely | Dig-deeper becomes the sole detail layer. Existing 23 deep-dive docs remain as legacy; no new ones generated. |
| D2 | Output = **companion doc per video** (`<basename>-dig-deeper.md`) | Lazily accumulates dug sections; natural replacement for the deep-dive doc; PR#22 nav already resolves the counterpart-doc pattern. |
| D3 | Screenshots via **yt-dlp + ffmpeg, in MVP** | Only path to full-res readable slides. Accepts YouTube-gating fragility (text-only fallback when gated). |
| D4 | Trigger = **non-blocking per-section spinner** | Reader keeps reading/queuing; consistent with existing busy-state/sync patterns. Blocking overlay explicitly rejected. |
| D5 | Architecture = **Approach A** (single combined Gemini call + token-resolver extraction) | Lazy local download (only when a slide is flagged); reuses the `[[TS:i]]` token-resolution pattern verbatim. |

### Cost (grounded in the corpus)

- Corpus: 269 videos, mean 31.9 min; summaries average **6 sections**, so a section ≈ **~5 min** of video.
- Per single-section dig (clip-grounded, `gemini-2.5-pro`, default media resolution): **~$0.04–0.12**.
- Dig every section of a summary (≈6 calls, each clip stays under the 200k cheap tier): **~$0.26–0.71** — *still cheaper than one monolithic deep-dive (~$1.40)*, because splitting avoids the >200k premium tier.
- Screenshots add **$0 API cost** (local ffmpeg); cost is bandwidth + disk, incurred only on slide-flagged sections.

---

## 2. Architecture & Data Flow

### Module boundaries (each independently testable)

| Unit | Responsibility | Depends on |
|---|---|---|
| `lib/dig/section-window.ts` | Pure: section → `{ sectionId, startSec, endSec, transcriptWindow, summaryProse }` | `lib/html-doc/types.ts`, transcript segments |
| `lib/dig/generate.ts` | One Gemini call: clip + transcript window + summary prose → markdown w/ `[[TS:i]]` + `[[FRAME:sec\|caption]]` tokens | `lib/gemini.ts` |
| `lib/dig/frames.ts` | Resolve `[[FRAME]]` tokens → yt-dlp segment download + ffmpeg extract → save asset → rewrite to `![](…)`. No-op if zero frame tokens. | yt-dlp, ffmpeg (new exec boundary) |
| `lib/dig/companion-doc.ts` | Idempotent upsert of a dug section into `<basename>-dig-deeper.md` (key = sectionId), serialized writes | fs, atomic write |
| `app/api/videos/[id]/dig/[sectionId]/stream/route.ts` | SSE orchestration of the four units; emits step progress | all above |
| client wiring in `lib/html-doc/nav.ts` | State-aware `dig` control (not-dug / loading / dug / error) | existing `wireDigLinks`, `scrollToHashSection` |

### Data flow (one dig click)

```
click "dig deeper ▶" on summary section (data-start = S)
  → section-window:  window = [S, nextStart ?? duration], transcriptWindow, summaryProse
  → generate:        Gemini(clip @ [S,E] via fileData+videoMetadata + window + prose)
                       → markdown with [[TS:i]] and [[FRAME:sec|caption]]
  → resolveTranscriptTokens (existing, lenient LIS)        → ▶ links
  → frames:          if [[FRAME]] present → yt-dlp --download-sections "*Ss-Es"
                       + ffmpeg -ss (sec-S) → assets/<videoId>/<sec>.jpg → ![](…)
                     else → skip download entirely
  → companion-doc:   upsert section into <basename>-dig-deeper.md, re-render HTML
  → SSE 'done'       → client flips ⏳ to "view detail ↓"
```

**Isolation property:** `frames.ts` is the only unit touching yt-dlp/ffmpeg, and it runs only when frame tokens exist — the fragile/slow path is fault-isolated and lazy.

---

## 3. Section Windowing & Generation Contract

### 3a. `section-window.ts` (pure, no I/O)

A dig-enabled section always has a `data-start` (PR#22's `digControl` only emits when `startSec` is known — sections without timestamps get no dig control). From that:

```
windowForSection(section, allSections, segments, durationSeconds) → {
  sectionId:        startSec,                          // stable key == nav data-start
  startSec:         S,
  endSec:           nextSection.startSec ?? durationSeconds,
  transcriptWindow: segments.filter(seg => seg.t >= S && seg.t < endSec),
  summaryProse:     section.prose,
}
```

- `sectionId = startSec` — one identifier threads the timeline, nav control, resolver, and companion-doc merge.
- No artificial clip cap (most sections ≈5 min, under the cheap tier; capping risks cutting off a slide).

### 3b. `generate.ts` — Gemini request

```
parts: [
  { fileData: { fileUri: youtubeUrl, mimeType: 'video/mp4',
                videoMetadata: { startOffset: `${S}s`, endOffset: `${endSec}s` } } },
  { text: buildDigPrompt(lang) + buildIndexedTranscriptBlock(transcriptWindow) + summaryProse }
]
```

- **Model:** `gemini-2.5-pro` (existing `DEEPDIVE_MODEL`).
- **Media resolution:** **DEFAULT** (slides must be legible for captioning; clip is short → stays under 200k cheap tier). `MEDIA_RESOLUTION_LOW` remains an env knob if cost ever bites.
- **Output:** plain markdown, **not** JSON mode — avoids the known Gemini-JSON-reliability trap; matches `generateDeepDiveFromTranscript` returning raw markdown with inline tokens.

### 3c. Token contracts in the returned markdown

| Token | Meaning | Resolver |
|---|---|---|
| `[[TS:i]]` | `i` = index into **this window's** segments | existing `resolveTranscriptTokens` (lenient LIS), fed the **same** window array |
| `[[FRAME:sec\|caption]]` | `sec` = **absolute** video-second of a fully-rendered slide; `caption` = alt text | new `frames.ts` |

- `[[FRAME]]` carries **absolute** seconds (prompt states "this clip covers [S,E] — emit absolute timestamps"). `frames.ts` validates `sec ∈ [S,E]`, drops out-of-range tokens (lenient, mirrors the timestamp resolver).
- **Cap: ≤3 frames/section**, prompt-enforced.

**Correctness note:** `[[TS:i]]` is positional — the *same* windowed segment array must feed both `buildIndexedTranscriptBlock` (into the prompt) and `resolveTranscriptTokens` (on the output), or indices point at the wrong moments.

### 3d. `buildDigPrompt`

Elaborate this **one** section in depth, grounded in transcript + video; **must cover at least what the summary section states**, then add depth (the "coverage ≥ summary" goal SP2 wanted, scoped to a section). Visual rule: when a slide/diagram conveys information the speech doesn't, emit `[[FRAME:sec|caption]]` at the relevant point, choosing the second the slide is fully rendered, ≤3 total. Cite key moments with `[[TS:i]]`. Match summary language (en/ko). Output markdown only, no preamble.

**Known limitation:** Gemini's chosen `sec` can land mid-transition (slide half-drawn). MVP extracts the single frame at `sec` + relies on the "fully rendered" instruction. Multi-candidate extraction (grab `sec`, `sec±1`, pick sharpest) is a noted phase-2 enhancement.

---

## 4. Screenshot Extraction (`frames.ts`)

```
resolveFrameTokens(markdown, { videoId, youtubeUrl, startSec S, endSec E }) → markdown
  1. parse [[FRAME:sec|caption]] tokens
  2. none?   → return markdown unchanged          (NO download — the ~80% case)
  3. some?   → yt-dlp --download-sections "*Ss-Es" -f 'bv[height<=720]' → tmp clip
  4. per token: validate sec ∈ [S,E] (drop if out of range);
                ffmpeg -ss (sec - S) -i clip -frames:v 1 -q:v 2
                  → raw/assets/<videoId>/<sec>.jpg
                rewrite token → ![caption](assets/<videoId>/<sec>.jpg)
  5. any failure (gated download / ffmpeg error) → strip frame tokens,
                log [dig-frame-miss], continue text-only
  6. delete tmp clip
```

- **Segment-scoped download:** `--download-sections "*Ss-Es"` pulls only the section clip (seconds of 720p), not the full talk — minimizes bandwidth and gating exposure.
- **Clip-relative seek:** clip starts at `S`, so ffmpeg seeks `sec - S`.
- **Frame quality:** `-q:v 2` JPEG, ~100–300 KB, ≤3/section.
- **Temp clip** → gitignored `.cache/`; **extracted JPEGs** persist in `raw/assets/<videoId>/` (part of the deliverable corpus).

### Embed conventions (two render targets)

| Target | Embed form | Why |
|---|---|---|
| Markdown / Obsidian vault | `![caption](assets/<videoId>/<sec>.jpg)` (vault-relative file ref) | Obsidian renders it; keeps `.md` small |
| Exported HTML | base64 data-URI, inlined at render time | HTML docs are self-contained portable artifacts (open-from-disk + Print) |

The JPEG on disk is canonical; Obsidian references it, the HTML renderer inlines base64 (consistent with inlined CSS/theme). Re-rendering HTML never regenerates images.

---

## 5. Companion Doc — Output File Format

- **Filename:** `<summary-basename>-dig-deeper.md`, in `raw/` beside the summary (mirrors `<basename>-deep-dive.md`).
- **Frontmatter:**

```yaml
---
title: "<video title> — Dig Deeper"
videoId: uvg9UmI0PuQ
language: en
digVersion: { major: 1, minor: 0 }
sourceVideoUrl: https://www.youtube.com/watch?v=uvg9UmI0PuQ
sections:                       # one entry per dug section — upsert key
  - sectionId: 312              # == startSec
    startSec: 312
    generatedAt: 2026-06-24T12:00:00Z
---
```

- **Body:** one `## <section title>` per dug section, **ordered by `startSec`**, each with its ▶ timestamp link, elaboration prose (▶ links + inline screenshots).
- **Idempotent upsert:** re-digging overwrites *that* section's block (matched by `sectionId`), preserves others, re-sorts by `startSec`.
- **Versioning:** `digVersion` independent of summary/deep-dive versions — **no summary version bump** (sidesteps the 236-Gemini re-summarize trap). On-demand only; a `digVersion` bump never auto-regenerates.

### Annotated sample body

```markdown
## How the agent loop works  ▶ <a class="ts" data-t="312">5:12</a>

The speaker frames the loop as three phases… [grounds the summary line, then adds depth]
At ▶ <a class="ts" data-t="345">5:45</a> he contrasts this with…

![Agent loop: perceive → plan → act, with the context window in the center](assets/uvg9UmI0PuQ/352.jpg)

The diagram above shows the context window sitting between plan and act, which the
transcript only alludes to…
```

---

## 6. UI Contract

### Trigger states (client logic in `nav.ts`)

| State | Appearance | Transition |
|---|---|---|
| Not dug | `dig deeper ▶` | click → opens SSE → **Loading** |
| Loading | `⏳` (disabled) | SSE `done` → **Dug**; SSE `error` → **Error** |
| Dug | `view detail ↓` (link to companion section) | click → navigate; `↻` secondary → force-regen → **Loading** |
| Error | `⚠ retry` + tooltip msg | click → **Loading** |

Non-blocking: multiple sections queue independently; each control tracks its own state.

### URL Contracts

| Component | Link text | Full URL |
|---|---|---|
| Dig trigger (SSE gen) | `dig deeper ▶` | `GET /api/videos/[id]/dig/[sectionId]/stream?outputFolder=<enc>` (`id`=videoId, `sectionId`=startSec; server loads summary model, finds section by `startSec`, derives `endSec`/window) |
| Force re-dig | `↻` | same URL + `&force=1` |
| View companion section | `view detail ↓` | `/api/html/[id]?outputFolder=<enc>&type=dig-deeper#t=<startSec>` (`#t` scrolls via existing `scrollToHashSection`) |

### Overlay Dismissal

**N/A — no overlay or modal.** This is an inline non-blocking control (D4); the state machine above is the relevant analog. Error state is dismissed by clicking `⚠ retry` (→ Loading) or navigating away. Justification for no overlay: generation is non-blocking; the reader keeps reading and queuing — a blocking overlay was explicitly rejected.

---

## 7. Error Handling

| Failure | Behavior |
|---|---|
| Empty transcript window (no segments in `[S,E]`) | Generate from summary prose + clip; no `[[TS:i]]` possible — still valid |
| Gemini call fails (after existing retry wrapper) | SSE `error`; **no** companion-doc mutation; control → Error |
| yt-dlp download gated/fails | Strip `[[FRAME]]` tokens, log `[dig-frame-miss]`, write companion doc **text-only** |
| ffmpeg fails for one frame | Drop that frame, keep others |
| Concurrent digs, same companion doc | **Serialize** read-modify-write per file (in-process queue + atomic write) — prevents the two-writer race |
| Path safety | Validate `videoId`/`sectionId`; assert asset + doc paths stay within the vault (reuse PR#13 containment guard) |

---

## 8. Caching / Re-dig

The companion doc **is** the cache. A dug section → control links to it (no regen). `↻ force=1` overwrites that one block via idempotent upsert; other sections preserved.

---

## 9. Testing Strategy

- **Unit (jest):** `section-window` (last-section→duration, empty window, boundaries); `frames` token parse/validate/rewrite with yt-dlp+ffmpeg mocked at the **exec boundary** (new mock boundary — add to the project mocking table); `companion-doc` upsert (idempotent, ordering, preserve-others, serialized writes); `generate` request shape with gemini mocked; `[[FRAME]]` out-of-range drop.
- **Component (RTL):** the four control states.
- **E2E (Playwright, mock at API route):** fixtures **must** cover a section *with* slides (frame tokens) and one *without* (text-only) per the null/non-null rule; assert **all** URL params (`outputFolder`, `type`, `sectionId`, `#t`); exercise loading→done→link and the error path.
- **Behaviors adversarial review:** triggered (>8 behaviors + SSE state machine + multiple error paths) — to be run against the plan's Enumerated Behaviors table.

### New mocking boundary

| Boundary | What is mocked |
|---|---|
| `lib/dig/frames.ts` exec (yt-dlp, ffmpeg) | Spawned process calls — no real downloads/extraction in unit tests |

---

## 10. Open Risks (carry into plan review)

1. **YouTube gating** on yt-dlp — already bitten this project; mitigated by text-only fallback, scoped to slide-heavy sections only.
2. **Frame-accuracy** — Gemini timestamp may land mid-transition; MVP single-frame + "fully rendered" instruction; multi-candidate is phase-2.
3. **Long sections** crossing the 200k premium tier — rare, accepted.
4. **Binary assets in the data corpus** — JPEGs persist in `raw/assets/`; data lives in the separate `-data` repo. Confirm gitignore handles only the `.cache/` video temp, not the assets.
