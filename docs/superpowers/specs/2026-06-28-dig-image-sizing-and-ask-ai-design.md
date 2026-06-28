# Dig-Deeper Doc: Slide Image Sizing + Per-Section "Ask AI"

**Date:** 2026-06-28
**Status:** Design rev 2 — approved verbally ("approve proceed AFK after design phase"); spec gate satisfied by adversarial review in place of user review (AFK). Rev 2 folds in all Blocking/High/Medium adversarial findings (`docs/reviews/spec-dig-image-ask-ai-codex.md`).
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
1. **CSS resize.** Render each dug slide image as a centered figure capped by `max-height` (initial **360px**, tunable in verification) with `width:auto;max-width:100%`, a subtle border/radius, and `cursor:zoom-in`. Tall slides shrink; wide slides stay within the column. The markdown-it image rule tags **only the successfully-inlined asset `<img>`** with `class="dig-slide"`.
   - **Image-rule branches (`buildRenderer`, all four named):** success (base64 `<img>`) → gets `class="dig-slide"` + zoom; missing-file → `<span class="missing-slide">` unchanged (not a `.dig-slide`, not zoomable); containment-fail → `''` unchanged; non-asset src → bare `<img>` unchanged (no `.dig-slide`). The zoom selector is `img.dig-slide` only, so it never widens to the others.
   - **CSS targeting:** size via `.dg-slide` specifically — **not** `.dug img`. The existing `.dug img{margin:2em 0}` rule (`render-dig-deeper.ts:131`) and its assertion (`render-dig-deeper.test.ts:846–847`) are replaced; that test is updated in the same task (flagged, not a surprise).
2. **Click-to-zoom lightbox.** Clicking an `img.dig-slide` opens a full-screen overlay showing the same image at full resolution (`max-width/height:95vw/95vh`, `object-fit:contain`). Dismissal: backdrop click, `Esc`, and a `✕` close button (see Overlay Dismissal table).
   - **Esc coexistence (H1):** the doc already registers a `document` `keydown`/Esc handler for the `#_dg-ea-dlg` expand-all dialog (`nav.ts:304`). The zoom Esc handler is `document`-level and **must early-return unless the lightbox is actually open** (gate on overlay visibility); it does **not** `stopPropagation`. Both handlers are then additive-safe regardless of registration order.
   - **Stacking (H2):** `.dg-zoom` uses `z-index:9500` (above the existing `9000` overlays `#_dg-ea-dlg`/`#_dg-ea-prog`).
3. **No image processing, no new dependency, no asset mutation, no version bump.** The change is entirely in `render-dig-deeper.ts` (CSS + one inline script + an `<img>` class). The dig-deeper serve branch renders fresh on every GET (`route.ts:195`) — **no cache, no generator-version gate** (unlike the cached summary/deep-dive paths at `route.ts:87–91`) — so the change is live on every existing doc immediately.

### Files
- `lib/html-doc/render-dig-deeper.ts`:
  - `STRUCTURAL_CSS`/`DIG_DOC_CSS`: replace the generic `.dg img`/`.dug img` sizing rules with `.dg-slide` figure sizing + `.dg-zoom` overlay CSS (`z-index:9500`).
  - `buildRenderer`: add `class="dig-slide"` to the success-branch `<img>` only (the other three branches unchanged).
  - Add `ZOOM_OVERLAY` markup + `ZOOM_SCRIPT` inline JS (Esc gated on open-state); include in the page shell.
- `tests/lib/html-doc/render-dig-deeper.test.ts`: update the `.dug img` margin assertion (846–847) to the new `.dg-slide` rules.
- `tests/e2e/dig-deeper.spec.ts`: add zoom open + all three dismissal paths (the existing E2E already renders + browser-loads the doc).

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

Per the approved choice, prompts carry **video link + timestamp only** (no prose text). All builders take a fully-built `videoUrl` (`https://www.youtube.com/watch?v={id}`) so they reuse the existing launcher's exact whole-video text:

- **Section (en):** `Please review this section of the video (from {m:ss} to {m:ss}), then I'd like to ask questions about it: {videoUrl}&t={startSec}s`
- **Section (ko):** `이 영상의 해당 구간({m:ss}부터 {m:ss}까지)을 먼저 검토해 주세요. 이 부분에 대해 질문하고 싶습니다: {videoUrl}&t={startSec}s`
- **Whole (en):** `Please review this video first; I'd like to ask questions about it: {videoUrl}` (identical to current `buildGeminiPrompt`)
- **Whole (ko):** `아래 영상을 먼저 검토해 주세요. 이 영상에 대해 질문하고 싶습니다: {videoUrl}`

**Section end derivation (B1).** `MergedSection` has `startSec` but **no `endSec`** (`dig-merge.ts:26–33`). The renderer holds the full ordered `sections` array, so each section's end is **the next section's `startSec`** (the same "until next section" boundary the `▶` timestamps already use): `endSec = sections.slice(i+1).find(s => s.startSec !== null)?.startSec ?? null`. When `endSec` is `null` (last timed section, or none follow), `buildSectionPrompt` omits the upper bound — **en:** `...this section of the video (from {m:ss} onward)...`, **ko:** `...해당 구간({m:ss}부터)을...`. No `dig-merge.ts`/model change is needed — the derivation is render-local.

**Launch flow (inline JS):** on click of an `.ask-ai` element → copy its `data-ai-prompt` to the clipboard → `window.open(data-ai-url, '_blank', 'noopener,noreferrer')` → show a small inline "✓ copied — paste (⌘V) into Gemini" confirmation (auto-clears after ~2.5s); on clipboard failure show a fallback "copy this" affordance. Non-blocking (no overlay).

**Attribute encoding (M2).** Two distinct encodings, never conflated:
- `data-ai-prompt` = `esc(rawPrompt)` — HTML-**attribute** escape only (`esc()` handles `& < > "`), **no** percent-encoding (the clipboard must receive the literal prompt the user pastes). The embedded `&t={sec}s` becomes `&amp;t=…` in the attribute and decodes back to `&` on read.
- `data-ai-url` = `esc(AI_PROVIDER.buildUrl(rawPrompt))`, where `buildUrl` percent-encodes the prompt **inside the URL only** (existing `buildGeminiUrl`). A test asserts the rendered `data-ai-prompt` attribute round-trips to the exact clipboard string (incl. Korean).

**Provider configurability (server-side):** a single `AI_PROVIDER` config in `lib/ask-gemini.ts` (`{ name, buildUrl(prompt) }`). The render builds `data-ai-url` via the provider; the inline JS is provider-agnostic (copies `data-ai-prompt`, opens `data-ai-url`). Swapping providers later is a one-place change.

### Files
- `lib/ask-gemini.ts`:
  - add `buildSectionPrompt(videoUrl, startSec, endSec, lang)` (`endSec: number | null`) and `buildWholeVideoPrompt(videoUrl, lang)` (pure, tested). **Refactor existing `buildGeminiPrompt(video)` to delegate** → `buildWholeVideoPrompt(video.youtubeUrl, video.language)` (no duplicated string; existing behavior preserved). Keep `buildGeminiUrl`.
  - add `AI_PROVIDER` config const.
- `lib/html-doc/render-dig-deeper.ts`:
  - add **`language?: 'en' | 'ko'` (optional, default `'en'`)** to `renderDigDeeperDoc` args — optional so the 27 existing test call sites and the E2E keep compiling (B2). The serve route passes `video.language`.
  - top bar: append a whole-video `.ask-ai` link (with `data-ai-prompt`, `data-ai-url`).
  - per section heading: append a section-scoped `.ask-ai` link only when `startSec !== null` (end may still be `null` → "onward" phrasing).
  - add `ASK_AI_SCRIPT` inline JS + confirmation styling.
- `app/api/html/[id]/route.ts:195`: pass `language: video.language` (in scope at `route.ts:49–53`).
- tests: `ask-gemini.test.ts` (builders, en/ko, onward case, delegation); `render-dig-deeper.test.ts` (per-section + topbar `.ask-ai` data attrs, language threading); `tests/e2e/dig-deeper.spec.ts` (Ask-AI click → clipboard + confirmation; the inline-script wiring is only exercisable in a real browser — see Testing).

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
| Slide zoom lightbox | `Esc` key | Overlay closes **only when open**; handler early-returns otherwise so it never interferes with the expand-all dialog's own Esc (`nav.ts:304`) |
| Slide zoom lightbox | `✕` close button | Overlay closes |
| Ask-AI confirmation | (not an overlay) auto-clear after ~2.5s | Inline status disappears; no dismissal needed |

Stacking contract: `.dg-zoom` is `z-index:9500`, above the existing `9000` overlays (`#_dg-ea-dlg`, `#_dg-ea-prog`). The zoom lightbox is a viewer, not an async operation → non-blocking; opens only on explicit click.

---

## Testing strategy

**Test-layer reality (H3).** Inline `<script>` strings in the doc (`NAV_SCRIPT`, and the new `ZOOM_SCRIPT`/`ASK_AI_SCRIPT`) are **never executed in jest** — `render-dig-deeper.test.ts` only string-asserts their presence, and `nav.ts` itself carries a DRIFT WARNING that interactive behavior is jest-uncovered. The only place inline behavior actually runs is **Playwright E2E** (`tests/e2e/dig-deeper.spec.ts`, which renders the doc and loads it in a real browser). So: pure logic → jest; render contract (markup/attrs/CSS presence) → jest string assertions; **interactive behavior (zoom dismissal, Ask-AI clipboard+confirmation) → Playwright E2E** (extend the existing spec). No attempt to `eval` inline strings in jsdom.

**Feature 1**
- jest `render-dig-deeper.test.ts`: success-branch slide `<img>` carries `class="dig-slide"`; missing-slide `<span>` does NOT; CSS contains the `max-height` cap, `.dg-slide` sizing, and `.dg-zoom{…z-index:9500}`; zoom overlay markup + `ZOOM_SCRIPT` present; **the old `.dug img{margin:2em 0}` assertion (846–847) is updated** to the new rules.
- Playwright `dig-deeper.spec.ts`: click a `.dig-slide` → overlay opens; backdrop click closes; `Esc` closes; `✕` closes (all three dismissal paths, one block each); pressing `Esc` with no lightbox open does NOT throw / does not disturb the page.

**Feature 2**
- jest `ask-gemini.test.ts`: `buildSectionPrompt` (en/ko) includes the `m:ss–m:ss` range and `&t={startSec}s`; the `endSec === null` "onward" variant (en/ko); `buildWholeVideoPrompt` (en/ko) matches the existing whole-video text; `buildGeminiPrompt(video)` still returns the identical string via delegation; `AI_PROVIDER.buildUrl` percent-encodes only the prompt.
- jest `render-dig-deeper.test.ts`: each section with `startSec !== null` emits one `.ask-ai` with the exact `data-ai-prompt` (HTML-attr-escaped) and `data-ai-url`; `startSec === null` → none; the top bar emits exactly one whole-video `.ask-ai`; `language:'ko'` threads to Korean prompts; the rendered `data-ai-prompt` round-trips (HTML-unescape) to the exact clipboard string incl. Korean.
- Playwright `dig-deeper.spec.ts`: click an `.ask-ai` → clipboard receives the prompt and the "✓ copied" confirmation appears (use Playwright's clipboard permission); failure path optional.

TDD per project policy for the pure builders and render contract; `tsc --noEmit` gate.

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
1. **`max-height: 360px` too small for dense code slides** — mitigated by click-to-zoom (full res). Tunable in verification. Acceptance criterion: on a ~1440px-wide viewport the slide's primary heading/label text is legible at the capped size without zooming, and zoom covers fine detail (dense code). If a real slide fails this, raise the cap (e.g. 420–480px) rather than re-introduce crop.
2. **Gemini ignores `?prompt=`** for users without the extension — mitigated by the clipboard copy (the universal path), exactly as the existing launcher.
3. **Clipboard blocked** (permissions) — fallback affordance shows the prompt text to copy manually.

## Resolved adversarial findings (spec rev 2)
B1 (no `endSec` in model → derive from next section's start, nullable "onward"; no `dig-merge` change), B2 (`language` optional, default `'en'` → 27 callers unaffected), H1 (zoom Esc no-ops unless open), H2 (`.dg-zoom` z-index 9500), H3 (interactive behavior → Playwright E2E, not jsdom), M1 (four named image-rule branches; `.dug img` test updated), M2 (`data-ai-prompt` HTML-attr-escaped, no percent-encoding; `data-ai-url` percent-encoded), M3 (dig-deeper serve path is always-fresh, no version gate — confirmed), L1 (`buildGeminiPrompt` delegates to `buildWholeVideoPrompt`, no duplication). Full review in `docs/reviews/spec-dig-image-ask-ai-codex.md`.
