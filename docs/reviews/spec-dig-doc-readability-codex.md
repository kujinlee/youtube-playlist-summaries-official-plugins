# Spec Adversarial Review (Codex) — Dig-Doc Readability

**Spec:** docs/superpowers/specs/2026-06-29-dig-doc-readability-design.md. Model: frontier (--fresh). Clean run (no fallback). **0 Blocking, 4 High, 3 Medium, 1 Low.** All findings accepted.

| Sev | ID | Finding | Resolution in spec |
|---|---|---|---|
| High | H1 | Missing-asset slide refs render as `<span class="missing-slide">` (render-dig-deeper.ts:112-117), NOT a figure → "every in-flow slide is a figure+caption" is false. | Spec A2: missing-asset placeholder is UNCHANGED, excluded from figure/figcaption/toggle/print; add unit test (missing asset + caption toggle). |
| High | H2 | Zoom overlay only builds an `<img>` copying src/alt (render-dig-deeper.ts:334-350); no caption node. "Caption visible in zoom" was underspecified. | Spec A4: overlay gets a caption element populated via **`textContent`** from the clicked slide's caption; respects `dg-hide-caps` (hidden when captions off). |
| High | H3 | Sub-heading "plain descriptive **English**" contradicts the Korean-language contract (generate.ts:57-60: entire response in Korean when lang==='ko'). | Spec B1: change to "**same language as the response**, short/plain/descriptive"; test both EN + KO prompt wording. |
| High | H4 | figcaption "same sanitized string" risks interpolating untrusted persisted text as HTML; safe invariant is render-time escaping. | Spec A2: server figcaption uses **`esc(altAttr)`**; JS overlay uses `textContent`; stored captions are NOT trusted as HTML. |
| Med | M1 | `tests/e2e/dig-slide-crop.spec.ts:105-122` also hardcodes `figure.dig-slide-crop` — missed in change list. | Added to Part A update list. |
| Med | M2 | `tests/lib/html-doc/render-dig-deeper.size.test.ts:28-50` asserts `figure.dig-slide-crop` width + print CSS — missed. | Added to Part A update list. |
| Med | M3 | Orphan dug body renders OUTSIDE `.dug` (render-dig-deeper.ts:299-303) → `.dug h3` polish won't reach orphan-body `###`. | Spec B3: wrap orphan rendered body in `.dug` (or add orphan selector to the h3 rule). |
| Low | L1 | Empty captions `![](assets/...)` are a supported state (slide-tokens.ts:15/24, slides.ts:175); "every dug doc has caption text" overstated. | Background + A1 reworded to "caption, when present"; no-figcaption-on-empty test kept. |
