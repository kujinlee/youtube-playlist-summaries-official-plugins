# Adversarial Review — Plan: Per-Section + Whole-Video Ask-AI

**Reviewer:** Claude adversarial subagent (fresh, full file access; every claim verified in Node / against real files).
**Date:** 2026-06-28
**Codex gap:** Codex CLI at usage limit; this Claude adversarial review satisfies the Post-Plan Gate (AFK). Re-run Codex pass before merge if access returns.

**Verdict:** Sound architecture; 1 Blocking + 1 High fixed in plan rev 2; rest verified correct.

## Blocking
- **B1 — E2E A1 assertion `clip.toContain('the video')` would commit red.** `.ask-ai').first()` is the top-bar **whole-video** link (top bar emitted before sections), whose prompt says "this video", not "the video". → **Fixed:** assert `toContain('this video')` + comment noting `.first()` is the whole-video link.

## High
- **H1 — "top-level describe building `html`" does not exist.** Each behavior describe builds its own local `html` in `beforeAll`. The right host is `Behavior 9` (≈line 876), whose `html` comes from `makeSummary()` (≈426, two timed sections → both top-bar and per-section `.ask-ai` render). → **Fixed:** plan now names `Behavior 9`/`makeSummary()`.

## Medium (doc hygiene, non-blocking)
- **M1 — delegation expression differs spec vs plan.** Both preserve the English fallback (`buildWholeVideoPrompt` only branches on `=== 'ko'`); plan's ternary is type-clean. No code impact.
- **M2 — "27 callers" is ~45.** Harmless (`language?` optional), but the number shouldn't be used as a checkpoint.

## Verified correct (checked against real code)
- **Escaping round-trips** (Node-verified): `data-ai-prompt=esc(raw)` → `getAttribute` returns literal `&t=…` (correct clipboard), EN+KO; `'` unescaped is safe in a double-quoted attr (`I'd`); `data-ai-url=esc(buildUrl(...))` → `new URL` yields correct `prompt`/`autosubmit=false`.
- `formatTimestamp` (transcript-timestamps.ts:9): 75→"1:15", 40→"0:40". `@/lib/transcript-timestamps` runtime import is E2E-safe (already loaded transitively via generate.ts:8).
- `endSec = sections.slice(i+1).find(s => s.startSec !== null)?.startSec ?? null`: correct (last→null→"onward", skips null-startSec neighbor; no off-by-one).
- **No event-handler conflicts:** nav.ts click (318–331) only acts on `.dig-*`; `.ask-ai` returns at 327 with no preventDefault; zoom click only closes when open; ask-ai `closest('.ask-ai')` scopes cleanly.
- route.ts:195: `video.language` (typed `'en'|'ko'`) in scope; `language: video.language` type-checks.
- `esc` (render:54), topBar (render:188), `.map((ms)→(ms,i))`, `control` `let` `+=`, section ask-ai gated on `startSec !== null` (renders for dug + un-dug) — all valid.
- `makeCompanionHtmlWithSlides()` renders one dug section (startSec 120) → a `.ask-ai` exists; `grantPermissions` + `readText()` on localhost + `addInitScript` window.open stub is a valid (repo-novel) Playwright pattern.
