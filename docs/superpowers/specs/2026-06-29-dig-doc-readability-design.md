# Dig-Doc Readability — Slide Captions + Section Sub-Headings (Design Spec)

**Date:** 2026-06-29
**Status:** Draft (pending grill-with-docs + Codex adversarial review + user approval)

## Goal

Improve readability of dig-deeper companion docs in two ways:
1. **Slide captions** — surface the per-slide description (already generated, currently hidden in alt text) as a visible `<figcaption>`, with a reader show/hide toggle.
2. **Section sub-headings** — have Gemini structure long section prose with `###` sub-headings so the elaboration reads as labeled subsections instead of a wall of text.

The two ship as **two separate PRs** with very different profiles:

| | Part A — Captions | Part B — Sub-headings |
|---|---|---|
| PR | 1 (first) | 2 (after A) |
| Nature | **Render-only** | **Generation change** |
| Data/version | No `DugSection` change, no version bump | `DIG_GENERATOR_VERSION` 8 → 9 |
| Reaches existing docs | Immediately, next GET | After lazy on-demand re-dig (shows "↻ outdated" until then) |
| Gemini cost | None | Re-dig cost, incurred lazily per section |

---

## Background (current state, verified)

- `lib/dig/generate.ts:13` — `DIG_GENERATOR_VERSION = 8`. Prompt at `generate.ts:52-79`; line 75 instructs "Output markdown only — no preamble, no headings for the section title, no meta-commentary." No instruction governs *internal* structure, so Gemini emits flowing prose. `###` inside `bodyMarkdown` already renders as `<h3>`.
- Each slide is emitted by Gemini as `[[SLIDE:M:SS|M:SS|caption]]`; after capture, `resolveSlideTokens` (`lib/dig/slides.ts:175`) rewrites it to `![caption](assets/{videoId}/{sectionId}-{start}-{end}.jpg)`. The **slide caption is the markdown alt text** — sanitized at generation only for markdown-breaking chars (`[] () |`), NOT HTML-escaped (render escapes via `esc()`). The caption is **optional**: an empty caption is a supported state and persists as `![](assets/…)` (`lib/dig/slide-tokens.ts:15,24`). So a slide caption exists *when present*, not on every slide.
- Missing-asset slide refs: when the asset file is absent at render time, `buildRenderer` emits `<span class="missing-slide">…</span>` (`render-dig-deeper.ts:112-117`), NOT a figure/img.
- `render-dig-deeper.ts` `buildRenderer` (~`:88-143`) overrides the markdown-it `image` rule: `assets/…` images are inlined base64; a slide with a crop-map entry is wrapped in `<figure class="dig-slide-crop">` (`overflow:hidden`, native `aspect-ratio`, `object-position` vertical crop, `:128-131`, CSS `:150`); otherwise a bare `<img class="dig-slide">`. External URLs render as a plain non-zoomable `<img>`.
- Reader toggles follow one pattern (theme, size slider): a pre-paint `<head>` script reads sanitized `localStorage` and sets state before first paint (no FOUC); a body script wires the control + persists; all `localStorage` access in try/catch; a control lives in `.dg-topbar`. Size slider: key `digSlideScale`, `SIZE_HEAD_SCRIPT`, `sizeScript`, `.dg-size` control.
- Zoom lightbox: clicking `.dig-slide` opens a full-image overlay (wired in `sizeScript`).
- Render-only changes reach all docs on next GET (dig route live-renders); generation/prompt changes require a version bump + re-dig (the stale section shows `.dig-refresh` "↻ outdated", `render-dig-deeper.ts:263`, gated by `dig-merge.ts` `genVersion < DIG_GENERATOR_VERSION`).

---

## Part A — Slide Captions (PR 1, render-only)

### A1. Data source
Reuse the existing alt-text slide caption. **No `DugSection` change, no `DIG_GENERATOR_VERSION` bump.** The slide caption, *when present*, already lives in the persisted `![caption](…)` markdown (it may be empty — see A2). No regeneration needed; render-only reaches all docs on next GET.

### A2. Rendering — semantic figure + figcaption
Every in-flow slide (`assets/…` image) renders as a single semantic `<figure class="dig-slide-fig">` containing the image (or crop container) **and** a `<figcaption class="dig-cap">` with the caption text.

The cropped slide's container currently *is* a `<figure class="dig-slide-crop">` with `overflow:hidden` — a `<figcaption>` inside it would be clipped. Restructure so the crop container is a non-figure element wrapped by the semantic figure:

```html
<!-- cropped slide -->
<figure class="dig-slide-fig">
  <div class="dig-slide-crop" style="aspect-ratio:W/H">
    <img class="dig-slide" style="object-position:0 P%" src="data:image/jpeg;base64,…" alt="CAPTION">
  </div>
  <figcaption class="dig-cap">CAPTION</figcaption>
</figure>

<!-- uncropped slide -->
<figure class="dig-slide-fig">
  <img class="dig-slide" src="data:image/jpeg;base64,…" alt="CAPTION">
  <figcaption class="dig-cap">CAPTION</figcaption>
</figure>
```

- `figure.dig-slide-crop` → `div.dig-slide-crop`. This selector/structure is referenced in MORE places than first listed — the full update set (all must change together):
  - `render-dig-deeper.ts` DIG_DOC_CSS crop rule + the size-slider rule `.dg figure.dig-slide-crop` → `.dg .dig-slide-crop`
  - `tests/lib/html-doc/render-dig-deeper.crop.test.ts` (crop unit tests)
  - `tests/lib/html-doc/render-dig-deeper.size.test.ts` (asserts `figure.dig-slide-crop` width + print CSS strings — M2)
  - `tests/e2e/dig-slide-size.spec.ts` (S7 locator)
  - `tests/e2e/dig-slide-crop.spec.ts` (`:105-122` hardcoded `figure.dig-slide-crop` locators/comments — M1)
  - the zoom click handler finds `.dig-slide` (the `<img>`), which is unchanged by the wrapper rename — verify it still resolves after restructure.
- **figcaption text — HTML-ESCAPE at render time (H4):** the server-rendered `<figcaption>` uses `esc(altAttr)` (the same `esc()` the renderer already applies to alt). Stored captions are NOT trusted as HTML. (The JS zoom overlay caption uses `textContent` — see A4.)
- If a slide's caption is **empty/absent**, emit the `<figure>`+image but **no `<figcaption>`** (don't render an empty box).
- **Missing-asset placeholder is UNCHANGED (H1):** a missing asset still renders `<span class="missing-slide">` — no figure, no figcaption; it is excluded from the caption toggle and unaffected by print rules. (Unit test covers missing-asset + caption-toggle co-existence.)
- External (non-`assets/`) images are unaffected — no figure wrap, no caption (unchanged behavior).
- The `.dig-slide-fig` figure itself must not constrain width beyond the existing slide cap; the size-slider `--dig-slide-scale` continues to drive the crop/img sizing as today.

### A3. Caption visibility toggle
A top-bar control mirroring the size slider:
- `localStorage` key `digCaptions`, values `'on'` / `'off'`; **default `'on'` (shown)** when unset/invalid.
- Pre-paint `<head>` script (sanitize → set a root class before first paint, no FOUC): when off, add `dg-hide-caps` to `<html>`; CSS `.dg-hide-caps .dig-cap{display:none}`.
- Body script wires a topbar toggle (a `<button>`, keyboard-operable) that flips the class + persists. All `localStorage` access in try/catch; fail-safe = captions shown.
- Sanitizer shared single-source (same discipline as `DIG_SLIDE_SANITIZE_JS`): unknown/missing → `'on'`.

### A4. Zoom lightbox (H2 — fully specified)
The existing zoom handler builds an overlay with only an `<img>` (copies `src`/`alt`, `render-dig-deeper.ts:334-350`). Add a caption element to the overlay:
- Append a caption node (e.g. a `<div class="dg-zoom-cap">`) to the overlay; populate it via **`textContent`** from the clicked slide's caption (the figure's `.dig-cap` text, or the `<img>` `alt`). `textContent` (not `innerHTML`) makes escaping inherent — no HTML-injection path.
- The overlay caption **respects the global toggle**: when captions are hidden (`dg-hide-caps` on `<html>`), the overlay caption is hidden too (same CSS rule scope or a guard in the handler), so zoom matches in-flow state.
- If the clicked slide has an empty caption, render no overlay caption node.
- The lightbox image source is unchanged (still the full original image).

### A5. Print
- Captions **print** (document content) — but respect the toggle: if the reader hid captions, they stay hidden in print too (the `dg-hide-caps` class is on `<html>`, applies in print).
- The toggle *control* itself hides in print (like `.dg-size`).

### A6. UI Design

Top bar (existing + new toggle appended):
```
┌──────────────────────────────────────────────────────────────────────┐
│ ← summary   ⤢ expand all   🔆 Ask AI   [− ▭▭▭ +] 100%   [▣ captions] │
└──────────────────────────────────────────────────────────────────────┘
                                              size slider      new toggle
```
Slide with caption (captions ON):
```
        ┌───────────────────────────┐
        │        [slide image]      │
        └───────────────────────────┘
         Fig: Diagram showing four OKF capabilities   ← .dig-cap (muted, smaller, centered)
```
Toggle states: `[▣ captions]` (on) / `[▢ captions]` (off). Caption style: smaller than body (~`.8rem`), muted color (`var(--meta)`), centered under the slide, small top margin; matches the doc's existing meta-text treatment.

### A7. Testing (Part A)
- Unit (`render-dig-deeper`): cropped slide emits `figure.dig-slide-fig > div.dig-slide-crop > img` + `figcaption.dig-cap` with the **HTML-escaped** caption (assert a caption containing `<`/`&`/`"` is escaped — H4); uncropped slide emits `figure.dig-slide-fig > img` + `figcaption`; empty caption → no `figcaption`; **missing-asset ref still emits `span.missing-slide` (no figure/figcaption) even with captions on — H1**; toggle markup present (default-on); pre-paint head script keyed on `digCaptions` before `<style>`; print CSS keeps `.dig-cap` (no hide rule under print except via `dg-hide-caps`); existing crop assertions updated to `.dig-slide-crop`.
- E2E (`dig-slide-captions.spec.ts`): default shows captions; toggle hides/shows + persists across reload; pre-paint proof (caption hidden before control exists when stored `off`); blocked-localStorage survival; caption visible in zoom overlay AND hidden in zoom when toggle off (H2).

---

## Part B — Section Sub-Headings (PR 2, generation change)

### B1. Prompt change
Add guidance to the dig generation prompt (`lib/dig/generate.ts`) so that for a **long** elaboration, Gemini groups the prose under short `###` sub-headings; short sections stay unbroken.

Constraints encoded in the prompt:
- Use `###` (h3) **only** — never `#`/`##` (those collide with the section title rendered at `<h2>`).
- Sub-heading text is short, plain, descriptive, **in the same language as the rest of the response** (H3 — the prompt already mandates the entire response be Korean when `lang==='ko'`, `generate.ts:57-60`; sub-headings must NOT be forced to English); no markdown, code, or `[] () |`.
- Sub-headings group the *elaboration* (e.g. "How it works", "Where it breaks down", "What to use instead") — they do not restate the gist bullets or the section title.
- **Length-conditional:** only when the section is long enough to warrant structure (guidance, not mandatory) — a 1–2 paragraph section stays unbroken.
- Continue to rely on the existing sentinel-comment wrapper that protects in-prose headings (`companion-doc.ts:14-21`).

### B2. Version bump + rollout
- `DIG_GENERATOR_VERSION` 8 → 9.
- Existing dug sections (all 3 playlists) become stale → show the existing "↻ outdated" badge.
- **Lazy on-demand re-dig** — no bulk job. Staleness clears as readers click ↻ / regenerate. No serve-route version check (matches established pattern).

### B3. Rendering polish (render-only, ships with PR 2)
- Style `.dug h3` so sub-headings read as in-prose sub-headings distinct from the `<h2>` section heading (weight/size/spacing). No structural change beyond CSS.
- **Orphan dug body (M3):** orphan rendered body currently emits OUTSIDE a `.dug` wrapper (`render-dig-deeper.ts:299-303`), so `.dug h3` would miss its `###`. Fix: either wrap the orphan rendered body in `.dug`, or extend the h3 rule to also cover the orphan-body container. The chosen approach must ensure orphan-body sub-headings get the same styling.

### B4. Testing (Part B)
- Unit: prompt string contains the sub-heading instruction (the `###`-only + length-conditional + **same-language-as-response** contract — assert the wording does NOT hardcode English, so the Korean-lang path stays correct, H3); `DIG_GENERATOR_VERSION === 9`; `.dug h3` styling present in CSS and applies to the orphan-body container (M3). (Deterministic Gemini output is not asserted — consistent with how the v8 prompt change was tested.)
- Manual/verification: re-dig one long section, confirm `###` sub-headings render as styled sub-headings and short sections stay unbroken.

---

## Out of scope (YAGNI)
- No new `DugSection` fields for captions (alt text suffices).
- No per-slide caption editing UI.
- No bulk re-dig job for Part B (lazy only).
- No change to slide capture, crop, or selection logic.
- No `wiki/` or PDF changes.

## Version policy summary
- Part A: render-only — **no** `DIG_GENERATOR_VERSION` bump.
- Part B: **bump 8 → 9** — re-dig lazily.

## File format / data model
- Part A: no frontmatter or `DugSection` change.
- Part B: no frontmatter/schema change; only `bodyMarkdown` *content* gains `###` sub-headings on re-dig (still valid markdown; sentinel wrapper unchanged).
