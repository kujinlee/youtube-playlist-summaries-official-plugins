# Design Spec — On-Demand Section "Dig Deeper" with Slide Screenshots

**Date:** 2026-06-24
**Status:** Draft (rev 2 — post adversarial review) — awaiting user review
**Supersedes:** SP2 (full deep-dive coverage re-generation), abandoned in favor of this approach.
**Review:** `docs/reviews/spec-dig-deeper-screenshots-review.md` (B1/B2/H1–H7/M2–M6/L1–L4 addressed below; B3/B4/M1 → Task 0 spike).

---

## 1. Motivation & Decision Summary

The full deep-dive doc has three problems: expensive to (re)generate (whole-video upload to `gemini-2.5-pro`), eager (you pay for all 23 docs whether read or not), and **text-only** — for the minority of videos that present slides/diagrams on screen, prose is a poor substitute for the visual.

This feature replaces the deep-dive doc with **on-demand, per-section elaboration**: the reader digs a single summary section; the system generates a deeper, video-grounded treatment of *just that section*, **inserting screenshots of informative slides** where they exist.

### Decisions locked during brainstorming

| # | Decision |
|---|---|
| D1 | **Replace** the full deep-dive doc entirely (23 legacy docs frozen, no new ones) |
| D2 | Output = **dig-deeper doc per video** (`<basename>-dig-deeper.md`) that lazily accumulates dug sections |
| D3 | Screenshots via **yt-dlp + ffmpeg, in MVP** (text-only fallback when a download is gated) |
| D4 | Trigger = **non-blocking per-section spinner** |
| D5 | Architecture = **Approach A** (one combined Gemini call + token-resolver extraction) |

### Cost — PROVISIONAL, pending Task 0 spike

The cost advantage depends entirely on **clip-grounding actually working** (Task 0). *If* a ~5-min clip is honored: ~$0.04–0.12/section, and digging all ~6 sections (~$0.26–0.71) stays cheaper than one monolithic deep-dive (~$1.40) because each clip stays under the 200k premium tier. **If clip-grounding silently no-ops (the full video is billed per call), this feature is MORE expensive than what it replaces** — Task 0 must resolve this before any other implementation, and the measured `usageMetadata` token count replaces these estimates.

---

## 0. Task 0 — Mandatory Verification Spike (gate before all other work)

Three load-bearing claims cannot be verified statically and MUST be proven by a throwaway spike before any other task begins:

1. **Clip-grounding reaches the wire.** The installed SDK `@google/generative-ai@0.24.1` has **no** `videoMetadata`/`startOffset` types (confirmed); `@google/genai` is not installed. Spike: issue a real clipped call and inspect the outgoing request body + `usageMetadata.promptTokenCount`. **Pass** = `videoMetadata` is transmitted AND token count ≈ clip-length (not full-video). **Fail** = full-video token count → clipping ignored.
2. **Timestamp frame-of-reference.** Determine whether Gemini emits **absolute** (original-video) or **clip-relative** seconds for a clipped call. Record which.
3. **Cost.** Compute real $/section from the spike's `usageMetadata`.

**Decision gate (recorded in the plan):**
- Pass → proceed; bake the observed frame-of-reference into `slides.ts` (B4) and replace §1 estimates with measured cost.
- `videoMetadata` unsupported on `0.24.1` → **migrate the Gemini client to `@google/genai`** (native `videoMetadata` + `mediaResolution`) as an explicit pre-req task, then re-run the spike.
- Clipping unconfirmable on any SDK → **stop and report to user**: the feature reduces to full-video calls (cost model inverted) — re-decide worthfulness. Do not silently proceed.

`slides.ts` MUST handle both frame-of-reference outcomes defensively regardless of the spike result (see §4).

---

## 2. Architecture & Data Flow

### Module boundaries (each independently testable)

| Unit | Responsibility | Depends on |
|---|---|---|
| `lib/dig/section-window.ts` | Pure: `(ParsedSection, allSections, segments, durationSeconds) → { sectionId, startSec, endSec, transcriptWindow, summaryProse }` | `lib/html-doc/types.ts` (`ParsedSection`), segments |
| `lib/dig/generate.ts` | One Gemini call: clip + transcript window + summary prose → markdown w/ `[[TS:i]]` + `[[SLIDE:sec\|caption]]` | `lib/gemini.ts` |
| `lib/dig/slides.ts` | Resolve `[[SLIDE]]` tokens → yt-dlp segment download + ffmpeg extract → save asset → rewrite to `![](…)`. No-op + no download if zero slide tokens. **Only unit touching system binaries.** | yt-dlp, ffmpeg (new exec boundary) |
| `lib/dig/companion-doc.ts` | Idempotent upsert of a dug section into `<basename>-dig-deeper.md` (key=`sectionId`); write assets → then atomic `.md` rename | fs, atomic write |
| `lib/html-doc/render-dig-deeper.ts` | Render the dig-deeper `.md` → self-contained HTML, **base64-inlining each `![](assets/…)`** at render time; `markdown-it({ html:false })` | markdown-it |
| `app/api/videos/[id]/dig/[sectionId]/route.ts` | **POST** — create job (`createJob`), run orchestration of the units, emit progress | all `lib/dig/*` |
| `app/api/videos/[id]/dig/[sectionId]/stream/route.ts` | **GET** — subscribe to job by `?jobId=` only (no side effects) — mirrors deep-dive stream | `lib/job-registry` |
| `app/api/videos/[id]/dig-state/route.ts` | **GET** — return the dig-deeper doc's `sections[].sectionId` list (for static-HTML control toggling) | `companion-doc` read |
| `app/api/html/[id]/route.ts` (extend) | Accept `type=dig-deeper`; serve `render-dig-deeper` output | existing serve route |
| `lib/html-doc/nav.ts` (extend) | On page load, `NAV_SCRIPT` fetches `dig-state` and toggles each control (not-dug/dug); click → POST then subscribe stream | existing `wireDigLinks`, `scrollToHashSection` |
| `Video` index type (extend) | `digDeeperMd?`, `digDeeperHtml?` fields | `types.ts`, index-store |

### Data flow (one dig click)

```
[page load] NAV_SCRIPT → GET dig-state → mark each section's control dug / not-dug

[click "dig deeper ▶" on section, data-start = S]
  → POST /api/videos/[id]/dig/[sectionId]?outputFolder=…   (creates job, returns jobId)
  → GET  …/stream?jobId=…                                   (subscribe; control shows ⏳)
  server job:
    → re-parse summary .md (parseSummaryMarkdown) → ParsedSection where timeRange.startSec == sectionId
    → section-window: window = [S, nextStart ?? duration], transcriptWindow, prose
    → generate: Gemini(clip @ [S,E] + window + prose) → md with [[TS:i]] + [[SLIDE:sec|caption]]
    → resolveTranscriptTokens(out, transcriptWindow, fullVideoDuration)   → ▶ links  (H2)
    → slides.ts: if [[SLIDE]] present → yt-dlp --download-sections + ffmpeg → assets → ![](…)
                 else → no download
    → companion-doc: write assets, then atomic upsert into <basename>-dig-deeper.md; render HTML
    → job 'done'  → client flips ⏳ to "view detail ↓"
```

---

## 3. Section Windowing & Generation Contract

### 3a. `section-window.ts` (pure, no I/O)

Operates on **`ParsedSection`** (from `parseSummaryMarkdown`) — which carries `prose` (`types.ts:15`) and `timeRange.startSec`. The *magazine model* does NOT carry these (H1), so the server re-parses the summary `.md`; "summary model" elsewhere means the parsed summary.

```
windowForSection(section, allSections, segments, durationSeconds) → {
  sectionId:        section.timeRange.startSec,            // == nav data-start
  startSec:         S,
  endSec:           nextSection.timeRange.startSec ?? durationSeconds,
  transcriptWindow: segments.filter(seg => seg.offset >= S && seg.offset < endSec),
  summaryProse:     section.prose,
}
```

- `sectionId = startSec` — one identifier threads timeline/nav/resolver/upsert.
- **Orphaning on re-summarize (accepted):** drifted `sectionId` reads as undug, old block orphaned. Accepted (project avoids summary re-gen); reconcile is out of scope.
- **L1 collision (accepted, noted):** two sections sharing a start second collapse to one entry; rare, documented.
- If `section.prose` is empty after divider-stripping, fall back to the section's bullets/lead text so the prompt is never empty.

### 3b. `generate.ts` — Gemini request

```
parts: [
  { fileData: { fileUri: youtubeUrl, mimeType: 'video/mp4',
                videoMetadata: { startOffset: `${S}s`, endOffset: `${endSec}s` } } },
  { text: buildDigPrompt(lang, S, endSec) + buildIndexedTranscriptBlock(transcriptWindow) + summaryProse }
]
```
- **Model:** `gemini-2.5-pro` (`DEEPDIVE_MODEL`). **`youtubeUrl` constructed server-side from validated `videoId`** — never request-supplied (H3).
- **Media resolution:** DEFAULT (slides legible). Subject to Task 0; the `videoMetadata`/`mediaResolution` transport is exactly what Task 0 verifies. (The existing `transcribeViaGemini` already casts `mediaResolution` onto a part — `gemini.ts:546`; whether part-level fields serialize on this SDK is the spike.)
- **Output:** plain markdown, NOT JSON mode (avoids the Gemini-JSON-reliability trap).

### 3c. Token contracts — precise grammar (H5)

| Token | Grammar | Validation / resolver |
|---|---|---|
| `[[TS:i]]` | `i` = non-negative integer | existing `resolveTranscriptTokens`, fed the **window** array + **full-video duration** (H2) |
| `[[SLIDE:sec\|caption]]` | regex `\[\[SLIDE:(\d+)(?:\|([^\]]*))?\]\]` — `sec` = leading integer only; caption = everything up to the first `]`, split on the **first** `\|` | see rules below |

`[[SLIDE]]` resolver rules (`slides.ts`):
- `sec` parsed as integer; non-numeric/negative/float-with-no-leading-int → token dropped.
- Frame-of-reference per Task 0: if **absolute**, validate `sec ∈ [S,E]`; if **clip-relative**, convert `abs = sec + S` then validate. Out-of-range → dropped (lenient, mirrors timestamp resolver).
- **Dedupe:** multiple tokens with the same resolved `sec` → one extraction, first caption wins.
- **Cap enforced in code:** keep the first 3 valid tokens, drop the rest (not just prompt-enforced).
- **Caption sanitization (H4):** strip/replace `]`, `[`, `)`, `(`, `|`, newlines, control chars; collapse whitespace; cap 160 chars — before interpolation into `![caption](…)`.

**H2 — windowed resolver tail-drop (documented):** `resolveTranscriptTokens` derives duration from the array it's given and drops candidates `>= duration` (`transcript-timestamps.ts:84-97`), so a window's last segment(s) would be dropped. Mitigation: pass the **full-video `durationSeconds`** to the resolver (not the window's last offset) so window tokens near the section end still resolve. Window segments carry absolute `offset`, so watch-URLs remain correct.

### 3d. `buildDigPrompt(lang, S, E)`
Elaborate this **one** section in depth, grounded in transcript + video; **cover at least what the summary section states**, then add depth. State explicitly: "this clip covers seconds [S,E] of the video." Visual rule: when a slide/diagram/chart/code-screen conveys information the speech doesn't, emit `[[SLIDE:sec|caption]]` at the relevant point, choosing the second the slide is fully rendered, **≤3 total**. Cite key moments with `[[TS:i]]`. Match summary language (en/ko). Markdown only, no preamble.

**Known limitation:** Gemini's `sec` can land mid-transition; MVP extracts a single frame + relies on the instruction. Multi-candidate (grab `sec`, `sec±1`, pick sharpest) is phase-2.

---

## 4. Screenshot Extraction (`slides.ts`)

```
resolveSlideTokens(markdown, { videoId, startSec S, endSec E, frameOfRef }) → markdown
  0. youtubeUrl   = `https://www.youtube.com/watch?v=${videoId}`   // server-constructed (H3)
  1. parse + validate [[SLIDE:sec|caption]] per §3c (dedupe, cap 3, sanitize caption)
  2. none?        → return markdown unchanged   (NO download — the ~80% case)
  3. binaries?    → if yt-dlp OR ffmpeg missing → strip slide tokens, log, continue text-only (L4)
  4. download:    execFile('yt-dlp', ['--download-sections', `*${S}-${E}`,
                    '-f', 'bv[height<=720]', '-o', tmpPath, youtubeUrl])     // argv array, no shell (H3)
  5. per token:   abs = frameOfRef==='relative' ? sec+S : sec;  assert abs ∈ [S,E]
                  execFile('ffmpeg', ['-ss', String(abs - S), '-i', tmpClip,
                    '-frames:v','1','-q:v','2', assetPath])
                  assetPath = assertWithinAssets(raw/assets/<videoId>/<sectionId>-<abs>.jpg)   // M3, L2
                  rewrite token → ![caption](assets/<videoId>/<sectionId>-<abs>.jpg)
  6. failure (gated download / ffmpeg error / one bad frame) → drop that token (or all on
                  download failure), log [dig-slide-miss], continue text-only
  7. delete tmp clip
```

- **Spawn discipline (H3):** `execFile`/`spawn` with **argv arrays only** — never a shell string. `videoId` validated via `VIDEO_ID_RE` (`index-store.ts:8`); `sec/S/E` coerced to `Number` then re-stringified.
- **Asset-path guard (M3):** dedicated assertion — resolve the asset path and require `startsWith(rawAssetsRoot + sep)`. The PR#13 `.md`-filename guard does **not** cover this; new guard required.
- **Filename keyed by `<sectionId>-<abs>` (L2):** avoids boundary-overlap collisions between sections sharing an absolute second.
- **Download caveat (M2):** `--download-sections` may fetch a larger prefix for some formats (no true ranged seek); "section-only" is best-effort, not guaranteed. Bandwidth, not correctness.
- **Frame quality:** `-q:v 2` JPEG, ~100–300 KB, ≤3/section.
- **Temp clip** → gitignored `.cache/`; **extracted JPEGs** committed in `raw/assets/<videoId>/` (deliverable corpus).

### Embed conventions (M4 — locked invariant)

| Target | Embed form | Invariant |
|---|---|---|
| Markdown / Obsidian | `![caption](assets/<videoId>/<file>.jpg)` (relative to `raw/`) | resolves because the `.md` lives in `raw/` |
| Exported HTML | **base64 data-URI, always** | HTML must NEVER use a relative `img src` (it lives in `raw/htmls/`, would 404). `render-dig-deeper.ts` reads the JPEG and inlines base64. |

---

## 5. Dig-Deeper Doc — Output File Format

- **Filename:** `<summary-basename>-dig-deeper.md` in `raw/` (mirrors `<basename>-deep-dive.md`; distinct name → no collision with the 23 legacy deep-dive docs).
- **Frontmatter:**
```yaml
---
title: "<video title> — Dig Deeper"
videoId: uvg9UmI0PuQ
language: en
digVersion: { major: 1, minor: 0 }    # provenance stamp only (M6): records generator version
sourceVideoUrl: https://www.youtube.com/watch?v=uvg9UmI0PuQ
sections:                              # upsert key + dig-state source (B1)
  - sectionId: 312
    startSec: 312
    generatedAt: 2026-06-24T12:00:00Z
---
```
- **`digVersion` (M6):** a **provenance stamp only** — records which generator version produced each block. It does **not** drive auto-regeneration (no version-gated re-render). Regeneration is solely via the `↻` force action.
- **Body:** one `## <title>` per dug section, ordered by `startSec`, each with ▶ link, prose (▶ links + inline slide screenshots).
- **Idempotent upsert:** re-dig overwrites that section's block (matched by `sectionId`), preserves others, re-sorts by `startSec`.
- **Versioning:** independent of summary/deep-dive versions — **no summary version bump** (sidesteps the 236-Gemini trap).

### Annotated sample body
```markdown
## How the agent loop works  ▶ <a class="ts" data-t="312">5:12</a>

The speaker frames the loop as three phases… At ▶ <a class="ts" data-t="345">5:45</a> he contrasts…

![Agent loop diagram: perceive, plan, act around the context window](assets/uvg9UmI0PuQ/312-352.jpg)

The diagram shows the context window between plan and act, which the transcript only alludes to…
```

---

## 6. UI Contract

### Trigger states (client logic in `nav.ts`; dug-state from `dig-state` route on load — B1)

| State | Appearance | Transition |
|---|---|---|
| Not dug | `dig deeper ▶` | click → POST job → subscribe stream → **Loading** |
| Loading | `⏳` (disabled) | stream `done` → **Dug**; `error` → **Error** |
| Dug | `view detail ↓` (link to companion section) | click → navigate; `↻` → POST `&force=1` → **Loading** |
| Error | `⚠ retry` + tooltip | click → **Loading** |

Non-blocking; each control tracks its own state. The static HTML's disabled state is **not authoritative** — the server enforces the in-flight guard (H7).

### URL Contracts (B2 — money-spending action is POST, never GET)

| Component | Text | Method + URL |
|---|---|---|
| Dig trigger | `dig deeper ▶` | **POST** `/api/videos/[id]/dig/[sectionId]?outputFolder=<enc>` → `{ jobId }` |
| Force re-dig | `↻` | **POST** same URL `+ &force=1` |
| Progress stream | (internal) | **GET** `/api/videos/[id]/dig/[sectionId]/stream?jobId=<jobId>` |
| Dug-state (on load) | (internal) | **GET** `/api/videos/[id]/dig-state?outputFolder=<enc>` → `{ sectionIds: number[] }` |
| View companion section | `view detail ↓` | **GET** `/api/html/[id]?outputFolder=<enc>&type=dig-deeper#t=<startSec>` |

### Overlay Dismissal
**N/A — no overlay/modal** (D4 inline non-blocking control). Error dismissed via `⚠ retry` (→ Loading) or navigation. Blocking overlay explicitly rejected.

---

## 7. Error Handling & Concurrency

| Failure | Behavior |
|---|---|
| Empty transcript window | Generate from prose + clip; no `[[TS:i]]` — valid (M5: thin output is a known low-value case) |
| Gemini call fails (after retry wrapper) | job `error`; **no** doc mutation; control → Error |
| yt-dlp gated/fails OR **binary missing** (L4) | strip `[[SLIDE]]`, log `[dig-slide-miss]`, write doc **text-only** (never 500) |
| ffmpeg fails for one frame | drop that frame, keep others |
| **Same-section concurrent dig (H7)** | per-`(videoId, sectionId)` **in-flight guard** in the job layer: a second dig of a section already Loading is **coalesced/rejected** (server-authoritative, not reliant on the static HTML disabled state) |
| Cross-doc write race | per-companion-doc serialized read-modify-write; **write assets first, then atomic `.md` rename** referencing them (renderer never sees a doc pointing at a missing asset) |
| Path safety | `videoId` via `VIDEO_ID_RE`; dedicated **asset-path containment guard** (M3); `.md` path guard (PR#13) for the doc |
| Caption injection (H4) | sanitize per §3c; companion renderer uses `markdown-it({ html:false })` |

---

## 8. Caching / Re-dig
The dig-deeper doc **is** the cache. Dug section → control links to it (no regen). `↻ force=1` overwrites that one block via idempotent upsert; others preserved.

---

## 9. Testing Strategy

- **Unit (jest):**
  - `section-window`: last-section→duration, empty window, boundaries, prose-empty fallback, L1 collision.
  - `slides`: `[[SLIDE]]` grammar (pipe/`]]`/newline in caption, non-numeric/negative/float `sec`, >3 cap, duplicate-sec dedupe, caption sanitization), absolute vs clip-relative conversion, out-of-range drop, asset-path containment, binary-missing fallback — yt-dlp/ffmpeg mocked at the **exec boundary**.
  - `companion-doc`: idempotent upsert, ordering, preserve-others, assets-before-doc ordering.
  - `generate`: request shape (clip offsets, server-constructed URL) with gemini mocked.
- **Component (RTL):** four control states; dug-state toggling from `dig-state` payload.
- **E2E (Playwright, mock at API route):** fixtures cover a section **with** slides and one **without** (null/non-null rule); assert **all** URL params (`outputFolder`, `type`, `sectionId`, `jobId`, `#t`); POST-then-stream flow; error path; verify the trigger is **POST** (a bare GET must not generate — B2).
- **Behaviors adversarial review:** triggered (>8 behaviors + SSE state machine + multiple error paths) — run against the plan's Enumerated Behaviors table.

### New mocking boundary
| Boundary | Mocked |
|---|---|
| `lib/dig/slides.ts` exec (yt-dlp, ffmpeg) | spawned process calls — no real downloads/extraction in unit tests |

---

## 10. Open Risks (carry into plan review)

1. **B3/B4/M1 — clip-grounding + cost** → resolved by **Task 0 spike** (§0) before any other work; decision gate documented there.
2. **YouTube gating / missing binary** — text-only fallback, scoped to slide-heavy sections.
3. **Frame accuracy** — single-frame MVP; multi-candidate phase-2.
4. **Long sections** crossing the 200k tier — rare, accepted.
5. **Binary assets in corpus** — `raw/assets/` JPEGs committed (data repo); `.cache/` video temp gitignored (L3 — resolved, not deferred).
6. **SDK migration risk** — if Task 0 forces `@google/genai`, that migration touches all of `lib/gemini.ts`; size/scope to be assessed when the gate fires.
