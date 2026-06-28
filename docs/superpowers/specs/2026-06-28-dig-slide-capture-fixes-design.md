# Dig Slide Capture Fixes — Trailing-Edge Selection, Curated Progression, End Persistence

**Date:** 2026-06-28
**Status:** Design — pending user review
**Component:** `lib/dig/generate.ts` (prompt), `lib/dig/slide-tokens.ts` (parser), `lib/dig/slides.ts` (capture), `lib/dig/companion-doc.ts` (frontmatter)
**Version impact:** `DIG_GENERATOR_VERSION` 6 → 7
**Builds on:** the v6 Gemini-window design (`2026-06-27-dig-window-capping-design.md`, PR #35).

---

## 1. Problem (observed in v6, 2026-06-28)

Section 160 of `2kKkb01GxYQ` re-dug at v6 captured the **wrong frame** for slide 2: `160-171.jpg`
shows the *previous* slide (a directory listing), duplicating slide 1, instead of the intended
YAML-concept slide.

**Root cause (evidence-confirmed):** Gemini emitted `start=171` for the YAML slide, but at t=171 the
*previous* slide is still on screen — the directory→YAML transition is at ~171.5 and the YAML slide
settles ~176. `captureSlideFrame` downloads `[171, winEnd]` and picks the **largest JPEG**
(`pickLargestFile`); the lingering directory-listing frame (~62 KB) is larger than the settled YAML
frame (~44 KB), so it wins. A size profile of t=166–180 confirmed the transition timing and the
size inversion.

This is the "wrong-slide-via-largest-JPEG when `start` is early" risk (flagged M-3 in the PR-35
review), now reproduced. A 3× re-run of Gemini on this section confirmed **`start` varies run-to-run
by 1–3s** (171 / 172 / 173 for the same slide) and can land *before the slide appears* — so this is
systemic, not a one-off.

### Secondary findings (from the same investigation)
- **`end` is reliable; `start` is the unreliable edge.** Gemini brackets the slide's real on-screen
  span well at the *trailing* edge (`end` ≈ when it's replaced); the leading edge is where the
  contamination lives.
- **No observability.** Nothing persisted Gemini's `end` or which frame we picked, making the bug
  hard to diagnose.
- **`start`-only dedup is destructive.** Gemini can emit the same slide twice with different ends
  (a genuine build *progression*); dedup-by-`start` silently drops one.
- **Filenames orphan on every re-dig.** Gemini's `start` non-determinism means
  `sectionId-start.jpg` changes each re-dig, leaving stale assets.
- **Prompt is over-restrictive.** The v6 "collapse builds to ONE token" + "≤3 slides" loses
  genuine progressions and under-serves visually dense sections.

---

## 2. Empirical grounding (spikes, 2026-06-28)

- **Transition timing:** size profile of `[166,180]` → directory listing through ~171, fade at
  171.5, YAML builds 172→176, settled 176+. Gemini's `start=171` lands on the previous slide.
- **`start` variance:** 3 re-runs of §160 → the YAML slide at 171/172/173; `end`s consistently
  bracket the real span (e.g. directory `160–171`, YAML `173–180`).
- **Prompt revision spikes (count + progression):** a relaxed prompt **tracks visual density** —
  dense animated-deck video (`2kKkb01GxYQ`) → 4–7 real diagrams/section; talking-head video
  (`1dYp9ymqy_g`) → 0–2/section. The **progression exception worked** (a 2-stage knowledge-graph
  build: "unconnected nodes" `194–195` → "connected graph" `196–202`). The count is genuine, not
  padding — so count is a *curation/cost* choice, settled below.

---

## 3. Design

Six coupled changes, all under `DIG_GENERATOR_VERSION` 6 → 7.

### 3.1 Fix (A) — trailing-edge frame selection (the core bug fix)
`end` reliably marks the slide; `start` is the contaminated edge. So select the most-built frame
from the **trailing portion** of the window, not the whole window:
- Sample `[startSec, winEnd]` at `SAMPLE_FPS` as today.
- `pickLargestFile` only over frames with `offset ≥ startSec + (winEnd − startSec) · TAIL_FRACTION`
  (`TAIL_FRACTION = 0.5` default). This skips the leading previous-slide contamination while still
  landing on the settled frame (for builds, the settled state is in the latter part too).
- Worked through the bug: YAML window `[171,181]` → trailing half `[176,181]` = settled YAML ✓;
  directory `[160,171]` → trailing half `[165.5,171]` = directory ✓ (stays correct).
- Capture **returns the picked frame's absolute timestamp** (`pickedSec`, sub-second per
  `1/SAMPLE_FPS`) for persistence.

### 3.2 Prompt — curated count + progression exception
- **Progression:** keep one-token-per-visual by default, but allow one token **per instructive
  stage** when the intermediate stages teach something the final frame cannot. (Validated.)
- **Count:** replace "≤3 / collapse" with curation: *"Select at most 4 — typically 1–3 — only the
  most essential visuals; in a slide-heavy talk do NOT reproduce every slide, curate the handful a
  reader most needs; omit any visual whose point the prose already carries."* A firm cap of **4**
  (hard caps are respected reliably; the old ≤3 held).
- **Tighten** the speaker-on-camera exclusion (a split-screen-with-speaker false positive appeared):
  *"never for a speaker on camera, including split-screen, unless slide content is the actual point."*

### 3.3 Parser — `(start, end)` dedup + raised ceiling
- `SlideToken` already carries `{ sec, endSec }`. **Dedup by `(sec, endSec)`** instead of `sec`, so
  same-start/different-end progression frames both survive; exact duplicates still drop.
- **Hard cap 3 → 5** (runaway guard one above the prompt's editorial 4).

### 3.4 Filename — `sectionId-start-end.jpg`
- `start`, `end` are integer seconds → clean, e.g. `160-171-181.jpg`. Uniquely identifies a slide
  even for same-start progression. (`pickedSec` is sub-second → goes in frontmatter, not the name.)
- When `endSec` is null (Gemini omitted it), use the fallback window's end: `start + DEFAULT_FWD`,
  so the filename always has a definite second value.

### 3.5 Delete-on-re-dig — orphan elimination
Gemini non-determinism makes orphans inevitable (`start`/`end` change each re-dig → new filenames).
Fix: **write the section's new assets first, then prune** — after a section's tokens are captured,
delete any `assets/<videoId>/<sectionId>-*.jpg` **not** among the just-written filenames. Write-then-
prune ordering guarantees a failed/partial re-dig never wipes the prior good set (new assets exist
before any old one is removed; if zero new were written, prune nothing). Scoped strictly to the
section's `sectionId-` prefix.

### 3.6 Frontmatter — persist `{ start, end, pickedSec }` per slide
Add a per-slide record to the companion-doc frontmatter for observability: window `[start, end]`
and the actual `pickedSec`. This is exactly what was missing to diagnose §1. Companion-doc schema
gains an optional per-slide list under each section; rendering is unaffected (body still carries the
image refs).

---

## 4. Architecture & flow

```
prompt (3.2) → Gemini [[SLIDE:start|end|caption]] (≤4, progression-aware)
  → parser (3.3): dedup (start,end), cap 5, SlideToken{sec,endSec,caption}
  → per token, captureSlideFrame:
       winEnd = clamp(end? min(end,start+MAX_CAPTURE_SEC) : start+DEFAULT_FWD, ≥ start+1)
       sample [start, winEnd] @ SAMPLE_FPS
       pickLargestFile over TRAILING portion (3.1) → pickedSec
       write asset → sectionId-start-end.jpg (3.4)
  → upsert: delete-on-re-dig (3.5) + frontmatter {start,end,pickedSec} (3.6)
```

**Reused:** `pickLargestFile` (now over a filtered frame subset), `clockToSeconds`,
`sanitizeCaption`, `assertVideoId`, security invariants, the `[dig-slide-miss]` degradation.

---

## 5. Error handling & degradation
- **`end` null** → fallback window `[start, start+DEFAULT_FWD]`; trailing-portion selection still
  applies; filename uses `start+DEFAULT_FWD` as the end component.
- **`yt-dlp` / no-frames** → strip that token (per-token), others unaffected (unchanged).
- **Delete-on-re-dig** is write-then-prune: new assets are written before any old `sectionId-*` is
  removed, so a failed/partial re-dig leaves the prior set intact (nothing written → nothing pruned).
- Security invariants unchanged (validate id before exec, server-built URL, argv-only, containment
  before write, temp cleanup in finally).

---

## 6. Testing strategy
- **Selection (`slides.test`):** trailing-portion `pickLargestFile` ignores leading frames — given a
  window where the largest frame is in the first half, assert the chosen frame is from the trailing
  half. Window math + `pickedSec` returned.
- **Parser (`slide-tokens.test`):** dedup by `(start,end)` keeps same-start/different-end, drops
  exact dups; cap 5.
- **Prompt (`generate.test`):** progression-exception wording present; "at most 4" + curation
  present; tightened speaker exclusion; version 7.
- **Filename:** `sectionId-start-end.jpg`; null-end → `start-(start+DEFAULT_FWD)`.
- **Companion-doc (`companion-doc.test`):** frontmatter round-trips the per-slide `{start,end,pickedSec}`.
- **Delete-on-re-dig:** writing a section clears prior `sectionId-*`; a failed capture doesn't wipe
  the prior set.
- TDD; `tsc --noEmit` gate.

---

## 7. Scope
**In:** fix (A) trailing-edge selection; prompt progression + curated count (≤4) + speaker tighten;
parser `(start,end)` dedup + cap 5; `sectionId-start-end` filename; delete-on-re-dig; frontmatter
`{start,end,pickedSec}`; version 6→7.
**Out (follow-ups):** re-asking Gemini to *pick* the frame; re-sectioning long videos; tuning
`TAIL_FRACTION`/`SAMPLE_FPS` beyond defaults.

---

## 8. Migration
v6→7 makes existing dug sections show `↻ outdated`. Re-dig applies trailing-edge selection (correct
slide), the new filename scheme, delete-on-re-dig (clears v5/v6 orphans for that section), and
frontmatter persistence. No bulk migration; lazy per-section on re-dig.

---

## 9. Constants (env-overridable via `numEnv`, `DIG_` prefix)
| Constant | Initial | Note |
|---|---|---|
| `TAIL_FRACTION` | 0.5 | selection considers only the back half of the window |
| `MAX_CAPTURE_SEC` | 10 | unchanged (download cap) |
| `DEFAULT_FWD` | 4 | unchanged (null-end fallback) |
| `SAMPLE_FPS` | 2 | unchanged (→ pickedSec 0.5s resolution) |
| slide hard cap | 5 | parser ceiling (prompt editorial target 4) |

---

## 10. Open risks
1. **`start` *very* early (>½ window before the slide)** → even the trailing half could include the
   previous slide. Rare (variance is 1–3s, window ≥ ~8s); if seen, lower `TAIL_FRACTION` further or
   anchor strictly on `end`. `pickedSec` in frontmatter makes such cases diagnosable.
2. **Curated cap vs. genuinely dense sections** — capping at 4 drops some real visuals on slide-deck
   videos (deliberate product choice; expressiveness vs. download cost).
3. **Prompt drift on "at most 4"** — bounded hard by the parser ceiling (5); verify on re-dig.
