# Codex Adversarial Review — Slide Auto-Crop Spec

**Date:** 2026-06-28
**Model:** gpt-5.5 (fresh session)
**Target:** `docs/superpowers/specs/2026-06-28-dig-slide-autocrop-design.md`
**Outcome:** Completed cleanly (no hang/limit). 2 Blocking, 3 High, 4 Medium, 3 Low.

---

## Blocking

**B1 — Wrapper CSS underspecified; won't reliably crop.**
`render-dig-deeper.ts:135`. A plain `<span>` is inline; `aspect-ratio`/`overflow` won't establish a crop viewport, and the child img keeps existing `.dig-slide` rules (`height:auto`, `margin:2em auto`, `max-height:360px`, border). `object-fit` only crops when the img has a concrete box matching the wrapper.
Fix: full CSS contract — `.dig-slide-crop{display:block;overflow:hidden;max-width:100%;width:min(100%,<W>px);aspect-ratio:W/keepH;margin:2em auto;border:1px solid var(--rule);border-radius:6px}` and `.dig-slide-crop>img.dig-slide{width:100%;height:100%;max-height:none;margin:0;border:0;border-radius:0;object-fit:cover}`. Move the size cap to the wrapper.

**B2 — Async pre-pass conflicts with the synchronous renderer call chain.**
`app/api/html/[id]/route.ts:195`. Spec keeps markdown-it render sync but doesn't say how the public renderer becomes async or where the pre-pass runs.
Fix: pick + document the boundary — either `await renderDigDeeperDoc(...)` everywhere, or a `prepareSlideCropMap(...)` in the route that passes a completed map into a still-sync renderer. Update all call sites + tests.

## High

**H1 — Cache key by filename+algoVersion is unsound.**
`lib/dig/slides.ts:157,:102`. Re-dig can produce the same `sectionId-start-end.jpg` and overwrite in place; the spec's "rewrites under a new name" is false for repeated tokens. Stale box served.
Fix: key by `{filename, size, mtimeMs, algoVersion}` or content hash.

**H2 — Concurrent cache writes undesigned.** Two simultaneous HTML requests can read-then-overwrite each other; a crash mid-write leaves malformed JSON.
Fix: per-path in-process serialization + temp-file atomic rename; on malformed JSON, log + rebuild.

**H3 — `DIG_CROP=on` globally is too aggressive.** Thresholds validated on 8 frames of one dark deck. No-op guards don't prevent over-crop on dark photographic slides, sparse dim content, low-contrast diagrams, or decks with content below `THR_BOT=40`.
Fix: default off, or per-deck allowlist, or stronger eligibility checks + visual fixtures from a light/photo deck before broad enable.

## Medium

**M1 — `scale=1:ih` scaler not pinned.** Specify `flags=area`; validate `stdout.length === height`; fail closed to `null` on mismatch.
**M2 — "walk markdown for asset refs" underspecified.** Regex can diverge from markdown-it. Use token parsing with the same containment rules; dedupe by canonical absolute path.
**M3 — Missing assets must not cache as no-op.** `render-dig-deeper.ts:111`. Distinguish `missing` from `no-op`; don't cache missing-file results.
**M4 — Gitignore claim false.** Spec says assets are gitignored; `.gitignore` doesn't ignore `assets/`/`.crop-cache.json`. Add real rules (or clarify the cache lives in the separate data tree).

## Low

**L1 — Non-destructive lightbox claim untested.** Add a regression test: overlay img gets the original uncropped data URI and has no crop-wrapper ancestor.
**L2 — Test plan lacks adversarial fixtures** for light bg, photos, dark low-contrast diagrams, tiny images, non-16:9, repeated filenames with changed content.
**L3 — Wrapper accessibility.** Prefer `<figure>` preserving `alt`, or `aria-hidden` only if the img stays the accessible object.
