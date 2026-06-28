# Code Review — Feature 2: Per-Section + Whole-Video Ask-AI

**Reviewer:** Claude code-review subagent (fresh, full file access)
**Date:** 2026-06-28
**Branch:** `feat/dig-section-ask-ai`

**Verdict: Solid, spec-compliant. No Critical.** Escaping split, endSec derivation, and delegation all correct.

## Important (addressed)
- **I1 — A1 E2E only exercised the whole-video link; the per-section escaping round-trip (`&t=…s`) was browser-unverified.** → **Fixed:** added **A2** clicking the per-section `.ask-ai`, asserting the clipboard contains `this section of the video` + literal `&t=120s` (the escape/unescape contract executing in a real browser).
- **I2 — A1 didn't verify the opened URL's decoded prompt matches the clipboard.** → **Fixed:** A2 asserts `new URL(opened).searchParams.get('prompt') === clip`.

## Minor
- **M1 — three coexisting document click handlers (nav/zoom/ask-ai) undocumented.** → **Fixed:** comment added next to `askAiScript`.
- **M2 — `e.preventDefault()` on an href-less anchor is a harmless no-op.** Left as-is (defensive).
- **M3 — toast `setTimeout` not cleared on rapid re-click** (cosmetic; spec accepts auto-clear). No action.
- **M4 — toast/label text is English even under `language:'ko'`** (spec localizes prompts only; labels are English in the spec table). No action.

## Verified OK
No circular import (ask-gemini→transcript-timestamps one-way); `video.language` is a required `z.enum(['en','ko'])`; `buildGeminiPrompt` delegation is byte-identical to the old strings (guarded by existing tests); endSec derivation correct for "to"/"onward"/ko; toast `var(--card)`/`var(--ink)` defined in both palettes.
