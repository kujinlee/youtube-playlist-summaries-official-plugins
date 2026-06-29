# Dig-Deeper Doc: Slide Vertical Auto-Crop (render-time, non-destructive)

**Date:** 2026-06-28
**Status:** Design — Phase-0 validation spike complete; awaiting user spec review, then writing-plans.
**Component:** `lib/html-doc/render-dig-deeper.ts` (+ new `lib/dig/slide-crop.ts`)
**Version impact:** none — render-time only; no `DIG_GENERATOR_VERSION` bump, no re-dig, no asset mutation. Applies to every existing companion doc on next page load (same delivery model as PR #38 image-sizing).

Trims the dead vertical band above each slide's heading (and the near-black band below its lowest content) at render time, as a **non-destructive CSS display-crop**. The click-to-zoom lightbox always shows the full, uncropped original, so a mis-detection is cosmetic and recoverable by one click — never lost content.

---

## Background: why this is a *revisit*

A prior `jimp.autocrop` spike (see `2026-06-28-dig-image-sizing-and-ask-ai-design.md:17–24`) was dropped because it trimmed **25–44% of width** on the OKF deck (`2kKkb01GxYQ`) and cut the title, code-card edges, left labels, and source line. Root cause: those slides are **full-bleed horizontally** and their **dim-gray text sits within color-tolerance of the dark gradient background**, so no horizontal crop and no single tolerance is safe.

This revisit differs on three axes that together clear that failure:
1. **Vertical-only.** Width is never touched — exactly the axis that broke jimp is left alone. (The motivating example crop was purely vertical: 720→~390px, width unchanged.)
2. **Non-destructive.** The crop is CSS display-only; the original is preserved and shown on zoom. jimp re-encoded destructively.
3. **Dual-threshold, asymmetric.** Different brightness thresholds per edge (see below), validated by a Phase-0 spike on the very deck that broke jimp.

---

## Phase-0 validation spike (completed before locking thresholds)

Ran an ffmpeg-based detector on **8 real frames** from `2kKkb01GxYQ` (code/directory cards, three-card layouts, wide comparison tables, node-graph diagrams), eyeballing every crop against its original.

| Approach | Outcome |
|---|---|
| Single threshold, high (~120) | ❌ Cuts dim-gray card labels (`69-76-80`: "embed · index · re-embed" sliced) |
| Single threshold, low (~70) | ❌ Fragile per-slide; cut card descriptions (`160-214-222`) |
| **Dual-threshold, keep footer (top@120 / bottom@40)** | ✅ **8/8 clean, zero content loss**; ~19–28% top trim, ~3% bottom trim |
| Dual-threshold + positional footer-strip | ❌ Over-stripped a graph-card frame (`160-195-202`) — dim card border merged into the footer "gap" |

**Locked decision:** ship the **dual-threshold, footer-kept** variant. Reliable footer *removal* is **not** achievable by any pixel heuristic (the footer is brightness-identical to card labels and positionally indistinguishable from gap-separated diagram content); it would require a semantic/VLM pass and is explicitly **out of scope** here (possible separate future effort).

Spike artifacts (throwaway, not committed): `scratchpad/spike-autocrop.mjs` + `out_dual/` previews.

---

## Architecture

Three units, split so the logic is testable without spawning a subprocess.

### 1. `profileRows(assetPath, pixelThreshold) → Promise<number[]>` — thin ffmpeg wrapper
The only unit that touches ffmpeg. Runs:
```
ffmpeg -v error -i <asset> \
  -vf "format=gray,geq=lum='if(gte(lum(X,Y),<thr>),255,0)',scale=1:ih:flags=area" \
  -f rawvideo -pix_fmt gray -
```
Binarize-then-average yields, per image row, the **fraction of pixels brighter than `thr`** (one byte per row, value = 255 × fraction). Binarizing first is essential: a plain row-average misses a thin bright heading (a white title spanning ~10% of row width averages down to background). `flags=area` pins the downscale to a true area average rather than the default scaler (addresses **M1**). The wrapper **validates `stdout.length === imageHeight`** (height from ffprobe) and **fails closed to `null`** on any mismatch, non-zero exit, or empty output. Mocked at this boundary in unit tests (project lib-boundary mocking policy).

### 2. `computeTrim(topProfile, botProfile, opts) → {trimTop, trimBot} | null` — pure logic

Returns trim fractions of image height (`trimTop`, `trimBot` ∈ [0,1)), or `null` for no-op. Everything the wrapper needs is derived: `keepFrac = 1 − trimTop − trimBot`, `P% = trimTop / (trimTop + trimBot) × 100`, `keepH = round(H × keepFrac)`.
- `topProfile` from a **high** threshold (`THR_TOP=120`): anchors on the bright heading, ignores dead gradient and the radial glow above it.
- `botProfile` from a **low** threshold (`THR_BOT=40`): trims only near-pure-black, preserving every dim element (card labels, descriptions, **footer**).
- `t` = first row with bright-fraction > `CONTENT_FRAC` in `topProfile`; `b` = last such row in `botProfile`.
- Add `PAD_FRAC` padding above `t` / below `b`.
- **No-op guards (return `null`):** no bright row at all (`all-empty`); retained band `< MIN_RETAIN` of height; total trim `< MIN_TRIM` (not worth it).

This unit is pure (arrays in, box out) → exhaustively unit-tested with synthetic profiles.

### 3. Render integration — async boundary in the route, renderer stays sync (addresses **B2**)
`renderDigDeeperDoc` is a **synchronous** `export function` called directly by `app/api/html/[id]/route.ts:195` (`serveHtml(renderDigDeeperDoc(...))`). markdown-it's image rule is also synchronous. Rather than make the whole renderer async (large blast radius), the async work runs **before** render, in the route:

1. New async `prepareSlideCropMap(dug, assetsRoot, videoId) → Promise<Map<absPath, Box|null>>`.
   - Collect slide asset refs by **parsing the section markdown with markdown-it tokens** (same parser + the existing path-containment rule), not regex (addresses **M2**); dedupe by canonical resolved absolute path.
   - For each unique asset: `lookupOrCompute` the box (cache → else `profileRows`×2 + `computeTrim`).
2. The route `await`s the map and passes it as a new `cropMap` arg into the still-synchronous `renderDigDeeperDoc(...)`.
3. The synchronous image rule reads `cropMap` by resolved path. Map miss or `null` → plain `<img class="dig-slide">` (today's output, unchanged). A **missing asset file** is represented distinctly from a `null` no-op and is never cached as a result (addresses **M3**).

The image rule emits a `<figure>` crop wrapper (preserves `alt` on the img as the accessible object; addresses **L3**):
```html
<figure class="dig-slide-crop">
  <img class="dig-slide" alt="…" src="data:image/jpeg;base64,…">
</figure>
```
with per-instance inline values for `aspect-ratio` (W/keepH) and `object-position` (`0 P%`, `P% = trimTop/(trimTop+trimBot)×100`).

**Full CSS contract (addresses B1).** The existing `.dig-slide{margin:2em auto;max-height:360px;border:…;cursor:zoom-in}` rule conflicts with cover-cropping, so the wrapped img must override it:
```css
.dig-slide-crop{display:block;overflow:hidden;margin:2em auto;max-width:100%;
  /* width capped where the bare img's max-height:360px used to cap; aspect-ratio set inline per-image */
  border:1px solid var(--rule);border-radius:6px;cursor:zoom-in}
.dig-slide-crop > img.dig-slide{display:block;width:100%;height:100%;
  max-height:none;margin:0;border:0;border-radius:0;object-fit:cover;cursor:zoom-in}
```
`object-fit:cover` only crops when the img has a concrete box matching the wrapper — the rules above give it `width:100%;height:100%` inside an `overflow:hidden`, `aspect-ratio`-sized figure. The size cap moves from the img to the wrapper.

**Lightbox unchanged.** It builds its own `<img>` from the same data-URI with **no** `.dig-slide-crop` ancestor, so zoom always shows the full uncropped original.

---

## Detection parameters (spike-locked defaults, all env-tunable)

| Param | Default | Meaning |
|---|---|---|
| `DIG_CROP` | `on` | Master enable/disable. `off` → render exactly as today. |
| `THR_TOP` | `120` | Top-edge pixel brightness threshold (find bright heading). |
| `THR_BOT` | `40` | Bottom-edge pixel brightness threshold (trim only near-black). |
| `CONTENT_FRAC` | `0.004` | A row is "content" if >0.4% of its pixels exceed the threshold. |
| `PAD_FRAC` | `0.015` | Padding added above/below the content band. |
| `MIN_RETAIN` | `0.30` | Kept band below 30% of height → no-op (suspect detection). |
| `MIN_TRIM` | `0.04` | Total trim below 4% → no-op (not worth a wrapper). |
| `ALGO_VERSION` | `1` | Bumped to invalidate the cache after any tuning. |

`ALGO_VERSION` lives in code, not env; it is the cache-invalidation key.

---

## Caching

Sidecar `assets/{videoId}/.crop-cache.json`: `filename → {algoVersion, size, mtimeMs, box}` where `box` is `{trimTop, trimBot}` or `null` (a no-op result is cached too, so a no-op slide isn't recomputed every render).

- **Key soundness (addresses H1):** filenames are **not** immutable. `slides.ts:158` builds `${sectionId}-${token.sec}-${endComponent}.jpg` and `:102` `copyFileSync`s over it; a re-dig that yields the same Gemini timestamps overwrites the file **in place** with a possibly different frame. So the cache entry is only valid when `size` and `mtimeMs` (from `fs.statSync`) match the current file in addition to `algoVersion`. Any mismatch → recompute.
- **Concurrency (addresses H2):** writes are serialized per cache-file path with an in-process mutex (promise chain keyed by path) and committed via **temp-file + atomic `rename`**. A read that hits malformed JSON logs and treats the cache as empty (rebuild). This tolerates two simultaneous HTML requests without lost-update corruption within a process; cross-process races degrade to a recompute, never corruption (atomic rename).
- First render of a slide computes (2 ffmpeg calls) and writes through; later renders read.
- Cache write is best-effort: a write failure is logged and ignored (detection simply recomputes next time).
- **Location (corrects M4):** assets live in the **separate data tree** (`…-data/<deck>/raw/assets/`), which is **not** a git repository — so the cache file is neither committed nor needs a `.gitignore` rule. (The earlier "gitignored" claim was wrong.)

---

## Eligibility & cross-deck robustness (addresses H3)

Thresholds were tuned on one dark deck (`2kKkb01GxYQ`), so the spike was extended to the **light-themed cs146s deck** (`854×476` infographics). Result: the detector **no-op'd (keep 100%)** — on a light background `THR_TOP=120`/`THR_BOT=40` see the whole frame as bright, so `t=0`/`b=last` → `MIN_TRIM` guard fires. **The failure direction is under-crop (safe), not over-crop.** The algorithm self-limits to dark-letterboxed slides.

**Known residual limitation (documented, not eliminated):** a **dark photo or dark low-contrast graphic at the top/bottom edge** can be read as dead band and trimmed. None of the spike decks contain full-bleed dark photos; non-destructive display + zoom recovers any such case. Mitigations: the no-op guards, the adversarial fixtures above, and `DIG_CROP=off` as a one-line global kill switch.

**Open decision (default on vs off):** see "Revised scope" decision below — `DIG_CROP` default is set by the user given this evidence.

## Error handling

Crop is a cosmetic enhancement and must **never block or break a render**.
- ffmpeg missing / non-zero exit / empty or malformed output → treat as `null` (uncropped render), logged via the dev-logger.
- Any exception in the pre-pass for one asset → that asset renders uncropped; other assets and the section are unaffected.
- The synchronous image rule never throws on crop data; absent/`null` box → plain `<img>`.

---

## Out of scope (explicit)

- **Footer / source-line removal** — not safely achievable by pixels (spike-disproven); would need a Gemini/VLM crop box at generation time, a `genVersion` bump, and re-dig. Deferred.
- **Horizontal trimming** — the axis that broke jimp; never attempted.
- **Destructive crop / re-encode** — rejected in favor of non-destructive CSS.

---

## Testing

### Unit (TDD — pure `computeTrim`)
Synthetic top/bottom profiles for:
| # | Scenario | Expected |
|---|---|---|
| 1 | Letterboxed bright-heading slide (the `69-76-80` shape) | Trims top dead band; keeps content + footer |
| 2 | Heading flush at top, content to bottom | Minimal/no top trim, ~near-black bottom trim only |
| 3 | All-dim slide (no row > `THR_TOP`) | `null` (all-empty) |
| 4 | Retained band < `MIN_RETAIN` | `null` |
| 5 | Trim < `MIN_TRIM` | `null` |
| 6 | Dim card content extends below last bright row | Bottom anchored on dim content (NOT cut) — the `160-214-222` regression guard |

### Wrapper/render
- Given a box, assert wrapper `aspect-ratio` and `object-position` math.
- Given `null` **or a map miss**, assert plain `dig-slide` img (no wrapper).
- Assert a **missing asset** still renders the existing placeholder and is **not** cached (M3).
- **L1 regression:** assert the lightbox `<img>` carries the original (uncropped) data URI and has **no** `.dig-slide-crop` ancestor.

### Adversarial fixtures (addresses L2 / H3)
Detection fixtures (committed tiny images or recorded profiles) covering: light background full-bleed, dark photographic top band, dark low-contrast diagram, tiny image, non-16:9 aspect, and **two files with the same name but different content** (H1 cache-key guard). Each asserts either a clean box or a safe `null` — never an over-crop.

### ffmpeg boundary
- `profileRows` integration test against one committed tiny fixture image (real ffmpeg), asserting the profile separates a bright band from a dark band. Mocked elsewhere.

### E2E (Playwright)
- Fixture companion doc with one slide: assert the in-flow image carries the crop wrapper with computed style, and the lightbox shows the unwrapped full image. Include one slide whose detection returns `null` → plain img.

---

## Files

| File | Change |
|---|---|
| `lib/dig/slide-crop.ts` | **New** — `profileRows`, `computeTrim`, cache read/write, `ALGO_VERSION`. |
| `lib/html-doc/render-dig-deeper.ts` | Async pre-pass to build the box map; image rule emits crop wrapper; CSS for `.dig-slide-crop`. |
| `lib/dig/slide-crop.test.ts` | **New** — unit tests for `computeTrim` (table above). |
| `assets/{videoId}/.crop-cache.json` | **New runtime artifact** in the non-versioned data tree (not committed; no gitignore needed). |
| `app/api/html/[id]/route.ts` | `await prepareSlideCropMap(...)` before render; pass `cropMap` into `renderDigDeeperDoc`. |
