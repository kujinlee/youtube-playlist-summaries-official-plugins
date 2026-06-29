# Dig-Deeper Doc: Slide Image-Size Control (viewer slider)

**Date:** 2026-06-29
**Status:** Design — Codex adversarial review addressed (`docs/reviews/spec-dig-slide-size-control-codex.md`: 1 Blocking rejected w/ evidence as a false positive, 2 High + 4 Medium + 2 Low folded in). Ready for writing-plans. Implementation holds until PR #41 merges.
**Component:** `lib/html-doc/render-dig-deeper.ts` (CSS + top-bar control markup + a vanilla-JS IIFE)
**Version impact:** none — render-time only; no `DIG_GENERATOR_VERSION`/doc-version bump, no re-dig, no asset mutation. **The dig-deeper route is live-rendered per request** — `app/api/html/[id]/route.ts` does `serveHtml(renderDigDeeperDoc(...))`, re-reading the companion `.md` on every GET (unlike the deep-dive branch, which serves a *stored* `.html`). So there is no already-rendered artifact to go stale: the new CSS/markup/script reach every existing dig-deeper doc on the next page load with no stored-HTML rewrite. (Same delivery model as PR #38 image-sizing and #41 auto-crop.)
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

**Print (H2).** The reader's scale must not bleed into print, and the control must not print. Add a print override:
```css
@media print{
  .dg-size{display:none!important}
  .dg img.dig-slide{max-height:300px}
  .dg figure.dig-slide-crop{width:min(100%,540px)}
}
```
This resets printed slides to the base size regardless of the saved scale and hides the control. (The existing `@media print` block already hides `#theme-toggle`/`.dg-zoom`.)

## Control — in the existing `.dg-topbar`

Appended to the top bar (which today holds `↑ summary`, `⤢ expand all`, and the Ask-AI link), a compact group:

```html
<span class="dg-size" role="group" aria-label="Slide image size">
  <button class="dg-size-dec" type="button" aria-label="Smaller slides">−</button>
  <input class="dg-size-range" type="range" min="50" max="150" step="10" value="100"
         aria-label="Slide image size percent">
  <button class="dg-size-inc" type="button" aria-label="Larger slides">+</button>
  <button class="dg-size-val" type="button" aria-label="Reset slide image size to 100%">100%</button>
</span>
```

- `−` / `+` step the range by one `step` (10%), clamped to [50,150].
- The range is the continuous control.
- `.dg-size-val` is a **`<button>`** (M1 — keyboard-focusable, real semantics, not a `<span>`+`title`) showing the live percent; **clicking/Enter/Space resets to 100%**.
- Values are integers 50…150 in the control; the CSS var is `percent/100` (e.g. `120` → `1.2`).
- **Topbar overflow (M3):** add `.dg-topbar{flex-wrap:wrap}` and keep `.dg-size` compact — fixed-size `−`/`+` buttons, a bounded range width (e.g. `width:7rem`), and a non-shrinking readout — so the added control wraps cleanly on narrow viewports instead of clipping.

## Persistence — `localStorage`, sticky across docs

- Key: `digSlideScale`, value = integer percent string (e.g. `"120"`).
- **One shared sanitizer (M4)** — every load/change path runs values through this exact function before touching the CSS var, control, readout, or storage:
  ```js
  function sanitize(raw){var n=Number(raw);if(!Number.isFinite(n))return 100;n=Math.round(n/10)*10;return Math.min(150,Math.max(50,n));}
  ```
  (`Number` — not `parseInt` — so `"120px"`, `""`, `NaN`, `Infinity` all fail to `Number.isFinite` → default 100; valid numbers snap to the nearest 10 then clamp to [50,150].)
- **Pre-paint (H1 — no FOUC):** a tiny **head script** (placed next to the existing `THEME_HEAD_SCRIPT`, before first paint) reads `localStorage.digSlideScale`, runs `sanitize`, and sets `document.documentElement.style.setProperty('--dig-slide-scale', n/100)`. This guarantees the page paints at the *saved* size, not 100%-then-jump. Wrapped in try/catch (blocked storage → no-op, CSS `var(...,1)` fallback → 100%).
- **On load (body script):** read+`sanitize` the same key and **sync the control** (range value + readout text) to match the already-applied var.
- **On change** (range `input`, +/− click, reset click): `sanitize` → set the CSS var, update the readout, and write the percent to `localStorage` (try/catch).
- All dig docs share one origin, so the choice carries across docs and reloads.

## Integration

- **Two scripts (H1/M2):**
  - A **head script** (next to `THEME_HEAD_SCRIPT`) sets `--dig-slide-scale` pre-paint from sanitized `localStorage` (see Persistence). It does NOT touch the DOM control (which doesn't exist yet at head time).
  - A **body-end `sizeScript` IIFE**, placed after `${bodyHtml}` alongside the existing `zoomScript`/`askAiScript` blocks, syncs the control to the saved value and wires `input`/click listeners. It guards on the control's presence (no-op if absent); placement-after-body guarantees the control exists, so the prior vague "works regardless of script order" claim is dropped in favor of this concrete ordering.
- The control markup is added to the `topBar` template string.
- CSS added to `DIG_DOC_CSS` (the two scaled rules, `.dg-size*` styles incl. `.dg-topbar{flex-wrap:wrap}`, and the `@media print` override).
- No new dependency; no React (these are live-rendered self-contained HTML docs).

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
| 4 | Top bar contains the `.dg-size` control: range `min=50 max=150 step=10 value=100`, `−`/`+` buttons, and a **`<button class="dg-size-val">`** reset (not a span) |
| 5 | A body `sizeScript` block is present and references `digSlideScale` + `--dig-slide-scale` |
| 6 | A **head script** (pre-paint) references `digSlideScale` + sets `--dig-slide-scale` before body |
| 7 | `@media print` block resets `.dg img.dig-slide{max-height:300px}` + `.dg figure.dig-slide-crop{width:min(100%,540px)}` and hides `.dg-size` (H2) |
| 8 | `.dg-topbar` rule includes `flex-wrap:wrap` (M3) |

### E2E (Playwright; mirror tests/e2e/dig-deeper.spec.ts route.fulfill harness)
| # | Scenario | Expected |
|---|---|---|
| S1 | Set range to 50 | `documentElement` `--dig-slide-scale` = `0.5`; a slide's rendered width shrinks; readout `50%` |
| S2 | Click `+` from 100 | scale → `1.1`, readout `110%` |
| S3 | Reload (same context) after setting 120 | control + var restored to 120% / `1.2`; **no flash at 100% first** (head script applies pre-paint — assert the var is `1.2` immediately after navigation, before interaction) |
| S4 | Reset button: click AND keyboard (Tab→Enter/Space) | resets to `100%` / `1` and persists 100 (M1 a11y) |
| S5 | Clamp/sanitize on load: stored `999`→150, `-1`→50, `44`→50, `"120px"`/malformed→100, missing→100 (L2) |
| S6 | localStorage get/set stubbed to throw (L1) | control initializes at 100, can change to 110 + updates the var, does not throw (just doesn't persist) |
| S7 | Print emulation (`emulateMedia print`) at saved 150% | slide rendered at base size (max-height 300 / width 540), `.dg-size` hidden (H2) |

---

## Files

| File | Change |
|---|---|
| `lib/html-doc/render-dig-deeper.ts` | CSS (`--dig-slide-scale` in the two slide rules + `max-width:100%`; `.dg-size*` + `.dg-topbar{flex-wrap:wrap}`; `@media print` override); `.dg-size` markup in `topBar`; **pre-paint head script** (set var before paint); body `sizeScript` IIFE (sync control + listeners) |
| `tests/lib/html-doc/render-dig-deeper.size.test.ts` | **New** — unit/DOM assertions (table above) |
| `tests/e2e/dig-slide-size.spec.ts` | **New** — Playwright scenarios S1–S5 |
