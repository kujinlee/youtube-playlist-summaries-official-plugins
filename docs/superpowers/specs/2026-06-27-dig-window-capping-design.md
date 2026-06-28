# Dig Window-Capping via Gemini-Provided Slide Windows

**Date:** 2026-06-27
**Status:** Design (rev 3 — Gemini-window pivot) — pending user review
**Component:** `lib/dig/generate.ts` (prompt), `lib/dig/slide-tokens.ts` (parser), `lib/dig/slides.ts` (capture)
**Version impact:** `DIG_GENERATOR_VERSION` 5 → 6

> **Supersedes** the rev-2 mechanical design (extend-on-demand probing + ffmpeg
> scene-threshold cut detector). Two measurement spikes (below) showed Gemini emits the slide's
> start/end **accurately** and **collapses animated builds** when asked plainly — so the boundary
> moves from a fragile pixel-diff heuristic to Gemini's semantic understanding, and the capture
> code shrinks dramatically.

---

## 1. Problem

When a "dig deeper" section has `[[SLIDE:sec|caption]]` tokens, `resolveSlideTokens` downloads
**one clip spanning the entire section window** `[startSec, endSec]` (the gap to the next
section). On sparsely-sectioned long videos this is enormous: a 51-minute livestream's deep
sections produced **19.5- and 11-minute** downloads (~70 MB), which blew past timeouts and tripped
YouTube **HTTP 403 rate-limiting** (`[dig-slide-miss] yt-dlp failed`, 2026-06-27). We download ~20
minutes of video to use ≤3 frames. The download span is tied to inter-section distance, not to
where the slide actually is.

---

## 2. Empirical grounding (two spikes, 2026-06-27)

**Spike 1 — frame accuracy** (24 v5-emitted tokens, contact sheets): slides fall into three
regimes — **stable** (~40%, complete at `sec`), **fast-cut** (~30%, complete at `sec` but replaced
within seconds), **animated build** (~25%, still assembling at `sec`, settling up to ~15s later,
beyond the old 8s window). It also showed the v5 "largest JPEG in an 8s forward window" heuristic
**picks the wrong slide** in fast-cut decks and that `scene` detection at 0.4 **misses soft fades**.

**Spike 2 — duration reliability** (8 slides) and **Spike 3 — collapse prompt** (6 slides): asking
Gemini (via the same clipped-video REST call the pipeline already uses) to emit each slide's
`START|END` returned **well-formed, captioned `[[SLIDE:start|end|caption]]` for 100%** of slides,
with boundaries within **~±1–2s** of the visual truth — *including the exact fast-cut case
(`sec=333 → 333–339`) where the mechanical cut detector reported `scene:none`.* With a production-
style prompt ("one entry per slide; for an animated build, point START at the FULLY ASSEMBLED
moment"), Gemini **collapsed builds into a single settled token** (the 113 build: 5 step-tokens →
one `135–137` at the fully-assembled diagram) while **not over-merging genuinely distinct slides**
(the 333 fast-cut deck stayed 5 separate slides).

**Conclusion:** Gemini reliably supplies an accurate, build-aware `[start, end]` window per slide.
The boundary problem the rev-2 mechanical layer solved badly is solved well upstream, for free
(the dig call already watches the clip). The local pipeline keeps only its one reliable job:
pick the most-built frame within a known window.

---

## 3. Design — Gemini-provided window

```
Dig prompt  ──►  Gemini emits  [[SLIDE:start | end | caption]]   (start = settled, end = replaced)
                                      │
                                      ▼
            download  [start, min(end, start + MAX_CAPTURE_SEC)]   ── ONE yt-dlp call, exact lifespan
                                      │
                                      ▼
            sample @ SAMPLE_FPS ──► pick the largest JPEG (most-built frame) ──► write asset
```

### 3.1 Prompt (`buildDigPrompt`)
Extend the SLIDE instruction to request a **start and end** and to **collapse builds**:
- Emit `[[SLIDE:M:SS|M:SS|caption]]` where the **first** time is the moment the slide is **fully
  built/settled** and the **second** is when it is **replaced or leaves the screen**.
- For an animated build/diagram that assembles in steps, emit **ONE** entry at the fully-assembled
  moment — do not list each step.
- All other rules unchanged (only true graphics/code/CLI; never title cards/bullets/speaker; caption
  has no `[ ] ( ) |`; ≤3 per section; most sections emit zero).

### 3.2 Parser (`parseSlideTokens`)
Grammar becomes `[[SLIDE:<time>|<time>|<caption>]]`. Parsing is **tolerant** (Gemini may
occasionally drift): the first field must be a time (`start`); if the second field also parses as a
time it is `end`, otherwise it is treated as the caption and `end` is `null`. `SlideToken` carries
`{ startSec, endSec: number | null, caption, raw }`. Validation: `start ∈ [windowStart, windowEnd]`;
if `end` present, require `end > start` and clamp `end` to `windowEnd`; else `end = null`. Dedup by
`startSec`, cap at 3 (unchanged).

### 3.3 Capture (`captureSlideFrame`)
Per token, **one** bounded download, no probing, no cut detection:
- `winEnd = (endSec && endSec > startSec) ? min(endSec, startSec + MAX_CAPTURE_SEC) : startSec + DEFAULT_FWD`
- `yt-dlp --download-sections *startSec-winEnd` (one clip).
- Sample at `SAMPLE_FPS`; **`pickLargestFile`** over the sampled frames = the most-built frame.
  Because the window starts at Gemini's *settled* `start` and is bounded by its `end`, the largest
  frame is the settled slide — and never the previous or next slide (they are outside the window).
- Write the chosen frame to the asset path; delete the temp clip in `finally`.

`MAX_CAPTURE_SEC` (~10) bounds the download even for a slide that stays on screen for minutes
(a stable slide's frame is identical throughout, so a short capture suffices). `DEFAULT_FWD` (~6)
is the fallback span when Gemini omits a usable `end`.

---

## 4. Architecture & units

| File | Change | Why |
|---|---|---|
| `lib/dig/generate.ts` | `buildDigPrompt` SLIDE rule → start/end + collapse; bump version | semantic window source |
| `lib/dig/slide-tokens.ts` | grammar + `SlideToken.endSec`; tolerant parse + validation | carries the window |
| `lib/dig/slides.ts` | `captureSlideFrame` = bounded one-call download + `pickLargestFile`; delete `captureBestFrame`, `singleFrameCapture`, `parseFirstSceneChange` | shrinks to one reliable job |

**Reused as-is:** `pickLargestFile` (already pure + unit-tested), `clockToSeconds`,
`sanitizeCaption`, `stripUnresolvedSlideTokens`, `resolveAssetPath`, `assertVideoId`,
the `[dig-slide-miss]` degradation pattern. **Net deletion** of the rev-2 cut-detector / extend
machinery — `frame-select.ts` is **not** created.

---

## 5. Error handling & degradation

- **Gemini omits/!parses `end`** → `endSec = null` → capture uses `startSec + DEFAULT_FWD` (a sane
  bounded window). No failure.
- **`end <= start` or out of range** → treated as missing (fallback window); `end` clamped to the
  section `endSec` when valid-but-too-large.
- **`yt-dlp` fails (ENOENT / 403 / gated)** → strip that token (`[dig-slide-miss]`), per-token; other
  tokens unaffected.
- **No frames sampled** → drop that token.
- Temp clip always deleted in `finally`. Security invariants unchanged: `assertVideoId` before any
  exec; server-built `youtubeUrl`; `execFile` argv-only; asset-path containment before write.

---

## 6. Testing strategy

- **Parser** (`slide-tokens.test.ts`): `start|end|caption` parses to `{startSec, endSec, caption}`;
  tolerant fallback (`start|caption` → `endSec null`); `end<=start` → null; `end>windowEnd` → clamp;
  out-of-range `start` dropped; dedup by start; ≤3 cap; caption sanitation unchanged.
- **Prompt** (`generate.test.ts`): `buildDigPrompt` contains the start/end + collapse instruction;
  version assertion → 6.
- **Capture** (`slides.test.ts`, mocked `child_process`): one `yt-dlp` call per token; window =
  `[start, min(end, start+MAX_CAPTURE_SEC)]`; `endSec null` → `[start, start+DEFAULT_FWD]`; largest
  frame written; yt-dlp fail → token stripped, others kept; security (server-built URL, argv-only).
- **Regression:** existing suites green; delete tests for removed helpers.
- TDD; `tsc --noEmit` gate (Jest = SWC, no typecheck).

---

## 7. Scope

**In:** prompt start/end + collapse; parser grammar + `endSec`; bounded one-call capture +
`pickLargestFile`; delete cut-detector/extend helpers; version 5 → 6.
**Out (follow-ups):** 3-token-per-section cap (editorial/coverage, a prompt-policy lever);
re-asking Gemini to *pick the frame* (only if the size-profile backstop proves too crude in
practice); re-sectioning long livestreams (upstream summary concern).

---

## 8. Migration

v5 → 6 makes existing dug sections show the `↻ outdated` affordance (version-gated, lazy — no Gemini
on page load). Re-dig applies the new prompt + bounded capture. Companion-doc schema unchanged
(`genVersion` per section). The previously-pathological livestream sections re-dig fast and
rate-limit-safe (download is now the slide's own ~seconds-long lifespan).

---

## 9. Constants (env-overridable via `numEnv`, `DIG_` prefix)

| Constant | Initial | Source |
|---|---|---|
| `MAX_CAPTURE_SEC` | 10 | bounds download for long-lived slides; covers slight-early `start` |
| `DEFAULT_FWD` | 6 | fallback window when Gemini omits a usable `end` |
| `SAMPLE_FPS` | 2 | unchanged |

Removed: `SCENE_THRESHOLD`, `MAX_WINDOW_SEC`, and the rev-2 `BACK_PAD`/`BASE_FWD`/`EXTEND_SEC`/`MAX_EXTENDS`.

---

## 10. Open risks

1. **Gemini collapse-prompt compliance** — validated on 6 slides across regimes (builds collapsed,
   fast-cuts preserved), but not guaranteed on every style. **Backstop:** `pickLargestFile` within
   `[start, end]` selects the most-built frame even if `start` is slightly early, and the window
   bound prevents wandering into adjacent slides. A missed-collapse degrades to "a slightly less
   complete frame," never a wrong-slide frame.
2. **`end` accuracy too generous** (Gemini overshoots into the next slide) — bounded by
   `MAX_CAPTURE_SEC`, and `pickLargestFile` favors the current slide's settled frame over a
   just-appearing next slide within the short capture window. If observed in practice, tighten
   `MAX_CAPTURE_SEC` or revisit.
3. **3-token cap interaction** — busy fast-cut sections still cap at 3 real slides (unchanged,
   out of scope).
