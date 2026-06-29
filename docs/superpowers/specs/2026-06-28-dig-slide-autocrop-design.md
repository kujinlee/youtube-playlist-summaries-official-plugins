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
  -vf "format=gray,geq=lum='if(gte(lum(X,Y),<thr>),255,0)',scale=1:ih" \
  -f rawvideo -pix_fmt gray -
```
Binarize-then-average yields, per image row, the **fraction of pixels brighter than `thr`** (one byte per row, value = 255 × fraction). Binarizing first is essential: a plain row-average misses a thin bright heading (a white title spanning ~10% of row width averages down to background). Mocked at this boundary in unit tests (project lib-boundary mocking policy).

### 2. `computeTrim(topProfile, botProfile, opts) → {trimTop, trimBot} | null` — pure logic

Returns trim fractions of image height (`trimTop`, `trimBot` ∈ [0,1)), or `null` for no-op. Everything the wrapper needs is derived: `keepFrac = 1 − trimTop − trimBot`, `P% = trimTop / (trimTop + trimBot) × 100`, `keepH = round(H × keepFrac)`.
- `topProfile` from a **high** threshold (`THR_TOP=120`): anchors on the bright heading, ignores dead gradient and the radial glow above it.
- `botProfile` from a **low** threshold (`THR_BOT=40`): trims only near-pure-black, preserving every dim element (card labels, descriptions, **footer**).
- `t` = first row with bright-fraction > `CONTENT_FRAC` in `topProfile`; `b` = last such row in `botProfile`.
- Add `PAD_FRAC` padding above `t` / below `b`.
- **No-op guards (return `null`):** no bright row at all (`all-empty`); retained band `< MIN_RETAIN` of height; total trim `< MIN_TRIM` (not worth it).

This unit is pure (arrays in, box out) → exhaustively unit-tested with synthetic profiles.

### 3. Render integration — `render-dig-deeper.ts`
markdown-it's image rule is **synchronous**, so detection runs in an **async pre-pass**:
1. Walk the section markdown for slide asset refs.
2. For each, `lookupOrCompute` the trim box (cache → else `profileRows`×2 + `computeTrim`).
3. Build `Map<filename, box>`.
4. Run the existing synchronous render; the image rule reads the map.

The image rule emits a crop wrapper around the existing base64 `<img>`:
```html
<span class="dig-slide-crop" style="aspect-ratio:<W>/<keepH>">
  <img class="dig-slide" style="object-fit:cover;object-position:0 <P>%"
       src="data:image/jpeg;base64,…" alt="…">
</span>
```
where `P% = trimTop / (trimTop + trimBot) × 100`. `object-fit:cover` + a wrapper whose aspect-ratio is shorter than the image crops top/bottom responsively without re-encoding; `object-position` selects the kept band. `null` box → emit today's plain `<img class="dig-slide">` unchanged.

**Lightbox unchanged.** It builds its own `<img>` from the same data-URI *without* the crop wrapper, so zoom always shows the full original.

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

Sidecar `assets/{videoId}/.crop-cache.json`: `filename → {algoVersion, box}` where `box` is `{trimTop, trimBot}` or `null` (no-op result is cached too, so a no-op slide isn't recomputed every render).
- Asset filenames encode `{sectionId}-{startSec}-{endSec}` and are immutable (re-dig deletes + rewrites under a new name), so `filename + algoVersion` is a sound key — no mtime needed.
- First render of a slide computes (2 ffmpeg calls) and writes through; later renders read. Recompute when the entry is missing or its `algoVersion` differs.
- Cache write is best-effort: a write failure is logged and ignored (detection simply recomputes next time).

---

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
- Given `null`, assert plain `dig-slide` img (no wrapper).
- Assert the lightbox `<img>` has **no** crop wrapper (full original on zoom).

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
| `assets/{videoId}/.crop-cache.json` | **New runtime artifact** (gitignored alongside other assets). |
