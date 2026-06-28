# Dig Window-Capping + Anchor-Aware Frame Selection (3′)

**Date:** 2026-06-27
**Status:** Design — pending user review
**Component:** `lib/dig/slides.ts` (slide-token → frame resolution)
**Version impact:** `DIG_GENERATOR_VERSION` 5 → 6

---

## 1. Problem

When a "dig deeper" section contains `[[SLIDE:sec|caption]]` tokens, `resolveSlideTokens`
downloads **one clip spanning the entire section window** `[startSec, endSec]` and extracts
a frame per token. The window's `endSec` is the *next section's* start (`windowForSection`),
so on sparsely-sectioned long videos the download is enormous.

**Observed incident (2026-06-27, v5 re-dig):** sections 1265 and 2435 of a 51-minute
livestream (`7iic3Zj427M`) have windows of **1170s (19.5 min)** and **656s (11 min)**. The
pipeline tried to download ~70 MB clips, blew past timeouts, and tripped YouTube **HTTP 403
rate-limiting** (`[dig-slide-miss] yt-dlp failed`). We download ~20 minutes of video to use
≤3 frames of ~8 seconds each.

The download span is tied to **inter-section distance**, not to **where the slides are**.

---

## 2. Empirical grounding (accuracy spike, 2026-06-27)

Before designing, we measured where the *actually-settled* slide sits relative to Gemini's
emitted `sec`, using **v5-emitted tokens only** (80 tokens across 9 videos; sampled 24,
23 succeeded). For each token we downloaded `[sec−6, sec+18]`, sampled 1 fps, and inspected
per-offset JPEG size + contact sheets.

**Finding — slide behavior falls into three regimes:**

| Regime | ~Share | Behavior at `sec` | Implication |
|---|---|---|---|
| **A. Stable slide** | ~40% | Complete slide at `sec`, unchanged across window | tiny window suffices |
| **B. Fast-cut deck** | ~30% | Complete slide at `sec`, *replaced by different slides within seconds* | short window is **safer** |
| **C. Animated build** | ~25% | Slide **still assembling** at `sec`; settles **up to ~15s later** (beyond current `MAX_WINDOW_SEC=8`) | needs longer forward reach |

**Key conclusions:**

1. **`sec` is reliable as "the slide, or its build-start."** In A/B the complete slide is
   *at* `sec`; in C, `sec` is the build-*start* (Gemini points early despite the prompt's
   "fully built and settled" instruction). **Backward error is negligible** — no case showed
   the intended slide meaningfully *before* `sec`.
2. **The "largest JPEG in window" heuristic is unreliable** — in regime B it grabs a
   *different, busier later slide*. This is the root capture-quality defect, independent of
   download size. The current v5 `pickLargestFile` over an 8s forward window **can pick the
   wrong slide in fast-cut decks and under-captures builds longer than 8s**.
3. **`scene` detection at threshold 0.4 failed to fire** on visibly-cutting decks
   (`scene_offsets: none` for `333`), so the window-bounding it was meant to provide never
   engaged. Threshold needs recalibration (some transitions are soft fades).

Spike artifacts (frame strips + contact sheets for 23 tokens across all regimes) are retained
as a **labeled calibration set** for tuning the cut detector.

---

## 3. Design — (3′): extend-on-demand download + anchor-aware selection

The existing shape is already **two-stage**: download a clip, then search it for a frame.
(3′) fixes both stages and makes them interdependent.

### 3.1 Stage 1 — Download (the cap): extend-on-demand, per token

Replace the single full-section download with a **per-token** download that grows only as
needed:

- Start with a **base window** `[sec − BACK_PAD, sec + BASE_FWD]` (≈ 9s; `BACK_PAD ≈ 3`,
  `BASE_FWD ≈ 6`). Clamp the lower bound to `max(0, …)` and the upper bound to the video /
  section end.
- **Extend forward** by one segment (`SEG ≈ 6s`) *only while* both hold:
  1. no hard **cut** has been crossed after the anchor (see §3.3), and
  2. the current best frame sits at the **trailing edge** of the downloaded span (i.e. the
     slide is still improving — see §3.4).
- **Stop** when: a cut is crossed, OR the best frame is interior and the size has plateaued,
  OR a **hard safety cap** is reached (`sec + MAX_FWD`, e.g. 30s, bounded also by section end).

Effect: regimes A & B finish in **one ~9s fetch**; regime C takes 2–3 fetches that stop
exactly when the slide settles; no arbitrary forward constant; worst case bounded.

**Per-call overhead note:** each segment is a separate `yt-dlp --download-sections`
invocation (~1–2s startup + signed-URL re-extraction). Base segment is kept at ~8–10s so the
common case is a single call; truly tiny segments would let per-call overhead dominate.

### 3.2 Stage 2 — Selection: anchor + cut-bound + settle

Within the (possibly extended) downloaded frames, sampled at `SAMPLE_FPS`:

```
anchor   = frame nearest sec                  # Gemini's pick — reliable per the spike
segment  = [anchor]
for each later frame f (forward):
    if cut_detected(prev, f):  break          # different slide starts → boundary
    segment.append(f)
# segment now contains ONLY the slide Gemini meant
if sizes(segment) ~flat:   choose anchor       # STABLE (A): use sec itself
else (grow → plateau):     choose plateau frame # BUILD (C): the settled frame
# FAST-CUT (B): cut fires early → segment tiny → anchor chosen, never the next slide
```

This composes with Stage 1: **cut-awareness decides whether to extend; extend-on-demand
decides how much to fetch.**

### 3.3 Cut / same-slide detector (the keystone)

Answers, per consecutive frame pair: *is this still the same slide (even if building) or a
different slide?* Mechanism: **magnitude + spatial extent of inter-frame change**.

- Same slide building → localized, additive change → **low** score → keep.
- Cut to new slide → most of the frame replaced → **high** score → boundary.

`ffmpeg`'s `scene` score (already used in `captureBestFrame`) is this metric. The **threshold
must be recalibrated** against the spike's labeled frames (0.4 missed soft fades; too low
mis-flags large build-steps as cuts). If a single `scene` threshold cannot separate the
labeled set acceptably, fall back to a direct consecutive-frame difference metric. Calibration
is an explicit early task.

### 3.4 Settle / plateau (separate from the cut detector)

Within a same-slide run, pick the **most-complete** frame via the **JPEG-size profile**:
flat → anchor; rising-then-plateau → first plateau frame. "Best at trailing edge" = size still
rising at the span's end → signal to extend (§3.1).

---

## 4. Architecture & units

Keep I/O and decision logic separate so the decision logic is pure and testable against the
spike calibration set.

| Unit | Responsibility | Purity |
|---|---|---|
| `detectCut(prevMetric, currMetric, threshold)` | boundary classification | pure |
| `chooseFrame(frames[])` → `{ bestIdx, atTrailingEdge }` | anchor/plateau selection over a labeled frame sequence | pure |
| `extendPlan(...)` | given current best + cut state, decide stop / extend | pure |
| download/sample orchestrator in `resolveSlideTokens` | runs `yt-dlp`/`ffmpeg`, feeds the pure units, writes the asset | I/O |

`parseFirstSceneChange` and `pickLargestFile` already exist and are unit-tested; they are
refactored/absorbed into the above. The single-frame `-y` fix (PR #34) is preserved.

---

## 5. Error handling & degradation

- **`yt-dlp` fails on the base segment** → strip the token (current `[dig-slide-miss]`
  behavior), per-token (one token failing does not drop the others).
- **Extension segment fails** after a successful base → **use best-so-far** rather than
  dropping the token (graceful: a slightly-less-settled frame beats no slide).
- **No frames sampled** → drop the token.
- Temp clips deleted in `finally` (existing pattern); per-token clips never accumulate.
- All existing security invariants unchanged: `assertVideoId` first, server-built URL,
  `execFile` argv only, asset-path containment under `assetsRoot`.

---

## 6. Testing strategy

- **Pure units** (`detectCut`, `chooseFrame`, `extendPlan`): table-driven unit tests over
  synthetic frame sequences representing A / B / C.
- **Calibration test**: assert the chosen `scene` threshold correctly classifies the spike's
  labeled boundary set (checked-in fixture of per-frame metrics, not the raw images).
- **Orchestrator**: mock `child_process` at the module boundary (existing `slides.test.ts`
  pattern) — assert per-token extend-on-demand makes the expected `yt-dlp` calls for A (1 call),
  B (1 call, cut bounds it), C (2–3 calls, stops on plateau), and the safety cap.
- **Regression**: existing `slides.test.ts` / `slides-helpers.test.ts` stay green (adapt the
  mock to per-token windows).
- TDD: behaviors enumerated before tests; `npm test` + `tsc --noEmit` gate before commit.

---

## 7. Scope

**In scope:**
- Per-token extend-on-demand capped download.
- Anchor-aware, cut-bounded, settle-based frame selection.
- Recalibrate the cut threshold (or replace the metric) using spike data.
- `DIG_GENERATOR_VERSION` 5 → 6.

**Out of scope (documented follow-ups):**
- **3-token-per-section cap.** The spike gave no strong signal to change it; the coverage
  concern on very long sections is real but separate (it's a *prompt/policy* lever, not a
  capture lever). Tracked as its own future spec.
- **Backward extension.** Backward error appeared negligible; a fixed `BACK_PAD` covers
  quantization. Symmetric backward walking is deferred unless evidence emerges.
- **Re-sectioning long livestreams** (upstream summary concern).

---

## 8. Migration

- Bumping to v6 makes existing dug sections show the `↻ outdated` affordance (version-gated,
  lazy — no Gemini on page load). Re-dig applies the new capture. No data migration needed;
  companion-doc schema is unchanged (still `genVersion` per section).
- Re-dig of the previously-pathological livestream sections (1265, 2435) becomes fast and
  rate-limit-safe under the cap.

---

## 9. Constants (initial; finalize via calibration)

| Constant | Initial | Source |
|---|---|---|
| `BACK_PAD` | 3s | spike: backward error negligible, quantization pad |
| `BASE_FWD` | 6s | spike: covers stable/fast-cut at `sec` |
| `SEG` (extend step) | 6s | per-call overhead vs granularity |
| `MAX_FWD` (safety cap) | 30s | spike: longest observed build settle ~18s + margin |
| `SCENE_THRESHOLD` | **recalibrate** | spike labeled set (0.4 too high) |
| `SAMPLE_FPS` | 2 (current) | unchanged unless calibration suggests otherwise |

The current fixed-forward `MAX_WINDOW_SEC` (8s) is **removed** — its role (bounding the
forward search) is taken over by the cut detector (§3.3) plus the `MAX_FWD` safety cap. No
code should retain an 8s forward assumption.

All env-overridable, following the existing `numEnv` pattern (`DIG_*`).

---

## 10. Open risks

1. **Cut detector accuracy on soft fades** — primary technical risk; mitigated by calibration
   and by anchoring on `sec` (a wrong "no-cut" only extends a bit further; a wrong "cut" stops
   at the anchor, which is still the right slide). The anchor makes the heuristic fault-tolerant.
2. **Per-call latency** if many builds need 3 segments — bounded by `MAX_FWD`; acceptable vs.
   the 19-min status quo.
3. **Calibration set size** (23 tokens) — expand toward the full 80 if the threshold is noisy.
