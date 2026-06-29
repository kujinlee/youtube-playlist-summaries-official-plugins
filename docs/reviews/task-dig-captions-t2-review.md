# PR1 (dig captions) Task 2 — Claude Code Review

**Diff:** eeb9bf6..48f6e3e (3 files: `render-dig-deeper.ts` + captions unit + captions E2E).
**Verdict:** Task quality **Approved** — 0 Critical/Important.

## Spec Compliance — ✅
DIG_CAPTIONS_SANITIZE_JS returns 'on' for everything except exact 'off' (null/''/‹'ON'›/garbage→'on'); CAPTIONS_HEAD_SCRIPT injected after SIZE_HEAD_SCRIPT, before `<style>` (FOUC-safe, index-asserted); `apply(read(),false)` initial sync present + annotated "REQUIRED"; click toggles on current class (race-free); all localStorage in try/catch (head block + read getItem + apply setItem); aria-pressed + ▣/▢ glyph update; CSS `.dg-hide-caps .dig-cap{display:none}` + print `.dg-caps-toggle{display:none!important}`. Render-only: generate.ts untouched, no version bump.

## Test quality
Print assertion is plain `toContain('.dg-caps-toggle{display:none!important}')` (not a cross-brace regex). Sanitizer table uses `new Function(DIG_CAPTIONS_SANITIZE_JS)`. C3 pre-paint proof has `if(!first)return;` guard after not-null assert. C4 validates blocked-storage path. 16 unit + C1–C4 E2E green.

## Issues
Critical/Important: none.
### Minor (awareness only — intentional, matches DIG_SLIDE_SANITIZE_JS precedent)
- captionsScript inlines the sanitizer fn via `${DIG_CAPTIONS_SANITIZE_JS}` interpolation (browser path) while tests reconstruct via `new Function` — structurally different paths but behaviorally identical; same accepted pattern as the size slider.

## Note
Full-suite pdf.test.ts failures = confirmed pre-existing parallel-load flake; Task-2 diff touches only render-dig-deeper.ts + caption tests (proven non-involvement). Codex adversarial review recorded in `task-dig-captions-t2-codex.md`.
