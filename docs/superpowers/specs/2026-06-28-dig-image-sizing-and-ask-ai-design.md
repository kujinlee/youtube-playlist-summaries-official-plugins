# Dig-Deeper Doc: Slide Image Sizing + Per-Section "Ask AI"

**Date:** 2026-06-28
**Status:** Design — approved verbally ("approve proceed AFK after design phase"); spec gate satisfied by adversarial review in place of user review (AFK).
**Component:** `lib/html-doc/render-dig-deeper.ts`, `lib/ask-gemini.ts`
**Version impact:** none — both features are render-time only; no `DIG_GENERATOR_VERSION` bump, no re-dig, no asset mutation.

Two independent features, shipped as **two PRs** (images first, then Ask-AI).

---

## Feature 1 — Slide image sizing (resize + click-to-zoom)

### Problem
Slide screenshots inline at near-full-column width and break prose flow. They should be small enough to sit inside the reading flow yet readable as-is, with full detail on demand.

### Empirical finding (spike, 2026-06-28) — auto-crop is DROPPED
The original plan included auto-cropping the "extra space" at the slide edges. A spike with `jimp.autocrop` on the real OKF slides (`2kKkb01GxYQ`, 1280×720 full-bleed dark-theme slides with a radial gradient) disproved this:

- `cropdetect` (ffmpeg, black-border detector) finds nothing — the borders are not flat black bars.
- `jimp.autocrop` trims **25–44% of width at every tolerance tested** (0.01–0.5). At tolerance 0.1 the cropped output (viewed directly) **cut the slide title, the code card's right edge, the left-side labels, and the bottom source line.**
- Root cause: these slides are full-bleed by design — title (top), source line (bottom), labels (left), code card (right) all reach near the frame edges, and the dim gray text sits within color-tolerance of the dark gradient background. There is **no rectangular crop that removes margin without cutting content**, and no universally safe tolerance.

**Decision:** do not auto-crop. CSS resize + click-to-zoom achieves the actual goal (small in flow, full detail on demand) reliably, instantly on every existing doc, with zero risk of cutting content.

### Design
1. **CSS resize.** Render each dug slide image as a centered figure capped by `max-height` (initial **360px**, tunable in verification) with `width:auto;max-width:100%`, a subtle border/radius, and `cursor:zoom-in`. Tall slides shrink; wide slides stay within the column. The markdown-it image rule tags each inlined slide `<img>` with `class="dig-slide"`.
2. **Click-to-zoom lightbox.** Clicking a `.dig-slide` opens a full-screen overlay showing the same image at full resolution (`max-width/height:95vw/95vh`, `object-fit:contain`). The overlay reuses the doc's existing modal styling conventions. Dismissal: backdrop click, `Esc`, and a `✕` close button (see Overlay Dismissal table).
3. **No image processing, no new dependency, no asset mutation, no version bump.** The change is entirely in `render-dig-deeper.ts` (CSS + one inline script + an `<img>` class) and applies to all existing docs on next serve.

### Files
- `lib/html-doc/render-dig-deeper.ts`:
  - `STRUCTURAL_CSS`/`DIG_DOC_CSS`: replace the generic `.dg img`/`.dug img` rules with `.dg-slide` figure sizing + `.dg-zoom` overlay CSS.
  - `buildRenderer`: add `class="dig-slide"` to the inlined slide `<img>` (the `assets/` branch only; non-asset imgs unchanged).
  - Add `ZOOM_OVERLAY` markup + `ZOOM_SCRIPT` inline JS; include in the page shell.

---

## Feature 2 — Per-section + whole-video "Ask AI"

### Problem
The reader should be able to open an AI chat seeded with the video, either scoped to one section or to the whole video, to ask follow-up questions. Provider is Gemini now, configurable later.

### Design
Builds on the existing `lib/ask-gemini.ts` pattern (build a prompt, copy it to the clipboard, open the provider — Gemini's web app ignores `?prompt=` without a browser extension, so the clipboard copy is the universal path). Ported into the standalone dig-doc as self-contained inline JS.

**Two entry points** — which double as the user's (1)-vs-(2) ingestion experiment, with no extra UI:

| Entry point | Placement | Prompt framing | Experiment |
|---|---|---|---|
| **Ask AI about this video** | top bar | review the WHOLE video, then ask | (1) ingest whole |
| **ask AI** | each section heading controls | review THIS section (m:ss–m:ss), then ask | (2) ingest section |

Per the approved choice, prompts carry **video link + timestamp only** (no prose text):

- **Section (en):** `Please review this section of the video (from {m:ss} to {m:ss}), then I'd like to ask questions about it: https://www.youtube.com/watch?v={id}&t={startSec}s`
- **Section (ko):** `이 영상의 해당 구간({m:ss}부터 {m:ss}까지)을 먼저 검토해 주세요. 이 부분에 대해 질문하고 싶습니다: https://www.youtube.com/watch?v={id}&t={startSec}s`
- **Whole (en):** `Please review this video first; I'd like to ask questions about it: https://www.youtube.com/watch?v={id}` (unchanged from current `buildGeminiPrompt`)
- **Whole (ko):** `아래 영상을 먼저 검토해 주세요. 이 영상에 대해 질문하고 싶습니다: https://www.youtube.com/watch?v={id}`

**Launch flow (inline JS):** on click of an `.ask-ai` element → copy its `data-ai-prompt` to the clipboard → `window.open(data-ai-url, '_blank', 'noopener,noreferrer')` → show a small inline "✓ copied — paste (⌘V) into Gemini" confirmation (auto-clears after ~2.5s); on clipboard failure show a fallback "copy this" affordance. Non-blocking (no overlay).

**Provider configurability (server-side):** a single `AI_PROVIDER` config in `lib/ask-gemini.ts` (`{ name, appUrl, buildUrl(prompt) }`). The render builds `data-ai-url` via the provider; the inline JS is provider-agnostic (copies `data-ai-prompt`, opens `data-ai-url`). Swapping providers later is a one-place change.

### Files
- `lib/ask-gemini.ts`:
  - add `buildSectionPrompt(videoId, startSec, endSec, lang)` and `buildWholeVideoPrompt(videoId, lang)` (pure, tested). Keep `buildGeminiUrl`.
  - add `AI_PROVIDER` config const.
- `lib/html-doc/render-dig-deeper.ts`:
  - add `language: 'en' | 'ko'` to `renderDigDeeperDoc` args (threaded from the serve route's `video.language`).
  - top bar: append a whole-video `.ask-ai` link (with `data-ai-prompt`, `data-ai-url`).
  - per section heading: append a section-scoped `.ask-ai` link (only when `startSec !== null`, so the range is known).
  - add `ASK_AI_SCRIPT` inline JS + confirmation styling.
- serve route (caller of `renderDigDeeperDoc`): pass `language`.

---

## URL Contracts

| Component | Link text | Full URL (all params) |
|---|---|---|
| Section Ask-AI | `ask AI` (in heading) | `https://gemini.google.com/app?prompt={encoded section prompt}&autosubmit=false` — opened; `data-ai-prompt` = the section prompt (copied to clipboard) |
| Whole-video Ask-AI | `Ask AI about this video` (top bar) | `https://gemini.google.com/app?prompt={encoded whole prompt}&autosubmit=false` — opened; `data-ai-prompt` = the whole prompt (copied) |
| Section prompt's embedded source link | (inside prompt text) | `https://www.youtube.com/watch?v={id}&t={startSec}s` |
| Whole prompt's embedded source link | (inside prompt text) | `https://www.youtube.com/watch?v={id}` |
| Slide zoom | (image, no href) | none — opens an in-page overlay, not a URL |

`encodeURIComponent` is applied only to the prompt value (per existing `buildGeminiUrl`). `videoId` is escaped where interpolated into HTML attributes.

## Overlay Dismissal

| Component | Mechanism | Expected result |
|---|---|---|
| Slide zoom lightbox | Backdrop click (outside image) | Overlay closes |
| Slide zoom lightbox | `Esc` key | Overlay closes |
| Slide zoom lightbox | `✕` close button | Overlay closes |
| Ask-AI confirmation | (not an overlay) auto-clear after ~2.5s | Inline status disappears; no dismissal needed |

The zoom lightbox is a viewer, not an async operation → non-blocking by nature; opens only on explicit click.

---

## Testing strategy

**Feature 1**
- `render-dig-deeper.test.ts`: inlined slide `<img>` carries `class="dig-slide"`; CSS contains the `max-height` cap and `.dg-zoom` overlay rules; the zoom overlay markup + script are present in the page; non-asset `<img>` is unchanged.
- Zoom dismissal logic (backdrop/Esc/✕) verified via a DOM/component test of `ZOOM_SCRIPT` (or Playwright if a harness exists for the served doc). All three dismissal paths covered.

**Feature 2**
- `ask-gemini.test.ts`: `buildSectionPrompt` (en/ko) includes the `m:ss–m:ss` range and the `&t={startSec}s` URL; `buildWholeVideoPrompt` (en/ko) matches the existing whole-video text; `AI_PROVIDER.buildUrl` percent-encodes only the prompt.
- `render-dig-deeper.test.ts`: each section with `startSec !== null` emits one `.ask-ai` with the exact `data-ai-prompt` and `data-ai-url`; sections with `startSec === null` emit none; the top bar emits exactly one whole-video `.ask-ai`; `language` threads to Korean prompts.
- Launch/confirmation/dismissal logic of `ASK_AI_SCRIPT` (clipboard success → confirmation, failure → fallback) via DOM/component test.

TDD per project policy; `tsc --noEmit` gate. Pure prompt builders and the render contract are TDD; inline-script wiring is covered by DOM/component tests, not full E2E unless a served-doc harness already exists.

---

## Security
- `window.open(..., 'noopener,noreferrer')` (matches existing `AskGeminiMenuItem`); with `noopener` the return is null even on success → ignored.
- Clipboard write via `navigator.clipboard.writeText`; localhost is a secure context. Failure path shows a manual-copy fallback.
- `videoId` and all interpolated values are HTML-escaped in attributes; prompt values are `encodeURIComponent`-encoded in the provider URL.
- No new server endpoints, no filesystem writes, no exec. Feature 1 adds no image processing. The existing asset-inlining containment check in `buildRenderer` is unchanged.

## Scope
**In:** CSS resize + click-to-zoom for dug slides; per-section + whole-video Ask-AI in the dig doc; section/whole prompt builders + provider config; `language` threading.
**Out (follow-ups):** auto-crop (dropped — spike-disproven for full-bleed slides); per-section choice of both ingestion framings from one menu; additional AI providers; caching the rendered/zoomed images.

## Risks
1. **`max-height: 360px` too small for dense code slides** — mitigated by click-to-zoom (full res). Tunable in verification.
2. **Gemini ignores `?prompt=`** for users without the extension — mitigated by the clipboard copy (the universal path), exactly as the existing launcher.
3. **Clipboard blocked** (permissions) — fallback affordance shows the prompt text to copy manually.
