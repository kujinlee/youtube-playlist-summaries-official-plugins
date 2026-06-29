# Dig-Deeper Doc: Slide Image-Size Control (viewer slider)

**Date:** 2026-06-29
**Status:** Design — awaiting Codex adversarial review, then user spec review, then writing-plans.
**Component:** `lib/html-doc/render-dig-deeper.ts` (CSS + top-bar control markup + a vanilla-JS IIFE)
**Version impact:** none — render-time only; no `DIG_GENERATOR_VERSION`/doc-version bump, no re-dig, no asset mutation. Applies to every existing dig-deeper doc on next page load (same delivery model as the image-sizing and auto-crop work).
**Depends on:** PR #41 (slide auto-crop) merged to master — this edits the same `.dg img.dig-slide` / `.dg figure.dig-slide-crop` rules and the `.dg-topbar`. Implementation begins after #41 merges.

A reader-facing control in the dig-deeper top bar that scales all in-flow slide images uniformly (50–150%), persisted across all docs via `localStorage`. Lets the reader trade image detail for prose density without touching the pipeline.

---

## Decisions (locked with user)

| # | Decision | Value |
|---|---|---|
| 1 | Scope | **Global** — one control scales every slide in the doc (cropped + uncropped) |
| 2 | Direction | **Both** — smaller and bigger |
| 3 | Persistence | **Sticky across all docs** — per-origin `localStorage` |
| 4 | Uniformity | **Yes** — cropped and uncropped scale by the same factor |
| 5 | Range / step / default | **50%–150%, step 10%, default 100%** |
| 6 | Delivery | Separate PR, after #41 merges |

---

## Mechanism — one CSS custom property

A single `--dig-slide-scale` (unitless multiplier, default `1`) set on `document.documentElement`. The two existing sizing rules consume it:

```css
/* uncropped slides — was max-height:300px */
.dg img.dig-slide{margin:2em auto;max-width:100%;
  max-height:calc(300px * var(--dig-slide-scale, 1));
  border:1px solid var(--rule);cursor:zoom-in}

/* cropped slides — was width:min(100%,540px) */
.dg figure.dig-slide-crop{display:block;overflow:hidden;margin:2em auto;
  width:min(100%, calc(540px * var(--dig-slide-scale, 1)));
  border:1px solid var(--rule);border-radius:6px}
```

- The `var(--dig-slide-scale, 1)` fallback means the rules render at today's exact size if the JS never runs (no-JS / pre-listener paint) — graceful default.
- **`max-width:100%` is added to the bare-img rule** (new): scaling *up* must not let an uncropped slide overflow the prose column. The cropped figure is already bounded by `min(100%, …)`.
- **Aspect-ratio, `object-fit:cover`, and `object-position` are untouched** — scaling only changes the box's outer size; the crop geometry (the per-image inline `aspect-ratio`) is unaffected, so scaling cannot reintroduce the width-inflation bug fixed in #41.
- Behavior at extremes is intentional and user-initiated: at 150% a cropped slide reaches full column width (bounded by `min(100%,…)`, cannot overflow); at 50% both shrink to half.

## Control — in the existing `.dg-topbar`

Appended to the top bar (which today holds `↑ summary`, `⤢ expand all`, and the Ask-AI link), a compact group:

```html
<span class="dg-size" role="group" aria-label="Slide image size">
  <button class="dg-size-dec" type="button" aria-label="Smaller slides">−</button>
  <input class="dg-size-range" type="range" min="50" max="150" step="10" value="100"
         aria-label="Slide image size percent">
  <button class="dg-size-inc" type="button" aria-label="Larger slides">+</button>
  <span class="dg-size-val" title="Click to reset to 100%">100%</span>
</span>
```

- `−` / `+` step the range by one `step` (10%), clamped to [50,150].
- The range is the continuous control.
- `.dg-size-val` shows the live percent; **clicking it resets to 100%**.
- Values are integers 50…150 in the control; the CSS var is `percent/100` (e.g. `120` → `1.2`).

## Persistence — `localStorage`, sticky across docs

- Key: `digSlideScale`, value = integer percent string (e.g. `"120"`).
- **On load** (IIFE runs immediately): read the key → parse → **clamp to [50,150]** and snap to the nearest 10 → set `--dig-slide-scale` on `documentElement` and sync the control's value + readout. Missing/invalid → 100 (default). This runs before the user interacts, so every dig doc opens at the saved size.
- **On change** (range `input` event, +/− click, reset click): update the CSS var, the readout, and write the new percent to `localStorage`.
- All dig docs share one origin, so the choice carries across docs and reloads.

## Integration

- A new `sizeScript` IIFE alongside the existing `zoomScript` (~line 322) and `askAiScript` (~line 342) blocks; same self-invoking, listener-based pattern. Listeners are attached with a guard so the control works regardless of script order.
- The control markup is added to the `topBar` template string (~line 220).
- CSS added to `DIG_DOC_CSS`.
- No new dependency; no React (these are static self-contained HTML docs).

## Out of scope

- Per-image sizing (decision: global only).
- Affecting the lightbox/zoom overlay (it is full-screen `object-fit:contain` regardless of scale).
- Server-side persistence or per-user accounts (localStorage only).
- A separate "reset" button beyond click-to-reset on the readout (YAGNI).

## Error handling / edge cases

- Malformed or out-of-range `localStorage` value → clamp+snap, else default 100. Never throws.
- `localStorage` unavailable (private mode/blocked) → wrap read/write in try/catch; the control still works for the session, just doesn't persist.
- The CSS `var(--dig-slide-scale, 1)` fallback guarantees correct rendering before/without JS.

## Testing

### Unit / DOM (jest + the existing render-dig-deeper test harness)
| # | Assertion |
|---|---|
| 1 | CSS contains `max-height:calc(300px * var(--dig-slide-scale, 1))` on `.dg img.dig-slide` |
| 2 | CSS contains `width:min(100%, calc(540px * var(--dig-slide-scale, 1)))` on `.dg figure.dig-slide-crop` |
| 3 | `.dg img.dig-slide` rule includes `max-width:100%` (up-scale overflow guard) |
| 4 | Top bar contains the `.dg-size` control with range `min=50 max=150 step=10 value=100` and the three sub-elements |
| 5 | A `sizeScript` block is present and references `digSlideScale` + `--dig-slide-scale` |

### E2E (Playwright; mirror tests/e2e/dig-deeper.spec.ts route.fulfill harness)
| # | Scenario | Expected |
|---|---|---|
| S1 | Drag/set range to 50 | `documentElement` `--dig-slide-scale` = `0.5`; a slide's rendered width shrinks; readout `50%` |
| S2 | Click `+` from 100 | scale → `1.1`, readout `110%` |
| S3 | Reload page (same context) after setting 120 | control + var restored to 120% / `1.2` from localStorage |
| S4 | Click the `%` readout | resets to `100%` / `1` and persists 100 |
| S5 | Clamp: a stored `999` | snaps to 150 (max) on load |

---

## Files

| File | Change |
|---|---|
| `lib/html-doc/render-dig-deeper.ts` | CSS (`--dig-slide-scale` in the two slide rules + `max-width:100%`); `.dg-size` markup in `topBar`; new `sizeScript` IIFE; `.dg-size*` styles |
| `tests/lib/html-doc/render-dig-deeper.size.test.ts` | **New** — unit/DOM assertions (table above) |
| `tests/e2e/dig-slide-size.spec.ts` | **New** — Playwright scenarios S1–S5 |
