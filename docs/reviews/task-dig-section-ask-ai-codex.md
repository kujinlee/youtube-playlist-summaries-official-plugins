# Adversarial Review — Feature 2: Per-Section + Whole-Video Ask-AI

**Reviewer:** Claude adversarial subagent (fresh, full file access; empirical jsdom round-trips, endSec edge fixtures, full typecheck).
**Date:** 2026-06-28
**Codex gap:** Codex CLI at usage limit; this Claude adversarial review substitutes (AFK). Re-run Codex pass before merge if access returns.

**Verdict: READY TO MERGE.** No Blocking/High. One Medium (coverage hole) addressed; rest Low.

## Verified SAFE (the likely-bug areas)
1. **Clipboard round-trip:** `data-ai-prompt=esc(prompt)` → `getAttribute` returns the literal prompt incl. `&t=75s` + unescaped apostrophe; `'` unescaped is safe in a double-quoted attr; Korean intact. jsdom-verified `=== original`.
2. **videoId injection:** `assertVideoId` (`/^[A-Za-z0-9_-]{1,20}$/`, route.ts:39) runs BEFORE render — no quote/`&`/`<` can reach the attribute or URL. Cannot break out.
3. **data-ai-url:** `esc(buildUrl(prompt))` un-escapes correctly on read → `window.open` gets a valid URL, `autosubmit=false`, prompt decodes to original. No double-encoding.
4. **endSec edges:** all-null / single / timed-then-skeleton / middle-skeleton / startSec===0 all correct (guard `!== null`, not truthy → no falsy-zero bug); orphans excluded from `slice(i+1)`. No off-by-one.
5. **Handler isolation:** `closest('.ask-ai')` null for `.dig*`/`.dig-slide`/theme; `.ask-ai` never nested in `.dig`/`.dig-slide`; ask-ai-while-zoom-open unreachable (overlay has no `.ask-ai`).
6. **Failure modes:** `window.open` runs before clipboard write → Gemini opens even if clipboard undefined/blocked; `.then(ok, err)` → no unhandled rejection.
7. **Language:** `Video.language` required enum; `ParsedSummary.lang` ('EN') never referenced in ask-ai path → no case mismatch.

`tsc` clean; ask-gemini + render-dig-deeper = 105 jest passed.

## Medium (addressed)
- **M1 — section Ask-AI path had zero E2E coverage** (A1 clicked only the whole-video `.first()`). The range computation + `&t=` URL clipboard payload — the feature's most logic-heavy branch — was static-HTML-only. → **Fixed:** added **A2** (section link, `&t=120s` round-trip + decoded-URL-equals-clipboard).

## Low (noted)
- L1 — toast auto-dismiss (2500ms) untested. L2 — toast text now asserted in A2 (`'copied'`). L3 — cosmetic "could not copy" message when clipboard rejects but URL carries the prompt (best-effort). No further action.

## Note
Flaky `pdf.test.ts` failure observed once under full-suite load (puppeteer/40s); passes 12/12 in isolation; not touched by this branch.
