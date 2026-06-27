# Dig Deeper: Capture the Most-Complete Frame of an Animated Slide

**Date:** 2026-06-26
**Status:** Design — awaiting user review
**Builds on:** PR #30 (code/config slides as images). Stacked branch `feat/dig-frame-capture-quality`.

---

## Problem

Dig-deeper slide capture grabs **one frame at one instant** — the exact second Gemini named in
`[[SLIDE:M:SS]]`:

```
ffmpeg -ss <token.sec - startSec> -i clip -frames:v 1 -q:v 2 out.jpg
```

Many presentation slides are **animated builds**: content populates progressively and the slide is
only fully formed near the *end* of its on-screen span. The slide can even change within a single
second. So the single captured frame frequently lands on a blank or half-built state — the doc shows
an early/incomplete frame instead of the informative one.

**Goal:** capture the most-complete frame of the slide the timestamp points at, without crossing
into the next slide.

---

## Approach (confirmed with user)

Two cooperating parts:

### A — Prompt nudge
Instruct Gemini to emit the `[[SLIDE:M:SS]]` timestamp while the slide is **fully visible / settled**
(not at first appearance). This keeps `token.sec` *inside* the target slide's span. It need not be
frame-accurate — part B handles sub-second precision.

### B — Scene-bounded sampling, keep the largest frame
1. **Find the slide boundary** — the next *slide transition* after `token.sec` — via ffmpeg
   scene-change detection (`select='gt(scene,T)'`, **T = 0.4**). A full slide swap is a large
   frame-to-frame delta; an animated build is a series of small deltas, so a moderate threshold
   catches the swap and ignores the build.
2. **Window** = `[token.sec, min(firstSceneChange, token.sec + MAX_WINDOW_SEC, endSec)]`.
   - `MAX_WINDOW_SEC = 8` — fallback cap when no clean transition is detected (e.g. a continuous
     video clip rather than slides).
3. **Sample** the window at **SAMPLE_FPS = 2** (one ffmpeg pass, `fps=2`) into a temp dir.
4. **Select** the **largest JPEG** (fixed `-q:v 2`) as the asset. Because the window spans exactly
   one slide, every sampled frame is the same slide at a different build stage, so largest-file =
   most on-screen content = the completed build. (The completed frame sits at the end of the span,
   which the largest-file rule selects naturally.)

**Why next-token is NOT the boundary:** Gemini emits ≤3 `[[SLIDE:]]` tokens per section, so two
tokens can be many slides apart. Scene detection finds the *immediate* next slide; the token list
cannot.

**Why largest-file works only when bounded:** the heuristic is reliable solely because the window is
confined to one slide. Without the scene boundary, "largest" could pick a frame from the next slide
or an unrelated photo. The boundary turns a fragile global heuristic into a robust local one.

---

## Constants (named, env-overridable for tuning)

Each is a named constant with an env override so values can be tuned during testing without a
rebuild. Default applies when the env var is unset or non-numeric.

| Name | Default | Env override | Rationale |
|---|---|---|---|
| `SCENE_THRESHOLD` | `0.4` | `DIG_SCENE_THRESHOLD` | Ignore intra-slide animation deltas, catch slide swaps. Tune per real decks. |
| `MAX_WINDOW_SEC` | `8` | `DIG_MAX_WINDOW_SEC` | Fallback window cap when no transition is detected. |
| `SAMPLE_FPS` | `2` | `DIG_SAMPLE_FPS` | Frame sampling density within the window. |

Pattern: `const SCENE_THRESHOLD = numEnv('DIG_SCENE_THRESHOLD', 0.4);` where `numEnv(name, def)`
returns `Number(process.env[name])` when finite, else `def`.

---

## Components

All in `lib/dig/slides.ts` (plus a prompt edit in `lib/dig/generate.ts`):

1. **`parseFirstSceneChange(ffmpegOutput: string, maxFallbackSec: number): number`** — pure parser.
   Reads ffmpeg scene/showinfo output, returns the offset (seconds, relative to the window start) of
   the first detected scene change, or `maxFallbackSec` if none. Unit-testable in isolation.
2. **`pickLargestFile(dir: string): string | null`** — returns the path of the largest file in a
   directory (the sampled frames), or null if empty. Unit-testable with a temp dir.
3. **`captureBestFrame(...)`** — orchestrates: (a) ffmpeg scene-detect pass over
   `[winStart, winStart + MAX_WINDOW_SEC]` → `parseFirstSceneChange`; (b) compute window end;
   (c) ffmpeg `fps=SAMPLE_FPS` extract into temp dir; (d) `pickLargestFile`; (e) move chosen frame
   to the asset path; (f) clean up temp frames. Replaces the current single-frame `ffmpeg` call
   inside `resolveSlideTokens`.

The existing failure handling is preserved: per-token ffmpeg failure → drop that token (logged
`[dig-slide-miss]`); the `stripUnresolvedSlideTokens` safety net still runs.

---

## ffmpeg commands

Offsets are relative to the downloaded clip (which spans `[startSec, endSec]`), so the clip-relative
start is `token.sec - startSec`.

**Scene detection** (find the next transition; parse `pts_time` of first selected frame):
```
ffmpeg -ss <relStart> -t <MAX_WINDOW_SEC> -i clip \
  -vf "select='gt(scene,0.4)',showinfo" -f null -
```

**Frame sampling** (window `[relStart, relStart + winLen]`):
```
ffmpeg -ss <relStart> -t <winLen> -i clip -vf fps=2 -q:v 2 <tmpdir>/f_%03d.jpg
```

All exec calls stay on `execFile` with array argv — never a shell string (existing security
invariant). `videoId` containment + assetsRoot containment guards are unchanged.

---

## Versioning & migration

- **Bump `DIG_GENERATOR_VERSION` 4 → 5.** Existing dug sections re-flag `↻ outdated`; lazy re-dig
  re-captures slides with the new logic and the settled-timestamp prompt. No bulk regen, no data
  script (same mechanism as prior bumps).

---

## Testing

| Layer | Test |
|---|---|
| `parseFirstSceneChange` | pure unit: sample ffmpeg showinfo text with a scene change → correct offset; no scene change → `maxFallback`; malformed → `maxFallback`. |
| `pickLargestFile` | temp dir with files of known sizes → returns the largest; empty dir → null. |
| `captureBestFrame` / `resolveSlideTokens` | mock `execFile` (existing pattern): scene-detect stderr returns a transition; the fps pass "creates" frames; assert the largest is chosen and moved to the asset path; assert window is bounded by the detected scene change (not MAX) when a transition exists, and by MAX when none. |
| Prompt | `generate.test.ts`: prompt instructs the settled/fully-visible timestamp; `DIG_GENERATOR_VERSION === 5`. |
| Security/argv | existing invariant tests (execFile array argv) still green for the new ffmpeg calls. |

**Honest limit:** `SCENE_THRESHOLD` is content-dependent; 0.4 is a starting value. CI verifies the
selection *logic* (given a detected boundary, the largest in-window frame wins); whether 0.4 cleanly
separates build-from-swap on a given deck is verified by re-digging a real animated section.

---

## Out of scope

- Per-deck adaptive thresholds / ML frame-quality scoring (start with largest-file + fixed 0.4).
- Changing the ≤3 slide cap or the code→image policy (PR #30).
- Edge/ink-density selection metric — only if largest-file proves unreliable in practice.

---

## Enumerated Behaviors

| # | Behavior | Trigger | Expected |
|---|---|---|---|
| 1 | Bounded by scene change | transition detected at +3s within window | window end = +3s; largest frame in `[token.sec,+3s)` chosen |
| 2 | Bounded by MAX when no transition | no scene change in 8s | window end = token.sec + 8s |
| 3 | Bounded by endSec | token.sec near endSec | window end = endSec (never past clip) |
| 4 | Largest frame wins | sampled frames of increasing size | largest (last-built) selected |
| 5 | Single frame in window | tiny window (settled at slide end) | that frame chosen |
| 6 | ffmpeg sampling fails | extract pass errors | token dropped, `[dig-slide-miss]` logged, no leak |
| 7 | Scene-detect fails | scene pass errors | fall back to MAX window, continue sampling |
| 8 | Prompt nudge | build prompt | instructs settled/fully-visible timestamp |
| 9 | Version | read `DIG_GENERATOR_VERSION` | equals `5` |
