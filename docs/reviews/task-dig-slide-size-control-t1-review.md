# Task 1 (dig slide size control) — Claude Code Review

**Diff:** b73579c..2dcd00f (`lib/html-doc/render-dig-deeper.ts` + new `tests/lib/html-doc/render-dig-deeper.size.test.ts`)
**Verdict:** Task quality **Approved**.

## Spec Compliance — ✅ all 14 locked constraints verified
Range 50–150/step 10/default 100; var=percent/100 (head:190, body:395); key `digSlideScale` (3×, consistent); `DIG_SLIDE_SANITIZE_JS` defined once (185), interpolated into both scripts, no inline dup; null/'' guard FIRST; `Number` not parseInt; snap-to-10; clamp [50,150]; all localStorage in try/catch; CSS `var(…,1)` fallback; head script before `<style>`; render-only (no version bump, no dep); print hides `.dg-size` + resets both rules; reset is real `<button>`; U+2212 minus; percent readout.

⚠️ `flex-wrap:wrap` asserted inside the print test — slightly misleading association but inconsequential.

## Strengths
DRY sanitizer exactly as mandated; null/empty guard correctly ordered before `Number()`; dec/inc never escape clamp (both route through `s()`); FOUC prevention structurally correct (sync IIFE before stylesheet); genuine RED→GREEN TDD; no regression (existing `max-height:300px` assertion still passes via print reset rule).

## Issues
### Important (Should Fix)
1. **Print-reset test under-asserts** — `render-dig-deeper.size.test.ts:217`. Regex `@media print{[^}]*\.dg-size{display:none!important}` stops at the first `}`, never reaching `.dg img.dig-slide{max-height:300px}` / `.dg figure.dig-slide-crop{width:min(100%,540px)}`. Print slide resets present in production but UNGUARDED against accidental deletion. Fix: add two `toContain` assertions for the slide-rule resets in the same block.
2. **(Quality nit, non-bug)** Reviewer notes `s(s(x))` double-application on startup + redundant `Number()` in dec/inc — explicitly "cannot produce a bug" (s is idempotent). Optional cleanup; treated as Minor.

### Minor
3. No direct unit test of sanitizer edge branches (tested indirectly via rendered HTML).
4. inc button uses ASCII `+` (spec only specified U+2212 minus); cosmetic.

## Codex gap
Codex adversarial review dispatched in parallel (--fresh); recorded separately in `task-dig-slide-size-control-t1-codex.md`.
